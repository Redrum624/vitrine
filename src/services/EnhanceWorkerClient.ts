import { EnhanceParams } from '../utils/enhanceChain';
import { createEnhanceWorker } from '../utils/createEnhanceWorker';
import { logger } from '../utils/Logger';

export interface EnhanceWorkerResult { enhanced: Float32Array; base: Float32Array; width: number; height: number }

/**
 * Watchdog bound per run (F3, 2026-07-20 audit): before this, a worker crash or hang left the
 * run() promise pending forever — EnhanceService's `inFlight`/`isProcessing` stayed stuck until
 * app restart. The bound must comfortably cover the WORST legitimate whole-frame run: the enhance
 * chain self-tiles above 48 MP and applyUpscale's feasibility cap bounds output at 160 MP, with
 * the RL deconvolution (12 iterations × 2 separable blurs) dominating — seconds to low tens of
 * seconds per tile on slow hardware. 120 s is roughly an order of magnitude of headroom over the
 * per-message worst case while still unsticking the UI within the same sitting.
 */
export const ENHANCE_WORKER_WATCHDOG_MS = 120_000;

export class EnhanceWorkerClient {
  private worker: Worker | null = null;
  // W4 R1: the packaged factory boots the worker from a fetched blob (async), so creation is a
  // promise. A SYNC factory result (tests' FakeWorker; the dev-server path) is attached
  // immediately — preserving the pre-W4 semantic that crash listeners exist the moment a run
  // is issued.
  private workerPromise: Promise<Worker> | null = null;
  private seq = 0;
  // Every not-yet-settled run, keyed by message id — so a worker-level failure (error /
  // messageerror / watchdog / dispose) can reject ALL in-flight promises, not just one.
  private pending = new Map<number, { reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private workerFactory?: () => Worker | Promise<Worker>) {}

  /** Attach the F3 failure listeners and record the live worker. */
  private adopt(w: Worker): Worker {
    // F3 failure path: a worker crash (module-eval error, OOM, killed process) fires 'error';
    // an undeserializable message fires 'messageerror'. Both mean every in-flight run is dead.
    w.addEventListener('error', (e) => {
      const msg = (e as ErrorEvent).message;
      this.failAll(new Error(`enhance worker crashed: ${msg || 'unknown error'}`));
    });
    w.addEventListener('messageerror', () => {
      this.failAll(new Error('enhance worker message failed to deserialize'));
    });
    this.worker = w;
    return w;
  }

  private ensureWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      let created: Worker | Promise<Worker>;
      try {
        created = this.workerFactory ? this.workerFactory() : createEnhanceWorker();
      } catch (e) {
        // Synchronous factory throw: don't cache the failure — the next run retries a fresh boot.
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
      if (created && typeof (created as Promise<Worker>).then === 'function') {
        const boot: Promise<Worker> = (created as Promise<Worker>).then((w) => {
          // W5 R3 (W4 review follow-up c): failAll/dispose may have cleared — or a later run
          // replaced — the cached promise while this boot was in flight. Adopting the late
          // worker would leak it (never terminated) and attach an 'error' listener that could
          // later failAll a FRESH worker. Terminate it and reject this stale boot instead.
          if (this.workerPromise !== boot) {
            w.terminate();
            throw new Error('enhance worker boot superseded (client reset during boot)');
          }
          return this.adopt(w);
        });
        this.workerPromise = boot;
        // A failed async boot (fetch failed, blob refused) must not poison future runs: clear the
        // cached promise so the next run retries, mirroring failAll's drop-and-reboot semantic.
        boot.catch(() => { if (this.workerPromise === boot) this.workerPromise = null; });
      } else {
        this.workerPromise = Promise.resolve(this.adopt(created as Worker));
      }
    }
    return this.workerPromise;
  }

  /**
   * Reject every in-flight run and drop the worker so the next run boots a fresh one — a crashed
   * or hung worker cannot be trusted for queued or future messages (it processes sequentially).
   */
  private failAll(err: Error): void {
    const pend = [...this.pending.values()];
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.workerPromise = null;
    if (pend.length > 0) logger.error(`EnhanceWorkerClient: failing ${pend.length} in-flight run(s) — ${err.message}`);
    for (const p of pend) { clearTimeout(p.timer); p.reject(err); }
  }

  /**
   * Shared request/response round-trip for both message kinds. Registers the watchdog + pending
   * entry SYNCHRONOUSLY (so failAll/dispose reach a run even while its worker is still booting),
   * then posts once the worker is live. `transfer` moves the payload buffer off this thread.
   */
  private request<T>(
    type: 'ENHANCE' | 'ENHANCE_AI_FINISH',
    payload: { rgba: Float32Array; width: number; height: number; params: EnhanceParams },
    parse: (m: Record<string, unknown>) => T,
    label: string,
  ): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      let target: Worker | null = null;
      // Settle THIS run: clear its watchdog + pending entry + listener. Runs on the normal
      // message path; the failAll path clears the map wholesale instead (its worker is
      // terminated, so listener removal is moot there).
      const settle = () => {
        const p = this.pending.get(id);
        if (p) clearTimeout(p.timer);
        this.pending.delete(id);
        target?.removeEventListener('message', onMsg);
      };
      const onMsg = (e: MessageEvent) => {
        const m = e.data as { type: string; id: number; error?: string } & Record<string, unknown>;
        if (m.id !== id) return;
        settle();
        if (m.type === `${type}_COMPLETE`) {
          try { resolve(parse(m)); } catch (err) { reject(err instanceof Error ? err : new Error(String(err))); }
        } else {
          reject(new Error((m.error as string) || `enhance worker ${label} failed`));
        }
      };
      const timer = setTimeout(() => {
        this.failAll(new Error(`enhance worker timed out after ${ENHANCE_WORKER_WATCHDOG_MS / 1000}s (${payload.width}×${payload.height})`));
      }, ENHANCE_WORKER_WATCHDOG_MS);
      this.pending.set(id, { reject, timer });
      this.ensureWorker().then((w) => {
        // failAll / dispose may have settled this run while the worker was booting.
        if (!this.pending.has(id)) return;
        target = w;
        w.addEventListener('message', onMsg);
        w.postMessage({ type, id, data: payload }, [payload.rgba.buffer]);
      }).catch((e) => {
        if (!this.pending.has(id)) return;
        settle();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  run(rgba: Float32Array, width: number, height: number, params: EnhanceParams): Promise<EnhanceWorkerResult> {
    return this.request('ENHANCE', { rgba, width, height, params }, (m) => ({
      enhanced: m.enhanced as Float32Array,
      base: m.base as Float32Array,
      width: m.width as number,
      height: m.height as number,
    }), 'run');
  }

  /**
   * W4 R4: the AI-route finishing pass (enhanceAiUpscaled) on the worker — whole-frame, same
   * dims in as out. The input buffer is TRANSFERRED (detached on this thread); callers must copy
   * anything they still need before calling.
   */
  runAiFinish(rgba: Float32Array, width: number, height: number, params: EnhanceParams): Promise<Float32Array> {
    return this.request('ENHANCE_AI_FINISH', { rgba, width, height, params }, (m) => {
      const out = m.rgba;
      if (!(out instanceof Float32Array)) throw new Error('enhance worker AI-finish returned no buffer');
      return out;
    }, 'AI finish');
  }

  dispose(): void {
    // failAll (not a bare terminate) so any still-pending run rejects instead of hanging forever.
    this.failAll(new Error('enhance worker disposed'));
  }
}
export const enhanceWorkerClient = new EnhanceWorkerClient();
