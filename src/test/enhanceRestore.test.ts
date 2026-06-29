import { rlDeconvLuma, denoiseChroma } from '../utils/enhanceRestore';
import { gaussianBlur1 } from '../utils/enhanceOps';

const W = 16, H = 16;
const sharpEdge = () => { const a = new Float32Array(W*H); for (let y=0;y<H;y++) for (let x=0;x<W;x++) a[y*W+x] = x < W/2 ? 0.1 : 0.9; return a; };

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
  it('denoiseChroma is a no-op at strength 0', () => {
    const cr = new Float32Array([0.5, 0.6]); const cb = new Float32Array([0.4, 0.5]);
    const out = denoiseChroma(cr, cb, 2, 1, 0);
    expect(out.cr).toBe(cr); expect(out.cb).toBe(cb);
  });
});
