import { clamp01 } from './enhanceColor';

/**
 * Normalised discrete Gaussian kernel for `sigma`, cached by exact sigma value. The kernel maths is
 * byte-identical to the historical inline construction (same exp/normalise order), so caching is a
 * pure allocation win. Only a handful of sigmas ever occur (psfSigma, hpSigma, edgeMask 2.0,
 * cleanChroma 1.2, …) — the cache is cleared if it somehow grows past 16 entries.
 */
const kernelCache = new Map<number, Float32Array>();
function gaussianKernel(sigma: number): Float32Array {
  const cached = kernelCache.get(sigma);
  if (cached) return cached;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1); let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + radius] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  if (kernelCache.size >= 16) kernelCache.clear();
  kernelCache.set(sigma, k);
  return k;
}

// Pooled scratch for gaussianBlurInto: the horizontal-pass intermediate (w*h) and the vertical
// clamped-row-base table (2r+1). Both are FULLY overwritten before being read on every call, and
// there is no await inside the blur, so reuse across calls is safe in a single-threaded JS context
// (each worker thread gets its own module instance). Exact-size policy for tmp: keeps at most one
// allocation of the last-used image size instead of two fresh w*h buffers per call — the RL
// deconvolution calls this 2×rlIters times per image (24 with defaults), so at 20MP the old code
// churned ~1.9 GB of throwaway allocations per photo.
let poolTmp: Float32Array | null = null;
let poolBases: Int32Array | null = null;

/** Horizontal border pixel (needs the clamp): exact per-tap clamp arithmetic of the historical loop. */
function hBorderTap(src: Float32Array, row: number, x: number, w: number, k: Float32Array, radius: number): number {
  let acc = 0;
  for (let t = -radius; t <= radius; t++) { const xx = Math.min(w - 1, Math.max(0, x + t)); acc += src[row + xx] * k[t + radius]; }
  return acc;
}

/**
 * Separable Gaussian blur of `src` into `out` (both w*h luma planes; aliasing src===out is safe —
 * the horizontal pass writes only the pooled intermediate). BIT-IDENTICAL to the historical
 * gaussianBlur1 (proven by src/test/enhanceOps.test.ts reference-equality + the tileSeams
 * bit-exactness suite), only faster:
 *  - horizontal pass: the border clamp (`Math.min/Math.max` PER TAP) is hoisted out of the
 *    interior span — interior pixels index directly; border pixels keep the exact clamp.
 *  - vertical pass: the row clamp is precomputed once per (y,t) as a row base offset, and the
 *    per-pixel accumulator stays in a register (f64, ascending-t adds, one f32 rounding at the
 *    store — exactly the historical per-pixel loop's arithmetic).
 *  - the hot radii (2, 3, 4 — psfSigma ≤ ~1.33, hpSigma/cleanChroma 1.2) run fully-unrolled
 *    interior spans: a left-to-right chained sum `a*k0 + b*k1 + …` evaluates in the SAME ascending
 *    tap order as `acc += …` (JS + is left-associative), so every intermediate f64 sum is
 *    bit-identical — the unroll only removes loop overhead (measured ~4.3× on the radius-3 pass
 *    that dominates RL deconvolution).
 * Kernel taps, tap order and normalisation are unchanged (visual behavior frozen — R3 contract).
 */
