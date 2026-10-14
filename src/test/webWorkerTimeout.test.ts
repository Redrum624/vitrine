/**
 * v1.40.0 Task 10b — worker-hang cascade (R4).
 *
 * A message timeout used to reject the caller but put the STILL-BUSY worker back in the
 * pool, so the next job queued behind a worker that never answered (another 30 s timeout,
 * and so on). Contracts:
 *  - a timeout terminates the hung worker and spawns a replacement;
 *  - the pool stays at maxWorkers (the hung worker is gone from it);
 *  - the next job goes to a fresh worker and succeeds;
 *  - waiting for a free worker has a deadline (fails instead of spinning forever).
 */
type Listener = (event: { data: Record<string, unknown> }) => void;

class FakeWorker {
  static created: FakeWorker[] = [];
  hang = false;
  failInit = false;
  terminated = false;
  lastProcessId = -1;
  posted: string[] = [];
  private listeners: Listener[] = [];
  terminate = jest.fn(() => { this.terminated = true; });
  constructor() { FakeWorker.created.push(this); }
  addEventListener(type: string, cb: Listener): void {
    if (type === 'message') this.listeners.push(cb);
  }
  postMessage(msg: { type: string; id: number; data: { imageData?: { width: number; height: number; data: Float32Array } } }): void {
    if (this.terminated) return;
    this.posted.push(msg.type);
    if (msg.type === 'INITIALIZE') {
      const ok = !this.failInit;
      Promise.resolve().then(() => this.emit({ type: 'INITIALIZE_COMPLETE', id: msg.id, success: ok, error: ok ? undefined : 'boot failed' }));
    } else if (msg.type === 'PROCESS_IMAGE') this.lastProcessId = msg.id;
    if (msg.type === 'PROCESS_IMAGE' && !this.hang) {
      const img = msg.data.imageData!;
      Promise.resolve().then(() => this.emit({
        type: 'PROCESS_COMPLETE', id: msg.id, success: true, data: img.data, processingTime: 1,
        outputWidth: img.width, outputHeight: img.height,
      }));
    }
  }
  private emit(data: Record<string, unknown>): void {
    if (this.terminated) return;
    for (const l of this.listeners) l({ data });
  }
  /** A message already in flight when terminate() ran (bypasses the terminated guard). */
  lateAnswer(): void {
    const data = new Float32Array(8 * 8 * 4);
    for (const l of this.listeners) {
      l({ data: { type: 'PROCESS_COMPLETE', id: this.lastProcessId, success: true, data, processingTime: 1, outputWidth: 8, outputHeight: 8 } });
    }
  }
}

const mockSpawn = { fail: false, failInit: false, gate: null as Promise<void> | null };
jest.mock('../workers/createPipelineWorker', () => ({
  createPipelineWorker: jest.fn(async () => {
    if (mockSpawn.gate) await mockSpawn.gate;
    if (mockSpawn.fail) throw new Error('spawn refused');
    const w = new FakeWorker();
    w.failInit = mockSpawn.failInit;
    return w;
  }),
}));

import {
  WebWorkerImageProcessor, WORKER_MESSAGE_TIMEOUT_MS, WORKER_ACQUIRE_DEADLINE_MS,
} from '../services/WebWorkerImageProcessor';

const img = () => ({ width: 8, height: 8, channels: 4, data: new Float32Array(8 * 8 * 4).fill(0.5) });

