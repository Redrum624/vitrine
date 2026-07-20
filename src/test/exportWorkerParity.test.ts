/**
 * R2 — Export worker-path PARITY proof (2026-07-20 export-speed task).
 *
 * The export call sites carried `useWebWorkers: false` justified by "web workers may produce
 * different results". This suite kills that justification with evidence: the SAME representative
 * multi-module edit (basicAdj + WB + enhance-sharpen, NR off — the brief's spec) processed through
 * the worker route and the main-thread route is BIT-IDENTICAL (max abs diff 0, far inside the
 * ≤1e-5 tolerance the brief allows).
 *
 * jsdom cannot run a real Worker, so the pool is a stub that does EXACTLY what
 * pipeline.worker.ts PROCESS_IMAGE does: fresh ImageProcessingPipeline + applyWorkerConfig +
 * processImage(useWebWorkers:false) on a cloned buffer, returning the worker-local context dims.
 * That exercises the REAL risk surface of the worker route in-process:
 *   - the config serialisation (getModuleParams) built inside processWithWebWorkers,
 *   - the applyWorkerConfig round-trip onto a separate pipeline instance,
 *   - the identical CPU module math,
 *   - the output-dims write-back across the (simulated) structured-clone boundary.
 * The remaining surface (real thread, real clone) is covered by the packaged-app smoke run.
 * Tiled-path seam/normalisation parity is separately pinned bit-exact by tileSeams.test.ts.
 */