export function gaussianBlurInto(src: Float32Array, w: number, h: number, sigma: number, out: Float32Array): Float32Array {
  if (sigma <= 0) { out.set(src.subarray(0, w * h)); return out; }
  const k = gaussianKernel(sigma);
  const radius = (k.length - 1) >> 1;
  const n = w * h;
  if (!poolTmp || poolTmp.length !== n) poolTmp = new Float32Array(n);
  if (!poolBases || poolBases.length < k.length) poolBases = new Int32Array(k.length);
  const tmp = poolTmp, bases = poolBases;
  const xL = Math.min(radius, w);
  const xR = Math.max(xL, w - radius);
  const clampY = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v);

  if (radius === 3) {
    const k0 = k[0], k1 = k[1], k2 = k[2], k3 = k[3], k4 = k[4], k5 = k[5], k6 = k[6];
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < xL; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 3);
      for (let x = xL; x < xR; x++) {
        const b = row + x;
        tmp[b] = src[b - 3] * k0 + src[b - 2] * k1 + src[b - 1] * k2 + src[b] * k3 + src[b + 1] * k4 + src[b + 2] * k5 + src[b + 3] * k6;
      }
      for (let x = xR; x < w; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 3);
    }
    for (let y = 0; y < h; y++) {
      const b0 = clampY(y - 3) * w, b1 = clampY(y - 2) * w, b2 = clampY(y - 1) * w, b3 = y * w,
        b4 = clampY(y + 1) * w, b5 = clampY(y + 2) * w, b6 = clampY(y + 3) * w;
      const outRow = y * w;
      for (let x = 0; x < w; x++) {
        out[outRow + x] = tmp[b0 + x] * k0 + tmp[b1 + x] * k1 + tmp[b2 + x] * k2 + tmp[b3 + x] * k3 + tmp[b4 + x] * k4 + tmp[b5 + x] * k5 + tmp[b6 + x] * k6;
      }
    }
    return out;
  }

  if (radius === 2) {
    const k0 = k[0], k1 = k[1], k2 = k[2], k3 = k[3], k4 = k[4];
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < xL; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 2);
      for (let x = xL; x < xR; x++) {
        const b = row + x;
        tmp[b] = src[b - 2] * k0 + src[b - 1] * k1 + src[b] * k2 + src[b + 1] * k3 + src[b + 2] * k4;
      }
      for (let x = xR; x < w; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 2);
    }
    for (let y = 0; y < h; y++) {
      const b0 = clampY(y - 2) * w, b1 = clampY(y - 1) * w, b2 = y * w, b3 = clampY(y + 1) * w, b4 = clampY(y + 2) * w;
      const outRow = y * w;
      for (let x = 0; x < w; x++) {
        out[outRow + x] = tmp[b0 + x] * k0 + tmp[b1 + x] * k1 + tmp[b2 + x] * k2 + tmp[b3 + x] * k3 + tmp[b4 + x] * k4;
      }
    }
    return out;
  }

  if (radius === 4) {
    const k0 = k[0], k1 = k[1], k2 = k[2], k3 = k[3], k4 = k[4], k5 = k[5], k6 = k[6], k7 = k[7], k8 = k[8];
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < xL; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 4);
      for (let x = xL; x < xR; x++) {
        const b = row + x;
        tmp[b] = src[b - 4] * k0 + src[b - 3] * k1 + src[b - 2] * k2 + src[b - 1] * k3 + src[b] * k4 + src[b + 1] * k5 + src[b + 2] * k6 + src[b + 3] * k7 + src[b + 4] * k8;
      }
      for (let x = xR; x < w; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, 4);
    }
    for (let y = 0; y < h; y++) {
      const b0 = clampY(y - 4) * w, b1 = clampY(y - 3) * w, b2 = clampY(y - 2) * w, b3 = clampY(y - 1) * w, b4 = y * w,
        b5 = clampY(y + 1) * w, b6 = clampY(y + 2) * w, b7 = clampY(y + 3) * w, b8 = clampY(y + 4) * w;
      const outRow = y * w;
      for (let x = 0; x < w; x++) {
        out[outRow + x] = tmp[b0 + x] * k0 + tmp[b1 + x] * k1 + tmp[b2 + x] * k2 + tmp[b3 + x] * k3 + tmp[b4 + x] * k4 + tmp[b5 + x] * k5 + tmp[b6 + x] * k6 + tmp[b7 + x] * k7 + tmp[b8 + x] * k8;
      }
    }
    return out;
  }

  // Generic radius: hoisted border clamps horizontally; precomputed clamped row bases vertically.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < xL; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, radius);
    for (let x = xL; x < xR; x++) {
      let acc = 0; const b = row + x;
      for (let t = -radius; t <= radius; t++) acc += src[b + t] * k[t + radius];
      tmp[b] = acc;
    }
    for (let x = xR; x < w; x++) tmp[row + x] = hBorderTap(src, row, x, w, k, radius);
  }
  const taps = k.length;
  for (let y = 0; y < h; y++) {
    for (let t = -radius; t <= radius; t++) bases[t + radius] = clampY(y + t) * w;
    const outRow = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = 0; t < taps; t++) acc += tmp[bases[t] + x] * k[t];
      out[outRow + x] = acc;
    }
  }
  return out;
}

