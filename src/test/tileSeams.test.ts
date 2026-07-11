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
 *    see the moduleApron enhance case). Its test image (buildEnhanceDensityImage) gives each tile
 *    a DIFFERENT edge density, so edgeMask's global `mmax` normalisation genuinely matters: the
 *    tiled run matches the untiled run only when BOTH the apron covers the kernel cone AND the
 *    full-image edge-mask max is threaded to every tile (computeGlobalEdgeMax → ProcessingContext).
 *    Two sensitivity guards prove each failure mode seams (too-small apron; per-tile normalisation),
 *    then the combined path is bit-exact.
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

const { spatialApron, planApronTile, effectiveTileSize, moduleApron, MAX_WORKER_TILE, pipelineUsesEdgeMask } = tiledPipeline;

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
 *
 * Mirrors pipeline.worker.ts PROCESS_TILE faithfully: the real processTiledImage computes the
 * full-image edgeMaskGlobalMax and sends it in the message; this stub, like the real worker, puts
 * it on the tile's ProcessingContext so edgeMask normalises by the global constant.
 *
 * `ignoreGlobalMax` (default false) simulates the PRE-FIX worker that never threaded the value:
 * the tile then normalises by its OWN buffer max (per-tile) — used only by the sensitivity guard
 * to prove the harness catches the per-tile normalisation seam.
 */
async function processTiled(
  img: WorkerImageData,
  config: WorkerModuleConfig[],
  tileSize: number,
  { ignoreGlobalMax = false }: { ignoreGlobalMax?: boolean } = {},
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
    const ctx: ProcessingContext = {
      width: tileWidth,
      height: tileHeight,
      channels,
      edgeMaskGlobalMax: ignoreGlobalMax ? undefined : (data.edgeMaskGlobalMax as number | undefined),
    };
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
 * DIFFERENT edge densities per tile region — the honest test for global edgeMask normalisation.
 *
 * edgeMask normalises Sobel magnitudes by the buffer-global max gradient `mmax`. When tiled and
 * normalised PER TILE, a tile whose local max differs from the whole image's applies a different
 * sharpen gain → a smooth per-tile step at the crop lines. The old test dodged this by planting
 * identical maximum-gradient stamps in every tile (per-tile mmax === global). This image does the
 * OPPOSITE — it makes the per-tile maxes genuinely differ, so the seam is REAL unless the global
 * max is threaded to every tile:
 *
 * - DARK grey high-frequency noise EVERYWHERE ([0.02, 0.22]): RL-deconv divides by the local blur
 *   (`rel = y/max(conv, eps)`), so small `conv` AMPLIFIES contamination — this is what lets the
 *   too-small-apron sensitivity guard detect a kernel seam, and it gives the highpass a real signal
 *   so the mask-normalisation difference reaches the output. Its Sobel max (~1) is the whole faint
 *   background.
 * - ONE strong hard vertical edge (black→white) in the LEFT tile only (x≈250). With TILE=64 the
 *   effective tile is 767px, so the grid is 2 tiles: left core [0,767), right core [767,1000). The
 *   right tile's padded region starts at 767-23=744, well right of x=250, so the strong edge (Sobel
 *   magnitude 4) is the whole-image max AND the left tile's local max, but NOT the right tile's —
 *   the right tile sees only the faint ~1 background. Per-tile normalisation therefore over-amplifies
 *   the right region's sharpen; threading the global max makes every tile match the untiled gain.
 */