import { ImageProcessingPipeline, setWorkerPool, type ProcessingContext } from '../services/ImageProcessingPipeline';
import type { WorkerImageData, WorkerModuleConfig, ProcessingResult } from '../services/WebWorkerImageProcessor';
import type { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import type { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { createNoiseImage } from './testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ≥ 256x256 pixels so processImage's isSmallPreview gate does not force the main thread.
const W = 320;
const H = 256;

/** In-process stand-in for the worker pool — mirrors pipeline.worker.ts PROCESS_IMAGE faithfully. */
class FakeWorkerPool {
  calls = 0;
  shouldUseWorkers(): boolean { return true; }
  async processImage(imageData: WorkerImageData, config: WorkerModuleConfig[]): Promise<ProcessingResult> {
    this.calls++;
    const workerPipeline = new ImageProcessingPipeline();
    workerPipeline.applyWorkerConfig(config);
    const ctx: ProcessingContext = { width: imageData.width, height: imageData.height, channels: imageData.channels };
    // .slice() simulates the structured-clone copy the real postMessage performs.
    const data = await workerPipeline.processImage(imageData.data.slice(), ctx, { useWebWorkers: false });
    return { success: true, data, processingTime: 0, width: ctx.width, height: ctx.height };
  }
}

/** The brief's representative edit: basicAdj + WB + sharpen, NR off. rlIters kept small for
 *  test runtime — the blur/tap arithmetic is iteration-count-independent (and the full default
 *  iteration count is pinned bit-exact by enhanceRestore.test.ts + tileSeams.test.ts). */
function applyRepresentativeEdit(pipeline: ImageProcessingPipeline): void {
  pipeline.getModule<BasicAdjustmentsModule>('basicadj')!.setParams({ exposure: 0.5, contrast: 0.2 });
  pipeline.getModule<WhiteBalanceModule>('temperature')!.setParams({ temperature: 5200, tint: 5 });
  (pipeline.getModule('enhance') as unknown as { setParams(p: Record<string, unknown>): void }).setParams({
    enabled: true, sharpen: true, upscale: false,
    denoiseStrength: 0, psfSigma: 1.0, rlIters: 2, alpha: 0.8, hpSigma: 1.2, sharpness: 0.4, chromaClean: true,
  });
  (pipeline.getModule('noise-reduction') as unknown as { setParams(p: Record<string, unknown>): void })
    .setParams({ enabled: false });
}

const firstMismatch = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
};

describe('export worker-path parity (R2)', () => {
  afterEach(() => {
    // Restore a rejecting-pool-free state for other assertions in this file.
    jest.clearAllMocks();
  });

  it('worker route === main-thread route, bit for bit, on the representative export edit', async () => {
    const input = createNoiseImage(W, H, 21);

    const pipeline = new ImageProcessingPipeline();
    applyRepresentativeEdit(pipeline);

    const mainCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const mainOut = await pipeline.processImage(input.slice(), mainCtx, { useWebWorkers: false, cacheResults: false });

    const pool = new FakeWorkerPool();
    setWorkerPool(pool);
    const workerCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const workerOut = await pipeline.processImage(input.slice(), workerCtx, { useWebWorkers: true, cacheResults: false });

    expect(pool.calls).toBe(1); // the worker route actually ran (not a silent main-thread fallback)
    // Sanity: the edit actually changed pixels (a no-op pipeline would make parity vacuous).
    expect(firstMismatch(mainOut, input)).toBeGreaterThanOrEqual(0);
    // THE parity assertion: exact bit equality (brief tolerance ≤1e-5; actual diff is 0).
    expect(firstMismatch(workerOut, mainOut)).toBe(-1);
    expect(workerCtx.width).toBe(mainCtx.width);
    expect(workerCtx.height).toBe(mainCtx.height);
  });

  it('CROPPED export through the worker route: caller context gets the TRUE post-crop dims', async () => {
    const input = createNoiseImage(W, H, 22);

    const pipeline = new ImageProcessingPipeline();
    applyRepresentativeEdit(pipeline);
    (pipeline.getModule('crop') as unknown as {
      setCropRegion(x: number, y: number, w: number, h: number): void;
    }).setCropRegion(0, 0, 0.5, 0.5);

    const mainCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const mainOut = await pipeline.processImage(input.slice(), mainCtx, { useWebWorkers: false, cacheResults: false });
    expect(mainCtx.width).toBe(W / 2);
    expect(mainCtx.height).toBe(H / 2);

    setWorkerPool(new FakeWorkerPool());
    const workerCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const workerOut = await pipeline.processImage(input.slice(), workerCtx, { useWebWorkers: true, cacheResults: false });

    // The write-back added in processWithWebWorkers: the caller's context mirrors the
    // main-thread contract (CropModule's in-place mutation) across the clone boundary —
    // the v1.30.0 cropped-export corruption class stays fixed on the worker route.
    expect(workerCtx.width).toBe(W / 2);
    expect(workerCtx.height).toBe(H / 2);
    expect(workerOut.length).toBe((W / 2) * (H / 2) * 4);
    expect(firstMismatch(workerOut, mainOut)).toBe(-1);
  });

  it('a worker result whose length disagrees with its claimed dims falls back to the main thread', async () => {
    const input = createNoiseImage(W, H, 23);
    const pipeline = new ImageProcessingPipeline();
    applyRepresentativeEdit(pipeline);

    const mainCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const mainOut = await pipeline.processImage(input.slice(), mainCtx, { useWebWorkers: false, cacheResults: false });

    setWorkerPool({
      shouldUseWorkers: () => true,
      processImage: async (imageData: WorkerImageData) => ({
        success: true,
        data: new Float32Array(1234), // lies about its dims (v1.32.0 corruption class)
        processingTime: 0,
        width: imageData.width,
        height: imageData.height,
      }),
    });
    const ctx: ProcessingContext = { width: W, height: H, channels: 4 };
    const out = await pipeline.processImage(input.slice(), ctx, { useWebWorkers: true, cacheResults: false });

    // Buffer-conservation guard: the lying result is discarded, the main thread reprocesses,
    // and the caller's context was never corrupted.
    expect(firstMismatch(out, mainOut)).toBe(-1);
    expect(ctx.width).toBe(W);
    expect(ctx.height).toBe(H);
  });

  it('a failed worker result falls back to the main thread (unhealthy pool never fails an export)', async () => {
    const input = createNoiseImage(W, H, 24);
    const pipeline = new ImageProcessingPipeline();
    applyRepresentativeEdit(pipeline);

    const mainCtx: ProcessingContext = { width: W, height: H, channels: 4 };
    const mainOut = await pipeline.processImage(input.slice(), mainCtx, { useWebWorkers: false, cacheResults: false });

    setWorkerPool({
      shouldUseWorkers: () => true,
      processImage: async (imageData: WorkerImageData) => ({
        success: false, data: imageData.data, processingTime: 0, error: 'pool unavailable',
      }),
    });
    const ctx: ProcessingContext = { width: W, height: H, channels: 4 };
    const out = await pipeline.processImage(input.slice(), ctx, { useWebWorkers: true, cacheResults: false });
    expect(firstMismatch(out, mainOut)).toBe(-1);
  });
});
