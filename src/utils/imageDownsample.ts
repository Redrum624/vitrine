/**
 * Area-averaged (box) downsampling for RGB/RGBA float images.
 *
 * The module-preview path in AdjustmentPanel previously shrank the source with a
 * nearest-neighbour "every Nth pixel" sample (`src[floor(x*scaleX)]`). Dropping pixels
 * that way discards all the energy between the sampled points, so high-frequency content
 * (fine textures, fabric, foliage, resolution charts) aliases into visible moiré and the
 * preview stops matching what the full-resolution render will produce.
 *
 * A box downsample instead averages EVERY source pixel that falls inside a destination
 * pixel's footprint, which is the correct anti-aliased result for shrinking. Averaging is
 * done in the input's own value space (no colour conversion), so a black/white checkerboard
 * collapses to mid-grey rather than a nearest-neighbour all-black-or-all-white pattern.
 *
 * Output is always RGBA (alpha defaults to 1 when the source is 3-channel).
 */
export function boxDownsampleRGBA(
  src: ArrayLike<number>,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  srcChannels: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * scaleY);
    // At least one row per cell (guards against a zero-height footprint when dstH > srcH).
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((dy + 1) * scaleY)));

    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.ceil((dx + 1) * scaleX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowBase = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (rowBase + sx) * srcChannels;
          r += src[si];
          g += src[si + 1];
          b += src[si + 2];
          a += srcChannels === 4 ? src[si + 3] : 1;
          n++;
        }
      }

      const di = (dy * dstW + dx) * 4;
      out[di] = r / n;
      out[di + 1] = g / n;
      out[di + 2] = b / n;
      out[di + 3] = a / n;
    }
  }

  return out;
}
