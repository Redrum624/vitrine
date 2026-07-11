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
 * Two live spatial modules are exercised end-to-end:
 *  - ShadowsHighlights mask box-blur (radius = ceil(maskBlur), clamp edges — the widest CLEAN
 *    single kernel; see ShadowsHighlightsModule.blurMask).
 *  - The enhance chain (RL-deconv double-blur cone + series highpass — the widest DERIVED kernel;
 *    see the moduleApron enhance case). Its test image pins edgeMask's buffer-global `mmax`
 *    normalisation by planting identical maximum-gradient stamps in every tile (see
 *    buildEnhanceSeamImage), so the only tiled-vs-untiled difference left is kernel contamination
 *    — which the apron must reduce to EXACTLY zero (bit-equal interior arithmetic).
 */

import { ImageProcessingPipeline, type ProcessingContext } from '../services/ImageProcessingPipeline';
import {
  WebWorkerImageProcessor,
  type WorkerImageData,
  type WorkerModuleConfig,
  type ProcessingResult,
} from '../services/WebWorkerImageProcessor';
import * as tiledPipeline from '../utils/tiledPipeline';
import { createNoiseImage, maxImageDifference } from './testUtils';

const { spatialApron, planApronTile, effectiveTileSize, moduleApron, MAX_WORKER_TILE } = tiledPipeline;

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
  return pipeline.processImage(img.data.slice(), ctx, { useWebWorkers: false });
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
    const out = await pipeline.processImage(tileData, ctx, { useWebWorkers: false });
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

/**
 * Dark noise + identical maximum-gradient stamps, for the enhance seam test.
 *
 * - DARK noise ([0.02, 0.22]): RL-deconv divides by the local blur (`rel = y/max(conv, eps)`), so
 *   small `conv` AMPLIFIES boundary-clamp contamination — pushing the detectable seam band as far
 *   out as the chain can carry it (the strictest exercise of the apron).
 * - STAMPS (12x12: 2px zero ring, ones core, one corner carved): edgeMask normalises by the
 *   buffer-GLOBAL max Sobel magnitude `mmax` — a statistic no apron can bound. The carved corner
 *   realises the pattern [[0,0,1],[0,·,1],[0,1,1]] whose magnitude sqrt(4²+2²)=sqrt(20) is the
 *   THEORETICAL CEILING for values in [0,1] (gx=4 forces the shared corners to values where
 *   |gy|<=2), so every stamp attains the exact global maximum and NO clamped tile edge can exceed
 *   it. Stamps repeat every 100px -> every padded tile contains a complete stamp -> per-tile mmax
 *   === untiled mmax, and the only remaining tiled-vs-untiled difference is kernel contamination.
 */
function buildEnhanceSeamImage(W: number, H: number): Float32Array {
  const data = createNoiseImage(W, H, 11);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0.02 + 0.2 * data[i];
    data[i + 1] = 0.02 + 0.2 * data[i + 1];
    data[i + 2] = 0.02 + 0.2 * data[i + 2];
    data[i + 3] = 1;
  }
  const carved = new Set(['2,2', '3,2', '2,3', '2,4']);
  for (let sy = 40; sy + 12 <= H; sy += 100) {
    for (let sx = 40; sx + 12 <= W; sx += 100) {
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          const core = x >= 2 && x < 10 && y >= 2 && y < 10 && !carved.has(`${x},${y}`);
          const v = core ? 1 : 0;
          const idx = ((sy + y) * W + (sx + x)) * 4;
          data[idx] = v;
          data[idx + 1] = v;
          data[idx + 2] = v;
          data[idx + 3] = 1;
        }
      }
    }
  }
  return data;
}