function buildEnhanceDensityImage(W: number, H: number): Float32Array {
  const data = createNoiseImage(W, H, 11);
  for (let i = 0; i < data.length; i += 4) {
    const v = 0.02 + 0.2 * data[i]; // grey so luma === v; dark → RL amplifies contamination
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1;
  }
  // Hard vertical edge at x=250 (3px black band | 3px white band): a pure vertical step → Sobel
  // gx=4, gy=0, magnitude 4 — well above the faint background's max, and located only in the left
  // tile (its padded region never reaches the right tile).
  const edgeX = 250;
  for (let y = 0; y < H; y++) {
    for (let x = edgeX - 3; x < edgeX + 3; x++) {
      const v = x < edgeX ? 0 : 1;
      const idx = (y * W + x) * 4;
      data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 1;
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

  it('tiled enhance is BIT-EXACT vs untiled with the global edge-mask max; both a too-small apron and per-tile normalisation seam', async () => {
    const img: WorkerImageData = {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      data: buildEnhanceDensityImage(WIDTH, HEIGHT),
    };

    // Guard: >= 2 tiles (else the test is vacuous), and the tile split is the intended left/right.
    const apron = spatialApron(enhanceConfig);
    const eff = effectiveTileSize(TILE, apron);
    expect(Math.ceil(WIDTH / eff) * Math.ceil(HEIGHT / eff)).toBe(2);

    const untiled = await processUntiled(img, enhanceConfig);
    // Sanity: enhance actually changed the image.
    expect(maxImageDifference(untiled, img.data)).toBeGreaterThan(0.01);

    // SENSITIVITY GUARD A — apron: force an apron well inside the RL contamination band; the
    // boundary must show a real KERNEL discrepancy (proves the harness detects convolution seams).
    const spy = jest.spyOn(tiledPipeline, 'spatialApron').mockReturnValue(11);
    const seamyApron = await processTiled(img, enhanceConfig, TILE);
    spy.mockRestore();
    expect(maxImageDifference(seamyApron, untiled)).toBeGreaterThan(5e-7);

    // SENSITIVITY GUARD B — per-tile normalisation (the P3 residual, RED without the fix): correct
    // apron, but the worker ignores the threaded global edge-mask max, so each tile normalises by
    // its OWN buffer max. The right tile (faint texture only) over-amplifies its sharpen vs the
    // untiled whole-image gain → a real, honest seam this image is designed to expose. This is the
    // assertion the old test's max-gradient stamps dodged; it fails the bit-exact bound below.
    const seamyNorm = await processTiled(img, enhanceConfig, TILE, { ignoreGlobalMax: true });
    expect(maxImageDifference(seamyNorm, untiled)).toBeGreaterThan(1e-3);

    // THE assertion: correct apron AND the global edge-mask max threaded to every tile → every
    // interior pixel's full dependency cone fits its padded tile and every tile normalises by the
    // SAME constant, so the arithmetic is IDENTICAL to the untiled run → exactly 0 (defensive 1e-7).
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

describe('pipelineUsesEdgeMask — gate for the global edge-mask sweep', () => {
  const enh = (params: Record<string, unknown>): WorkerModuleConfig[] => [
    { moduleId: 'enhance', enabled: true, params: { enabled: true, sharpen: true, upscale: false, psfSigma: 1.0, rlIters: 12, ...params } },
  ];
  it('true for an enabled enhance-sharpen module with an active RL/edgeMask pass', () => {
    expect(pipelineUsesEdgeMask(enh({}))).toBe(true);
  });
  it('false when the enhance module is disabled', () => {
    expect(pipelineUsesEdgeMask([{ moduleId: 'enhance', enabled: false, params: { enabled: true, sharpen: true } }])).toBe(false);
  });
  it('false on the upscale path or when sharpen is off (edgeMask does not run there)', () => {
    expect(pipelineUsesEdgeMask(enh({ upscale: true }))).toBe(false);
    expect(pipelineUsesEdgeMask(enh({ sharpen: false }))).toBe(false);
  });
  it('false when RL is off (rlIters 0 or psfSigma 0 → lumaGraft/edgeMask never runs)', () => {
    expect(pipelineUsesEdgeMask(enh({ rlIters: 0 }))).toBe(false);
    expect(pipelineUsesEdgeMask(enh({ psfSigma: 0 }))).toBe(false);
  });
  it('false for a pipeline with no enhance module', () => {
    expect(pipelineUsesEdgeMask([{ moduleId: 'exposure', enabled: true, params: { exposure: 0.3 } }])).toBe(false);
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
