export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
export const linearToSrgb = (c: number): number => {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

export function rgbaSrgbToLinear(rgba: Float32Array): Float32Array {
  const out = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = srgbToLinear(rgba[i]); out[i + 1] = srgbToLinear(rgba[i + 1]);
    out[i + 2] = srgbToLinear(rgba[i + 2]); out[i + 3] = rgba[i + 3];
  }
  return out;
}
export function rgbaLinearToSrgb(rgba: Float32Array): Float32Array {
  const out = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = linearToSrgb(rgba[i]); out[i + 1] = linearToSrgb(rgba[i + 1]);
    out[i + 2] = linearToSrgb(rgba[i + 2]); out[i + 3] = rgba[i + 3];
  }
  return out;
}

export interface YCrCb { y: Float32Array; cr: Float32Array; cb: Float32Array; a: Float32Array }

export function rgbaToYCrCb(rgba: Float32Array): YCrCb {
  const n = rgba.length / 4;
  const y = new Float32Array(n), cr = new Float32Array(n), cb = new Float32Array(n), a = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const yy = 0.299 * r + 0.587 * g + 0.114 * b;
    y[p] = yy; cr[p] = (r - yy) * 0.713 + 0.5; cb[p] = (b - yy) * 0.564 + 0.5; a[p] = rgba[i + 3];
  }
  return { y, cr, cb, a };
}
export function yCrCbToRgba({ y, cr, cb, a }: YCrCb): Float32Array {
  const n = y.length, rgba = new Float32Array(n * 4);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const yy = y[p], crd = cr[p] - 0.5, cbd = cb[p] - 0.5;
    rgba[i] = clamp01(yy + 1.403 * crd);
    rgba[i + 1] = clamp01(yy - 0.714 * crd - 0.344 * cbd);
    rgba[i + 2] = clamp01(yy + 1.773 * cbd);
    rgba[i + 3] = a[p];
  }
  return rgba;
}
