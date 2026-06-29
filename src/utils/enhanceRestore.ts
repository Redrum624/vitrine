import { gaussianBlur1 } from './enhanceOps';

/** Richardson-Lucy on luma with a symmetric Gaussian PSF (its own mirror -> blur twice per iter). */
export function rlDeconvLuma(y: Float32Array, w: number, h: number, psfSigma: number, iters: number): Float32Array {
  if (iters <= 0 || psfSigma <= 0) return y.slice();
  const eps = 1e-6, n = w * h;
  const est = y.slice();
  for (let k = 0; k < iters; k++) {
    const conv = gaussianBlur1(est, w, h, psfSigma);
    const rel = new Float32Array(n);
    for (let p = 0; p < n; p++) rel[p] = y[p] / Math.max(conv[p], eps);
    const corr = gaussianBlur1(rel, w, h, psfSigma);
    for (let p = 0; p < n; p++) { const v = est[p] * corr[p]; est[p] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
  return est;
}

/** Phase-1 gentle denoise: chroma-only Gaussian (luma detail untouched; full luma NLM is the
 *  dedicated Noise Reduction module / Phase-2 AI). strength 0..10 -> sigma ~0.4..1.6. */
export function denoiseChroma(cr: Float32Array, cb: Float32Array, w: number, h: number, strength: number): { cr: Float32Array; cb: Float32Array } {
  if (strength <= 0) return { cr, cb };
  const sigma = 0.4 + 0.12 * strength;
  return { cr: gaussianBlur1(cr, w, h, sigma), cb: gaussianBlur1(cb, w, h, sigma) };
}
