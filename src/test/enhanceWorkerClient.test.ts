import { EnhanceWorkerClient, ENHANCE_WORKER_WATCHDOG_MS } from '../services/EnhanceWorkerClient';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

// Typed-listener fake (message / error / messageerror kept separate, like a real Worker). Message
// completion is dispatched SYNCHRONOUSLY from postMessage — the client attaches its listener before
// posting, and synchronous dispatch keeps the watchdog tests independent of faked microtasks.
class FakeWorker {
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  posted: { msg: unknown; transfer: unknown }[] = [];
  terminated = false;
  constructor(private silent = false) {}
  addEventListener(t: string, cb: (e: unknown) => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), cb]);
  }
  removeEventListener(t: string, cb: (e: unknown) => void): void {
    this.listeners.set(t, (this.listeners.get(t) ?? []).filter((l) => l !== cb));
  }
  dispatch(t: string, e: unknown): void {
    [...(this.listeners.get(t) ?? [])].forEach((l) => l(e));
  }
  postMessage(msg: { id: number }, transfer: unknown): void {
    this.posted.push({ msg, transfer });
    if (this.silent) return;
    this.dispatch('message', { data: { type: 'ENHANCE_COMPLETE', id: msg.id, enhanced: new Float32Array(4), base: new Float32Array(4), width: 2, height: 2 } });
  }
  terminate(): void { this.terminated = true; }
}

