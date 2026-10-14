/**
 * Task 12c fix round 1 — Local Adjustments on the worker routes.
 *
 * Bug (reviewer repro: main 0.5 vs worker 0.25 at a +1 EV radial centre):
 * LocalAdjustmentsPipelineModule.setParameters cleared the layers and never rebuilt them, so
 * every worker route (pool exports since v1.35.0, EnhanceService bake develop pass, preview
 * worker frames) dropped ALL local-adjustment masks. A real worker has its own module graph
 * (a fresh localAdjustmentsModule singleton) — jest.isolateModules reproduces that here.
 */
import { ImageProcessingPipeline, setWorkerPool, type ProcessingContext } from '../services/ImageProcessingPipeline';
import type { WorkerImageData, WorkerModuleConfig, ProcessingResult } from '../services/WebWorkerImageProcessor';
import type { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import { LocalAdjustmentsModule, type MaskGeometry } from '../modules/LocalAdjustmentsModule';
import { choosePreviewRoute } from '../services/previewRouting';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const W = 320, H = 256;
const radial: MaskGeometry = {
  type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.2, radiusY: 0.2,
  startX: 0.5, startY: 0.3, endX: 0.5, endY: 0.7, feather: 0.3, invert: false, rotation: 0,
};

/** Mirrors pipeline.worker.ts PROCESS_IMAGE in a FRESH module graph (own LA singleton). */
class IsolatedWorkerPool {
  lastConfig: WorkerModuleConfig[] = [];
  shouldUseWorkers() { return true; }
  async processImage(img: WorkerImageData, config: WorkerModuleConfig[]): Promise<ProcessingResult> {
    this.lastConfig = config;
    let P: typeof ImageProcessingPipeline = ImageProcessingPipeline;
    jest.isolateModules(() => {
      P = require('../services/ImageProcessingPipeline').ImageProcessingPipeline;
    });
    const wp = new P();
    wp.applyWorkerConfig(structuredCloneLike(config));
    const ctx = { width: img.width, height: img.height, channels: img.channels } as ProcessingContext;
    const data = await wp.processImage(img.data.slice(), ctx, { useWebWorkers: false });
    return { success: true, data, processingTime: 0, width: ctx.width, height: ctx.height };
  }
}

/** Deep copy keeping typed arrays (what postMessage's structured clone does). */
function structuredCloneLike<T>(v: T): T {
  if (v instanceof Float32Array) return new Float32Array(v) as unknown as T;
  if (Array.isArray(v)) return v.map(structuredCloneLike) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = structuredCloneLike(x);
    return o as T;
  }
  return v;
}

function laPipeline(bakeW = W, bakeH = H) {
  const p = new ImageProcessingPipeline();
  const la = p.getModule<LocalAdjustmentsPipelineModule>('localadjustments')!;
  const id = la.createLayer('radial_gradient', 'L', W, H);
  la.updateLayerBasicAdj(id, { exposure: 1 });
  la.setLayerGeometry(id, radial, bakeW, bakeH);
  return { p, la, id };
}

const input = () => {
  const a = new Float32Array(W * H * 4).fill(0.25);
  for (let i = 3; i < a.length; i += 4) a[i] = 1;
  return a;
};
const centre = ((H / 2) * W + W / 2) * 4;

