/**
 * Apron (halo) tiling math for the CPU worker pipeline.
 *
 * The Web-Worker fallback path (`WebWorkerImageProcessor`) splits large images into a grid of
 * tiles and processes each tile in a worker as a STANDALONE image. That is exact for point
 * operations (exposure, curves, white balance, …) but wrong for any SPATIAL filter — a
 * convolution / blur / bilateral / NLM / CAS sharpen reads neighbour pixels, and at a tile
 * boundary those neighbours belong to the ADJACENT tile. Without them the filter clamps at the
 * tile edge, producing a visible SEAM every `tileSize` pixels.
 *
 * The fix (mirrors the AI upscaler's overlapped tiling in `electron/aiUpscaler.cjs`):
 * extract each tile with an APRON of `apron` extra pixels borrowed from its neighbours, process
 * the padded tile, then CROP the apron away so only interior pixels — which now saw real
 * neighbour context — land in the output. Edge tiles get less apron on the border side; there the
 * padded edge IS the image edge, so the module's own edge policy (all live spatial modules clamp)
 * applies exactly as it would on the untiled image.
 *
 * SCOPE — the apron makes BOUNDED-CONVOLUTION modules seam-free (blur / sharpen / NLM /
 * ShadowsHighlights mask blur / the enhance chain's kernel cone). It does NOT cover geometric
 * warps (lens distortion/perspective/CA, crop rotation), whose sampling displacement scales with
 * image size rather than a fixed kernel radius — see the NOTE on {@link moduleApron}. Nor can it
 * bound truly global statistics (e.g. enhance edgeMask's `mmax` normalisation — see the enhance
 * case comment), though those produce smooth per-tile gain differences, not hard seams.
 *
 * `apron` must be >= the summed kernel radius of the enabled spatial modules (they run chained in
 * one worker pass, so contamination from the padded edge accumulates radius-by-radius through the
 * chain). {@link spatialApron} derives it from the actual params — never hardcoded.
 *
 * Pure math only (no Electron / DOM / worker) so it is unit-tested in isolation and reused by
 * `WebWorkerImageProcessor`.
 */

import type { WorkerModuleConfig } from '../services/WebWorkerImageProcessor';

/** Gaussian-blur kernel radius used across the enhance chain: `gaussianBlur1` uses
 *  `radius = max(1, ceil(sigma*3))` (src/utils/enhanceOps.ts). */
function gaussRadius(sigma: number): number {
  return sigma > 0 ? Math.max(1, Math.ceil(sigma * 3)) : 0;
}