describe('EnhanceWorkerClient', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('posts ENHANCE and resolves on ENHANCE_COMPLETE', async () => {
    const fake = new FakeWorker();
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    const rgba = new Float32Array([0.5, 0.5, 0.5, 1]);
    const r = await client.run(rgba, 1, 1, DEFAULT_ENHANCE_PARAMS);
    expect((fake.posted[0].msg as { type: string }).type).toBe('ENHANCE');
    expect(r.width).toBe(2); expect(r.base.length).toBe(4);
  });

  it('rejects on ENHANCE_ERROR', async () => {
    const fake = new FakeWorker(true);
    fake.postMessage = function (this: FakeWorker, msg: { id: number }): void { this.dispatch('message', { data: { type: 'ENHANCE_ERROR', id: msg.id, error: 'boom' } }); } as never;
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    await expect(client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS)).rejects.toThrow('boom');
  });

  // F3 (2026-07-20 audit): a worker crash used to leave the run() promise pending forever —
  // inFlight/isProcessing stuck until app restart. The client must reject on worker 'error',
  // on 'messageerror', and on prolonged silence (watchdog), dropping the dead worker so the
  // next run boots a fresh one.
  it("rejects the in-flight run and resets the worker on a worker 'error' event", async () => {
    const crashed = new FakeWorker(true);
    const workers = [crashed, new FakeWorker()];
    let created = 0;
    const client = new EnhanceWorkerClient(() => workers[created++] as unknown as Worker);
    const p = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    const guarded = expect(p).rejects.toThrow(/worker exploded/);
    crashed.dispatch('error', { message: 'worker exploded' });
    await guarded;
    expect(crashed.terminated).toBe(true);
    // A crashed worker must not be reused — the next run boots a fresh one and succeeds.
    const r = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    expect(r.width).toBe(2);
    expect(created).toBe(2);
  });

  it("rejects the in-flight run on a 'messageerror' event", async () => {
    const fake = new FakeWorker(true);
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    const p = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    const guarded = expect(p).rejects.toThrow(/message/i);
    fake.dispatch('messageerror', {});
    await guarded;
    expect(fake.terminated).toBe(true);
  });

  it('watchdog rejects a run when the worker stays silent, and rejects ALL in-flight runs', async () => {
    jest.useFakeTimers();
    const fake = new FakeWorker(true);
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    const p1 = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    const p2 = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    const g1 = expect(p1).rejects.toThrow(/timed out/);
    const g2 = expect(p2).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(ENHANCE_WORKER_WATCHDOG_MS);
    await g1;
    await g2;
    expect(fake.terminated).toBe(true);
  });

  it('a completed run clears its watchdog — no spurious failure or worker reset later', async () => {
    jest.useFakeTimers();
    const fake = new FakeWorker();
    let created = 0;
    const client = new EnhanceWorkerClient(() => { created++; return fake as unknown as Worker; });
    await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    jest.advanceTimersByTime(ENHANCE_WORKER_WATCHDOG_MS + 1);
    expect(fake.terminated).toBe(false);
    // The same (healthy) worker serves the next run.
    const r = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    expect(r.width).toBe(2);
    expect(created).toBe(1);
  });

  it('dispose rejects any still-pending run instead of leaving it hanging', async () => {
    const fake = new FakeWorker(true);
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    const p = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
    const guarded = expect(p).rejects.toThrow(/disposed/);
    client.dispose();
    await guarded;
    expect(fake.terminated).toBe(true);
  });

  // W4 R1: the packaged enhance worker boots via fetch→blob (async), so the client must accept an
  // ASYNC factory — while keeping every W2 failure semantic (crash/timeout/dispose still reject).
  describe('async worker boot (packaged blob-boot factory)', () => {
    it('boots from a factory that resolves a Worker and completes a run', async () => {
      const fake = new FakeWorker();
      const client = new EnhanceWorkerClient(() => Promise.resolve(fake as unknown as Worker) as unknown as Worker);
      const r = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      expect(r.width).toBe(2);
      expect((fake.posted[0].msg as { type: string }).type).toBe('ENHANCE');
    });

    it('rejects the run when the async factory fails, and the NEXT run retries with a fresh boot', async () => {
      let calls = 0;
      const fake = new FakeWorker();
      const client = new EnhanceWorkerClient(() => {
        calls++;
        return (calls === 1
          ? Promise.reject(new Error('fetch of worker chunk failed'))
          : Promise.resolve(fake as unknown as Worker)) as unknown as Worker;
      });
      await expect(client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS)).rejects.toThrow(/fetch of worker chunk failed/);
      const r = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      expect(r.width).toBe(2);
      expect(calls).toBe(2);
    });

    // W5 R3 (W4 review follow-up c): failAll/dispose racing an in-flight async boot used to leak
    // the eventually-resolved Worker — adopt() still ran after workerPromise was cleared, the
    // zombie was never terminated, and its 'error' listener could later failAll a FRESH worker.
    it('dispose during an async boot TERMINATES the late-resolved worker instead of adopting it', async () => {
      let resolveBoot!: (w: Worker) => void;
      const zombie = new FakeWorker(true);
      const fresh = new FakeWorker();
      let calls = 0;
      const client = new EnhanceWorkerClient(() => {
        calls++;
        return (calls === 1
          ? new Promise<Worker>((res) => { resolveBoot = res; })
          : Promise.resolve(fresh as unknown as Worker)) as unknown as Worker;
      });
      const p = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      const guarded = expect(p).rejects.toThrow(/disposed/);
      client.dispose();
      await guarded;
      // The boot resolves AFTER the dispose: the worker must be terminated, never adopted.
      resolveBoot(zombie as unknown as Worker);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(zombie.terminated).toBe(true);
      // A subsequent run boots a FRESH worker, unaffected by the zombie.
      const r = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      expect(r.width).toBe(2);
      expect(calls).toBe(2);
      // The zombie never got listeners: a late 'error' on it must NOT failAll the fresh worker.
      zombie.dispatch('error', { message: 'zombie crash' });
      expect(fresh.terminated).toBe(false);
      const r2 = await client.run(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      expect(r2.width).toBe(2);
      expect(calls).toBe(2); // still the same fresh worker — no spurious reboot
    });

    it("a crash while a run is queued behind an async boot still rejects it (worker 'error' after boot)", async () => {
      const crashed = new FakeWorker(true);
      const client = new EnhanceWorkerClient(() => Promise.resolve(crashed as unknown as Worker) as unknown as Worker);
      const p = client.run(new Float32Array([0, 0, 0, 1]), 1, 1, DEFAULT_ENHANCE_PARAMS);
      const guarded = expect(p).rejects.toThrow(/late crash/);
      // Let the boot settle (listeners attach), then crash.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      crashed.dispatch('error', { message: 'late crash' });
      await guarded;
      expect(crashed.terminated).toBe(true);
    });
  });

  // W4 R4: the AI-route finishing pass rides the same worker via runAiFinish.
  describe('runAiFinish (AI finishing pass)', () => {
    class FinishFakeWorker extends FakeWorker {
      postMessage(msg: { id: number; type?: string; data?: { rgba: Float32Array } }): void {
        this.posted.push({ msg, transfer: undefined });
        const out = new Float32Array(msg.data!.rgba.length).fill(0.25);
        this.dispatch('message', { data: { type: 'ENHANCE_AI_FINISH_COMPLETE', id: msg.id, rgba: out } });
      }
    }

    it('posts ENHANCE_AI_FINISH and resolves with the finished buffer', async () => {
      const fake = new FinishFakeWorker();
      const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
      const rgba = new Float32Array(2 * 2 * 4).fill(0.5);
      const out = await client.runAiFinish(rgba, 2, 2, DEFAULT_ENHANCE_PARAMS);
      expect((fake.posted[0].msg as { type: string }).type).toBe('ENHANCE_AI_FINISH');
      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(2 * 2 * 4);
      expect(out[0]).toBe(0.25);
    });

    it('rejects on ENHANCE_AI_FINISH_ERROR', async () => {
      const fake = new FakeWorker(true);
      fake.postMessage = function (this: FakeWorker, msg: { id: number }): void {
        this.dispatch('message', { data: { type: 'ENHANCE_AI_FINISH_ERROR', id: msg.id, error: 'finish boom' } });
      } as never;
      const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
      await expect(client.runAiFinish(new Float32Array(4), 1, 1, DEFAULT_ENHANCE_PARAMS)).rejects.toThrow('finish boom');
    });

    it('a silent worker trips the same watchdog as run()', async () => {
      jest.useFakeTimers();
      const fake = new FakeWorker(true);
      const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
      const p = client.runAiFinish(new Float32Array(4), 1, 1, DEFAULT_ENHANCE_PARAMS);
      const guarded = expect(p).rejects.toThrow(/timed out/);
      await Promise.resolve(); // let the boot microtask post the message
      jest.advanceTimersByTime(ENHANCE_WORKER_WATCHDOG_MS);
      await guarded;
      expect(fake.terminated).toBe(true);
    });
  });
});
