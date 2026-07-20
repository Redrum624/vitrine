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
  private seq = 0;
  // Every not-yet-settled run, keyed by message id — so a worker-level failure (error /
  // messageerror / watchdog / dispose) can reject ALL in-flight promises, not just one.
  private pending = new Map<number, { reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private workerFactory?: () => Worker) {}
  private get w(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory ? this.workerFactory() : createEnhanceWorker();
      // F3 failure path: a worker crash (module-eval error, OOM, killed process) fires 'error';
      // an undeserializable message fires 'messageerror'. Both mean every in-flight run is dead.
      this.worker.addEventListener('error', (e) => {
        const msg = (e as ErrorEvent).message;
        this.failAll(new Error(`enhance worker crashed: ${msg || 'unknown error'}`));
      });
      this.worker.addEventListener('messageerror', () => {
        this.failAll(new Error('enhance worker message failed to deserialize'));
      });
    }
    return this.worker;
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
    if (pend.length > 0) logger.error(`EnhanceWorkerClient: failing ${pend.length} in-flight run(s) — ${err.message}`);
    for (const p of pend) { clearTimeout(p.timer); p.reject(err); }
  }
  run(rgba: Float32Array, width: number, height: number, params: EnhanceParams): Promise<EnhanceWorkerResult> {
    const id = ++this.seq; const w = this.w;
    return new Promise((resolve, reject) => {
      // Settle THIS run: clear its watchdog + pending entry + listener. Runs on the normal
      // message path; the failAll path clears the map wholesale instead.
      const settle = () => {
        const p = this.pending.get(id);
        if (p) clearTimeout(p.timer);
        this.pending.delete(id);
        w.removeEventListener('message', onMsg);
      };
      const onMsg = (e: MessageEvent) => {
        const m = e.data as { type: string; id: number; error?: string } & EnhanceWorkerResult;
        if (m.id !== id) return;
        settle();
        if (m.type === 'ENHANCE_COMPLETE') resolve({ enhanced: m.enhanced, base: m.base, width: m.width, height: m.height });
        else reject(new Error(m.error || 'enhance worker failed'));
      };
      const timer = setTimeout(() => {
        this.failAll(new Error(`enhance worker timed out after ${ENHANCE_WORKER_WATCHDOG_MS / 1000}s (${width}×${height})`));
      }, ENHANCE_WORKER_WATCHDOG_MS);
      this.pending.set(id, { reject, timer });
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'ENHANCE', id, data: { rgba, width, height, params } }, [rgba.buffer]);
    });
  }
  dispose(): void {
    // failAll (not a bare terminate) so any still-pending run rejects instead of hanging forever.
    this.failAll(new Error('enhance worker disposed'));
  }
}
export const enhanceWorkerClient = new EnhanceWorkerClient();