export function gaussianBlur1(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  return gaussianBlurInto(src, w, h, sigma, new Float32Array(w * h));
}

export function highpass(y: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const lp = gaussianBlur1(y, w, h, sigma), out = new Float32Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = y[p] - lp[p];
  return out;
}

export function edgeMask(y: Float32Array, w: number, h: number, blur = 2.0, gamma = 0.75, globalMax?: number): Float32Array {
  const at = (x: number, yy: number) => y[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))];
  const mag = new Float32Array(w * h);
  // Normalisation denominator. When a caller supplies the FULL-IMAGE max gradient (the tiled CPU
  // worker path — see computeGlobalEdgeMax), normalise by THAT instead of this buffer's own local
  // max, so the sharpen gain is uniform across tile boundaries (per-tile normalisation otherwise
  // produces a smooth gain step at the crop lines — P3 residual). Absent → compute the buffer max
  // exactly as before, so the untiled/whole-image path is byte-identical.
  const useGlobal = globalMax !== undefined && globalMax > 1e-6;
  let mmax = useGlobal ? globalMax : 1e-6;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const gx = -at(i-1,j-1) - 2*at(i-1,j) - at(i-1,j+1) + at(i+1,j-1) + 2*at(i+1,j) + at(i+1,j+1);
    const gy = -at(i-1,j-1) - 2*at(i,j-1) - at(i+1,j-1) + at(i-1,j+1) + 2*at(i,j+1) + at(i+1,j+1);
    const m = Math.sqrt(gx*gx + gy*gy); mag[j*w+i] = m; if (!useGlobal && m > mmax) mmax = m;
  }
  const pw = new Float32Array(w * h);
  for (let p = 0; p < pw.length; p++) pw[p] = Math.pow(mag[p] / mmax, gamma);
  const blurred = gaussianBlur1(pw, w, h, blur);
  for (let p = 0; p < blurred.length; p++) blurred[p] = clamp01(blurred[p]);
  return blurred;
}

/**
 * Full-image maximum Sobel-gradient magnitude of the BT.601 luma — the exact `mmax` that
 * {@link edgeMask} computes over `rgbaToYCrCb(rgba).y`. The tiled CPU worker path computes this
 * ONCE over the whole image (before tiling) and threads it to every tile's edgeMask so all tiles
 * normalise by the SAME constant, matching the untiled whole-image sharpen gain (no per-tile seam).
 *
 * MUST stay in lock-step with edgeMask's luma coefficients (rgbaToYCrCb: 0.299/0.587/0.114), Sobel
 * stencil and clamp-edge `at()`, and the 1e-6 floor — the threaded value only yields a byte-exact
 * match if it equals what edgeMask would have computed locally.
 */
