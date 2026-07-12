import { rlDeconvLuma, denoiseChroma } from '../utils/enhanceRestore';
import { gaussianBlur1 } from '../utils/enhanceOps';

const W = 16, H = 16;
const sharpEdge = () => { const a = new Float32Array(W*H); for (let y=0;y<H;y++) for (let x=0;x<W;x++) a[y*W+x] = x < W/2 ? 0.1 : 0.9; return a; };

/** Reference RL that allocates a fresh `rel` buffer every iteration (the pre-refactor shape) —
 *  used to prove the hoisted-scratch version is bit-identical. */
function rlReference(y: Float32Array, w: number, h: number, psfSigma: number, iters: number): Float32Array {
  if (iters <= 0 || psfSigma <= 0) return y.slice();
  const eps = 1e-6, n = w * h;
  const est = y.slice();
  for (let k = 0; k < iters; k++) {
    const conv = gaussianBlur1(est, w, h, psfSigma);
    const rel = new Float32Array(n);
    for (let p = 0; p < n; p++) rel[p] = y[p] / Math.max(conv[p], eps);
    const corr = gaussianBlur1(rel, w, h, psfSigma);
    for (let p = 0; p < n; p++) { const v = est[p] * corr[p]; est[p] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
  return est;
}

describe('enhanceRestore', () => {
  it('rlDeconvLuma is identity when iters=0', () => {
    const y = sharpEdge();
    expect(Array.from(rlDeconvLuma(y, W, H, 1.0, 0))).toEqual(Array.from(y));
  });
  it('rlDeconvLuma sharpens a blurred edge back toward the original (higher gradient)', () => {
    const orig = sharpEdge();
    const blurred = gaussianBlur1(orig, W, H, 1.5);
    const restored = rlDeconvLuma(blurred, W, H, 1.5, 20);
    const grad = (a: Float32Array) => Math.abs(a[8*W + 8] - a[8*W + 7]);
    expect(grad(restored)).toBeGreaterThan(grad(blurred));
    for (const v of restored) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('rlDeconvLuma (hoisted scratch buffer) is BIT-IDENTICAL to the per-iteration-alloc reference', () => {
    const blurred = gaussianBlur1(sharpEdge(), W, H, 1.4);
    for (const iters of [1, 5, 12, 20]) {
      const got = rlDeconvLuma(blurred, W, H, 1.4, iters);
      const ref = rlReference(blurred, W, H, 1.4, iters);
      expect(Array.from(got)).toEqual(Array.from(ref)); // exact equality, not toBeCloseTo
    }
  });
});

describe('denoiseChroma — joint-bilateral guided by luma', () => {
  const CW = 16, CH = 8, EDGE = 8;
  // Luma: sharp edge down the middle (left 0.2, right 0.8).
  const luma = () => { const y = new Float32Array(CW*CH); for (let j=0;j<CH;j++) for (let i=0;i<CW;i++) y[j*CW+i] = i < EDGE ? 0.2 : 0.8; return y; };
  // Chroma: distinct mean per side (left/right) + a ±0.05 checkerboard "noise" whose per-column
  // mean (over the CH rows) averages out exactly (CH even), so colMean measures side drift and
  // colVar measures the residual noise.
  const noisyChroma = (leftMean: number, rightMean: number) => {
    const c = new Float32Array(CW*CH);
    for (let j=0;j<CH;j++) for (let i=0;i<CW;i++) {
      const base = i < EDGE ? leftMean : rightMean;
      c[j*CW+i] = base + (((i+j) & 1) ? 0.05 : -0.05);
    }
    return c;
  };
  const colMean = (c: Float32Array, col: number) => { let s=0; for (let j=0;j<CH;j++) s += c[j*CW+col]; return s/CH; };
  const colVar = (c: Float32Array, col: number) => { const m = colMean(c,col); let s=0; for (let j=0;j<CH;j++){const d=c[j*CW+col]-m; s+=d*d;} return s/CH; };

  it('is a no-op at strength 0 (returns the same buffers)', () => {
    const cr = new Float32Array([0.5, 0.6]); const cb = new Float32Array([0.4, 0.5]);
    const y = new Float32Array([0.5, 0.5]);
    const out = denoiseChroma(cr, cb, y, 2, 1, 0);
    expect(out.cr).toBe(cr); expect(out.cb).toBe(cb);
  });

  it('smooths chroma noise WITHIN a luma-uniform region (variance drops sharply)', () => {
    const y = luma();
    const cr = noisyChroma(0.3, 0.7), cb = noisyChroma(0.4, 0.6);
    const out = denoiseChroma(cr, cb, y, CW, CH, 6);
    // Interior left column (x=2), far from the edge: the checkerboard should be largely averaged out.
    expect(colVar(out.cr, 2)).toBeLessThan(colVar(cr, 2) * 0.5);
  });

  it('does NOT bleed chroma across a luma edge — beats the plain Gaussian at the edge (the RED)', () => {
    const y = luma();
    const cr = noisyChroma(0.3, 0.7);
    const strength = 10, sigma = 0.4 + 0.12 * strength; // 1.6 → radius 5, reaches across the edge
    const joint = denoiseChroma(cr, cr.slice(), y, CW, CH, strength).cr;
    const gauss = gaussianBlur1(cr, CW, CH, sigma); // the OLD fallback behaviour
    const leftMean = 0.3;
    const jointCol7 = colMean(joint, 7);  // last column on the LEFT side (adjacent to the edge)
    const gaussCol7 = colMean(gauss, 7);
    // The Gaussian pulls col 7 toward the right side (0.7); the joint-bilateral holds it near 0.3.
    expect(Math.abs(jointCol7 - leftMean)).toBeLessThan(Math.abs(gaussCol7 - leftMean));
    expect(jointCol7).toBeLessThan(0.4);        // stayed on the left side (no bleed)
    expect(gaussCol7).toBeGreaterThan(jointCol7); // the Gaussian bled toward 0.7
  });
});
