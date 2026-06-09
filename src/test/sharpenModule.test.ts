import { SharpenModule } from '../modules/SharpenModule';

/**
 * Build a small RGBA Float32 image with a single bright pixel in a dark field —
 * an edge the unsharp mask should accentuate.
 */
function makeEdgeImage(width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = 1; // alpha
  }
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const idx = (cy * width + cx) * 4;
  data[idx] = 0.8;
  data[idx + 1] = 0.8;
  data[idx + 2] = 0.8;
  return data;
}

describe('SharpenModule', () => {
  const ctx = { width: 16, height: 16, channels: 4 };

  it('defaults to identity (amount 0 leaves pixels unchanged)', () => {
    const m = new SharpenModule();
    expect(m.isIdentity()).toBe(true);
    const input = makeEdgeImage(16, 16);
    const out = m.process(input, ctx);
    expect(Array.from(out)).toEqual(Array.from(input));
    // and a fresh buffer is returned (input not mutated / not aliased)
    expect(out).not.toBe(input);
  });

  it('accentuates an edge when amount > 0', () => {
    const m = new SharpenModule();
    m.setParams({ amount: 100, radius: 1.0, detail: 0 });
    expect(m.isIdentity()).toBe(false);

    const input = makeEdgeImage(16, 16);
    const out = m.process(input, ctx);

    const center = (8 * 16 + 8) * 4;
    // The bright center should get brighter (overshoot) relative to the blurred mean.
    expect(out[center]).toBeGreaterThan(input[center]);
    // A neighbouring dark pixel should be pushed darker (undershoot) or stay clamped at 0.
    const neighbour = (8 * 16 + 9) * 4;
    expect(out[neighbour]).toBeLessThanOrEqual(input[neighbour] + 1e-6);
  });

  it('preserves the alpha channel', () => {
    const m = new SharpenModule();
    m.setParams({ amount: 120, radius: 2, detail: 10 });
    const input = makeEdgeImage(16, 16);
    const out = m.process(input, ctx);
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i]).toBeCloseTo(input[i], 6);
    }
  });

  it('clamps and validates params', () => {
    const m = new SharpenModule();
    m.setParams({ amount: 999, radius: 99, detail: -50 });
    const p = m.getParams();
    expect(p.amount).toBe(150);
    expect(p.radius).toBe(5);
    expect(p.detail).toBe(0);
  });

  it('resetParams restores defaults (identity)', () => {
    const m = new SharpenModule();
    m.setParams({ amount: 100 });
    m.resetParams();
    expect(m.isIdentity()).toBe(true);
    expect(m.getParams().amount).toBe(0);
  });
});
