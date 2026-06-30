/**
 * Tiling math for AI super-resolution (Real-ESRGAN x4plus).
 *
 * The bundled ONNX model has a **fixed** input of 128x128 -> 512x512 (x4) — confirmed by the
 * Task 1 de-risking spike (`.superpowers/sdd/ai-spike-findings.md`). It does NOT accept dynamic
 * input sizes, so we cannot feed arbitrary tile sizes. Instead we cover the image with a grid of
 * fixed 128x128 source windows that overlap by `2*pad` px; each window is fed to the model (edge
 * windows reflect-padded to fill 128x128 by the caller), producing a 512x512 output that is
 * composited by weighted feather accumulation (`blendWeight`) for seamless results.
 *
 * Pure math only — no Electron, no native deps — so it is unit-tested in isolation. `aiUpscaler.cjs`
 * (main process) inlines an identical copy of this logic in CommonJS; these tests cover the algorithm.
 */

/** Model input side length (px). FIXED by the ONNX model — do not change without a new model. */
export const MODEL_TILE = 128;
/** Model output scale. FIXED (x4). */
export const MODEL_SCALE = 4;
/** Model output tile side length (px) = MODEL_TILE * MODEL_SCALE. */
export const MODEL_TILE_OUT = MODEL_TILE * MODEL_SCALE; // 512

export interface Tile {
  /**
   * Top-left x of the 128x128 source window to feed the model. May be negative or push past the
   * image's right edge near borders; the extractor reflect-pads/clamps to fill a full 128x128 input.
   */
  sx: number;
  /** Top-left y of the 128x128 source window (same border semantics as {@link Tile.sx}). */
  sy: number;
}

/**
 * Window top-left positions along one axis. Windows are MODEL_TILE wide and step by
 * `(MODEL_TILE - 2*pad)` so neighbours overlap by `2*pad` (the feather band). The first window
 * starts `pad` before the origin (context via reflect-pad); the last is clamped flush so its far
 * edge reaches the image edge (+pad context), avoiding a thin sliver tile.
 */
function axisStarts(extent: number, pad: number): number[] {
  // Image fits inside one model tile: centre it (start <= 0) and reflect-pad the margins.
  if (extent <= MODEL_TILE) return [Math.floor((extent - MODEL_TILE) / 2)];
  const step = MODEL_TILE - 2 * pad;
  const lastStart = extent - MODEL_TILE + pad; // flush window: right edge at extent + pad
  const starts: number[] = [];
  for (let s = -pad; s < lastStart; s += step) starts.push(s);
  starts.push(lastStart);
  return starts;
}

/** Exposed for unit tests only; not part of the public tiling API. */
export const axisStartsForTest = axisStarts;

/**
 * Plan a grid of fixed 128x128 source windows covering `[0,width) x [0,height)`.
 * @param pad context margin (px) shared with neighbours on each side; `0 <= pad < MODEL_TILE/2`.
 *            Larger pad = smoother seams but more tiles (slower). Real-ESRGAN convention ~10-16.
 */
export function planTiles(width: number, height: number, pad: number): Tile[] {
  const xs = axisStarts(width, pad);
  const ys = axisStarts(height, pad);
  const tiles: Tile[] = [];
  for (const sy of ys) for (const sx of xs) tiles.push({ sx, sy });
  return tiles;
}

/** 1D feather: ramps 0->1 across `band` px from each edge of the 512px output tile, 1 in the middle. */
function ramp(p: number, band: number): number {
  if (band <= 0) return 1;
  const d = Math.min(p, MODEL_TILE_OUT - 1 - p); // distance (px) to the nearest output-tile edge
  return Math.max(0, Math.min(1, (d + 0.5) / band));
}

/**
 * Separable feather weight (0..1) for a pixel at (`localX`,`localY`) within a tile's 512x512
 * OUTPUT. Ramps 0->1 across the `pad*MODEL_SCALE` band at each edge and is 1 in the centre, so
 * overlapping tiles blend seamlessly under weighted accumulation (sum colour*weight, divide by
 * sum weight). `pad=0` disables feathering (weight 1 everywhere).
 */
export function blendWeight(localX: number, localY: number, pad: number): number {
  const band = pad * MODEL_SCALE; // feather width in output space
  return ramp(localX, band) * ramp(localY, band);
}
