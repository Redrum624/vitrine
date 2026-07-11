/**
 * Tile-seam regression for the CPU Web-Worker pipeline.
 *
 * The worker path (`WebWorkerImageProcessor.processTiledImage`) splits large images into a grid of
 * tiles processed independently. For SPATIAL filters (blur / sharpen / NLM / the ShadowsHighlights
 * mask box-blur, etc.) that reads neighbour pixels, a tile boundary cuts the kernel off from the
 * adjacent tile → a visible SEAM every `tileSize` px. The fix borrows an apron of neighbour pixels
 * around each tile (sized to the real kernel radius via `spatialApron`), processes the padded tile,
 * and crops the apron away — so interior pixels see the same context as the untiled image.
 *
 * A real `Worker` cannot run in jsdom, so we drive the REAL `processTiledImage`/`processTile`
 * stitching code with a stubbed transport that runs the REAL `ImageProcessingPipeline` synchronously
 * on each tile — exactly what `pipeline.worker.ts` does (`applyWorkerConfig` + `processImage(...,
 * useWebWorkers=false)`). We then compare the tiled output against the same pipeline run over the
 * whole image untiled. Before the apron fix this test FAILS with a large boundary discrepancy.
 *
 * Widest CLEAN live kernel used here: ShadowsHighlights mask box-blur (radius = ceil(maskBlur),
 * clamp edges — see ShadowsHighlightsModule.blurMask).
 */

import { ImageProcessingPipeline, type ProcessingContext } from '../services/ImageProcessingPipeline';
import {
  WebWorkerImageProcessor,
  type WorkerImageData,
  type WorkerModuleConfig,
  type ProcessingResult,
} from '../services/WebWorkerImageProcessor';
import {
  spatialApron,
  planApronTile,
  effectiveTileSize,
  moduleApron,
} from '../utils/tiledPipeline';
import { createNoiseImage, maxImageDifference } from './testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Minimal view onto the private members we drive/stub for the integration test.
interface PrivateProcessor {
  isInitialized: boolean;
  getAvailableWorker: () => Promise<unknown>;
  sendMessage: (worker: unknown, type: string, data: Record<string, unknown>) => Promise<unknown>;
  processTiledImage: (
    imageData: WorkerImageData,
    pipeline: WorkerModuleConfig[],
    tileSize: number,
  ) => Promise<ProcessingResult>;
}

/** Run the config over the WHOLE image on the main thread — exactly the worker's per-tile call. */
async function processUntiled(img: WorkerImageData, config: WorkerModuleConfig[]): Promise<Float32Array> {
  const pipeline = new ImageProcessingPipeline();
  pipeline.applyWorkerConfig(config);
  const ctx: ProcessingContext = { width: img.width, height: img.height, channels: img.channels };
  return pipeline.processImage(img.data.slice(), ctx, false);
}

/**
 * Drive the REAL processTiledImage with an in-process transport: the "worker" runs the real
 * pipeline synchronously on whatever tile buffer the stitching code sends (padded, once aproned).
 */
async function processTiled(
  img: WorkerImageData,
  config: WorkerModuleConfig[],
  tileSize: number,
): Promise<Float32Array> {
  const processor = WebWorkerImageProcessor.getInstance();
  const priv = processor as unknown as PrivateProcessor;
  priv.isInitialized = true;
  priv.getAvailableWorker = async () => ({} as unknown);
  priv.sendMessage = async (_worker, type, data) => {
    if (type !== 'PROCESS_TILE') throw new Error(`unexpected worker message: ${type}`);
    const tileData = data.tileData as Float32Array;
    const tileWidth = data.tileWidth as number;
    const tileHeight = data.tileHeight as number;
    const channels = (data.channels as number) ?? 4;
    const pipeline = new ImageProcessingPipeline();
    pipeline.applyWorkerConfig(data.pipeline as WorkerModuleConfig[]);
    const ctx: ProcessingContext = { width: tileWidth, height: tileHeight, channels };
    const out = await pipeline.processImage(tileData, ctx, false);
    return {
      success: true,
      data: out,
      tileX: data.tileX,
      tileY: data.tileY,
      tileWidth,
      tileHeight,
      processingTime: 0,
    };
  };
  const result = await priv.processTiledImage(img, config, tileSize);
  expect(result.success).toBe(true);
  return result.data;
}

describe('CPU worker tiled pipeline — spatial-filter seams', () => {
  // ShadowsHighlights with a wide mask blur = the widest clean live spatial kernel.
  const shConfig: WorkerModuleConfig[] = [
    {
      moduleId: 'shadowshighlights',
      enabled: true,
      params: {
        enabled: true,
        shadows: 80, // != 50 so the module is non-identity and actually runs
        highlights: 50,
        maskBlur: 2, // effective kernel radius = ceil(2) = 2 px
        bilateralFilter: false,
        iterations: 1,
      },
    },
  ];

  const WIDTH = 200;
  const HEIGHT = 120;
  const TILE = 60; // small tile → multiple tiles across the image (the grid the RED path uses)

  it('tiled output matches the untiled reference within epsilon (no boundary seam)', async () => {
    const img: WorkerImageData = {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      data: createNoiseImage(WIDTH, HEIGHT, 7), // high-frequency content → mask blur mixes neighbours
    };

    // Guard: the fix must still produce >= 2 tiles for this config (else the test is vacuous).
    const apron = spatialApron(shConfig);
    expect(apron).toBeGreaterThan(0);
    const eff = effectiveTileSize(TILE, apron);
    const tilesX = Math.ceil(WIDTH / eff);
    const tilesY = Math.ceil(HEIGHT / eff);
    expect(tilesX * tilesY).toBeGreaterThan(1);

    const untiled = await processUntiled(img, shConfig);
    const tiled = await processTiled(img, shConfig, TILE);

    // Sanity: the filter actually changed the image (otherwise a trivial pass-through would "match").
    expect(maxImageDifference(untiled, img.data)).toBeGreaterThan(0.01);

    // Interior tile pixels see real neighbour context through the apron → bit-exact within float noise.
    // Before the apron fix this is ~0.05+ at the tile boundaries (the RED seam).
    expect(maxImageDifference(tiled, untiled)).toBeLessThan(1e-4);
  });
});