describe('WebWorkerImageProcessor timeout recycling (Task 10b)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeWorker.created = [];
    mockSpawn.fail = false;
    mockSpawn.failInit = false;
    mockSpawn.gate = null;
  });
  afterEach(() => jest.useRealTimers());

  async function ready(): Promise<WebWorkerImageProcessor> {
    const p = new WebWorkerImageProcessor();
    await p.initialize();
    expect(p.isHealthy()).toBe(true);
    return p;
  }

  it('a timeout terminates the worker, keeps the pool at maxWorkers, and the next job gets a fresh worker', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    expect(FakeWorker.created).toHaveLength(maxWorkers);

    const hung = FakeWorker.created[0];
    hung.hang = true;
    const job = p.processImage(img(), []);
    await jest.advanceTimersByTimeAsync(WORKER_MESSAGE_TIMEOUT_MS + 10);
    const res = await job;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timeout/i);

    expect(hung.terminate).toHaveBeenCalledTimes(1);
    // One replacement spawned and initialised; the hung worker is out of the pool.
    expect(FakeWorker.created).toHaveLength(maxWorkers + 1);
    const stats = p.getStats();
    expect(stats.availableWorkers + stats.busyWorkers).toBe(maxWorkers);
    expect(stats.availableWorkers).toBe(maxWorkers);

    // Every later job lands on a live worker — never on the terminated one.
    for (let i = 0; i < maxWorkers + 1; i++) {
      const r = await p.processImage(img(), []);
      expect(r.success).toBe(true);
    }
    expect(hung.posted.filter((t) => t === 'PROCESS_IMAGE')).toHaveLength(1);
  });

  it('getAvailableWorker has a deadline: an empty pool fails the job instead of spinning forever', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    for (const w of FakeWorker.created) w.hang = true;
    mockSpawn.fail = true; // replacements cannot be spawned → the pool drains to empty
    const busy = Array.from({ length: maxWorkers }, () => p.processImage(img(), []));
    const waiting = p.processImage(img(), []);
    await jest.advanceTimersByTimeAsync(WORKER_ACQUIRE_DEADLINE_MS + 100);
    const res = await waiting;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no worker available/i);
    await Promise.all(busy);
  });

  it('a late answer from a terminated worker is ignored (settled once, never re-pooled)', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    const hung = FakeWorker.created[0];
    hung.hang = true;
    const settle = jest.fn();
    const job = p.processImage(img(), []).then((r) => { settle(r.success); return r; });
    await jest.advanceTimersByTimeAsync(WORKER_MESSAGE_TIMEOUT_MS + 10);
    await job;
    expect(hung.terminated).toBe(true);
    // The answer that was already in flight arrives after terminate().
    hung.lateAnswer();
    await jest.advanceTimersByTimeAsync(10);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(false);
    const stats = p.getStats();
    expect(stats.availableWorkers).toBe(maxWorkers);
    expect(stats.availableWorkers + stats.busyWorkers).toBe(maxWorkers);
    expect(stats.pendingMessages).toBe(0);
    // Saturate the pool: no job ever lands on the dead worker.
    await Promise.all(Array.from({ length: maxWorkers * 2 }, () => p.processImage(img(), [])));
    expect(hung.posted.filter((t) => t === 'PROCESS_IMAGE')).toHaveLength(1);
  });

  it('a replacement that fails INITIALIZE is terminated and never pooled', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    FakeWorker.created[0].hang = true;
    mockSpawn.failInit = true;
    const job = p.processImage(img(), []);
    await jest.advanceTimersByTimeAsync(WORKER_MESSAGE_TIMEOUT_MS + 10);
    await job;
    const replacement = FakeWorker.created[maxWorkers];
    expect(replacement).toBeDefined();
    expect(replacement.terminated).toBe(true);
    const stats = p.getStats();
    expect(stats.availableWorkers + stats.busyWorkers).toBe(maxWorkers - 1);
    for (let i = 0; i < maxWorkers; i++) {
      expect((await p.processImage(img(), [])).success).toBe(true);
    }
    expect(replacement.posted.filter((t) => t === 'PROCESS_IMAGE')).toHaveLength(0);
  });

  it('a drained pool (respawns failing) reports unhealthy and fails jobs fast', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    for (const w of FakeWorker.created) w.hang = true;
    mockSpawn.fail = true;
    const busy = Array.from({ length: maxWorkers }, () => p.processImage(img(), []));
    await jest.advanceTimersByTimeAsync(WORKER_MESSAGE_TIMEOUT_MS + 10);
    await Promise.all(busy);
    expect(p.getStats().availableWorkers + p.getStats().busyWorkers).toBe(0);
    expect(p.isHealthy()).toBe(false);
    // No 60 s acquire wait: the job fails at once.
    const settled = jest.fn();
    const job = p.processImage(img(), []).then((r) => { settled(r.success); });
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(settled).toHaveBeenCalledWith(false);
    await job;
  });

  it('dispose() + re-initialize() racing a pending respawn never adds an extra worker', async () => {
    const p = await ready();
    const maxWorkers = p.getStats().maxWorkers;
    FakeWorker.created[0].hang = true;
    let open!: () => void;
    mockSpawn.gate = new Promise<void>((r) => { open = r; });
    const job = p.processImage(img(), []);
    await jest.advanceTimersByTimeAsync(WORKER_MESSAGE_TIMEOUT_MS + 10);
    await job; // the respawn is now parked inside createPipelineWorker
    p.dispose();
    mockSpawn.gate = null;
    await p.initialize();
    expect(p.getStats().availableWorkers).toBe(maxWorkers);
    open(); // the stale respawn completes AFTER the new generation is up
    await jest.advanceTimersByTimeAsync(10);
    const stats = p.getStats();
    expect(stats.availableWorkers + stats.busyWorkers).toBe(maxWorkers);
    expect(FakeWorker.created[FakeWorker.created.length - 1].terminated).toBe(true);
  });
});
