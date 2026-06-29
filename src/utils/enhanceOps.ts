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

export function edgeMask(y: Float32Array, w: number, h: number, blur = 2.0, gamma = 0.75): Float32Array {
  const at = (x: number, yy: number) => y[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, x))];
  const mag = new Float32Array(w * h); let mmax = 1e-6;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const gx = -at(i-1,j-1) - 2*at(i-1,j) - at(i-1,j+1) + at(i+1,j-1) + 2*at(i+1,j) + at(i+1,j+1);
    const gy = -at(i-1,j-1) - 2*at(i,j-1) - at(i+1,j-1) + at(i-1,j+1) + 2*at(i,j+1) + at(i+1,j+1);
    const m = Math.sqrt(gx*gx + gy*gy); mag[j*w+i] = m; if (m > mmax) mmax = m;
  }
  const pw = new Float32Array(w * h);
  for (let p = 0; p < pw.length; p++) pw[p] = Math.pow(mag[p] / mmax, gamma);
  const blurred = gaussianBlur1(pw, w, h, blur);
  for (let p = 0; p < blurred.length; p++) blurred[p] = clamp01(blurred[p]);
  return blurred;
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

export function lumaGraft(origY: Float32Array, detailY: Float32Array, w: number, h: number, alpha: number, hpSigma: number): Float32Array {
  const mask = edgeMask(origY, w, h), hp = highpass(detailY, w, h, hpSigma), out = new Float32Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = clamp01(origY[p] + alpha * mask[p] * hp[p]);
  return out;
}

export function cleanChroma(cr: Float32Array, cb: Float32Array, w: number, h: number, sigma = 1.2): { cr: Float32Array; cb: Float32Array } {
  return { cr: gaussianBlur1(cr, w, h, sigma), cb: gaussianBlur1(cb, w, h, sigma) };
}
