import { gaussianBlurInto } from './enhanceOps';

/** Richardson-Lucy on luma with a symmetric Gaussian PSF (its own mirror -> blur twice per iter). */
export function rlDeconvLuma(y: Float32Array, w: number, h: number, psfSigma: number, iters: number): Float32Array {
  if (iters <= 0 || psfSigma <= 0) return y.slice();
  const eps = 1e-6, n = w * h;
  const est = y.slice();
  // Reused scratch, hoisted out of the loop: `rel` (the relative-blur ratio) and the two blur
  // outputs `conv`/`corr` are FULLY overwritten (every index written) on each iteration below —
  // gaussianBlurInto writes every output pixel — so reusing them is a pure allocation win with
  // bit-identical output (verified by enhanceRestore.test.ts's reference-impl equality test).
  // The old shape allocated 2 fresh w*h buffers per iteration via gaussianBlur1 (24 with the
  // default rlIters=12 — ~1.9 GB of churn per 20MP export photo).
  const rel = new Float32Array(n);
  const conv = new Float32Array(n);
  const corr = new Float32Array(n);
  for (let k = 0; k < iters; k++) {
    gaussianBlurInto(est, w, h, psfSigma, conv);
    for (let p = 0; p < n; p++) rel[p] = y[p] / Math.max(conv[p], eps);
    gaussianBlurInto(rel, w, h, psfSigma, corr);
    for (let p = 0; p < n; p++) { const v = est[p] * corr[p]; est[p] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
  return est;
}

/**
 * Chroma denoise as a JOINT-BILATERAL filter GUIDED BY LUMA: chroma (Cr/Cb) is smoothed with a
 * spatial Gaussian whose weights are additionally gated by the LUMINANCE difference between the
 * center and each neighbour. The range term reads the luma guide (not chroma), so chroma smooths
 * freely inside a luminance-uniform region but STOPS at luma edges — no colour bleeding across
 * contours (the plain-Gaussian fallback bled: it averaged chroma straight across the edge).
 *
 *  - spatialSigma = 0.4 + 0.12·strength (strength 0..10 → 0.4..1.6 px) — same as the old fallback.
 *  - window radius = ceil(spatialSigma·3) (≤5 for the supported strength range), matching
 *    gaussianBlur1's radius convention; a small fixed window keeps this O(n·(2r+1)²) sane.
 *  - rangeSigma = 0.10 on the 0..1 luma guide: a full-contrast luma edge (Δ≈0.6–0.8) drives the
 *    cross-edge weight to ~exp(-18)≈0 while a flat region (Δ≈0) keeps weight 1. The center tap
 *    (spatial=range=1) guarantees the weight sum is ≥1, so the normalisation never divides by 0.
 * Out-of-bounds neighbours are skipped (renormalised by the accumulated weight) rather than clamped.
 */
export function denoiseChroma(
  cr: Float32Array, cb: Float32Array, guideY: Float32Array,
  w: number, h: number, strength: number,
): { cr: Float32Array; cb: Float32Array } {
  if (strength <= 0) return { cr, cb };
  const sSigma = 0.4 + 0.12 * strength;
  const radius = Math.max(1, Math.ceil(sSigma * 3));
  const rSigma = 0.10;
  const s2 = 2 * sSigma * sSigma;
  const r2 = 2 * rSigma * rSigma;
  const outCr = new Float32Array(cr.length);
  const outCb = new Float32Array(cb.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const gc = guideY[c];
      let accCr = 0, accCb = 0, wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const idx = yy * w + xx;
          const spatial = Math.exp(-(dx * dx + dy * dy) / s2);
          const dl = guideY[idx] - gc;
          const range = Math.exp(-(dl * dl) / r2);
          const wgt = spatial * range;
          accCr += cr[idx] * wgt;
          accCb += cb[idx] * wgt;
          wsum += wgt;
        }
      }
      outCr[c] = accCr / wsum;
      outCb[c] = accCb / wsum;
    }
  }
  return { cr: outCr, cb: outCb };
}
