import { rgbaSrgbToLinear, rgbaLinearToSrgb } from './enhanceColor';

const sinc = (x: number): number => { if (x === 0) return 1; const p = Math.PI * x; return Math.sin(p) / p; };
const lanczosWeight = (x: number, a: number): number => (x <= -a || x >= a ? 0 : sinc(x) * sinc(x / a));

interface Taps { idx: number[]; wts: number[]; wsum: number }
function buildTaps(dst: number, src: number, a: number): Taps[] {
  const ratio = src / dst, out: Taps[] = [];
  for (let d = 0; d < dst; d++) {
    const center = (d + 0.5) * ratio - 0.5;
    const lo = Math.floor(center - a) + 1, hi = Math.floor(center + a);
    const idx: number[] = [], wts: number[] = []; let wsum = 0;
    for (let s = lo; s <= hi; s++) {
      const w = lanczosWeight(center - s, a);
      if (w !== 0) { idx.push(Math.min(src - 1, Math.max(0, s))); wts.push(w); wsum += w; }
    }
    out.push({ idx, wts, wsum: wsum || 1 });
  }
  return out;
}

export function lanczosResizeLinear(
  rgba: Float32Array, w: number, h: number, dw: number, dh: number, a = 4,
): { data: Float32Array; width: number; height: number } {
  const lin = rgbaSrgbToLinear(rgba);
  const xt = buildTaps(dw, w, a), yt = buildTaps(dh, h, a);
  const tmp = new Float32Array(dw * h * 4);          // horizontal pass: w -> dw
  for (let dx = 0; dx < dw; dx++) {
    const t = xt[dx];
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let k = 0; k < t.idx.length; k++) { const si = (y * w + t.idx[k]) * 4, wv = t.wts[k]; r += lin[si]*wv; g += lin[si+1]*wv; b += lin[si+2]*wv; al += lin[si+3]*wv; }
      const di = (y * dw + dx) * 4; tmp[di]=r/t.wsum; tmp[di+1]=g/t.wsum; tmp[di+2]=b/t.wsum; tmp[di+3]=al/t.wsum;
    }
  }
  const out = new Float32Array(dw * dh * 4);          // vertical pass: h -> dh
  for (let dy = 0; dy < dh; dy++) {
    const t = yt[dy];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let k = 0; k < t.idx.length; k++) { const si = (t.idx[k] * dw + x) * 4, wv = t.wts[k]; r += tmp[si]*wv; g += tmp[si+1]*wv; b += tmp[si+2]*wv; al += tmp[si+3]*wv; }
      const di = (dy * dw + x) * 4; out[di]=r/t.wsum; out[di+1]=g/t.wsum; out[di+2]=b/t.wsum; out[di+3]=al/t.wsum;
    }
  }
  return { data: rgbaLinearToSrgb(out), width: dw, height: dh };
}
