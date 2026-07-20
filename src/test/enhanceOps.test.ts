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

/**
 * REFERENCE implementation of the separable Gaussian blur — a verbatim copy of the pre-optimization
 * gaussianBlur1 (per-pixel tap loops with a Math.min/Math.max clamp on EVERY tap, fresh tmp/out
 * buffers). The optimized version (hoisted border clamps + t-outer f64 row accumulation + pooled
 * scratch, R3 of the 2026-07-20 export-speed task) must be BIT-IDENTICAL to this: same taps, same
 * per-pixel accumulation order, f64 accumulate + single f32 store. Exact equality, not closeTo.
 */
function gaussianBlurReference(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
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

/** Deterministic pseudo-random luma plane (mulberry32) — content-independent bit-exactness proof. */
function noisePlane(w: number, h: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = rand();
  return a;
}

describe('gaussianBlur1 optimization — BIT-IDENTICAL to the per-tap-clamp reference (R3)', () => {
  const firstMismatch = (a: Float32Array, b: Float32Array): number => {
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
    return -1;
  };

  // Shapes chosen to hit every span split: interior-dominated, non-square, width smaller than the
  // kernel radius (all-border rows), single-column/row edge cases, and consecutive calls with
  // DIFFERENT sizes/sigmas to prove the pooled scratch and kernel cache never leak state.
  const cases: Array<[w: number, h: number, sigma: number, seed: number]> = [
    [64, 40, 1.0, 1],   // radius 3 — the UNROLLED RL hot path (psfSigma default)
    [64, 40, 0.6, 9],   // radius 2 — unrolled
    [64, 40, 1.2, 7],   // radius 4 — unrolled (hpSigma / cleanChroma default)
    [64, 40, 2.0, 10],  // radius 6 — generic path (edgeMask blur)
    [40, 64, 3.0, 2],   // radius 9, non-square (tall) — generic path
    [5, 17, 3.0, 3],    // w=5 < radius 9 → horizontal pass is ALL border clamps
    [17, 5, 3.0, 4],    // h=5 < radius 9 → vertical clamp saturates both ends
    [5, 17, 1.0, 11],   // w=5 < 2*radius+1 on the UNROLLED radius-3 path (border-only spans)
    [3, 9, 1.2, 12],    // w=3 < radius 4 on the unrolled radius-4 path
    [1, 32, 1.5, 5],    // single column (radius 5 generic)
    [32, 1, 1.5, 6],    // single row
    [1, 8, 1.0, 13],    // single column through the unrolled radius-3 path
    [24, 24, 0, 8],     // sigma<=0 identity path (slice semantics preserved)
  ];

  it.each(cases)('w=%i h=%i sigma=%s — exact equality on seeded noise', (w, h, sigma, seed) => {
    const src = noisePlane(w, h, seed);
    const got = gaussianBlur1(src, w, h, sigma);
    const ref = gaussianBlurReference(src, w, h, sigma);
    expect(got.length).toBe(ref.length);
    expect(firstMismatch(got, ref)).toBe(-1);
  });

  it('back-to-back calls with alternating sizes stay exact (pooled scratch is fully overwritten)', () => {
    const a = noisePlane(48, 32, 11);
    const b = noisePlane(16, 16, 12);
    // Interleave sizes so any stale pooled state from the previous call would corrupt the next.
    expect(firstMismatch(gaussianBlur1(a, 48, 32, 2.0), gaussianBlurReference(a, 48, 32, 2.0))).toBe(-1);
    expect(firstMismatch(gaussianBlur1(b, 16, 16, 2.0), gaussianBlurReference(b, 16, 16, 2.0))).toBe(-1);
    expect(firstMismatch(gaussianBlur1(a, 48, 32, 2.0), gaussianBlurReference(a, 48, 32, 2.0))).toBe(-1);
  });
});
