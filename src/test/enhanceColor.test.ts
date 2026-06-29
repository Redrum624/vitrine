import { clamp01, srgbToLinear, linearToSrgb, rgbaToYCrCb, yCrCbToRgba } from '../utils/enhanceColor';

describe('enhanceColor', () => {
  it('clamps', () => { expect(clamp01(-1)).toBe(0); expect(clamp01(2)).toBe(1); expect(clamp01(0.3)).toBeCloseTo(0.3); });
  it('srgb<->linear round-trips and pins endpoints', () => {
    expect(srgbToLinear(0)).toBeCloseTo(0); expect(srgbToLinear(1)).toBeCloseTo(1);
    for (const v of [0.05, 0.2, 0.5, 0.9]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 5);
  });
  it('gray maps to chroma 0.5 and round-trips', () => {
    const rgba = new Float32Array([0.4, 0.4, 0.4, 1]);
    const ycc = rgbaToYCrCb(rgba);
    expect(ycc.y[0]).toBeCloseTo(0.4, 5); expect(ycc.cr[0]).toBeCloseTo(0.5, 5); expect(ycc.cb[0]).toBeCloseTo(0.5, 5);
    const back = yCrCbToRgba(ycc);
    expect(back[0]).toBeCloseTo(0.4, 4); expect(back[3]).toBe(1);
  });
  it('color round-trips within tolerance and preserves alpha', () => {
    const rgba = new Float32Array([0.2, 0.6, 0.8, 0.5]);
    const back = yCrCbToRgba(rgbaToYCrCb(rgba));
    expect(back[0]).toBeCloseTo(0.2, 3); expect(back[1]).toBeCloseTo(0.6, 3); expect(back[2]).toBeCloseTo(0.8, 3); expect(back[3]).toBe(0.5);
  });
});