function num(params: Record<string, unknown>, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Maximum spatial kernel radius (px) a single enabled module reads, derived from its params.
 * Point operations return 0. Values are read straight from each module's CPU convolution so the
 * apron tracks the real footprint (grep the cited sources if a module's math changes).
 *
 * NOTE — geometric warps are deliberately NOT covered: `lenscorrections` distortion/perspective/CA
 * and `crop` rotation resample from a source point whose displacement scales with IMAGE SIZE, not a
 * fixed kernel. An apron cannot make those seamless in a tiled pass (they are a separate, pre-existing
 * limitation of tiling geometric transforms); only the bounded convolutions are aproned here.
 */
export function moduleApron(moduleId: string, params: Record<string, unknown>): number {
  switch (moduleId) {
    case 'shadowshighlights': {
      // Mask box-blur (ShadowsHighlightsModule.blurMask): only offsets with euclidean
      // distance <= maskBlur contribute, so the effective axis footprint is ceil(maskBlur).
      // Optional 3x3 bilateral pre-pass adds 1. maskBlur range 0..10.
      const maskBlur = num(params, 'maskBlur', 1);
      const bilateral = params.bilateralFilter === true ? 1 : 0;
      return Math.ceil(Math.max(0, maskBlur)) + bilateral;
    }
    case 'noise-reduction': {
      // AdvancedDenoisingService CPU path (BM3D/NLM): search window + block/patch. These are
      // FIXED service defaults (searchRadius 21 + blockSize 8 for BM3D), independent of strength.
      // Interior tiles get full search context; the service's own border-copy only affects the
      // padded edge, which we crop away.
      const enabled = params.enabled === true;
      return enabled ? 29 : 0;
    }
    case 'enhance': {
      // enhanceImage sharpen chain (src/utils/enhanceChain.ts) — every pass is a clamped
      // gaussianBlur1 or a 3x3 stencil. The luma dependency cone is the dominant term:
      //   RL-deconv (rlDeconvLuma, enhanceRestore.ts): each iteration applies TWO gaussianBlur1
      //     passes — the convolution (:9) AND the correlation (:12) — and est(k+1) depends on
      //     est(k) through both, so the cone grows 2*gaussRadius(psfSigma) PER ITERATION
      //     -> 2*rlIters*gaussRadius(psfSigma) total.
      //   lumaGraft (enhanceOps.ts:57-60): hp = highpass(RL OUTPUT, hpSigma) chains IN SERIES on
      //     the RL cone (adds gaussRadius(hpSigma)); the edgeMask branch (Sobel r1 + blur sigma
      //     2.0 => r6 -> 7) runs on the ORIGINAL luma — a parallel branch -> max of the two.
      //   CAS: 3x3 => +1 in series after.
      //   => luma = 1 + max(7, 2*rlIters*gaussRadius(psfSigma) + gaussRadius(hpSigma))
      //      (defaults psfSigma=1, rlIters=12, hpSigma=1.2 -> 1 + max(7, 2*12*3 + 4) = 77)
      // chroma path: optional denoiseChroma then cleanChroma(sigma 1.2 => r4) IN SERIES (adds);
      // luma/chroma merge pointwise in yCrCbToRgba -> overall max of the two branches.
      //
      // RESIDUAL (not kernel-bounded, cannot be aproned): edgeMask normalises by the buffer-GLOBAL
      // max gradient `mmax` (enhanceOps.ts:33). When a padded tile's local max gradient differs
      // from the full image's, the sharpen gain differs slightly per tile — a smooth,
      // amplitude-bounded difference, not a hard convolution seam. The integration seam test pins
      // mmax by planting identical max-gradient features in every tile.
      const enabled = params.enabled === true;
      const sharpen = params.sharpen !== false;
      const upscale = params.upscale === true;
      if (!enabled || !sharpen || upscale) return 0;
      const psfSigma = num(params, 'psfSigma', 1.0);
      const rlIters = num(params, 'rlIters', 12);
      const hpSigma = num(params, 'hpSigma', 1.2);
      const denoiseStrength = num(params, 'denoiseStrength', 0);
      const chromaClean = params.chromaClean !== false;
      let luma = 1; // CAS 3x3
      if (rlIters > 0 && psfSigma > 0) {
        luma += Math.max(7, 2 * rlIters * gaussRadius(psfSigma) + gaussRadius(hpSigma));
      }
      let chroma = 0;
      if (denoiseStrength > 0) chroma += gaussRadius(0.4 + 0.12 * denoiseStrength);
      if (chromaClean) chroma += gaussRadius(1.2);
      return Math.max(luma, chroma);
    }
    case 'lenscorrections': {
      // Only the CREATIVE Gaussian blur is a bounded, clamp-edge convolution we can apron.
      // (The distortion/perspective/CA warp is geometric — see the NOTE above — and is not covered.)
      const enabled = params.enabled !== false;
      const blur = params.blur as { enabled?: boolean; radius?: number } | undefined;
      if (!enabled || !blur || blur.enabled !== true) return 0;
      return Math.ceil(Math.max(0, num(blur as unknown as Record<string, unknown>, 'radius', 0)));
    }
    default:
      // exposure / whitebalance / basicadjustments / tonecurve / colorbalance / localadjustments /
      // crop → point operations (or geometric, not covered): no spatial apron.
      return 0;
  }
}

/**
 * Apron (px) needed for a pipeline: the SUM of every enabled spatial module's kernel radius.
 * They run chained in a single worker pass, so the "contaminated" band from the padded edge grows
 * by each module's radius in turn — summing guarantees every interior pixel saw real context
 * through the WHOLE chain. Returns 0 when no enabled module has a spatial footprint (point-op-only
 * pipelines need no overlap, so tiling stays free).
 */
export function spatialApron(pipeline: WorkerModuleConfig[]): number {
  let total = 0;
  for (const { moduleId, enabled, params } of pipeline) {
    if (!enabled) continue;
    total += moduleApron(moduleId, params ?? {});
  }
  return total;
}

/** Overhead cap for the apron's redundant border pixels, as a fraction of the core tile area. */
export const APRON_OVERHEAD_CAP = 0.12;

/**
 * Hard ceiling on tile growth — matches WebWorkerImageProcessor's `hugeTileSize` (the largest tile
 * the worker path is ever asked to allocate). A maxed-out enhance stack (rlIters 30, psfSigma 3 ->
 * apron ~550) would otherwise demand an ~18000-px tile: a single Float32 RGBA tile buffer of
 * ~5 GB -> worker OOM. Capped, the buffer stays <= ~270 MB.
 */
export const MAX_WORKER_TILE = 4096;

/**
 * Tile size to actually use for a given `apron`. The apron adds an `apron`-px border to every tile,
 * so the redundant-compute overhead is ~`4*apron/tileSize`; a small tile with a wide kernel is
 * wasteful. Grow the tile just enough to keep that overhead <= {@link APRON_OVERHEAD_CAP}, and
 * never shrink (the caller's size already encodes the memory budget). No-op when `apron` is 0 or
 * the tile is already large enough — the common case: the 2048-px production tile is untouched for
 * any apron up to ~61 px (a single spatial filter), so only heavy multi-filter stacks grow it.
 *
 * Growth is clamped at {@link MAX_WORKER_TILE}: for extreme aprons (maxed-out enhance stacks) the
 * redundant-pixel overhead may then exceed the ~12-15% target — accepted trade-off, correctness
 * (a seam-free result within worker memory limits) beats overhead there.
 */
export function effectiveTileSize(tileSize: number, apron: number): number {
  if (apron <= 0) return tileSize;
  const minTile = Math.ceil((4 * apron) / APRON_OVERHEAD_CAP);
  return Math.max(tileSize, Math.min(minTile, MAX_WORKER_TILE));
}

/** Per-tile geometry for an apron-overlapped tile. All coords are in full-image pixels. */
export interface ApronTilePlan {
  /** Interior region written to the output (the tile's own pixels, no apron). */
  coreX: number;
  coreY: number;
  coreW: number;
  coreH: number;
  /** Padded region extracted from the source and sent to the worker. */
  padX: number;
  padY: number;
  padW: number;
  padH: number;
  /** Apron actually applied on the top/left = the crop offset of the core inside the padded result.
   *  Less than `apron` for tiles flush against the top/left image border. */
  apronLeft: number;
  apronTop: number;
}

/**
 * Compute the padded-extract + crop geometry for tile (`tileX`,`tileY`) of a `tileSize` grid over a
 * `width`x`height` image, borrowing up to `apron` px of context from neighbours on every side and
 * clamping the apron at the image borders.
 */
export function planApronTile(
  tileX: number,
  tileY: number,
  tileSize: number,
  width: number,
  height: number,
  apron: number,
): ApronTilePlan {
  const coreX = tileX * tileSize;
  const coreY = tileY * tileSize;
  const coreW = Math.min(tileSize, width - coreX);
  const coreH = Math.min(tileSize, height - coreY);

  const a = Math.max(0, Math.ceil(apron));
  const apronLeft = Math.min(a, coreX);
  const apronTop = Math.min(a, coreY);
  const apronRight = Math.min(a, width - (coreX + coreW));
  const apronBottom = Math.min(a, height - (coreY + coreH));

  return {
    coreX,
    coreY,
    coreW,
    coreH,
    padX: coreX - apronLeft,
    padY: coreY - apronTop,
    padW: coreW + apronLeft + apronRight,
    padH: coreH + apronTop + apronBottom,
    apronLeft,
    apronTop,
  };
}
