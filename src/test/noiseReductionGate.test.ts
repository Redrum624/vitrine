/**
 * v1.40.0 Task 10b — the worker-hang root cause (R4).
 *
 * NR inside a pipeline worker has no WebGL, so it fell to the CPU denoiser. Its size gate
 * read the POST-crop dims (998x498 < 1 MP) and ran the O(n*win^2*patch^2) denoiseSync for
 * > 30 s, so the worker hit its timeout and the pool kept the busy worker.
 * Contracts:
 *  - a preview pass in a worker never runs denoiseSync (pass-through instead);
 *  - the size gate reads the PASS dims (before crop), not the post-crop context dims;
 *  - export and off-worker passes below the gate keep the CPU denoise.
 */
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { AdvancedDenoisingService } from '../services/AdvancedDenoisingService';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

const rgba = (w: number, h: number, v = 0.5): Float32Array => {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 1; }
  return d;
};

describe('NoiseReductionModule CPU-denoise gate (Task 10b)', () => {
  let denoiseSync: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(webGLImageProcessor, 'isAvailable').mockReturnValue(false);
    denoiseSync = jest.spyOn(AdvancedDenoisingService.prototype, 'denoiseSync')
      .mockImplementation((input: Float32Array) => new Float32Array(input));
  });
  afterEach(() => jest.restoreAllMocks());

  const nr = () => {
    const m = new NoiseReductionModule();
    m.setParams({ enabled: true, strength: 40, method: 'auto' });
    return m;
  };

  test('1153x867 in a worker context with no GPU does not call denoiseSync', () => {
    const W = 1153; const H = 867;
    const input = rgba(W, H, 0.4);
    const out = nr().process(input, { width: W, height: H, channels: 4, inWorker: true });
    expect(denoiseSync).not.toHaveBeenCalled();
    expect(out.length).toBe(input.length);
    expect(out[0]).toBeCloseTo(0.4, 6);
  });

  test('the size gate reads the PASS dims: a post-crop 998x498 of a 1280x960 pass is skipped', () => {
    const W = 998; const H = 498;
    nr().process(rgba(W, H), { width: W, height: H, channels: 4, passWidth: 1280, passHeight: 960 });
    expect(denoiseSync).not.toHaveBeenCalled();
  });

  test('off-worker preview below the gate keeps the CPU denoise', () => {
    const W = 64; const H = 48;
    nr().process(rgba(W, H), { width: W, height: H, channels: 4, passWidth: W, passHeight: H });
    expect(denoiseSync).toHaveBeenCalledTimes(1);
  });

  test('an export pass below the gate keeps the CPU denoise, even in a worker', () => {
    const W = 64; const H = 48;
    nr().process(rgba(W, H), { width: W, height: H, channels: 4, inWorker: true, isExport: true });
    expect(denoiseSync).toHaveBeenCalledTimes(1);
  });

  test('the pipeline stamps the PASS dims before crop mutates context.width/height', async () => {
    const { ImageProcessingPipeline } = require('../services/ImageProcessingPipeline');
    const pipeline = new ImageProcessingPipeline();
    pipeline.getModule('crop').setCropRegion(0.1, 0.1, 0.5, 0.5);
    const ctx: { width: number; height: number; channels: number; passWidth?: number; passHeight?: number } =
      { width: 64, height: 48, channels: 4 };
    await pipeline.processImage(rgba(64, 48), ctx, { useWebWorkers: false, cacheResults: false });
    expect([ctx.width, ctx.height]).not.toEqual([64, 48]);
    expect([ctx.passWidth, ctx.passHeight]).toEqual([64, 48]);
  });

  test('the pipeline worker entry marks its contexts inWorker and threads the pass dims', () => {
    // Source pins: both worker message paths build their context with inWorker: true.
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '..', 'workers', 'pipeline.worker.ts'), 'utf8');
    expect(src.match(/inWorker: true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
