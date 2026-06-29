import { gaussianBlur1, highpass, edgeMask, cas, lumaGraft } from '../utils/enhanceOps';

const W = 8, H = 8;
const constant = (v: number) => { const a = new Float32Array(W*H); a.fill(v); return a; };
const vEdge = () => { const a = new Float32Array(W*H); for (let y=0;y<H;y++) for (let x=0;x<W;x++) a[y*W+x] = x < W/2 ? 0.2 : 0.8; return a; };

describe('enhanceOps', () => {
  it('gaussianBlur1 preserves a constant field', () => {
    const out = gaussianBlur1(constant(0.5), W, H, 1.5);
    for (const v of out) expect(v).toBeCloseTo(0.5, 4);
  });
  it('highpass of a constant field is ~0', () => {
    const out = highpass(constant(0.5), W, H, 1.2);
    for (const v of out) expect(Math.abs(v)).toBeLessThan(1e-3);
  });
  it('edgeMask is high on the edge column, low in flat regions', () => {
    const m = edgeMask(vEdge(), W, H);
    const edgeCol = m[3 * W + (W/2)];   // near the transition
    const flatCol = m[3 * W + 0];       // far left, flat
    expect(edgeCol).toBeGreaterThan(flatCol);
  });
  it('cas leaves a flat field unchanged', () => {
    const out = cas(constant(0.5), W, H, 0.4);
    for (const v of out) expect(v).toBeCloseTo(0.5, 4);
  });
  it('lumaGraft preserves luma in flat regions (mask ~0) and never NaNs', () => {
    const base = constant(0.5), detail = constant(0.9);
    const out = lumaGraft(base, detail, W, H, 0.8, 1.2);
    for (const v of out) { expect(Number.isNaN(v)).toBe(false); expect(v).toBeCloseTo(0.5, 3); }
  });
});
