import { clamp01 } from './enhanceColor';

export function gaussianBlur1(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1); let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + radius] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0; for (let t = -radius; t <= radius; t++) { const xx = Math.min(w - 1, Math.max(0, x + t)); acc += src[y * w + xx] * k[t + radius]; }
    tmp[y * w + x] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0; for (let t = -radius; t <= radius; t++) { const yy = Math.min(h - 1, Math.max(0, y + t)); acc += tmp[yy * w + x] * k[t + radius]; }
    out[y * w + x] = acc;
  }
  return out;
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

export function cas(y: Float32Array, w: number, h: number, sharpness: number): Float32Array {
  const out = new Float32Array(w * h);
  const peak = -(0.125 + 0.075 * clamp01(sharpness));
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
