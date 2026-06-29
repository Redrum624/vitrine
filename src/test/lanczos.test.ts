// src/test/lanczos.test.ts
import { lanczosResizeLinear } from '../utils/lanczos';

const flat = (w: number, h: number, rgb: [number, number, number]) => {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i*4]=rgb[0]; d[i*4+1]=rgb[1]; d[i*4+2]=rgb[2]; d[i*4+3]=1; }
  return d;
};

describe('lanczosResizeLinear', () => {
  it('produces exact target dimensions', () => {
    const out = lanczosResizeLinear(flat(4, 4, [0.5, 0.5, 0.5]), 4, 4, 8, 8);
    expect(out.width).toBe(8); expect(out.height).toBe(8); expect(out.data.length).toBe(8*8*4);
  });
  it('preserves a flat color (degamma/regamma round-trip) and alpha', () => {
    const out = lanczosResizeLinear(flat(4, 4, [0.2, 0.6, 0.8]), 4, 4, 8, 8);
    expect(out.data[0]).toBeCloseTo(0.2, 3); expect(out.data[1]).toBeCloseTo(0.6, 3);
    expect(out.data[2]).toBeCloseTo(0.8, 3); expect(out.data[3]).toBeCloseTo(1, 3);
  });
  it('downscales to exact target dimensions and preserves a flat color', () => {
    const out = lanczosResizeLinear(flat(8, 8, [0.2, 0.6, 0.8]), 8, 8, 4, 4);
    expect(out.width).toBe(4); expect(out.height).toBe(4); expect(out.data.length).toBe(4*4*4);
    expect(out.data[0]).toBeCloseTo(0.2, 3); expect(out.data[1]).toBeCloseTo(0.6, 3); expect(out.data[2]).toBeCloseTo(0.8, 3);
  });
  it('resamples a non-unit alpha (does not force alpha to 1)', () => {
    const d = new Float32Array(4*4*4);
    for (let i = 0; i < 4*4; i++) { d[i*4]=0.5; d[i*4+1]=0.5; d[i*4+2]=0.5; d[i*4+3]=0.5; }
    const out = lanczosResizeLinear(d, 4, 4, 8, 8);
    expect(out.data[3]).toBeCloseTo(0.5, 3);
  });
});