export function computeGlobalEdgeMax(rgba: Float32Array, w: number, h: number): number {
  const n = w * h;
  const y = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) y[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const at = (x: number, yy: number) => y[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))];
  let mmax = 1e-6;
  // Interior pixels (1..w-2, 1..h-2) need no clamping → read the 3x3 stencil by direct index (no
  // closure, no min/max), which is what dominates a large image. The 1px border falls back to the
  // clamped `at()`. Both branches use edgeMask's exact stencil, so the result is byte-identical to
  // running `at()` everywhere — only faster (measured ~4x on 48MP).
  for (let j = 0; j < h; j++) {
    const interiorRow = j > 0 && j < h - 1;
    for (let i = 0; i < w; i++) {
      let gx: number, gy: number;
      if (interiorRow && i > 0 && i < w - 1) {
        const r0 = (j - 1) * w + i, r1 = j * w + i, r2 = (j + 1) * w + i;
        const a = y[r0 - 1], b = y[r0], c = y[r0 + 1];
        const d = y[r1 - 1], f = y[r1 + 1];
        const g = y[r2 - 1], hh = y[r2], ii = y[r2 + 1];
        gx = -a - 2 * d - g + c + 2 * f + ii;
        gy = -a - 2 * b - c + g + 2 * hh + ii;
      } else {
        gx = -at(i-1,j-1) - 2*at(i-1,j) - at(i-1,j+1) + at(i+1,j-1) + 2*at(i+1,j) + at(i+1,j+1);
        gy = -at(i-1,j-1) - 2*at(i,j-1) - at(i+1,j-1) + at(i-1,j+1) + 2*at(i,j+1) + at(i+1,j+1);
      }
      const m = Math.sqrt(gx * gx + gy * gy); if (m > mmax) mmax = m;
    }
  }
  return mmax;
}

/**
 * v1.36.0 C5 — WYSIWYG resolution-compensated sharpen kernels (chain-audit F7).
 *
 * Enhance parameter semantics are defined at NATIVE resolution: psfSigma / hpSigma / the CAS
 * window describe the effect on the full-resolution image — what an EXPORT produces. A preview
 * pass runs at the quality cap (1024 base, ratcheted up to 4096/native), so applying the same
 * pixel-space σ to a ~4-5× smaller buffer looked ~4-5× stronger than the export. The fix
 * (industry convention, Lightroom-style): preview passes scale their kernels DOWN by
 * `kernelScale = processingLongEdge / nativeLongEdge`. Consequences:
 *   - export / bake develop passes run at native → scale 1 → BIT-IDENTICAL to pre-C5;
 *   - at fit zoom the sharpen preview becomes subtle BY DESIGN; at 1:1 (where the quality
 *     ratchet already delivers native-res processing) the preview now MATCHES the export —
 *     tune sharpening at 1:1. That is the WYSIWYG contract.
 *
 * σ floor ({@link ENHANCE_KERNEL_SIGMA_FLOOR_PX}): below ~0.3px an effective Gaussian sigma
 * degenerates to a near-delta kernel (gaussianKernel's min radius 1 tap weight → ~1), so the
 * stage is treated as VISUALLY-NIL — but the pipeline structure is deliberately KEPT (no stage
 * is skipped, σ_eff is never clamped up), so toggling a slider still previews *something*
 * consistent and gate conditions (`psfSigma > 0` etc.) stay equivalent to the raw params.
 *
 * The CAS window is a fixed 3×3 stencil — it cannot shrink below its pixel support — so its
 * PEAK AMPLITUDE scales by `casGain = kernelScale` instead (the sub-pixel-window approximation);
 * below the floor that amplitude is a sliver but never zeroed (same keep-the-structure rule).
 *
 * Derive the scale ONCE per pass (enhanceKernelScale at pass-build) and thread it — never
 * per-stage ad hoc, and NEVER from tile dims (a tiled pass threads the full-pass scale to every
 * tile exactly like edgeMaskGlobalMax). Both the CPU chain (enhanceImage) and the GPU parity
 * port (GpuPreviewPipeline.runEnhanceChain) read the SAME derived values from
 * {@link effectiveEnhanceKernels} so the two routes can never drift.
 */
export const ENHANCE_KERNEL_SIGMA_FLOOR_PX = 0.3;

/**
 * `processingLongEdge / nativeLongEdge`, clamped to ≤1 (kernels are only ever scaled DOWN — a
 * super-native pass keeps native semantics). Fail-safe: an unknown/invalid native long edge
 * returns 1, so every caller that does not thread native dims (exports, bake develop passes,
 * the enhance worker's native-res routes) keeps exact pre-C5 behavior.
 */
export function enhanceKernelScale(processingLongEdge: number, nativeLongEdge?: number): number {
  if (!Number.isFinite(processingLongEdge) || processingLongEdge <= 0) return 1;
  if (nativeLongEdge === undefined || !Number.isFinite(nativeLongEdge) || nativeLongEdge <= 0) return 1;
  return Math.min(1, processingLongEdge / nativeLongEdge);
}