describe('CPU worker tiled pipeline — enhance chain (RL-deconv cone) seams', () => {
  // Low iterations + max deblur radius: the derived apron (23) stays test-sized while the
  // RL double-blur term still dominates the formula (2*1*9 + 4 = 22 > edgeMask 7). With the OLD
  // under-derived formula (rlIters*r + max(7,hp) + 1 = 17) this config leaves a measured ~7.0e-7
  // residual seam that violates the bit-exactness assertion below; the corrected 23 covers the
  // full worst-case cone and yields EXACTLY 0.
  const enhanceConfig: WorkerModuleConfig[] = [
    {
      moduleId: 'enhance',
      enabled: true,
      params: {
        enabled: true, sharpen: true, upscale: false, scale: 2,
        denoiseStrength: 0, psfSigma: 3.0, rlIters: 1,
        alpha: 0.8, hpSigma: 1.2, sharpness: 0.4, chromaClean: true,
      },
    },
  ];

  const WIDTH = 1000; // > effectiveTileSize(TILE, 23) = 767 so the grid has >= 2 tiles
  const HEIGHT = 120;
  const TILE = 64;

  it('derives the corrected apron for this config (RL double-blur + series highpass)', () => {
    // 1 + max(edgeMask 7, 2*rlIters*gaussRadius(3.0) + gaussRadius(1.2)) = 1 + max(7, 18+4) = 23
    expect(spatialApron(enhanceConfig)).toBe(23);
  });

  it('tiled enhance is BIT-EXACT vs untiled at the derived apron, and a too-small apron seams', async () => {
    const img: WorkerImageData = {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      data: buildEnhanceSeamImage(WIDTH, HEIGHT),
    };

    // Guard: >= 2 tiles (else the test is vacuous).
    const apron = spatialApron(enhanceConfig);
    const eff = effectiveTileSize(TILE, apron);
    expect(Math.ceil(WIDTH / eff) * Math.ceil(HEIGHT / eff)).toBeGreaterThan(1);

    const untiled = await processUntiled(img, enhanceConfig);
    // Sanity: enhance actually changed the image.
    expect(maxImageDifference(untiled, img.data)).toBeGreaterThan(0.01);

    // SENSITIVITY GUARD (proves the harness detects seams at all): force an apron well inside the
    // contamination band — the boundary must show a real discrepancy (measured ~6.0e-6).
    const spy = jest.spyOn(tiledPipeline, 'spatialApron').mockReturnValue(11);
    const seamy = await processTiled(img, enhanceConfig, TILE);
    spy.mockRestore();
    expect(maxImageDifference(seamy, untiled)).toBeGreaterThan(5e-7);

    // THE assertion: at the derived apron every interior pixel's full dependency cone fits inside
    // its padded tile, so the arithmetic is IDENTICAL to the untiled run -> exactly 0 (assert a
    // defensive 1e-7). The OLD formula (apron 17) leaves ~7.0e-7 here and FAILS this bound.
    const tiled = await processTiled(img, enhanceConfig, TILE);
    expect(maxImageDifference(tiled, untiled)).toBeLessThan(1e-7);
  }, 120000);
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

  it('enhance radius = CAS + max(edgeMask, RL double-blur cone + series highpass)', () => {
    // rlDeconvLuma applies TWO gaussianBlur1 passes per iteration (the convolution AND the
    // correlation — enhanceRestore.ts:9 and :12), so the cone grows 2*gaussRadius(psfSigma) per
    // iteration; lumaGraft's highpass(hpSigma) runs on the RL OUTPUT (series → adds) while its
    // edgeMask (7) runs on the original luma (parallel → max); CAS adds 1 in series.
    // Defaults: 1 + max(7, 2*12*ceil(3*1.0) + ceil(3*1.2)) = 1 + max(7, 72 + 4) = 77.
    const r = moduleApron('enhance', {
      enabled: true, sharpen: true, upscale: false,
      psfSigma: 1.0, rlIters: 12, hpSigma: 1.2, denoiseStrength: 0, chromaClean: true,
    });
    expect(r).toBe(1 + Math.max(7, 2 * 12 * 3 + 4));
    expect(r).toBe(77);
    // Tiny RL cone: 2*1*ceil(3*0.5=2) + ceil(3*0.5)=2 -> 6 < edgeMask 7 -> the parallel branch wins.
    expect(moduleApron('enhance', {
      enabled: true, sharpen: true, upscale: false,
      psfSigma: 0.5, rlIters: 1, hpSigma: 0.5, denoiseStrength: 0, chromaClean: false,
    })).toBe(1 + 7);
    // No RL (rlIters 0): luma = CAS only (1); chroma = cleanChroma r4 dominates.
    expect(moduleApron('enhance', {
      enabled: true, sharpen: true, upscale: false,
      psfSigma: 1.0, rlIters: 0, hpSigma: 1.2, denoiseStrength: 0, chromaClean: true,
    })).toBe(4);
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

describe('effectiveTileSize — growth heuristic and OOM cap', () => {
  it('never shrinks below the caller tile and is a no-op for apron 0', () => {
    expect(effectiveTileSize(2048, 0)).toBe(2048);
    expect(effectiveTileSize(2048, 10)).toBe(2048); // production tile untouched for small aprons
    expect(effectiveTileSize(2048, 29)).toBe(2048); // noise-reduction fits too
  });

  it('grows a small tile to keep the apron overhead under the cap', () => {
    // minTile = ceil(4*apron / APRON_OVERHEAD_CAP): apron 23 -> 767
    expect(effectiveTileSize(64, 23)).toBe(Math.ceil((4 * 23) / tiledPipeline.APRON_OVERHEAD_CAP));
  });

  it('caps growth at MAX_WORKER_TILE so extreme aprons cannot OOM the worker', () => {
    // A maxed-out enhance stack (rlIters 30, psfSigma 3 -> apron ~550) would demand an ~18000px
    // tile (~5 GB Float32 RGBA). Correctness beats overhead: clamp at the hugeTileSize (4096).
    expect(MAX_WORKER_TILE).toBe(4096);
    expect(effectiveTileSize(2048, 550)).toBe(4096);
    expect(effectiveTileSize(4096, 550)).toBe(4096);
    // and still never shrinks a caller tile that already exceeds the cap
    expect(effectiveTileSize(5000, 550)).toBe(5000);
  });
});