describe('spatialApron — kernel radius from params', () => {
  it('sums the radius of every enabled spatial module (chained passes)', () => {
    const config: WorkerModuleConfig[] = [
      { moduleId: 'exposure', enabled: true, params: { exposure: 0.3 } }, // point op → 0
      { moduleId: 'shadowshighlights', enabled: true, params: { enabled: true, maskBlur: 6 } }, // 6
      { moduleId: 'noise-reduction', enabled: true, params: { enabled: true } }, // 29
    ];
    expect(spatialApron(config)).toBe(0 + 6 + 29);
  });

  it('is 0 for a point-operation-only pipeline (tiling stays free)', () => {
    const config: WorkerModuleConfig[] = [
      { moduleId: 'exposure', enabled: true, params: { exposure: 1 } },
      { moduleId: 'basicadj', enabled: true, params: { contrast: 0.5 } },
      { moduleId: 'temperature', enabled: true, params: { temperature: 4000 } },
    ];
    expect(spatialApron(config)).toBe(0);
  });

  it('ignores disabled modules', () => {
    const config: WorkerModuleConfig[] = [
      { moduleId: 'shadowshighlights', enabled: false, params: { enabled: true, maskBlur: 10 } },
    ];
    expect(spatialApron(config)).toBe(0);
  });

  it('shadowshighlights radius = ceil(maskBlur) (+1 for bilateral)', () => {
    expect(moduleApron('shadowshighlights', { maskBlur: 4 })).toBe(4);
    expect(moduleApron('shadowshighlights', { maskBlur: 3.2 })).toBe(4);
    expect(moduleApron('shadowshighlights', { maskBlur: 4, bilateralFilter: true })).toBe(5);
  });

  it('enhance radius scales with the RL-deconv iteration cone', () => {
    // sharpen path, defaults psfSigma=1 (r3) x rlIters=12 + lumaGraft(7) + CAS(1) = 44
    const r = moduleApron('enhance', {
      enabled: true, sharpen: true, upscale: false,
      psfSigma: 1.0, rlIters: 12, hpSigma: 1.2, denoiseStrength: 0, chromaClean: true,
    });
    expect(r).toBe(12 * 3 + 7 + 1);
    // disabled / upscale path contributes nothing to the same-res convolution apron
    expect(moduleApron('enhance', { enabled: false })).toBe(0);
    expect(moduleApron('enhance', { enabled: true, sharpen: true, upscale: true })).toBe(0);
  });
});

describe('planApronTile — padded-extract + crop geometry', () => {
  // 200x200 image, 100px tiles, apron 10 → a 2x2 grid.
  it('interior tiles get a full apron on the interior side, clamped at image borders', () => {
    // top-left tile: apron only on the right/bottom (left/top are the image border).
    const tl = planApronTile(0, 0, 100, 200, 200, 10);
    expect(tl.apronLeft).toBe(0);
    expect(tl.apronTop).toBe(0);
    expect(tl.coreX).toBe(0);
    expect(tl.coreW).toBe(100);
    expect(tl.padX).toBe(0);
    expect(tl.padW).toBe(110); // core 100 + right apron 10

    // bottom-right tile: apron only on the left/top.
    const br = planApronTile(1, 1, 100, 200, 200, 10);
    expect(br.apronLeft).toBe(10);
    expect(br.apronTop).toBe(10);
    expect(br.coreX).toBe(100);
    expect(br.coreW).toBe(100);
    expect(br.padX).toBe(90); // starts 10 px before the core
    expect(br.padW).toBe(110); // left apron 10 + core 100 (no right neighbour)
  });

  it('a fully-interior tile is padded on all four sides', () => {
    // 300x300 image, 100px tiles → centre tile (1,1) has neighbours on every side.
    const c = planApronTile(1, 1, 100, 300, 300, 10);
    expect(c.apronLeft).toBe(10);
    expect(c.apronTop).toBe(10);
    expect(c.padX).toBe(90);
    expect(c.padY).toBe(90);
    expect(c.padW).toBe(120); // 10 + 100 + 10
    expect(c.padH).toBe(120);
    expect(c.coreW).toBe(100);
    expect(c.coreH).toBe(100);
  });

  it('a partial edge tile keeps its true (clamped) core size', () => {
    // 250x250 image, 100px tiles → last tile is 50px wide, no right/bottom apron.
    const edge = planApronTile(2, 2, 100, 250, 250, 10);
    expect(edge.coreX).toBe(200);
    expect(edge.coreW).toBe(50);
    expect(edge.apronLeft).toBe(10);
    expect(edge.padW).toBe(60); // left apron 10 + core 50
  });

  it('apron 0 is an exact tile (no padding)', () => {
    const t = planApronTile(1, 0, 100, 300, 100, 0);
    expect(t.padX).toBe(100);
    expect(t.padW).toBe(100);
    expect(t.apronLeft).toBe(0);
  });
});