/** Resolution-compensated kernel parameters — the single source shared by CPU and GPU routes. */
export interface EffectiveEnhanceKernels {
  /** RL-deconvolution PSF sigma at processing resolution (σ × kernelScale). */
  psfSigma: number;
  /** lumaGraft highpass sigma at processing resolution (σ × kernelScale). */
  hpSigma: number;
  /** CAS peak-amplitude multiplier (the 3×3 window can't shrink — amplitude scales instead). */
  casGain: number;
}

/**
 * Scale the sharpen kernels for a pass. `kernelScale` outside (0,1) — including NaN/Infinity —
 * is treated as 1: kernels are never amplified, and an unthreaded scale means native semantics.
 * At scale 1 the multiplications are exact no-ops (IEEE ×1), so native passes stay bit-identical.
 */
export function effectiveEnhanceKernels(psfSigma: number, hpSigma: number, kernelScale: number): EffectiveEnhanceKernels {
  const s = Number.isFinite(kernelScale) && kernelScale > 0 && kernelScale < 1 ? kernelScale : 1;
  return { psfSigma: psfSigma * s, hpSigma: hpSigma * s, casGain: s };
}

/**
 * CAS peak weight from the sharpness slider (0..1). v1.36.0 C1/F2 recalibration: the old
 * `-(0.125 + 0.075·s)` applied 62.5% of maximum sharpening at s=0 and squashed the whole slider
 * into a 1.6× range. New curve: `-0.2·s` — zero means OFF, the s=1 maximum (-0.2) is unchanged.
 * SHARED by the CPU chain (cas below) and the GPU parity port (GpuPreviewPipeline enh_cas pass)
 * so the two can never drift. Callers skip the CAS pass entirely at s≤0 (true no-op).
 */
export function casPeak(sharpness: number): number {
  return -0.2 * clamp01(sharpness);
}

/**
 * CAS luma sharpen. `casGain` (default 1 = native semantics, bit-identical to the pre-C5 4-arg
 * call) is the C5 resolution compensation: the 3×3 window cannot shrink below its pixel support,
 * so a sub-native preview attenuates the PEAK amplitude by kernelScale instead — see
 * {@link effectiveEnhanceKernels}.
 */
export function cas(y: Float32Array, w: number, h: number, sharpness: number, casGain = 1): Float32Array {
  const out = new Float32Array(w * h);
  const peak = casPeak(sharpness) * casGain;
  const at = (x: number, yy: number) => y[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a=at(i-1,j-1), b=at(i,j-1), c=at(i+1,j-1), d=at(i-1,j), e=y[j*w+i], f=at(i+1,j), g=at(i-1,j+1), hh=at(i,j+1), ii=at(i+1,j+1);
    let mn = Math.min(b,d,e,f,hh); mn = Math.min(mn,a,c,g,ii);
    let mx = Math.max(b,d,e,f,hh); mx = Math.max(mx,a,c,g,ii);
    const amp = Math.sqrt(clamp01(Math.min(mn, 1 - mx) / Math.max(mx, 1e-6)));
    const wv = amp * peak;
    out[j*w+i] = clamp01((e + wv*(b+d+f+hh)) / (1 + 4*wv));
  }
  return out;
}

export function lumaGraft(origY: Float32Array, detailY: Float32Array, w: number, h: number, alpha: number, hpSigma: number, edgeMaskGlobalMax?: number): Float32Array {
  const mask = edgeMask(origY, w, h, 2.0, 0.75, edgeMaskGlobalMax), hp = highpass(detailY, w, h, hpSigma), out = new Float32Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = clamp01(origY[p] + alpha * mask[p] * hp[p]);
  return out;
}

export function cleanChroma(cr: Float32Array, cb: Float32Array, w: number, h: number, sigma = 1.2): { cr: Float32Array; cb: Float32Array } {
  return { cr: gaussianBlur1(cr, w, h, sigma), cb: gaussianBlur1(cb, w, h, sigma) };
}