describe('Local Adjustments survive the worker-config round trip', () => {
  afterEach(() => setWorkerPool(null as never));

  it('worker route === main thread for a radial +1 EV mask', async () => {
    const { p } = laPipeline();
    const main = await p.processImage(input(), { width: W, height: H, channels: 4 }, { useWebWorkers: false, cacheResults: false });
    const pool = new IsolatedWorkerPool();
    setWorkerPool(pool as never);
    const work = await p.processImage(input(), { width: W, height: H, channels: 4 }, { useWebWorkers: true, cacheResults: false });
    expect(pool.lastConfig.some((c) => c.moduleId === 'localadjustments')).toBe(true);
    expect(main[centre]).toBeGreaterThan(0.25 + 0.1);
    expect(work[centre]).toBeCloseTo(main[centre], 5);
    let maxDiff = 0;
    for (let i = 0; i < main.length; i++) maxDiff = Math.max(maxDiff, Math.abs(main[i] - work[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });

  it('a mask baked at another size (preview) is rebaked from geometry in the worker', async () => {
    const { p } = laPipeline(64, 51);
    const main = await p.processImage(input(), { width: W, height: H, channels: 4 }, { useWebWorkers: false, cacheResults: false });
    // Reset the bake size for the worker leg so both start from the same stale mask.
    const p2 = laPipeline(64, 51).p;
    setWorkerPool(new IsolatedWorkerPool() as never);
    const work = await p2.processImage(input(), { width: W, height: H, channels: 4 }, { useWebWorkers: true, cacheResults: false });
    expect(work[centre]).toBeCloseTo(main[centre], 5);
    expect(work[centre]).toBeGreaterThan(0.35);
  });
});

describe('LocalAdjustmentsModule.replaceLayers', () => {
  it('deep-copies layers (mutating the source later does not leak in) and keeps the active id', () => {
    const a = new LocalAdjustmentsModule();
    const id = a.createLayer('radial_gradient', 'L', 8, 8);
    a.updateLayerBasicAdj(id, { exposure: 1 });
    const src = a.getLayers();
    const b = new LocalAdjustmentsModule();
    b.replaceLayers(src, id);
    src[0].mask.fill(0);
    src[0].geometry!.centerX = 0.9;
    src[0].basicAdj!.exposure = -2;
    const copy = b.getLayer(id)!;
    expect(copy.mask.some((v) => v > 0.5)).toBe(true);
    expect(copy.geometry!.centerX).toBe(0.5);
    expect(copy.basicAdj!.exposure).toBe(1);
    expect(b.getStats().activeLayerId).toBe(id);
  });

  it('coerces a JSON-round-tripped mask and rebakes geometry layers on size mismatch', () => {
    const a = new LocalAdjustmentsModule();
    const id = a.createLayer('radial_gradient', 'L', 8, 8);
    a.updateLayerBasicAdj(id, { exposure: 1 });
    const json = JSON.parse(JSON.stringify(a.getLayers()));
    const b = new LocalAdjustmentsModule();
    b.replaceLayers(json, null);
    expect(b.getLayer(id)!.mask).toBeInstanceOf(Float32Array);
    expect(b.getLayer(id)!.mask.length).toBe(64);
    const out = b.processImage(new Float32Array(16 * 16 * 4).fill(0.25), 16, 16);
    expect(out[(8 * 16 + 8) * 4]).toBeGreaterThan(0.35);
  });

  it('a brush layer whose mask size mismatches is skipped, never crashes', () => {
    const a = new LocalAdjustmentsModule();
    const id = a.createLayer('brush', 'B', 8, 8);
    a.updateLayerBasicAdj(id, { exposure: 1 });
    a.getLayer(id)!.mask.fill(1);
    const inp = new Float32Array(16 * 16 * 4).fill(0.25);
    const out = a.processImage(inp, 16, 16);
    expect(Array.from(out)).toEqual(Array.from(inp));
  });
});

describe('LA is kept off the TILED (> 48 MP) worker path', () => {
  const base = { gpuAvailable: false, activeCpuBridgeCount: 1, passCount: 1 };
  it('preview: LA active above 48 MP → main; below → worker; LA off above 48 MP → main (not-tile-safe)', () => {
    expect(choosePreviewRoute({ ...base, width: 10000, height: 6000, laActive: true })).toEqual({ path: 'main', reason: 'la-not-tile-safe' });
    expect(choosePreviewRoute({ ...base, width: 8000, height: 6000, laActive: true }).path).toBe('worker');
    expect(choosePreviewRoute({ ...base, width: 10000, height: 6000 })).toEqual({ path: 'main', reason: 'not-tile-safe' });
  });
});
