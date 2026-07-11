import { gaussianBlur1, highpass, edgeMask, cas, lumaGraft, computeGlobalEdgeMax } from '../utils/enhanceOps';
import { rgbaToYCrCb } from '../utils/enhanceColor';

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
  it('edgeMask with an absent globalMax is byte-identical to its own buffer-max normalisation', () => {
    // Passing globalMax=undefined must not change any output value (untiled path unchanged).
    const y = vEdge();
    const withDefault = edgeMask(y, W, H);
    const withUndefined = edgeMask(y, W, H, 2.0, 0.75, undefined);
    for (let i = 0; i < withDefault.length; i++) expect(withUndefined[i]).toBe(withDefault[i]);
  });
  it('computeGlobalEdgeMax equals the buffer max edgeMask would use → threading it is byte-identical', () => {
    // Build an RGBA image; its BT.601 luma is what edgeMask normalises. computeGlobalEdgeMax over
    // the RGBA must equal edgeMask's internal mmax, so edgeMask(y, …, gMax) === edgeMask(y).
    const rgba = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const v = x < W / 2 ? 0.15 : 0.85;
      rgba[idx] = v; rgba[idx + 1] = v * 0.7; rgba[idx + 2] = 1 - v; rgba[idx + 3] = 1;
    }
    const y = rgbaToYCrCb(rgba).y;
    const gMax = computeGlobalEdgeMax(rgba, W, H);
    const local = edgeMask(y, W, H);                 // computes its own buffer max
    const global = edgeMask(y, W, H, 2.0, 0.75, gMax); // uses the threaded global max
    for (let i = 0; i < local.length; i++) expect(global[i]).toBe(local[i]);
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
