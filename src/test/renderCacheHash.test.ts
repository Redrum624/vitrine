/**
 * Regression: the Canvas render-cache hash used to loop forever on sub-40px images. The
 * center-area sampler stepped by `Math.floor(min(w,h)/4 / 10)`, which is 0 for any image
 * with min(w,h) < 40 (a 16×16 image → floor(4/10) = 0), so `dy += 0` never advanced and the
 * loops spun forever. computeRenderCacheHash clamps that step to >= 1.
 *
 * With the OLD inline code, the 16×16 case below would hang and hit Jest's timeout (RED).
 * The clamp makes it terminate immediately (GREEN).
 */
import { computeRenderCacheHash } from '../utils/renderCacheHash';

describe('computeRenderCacheHash — sub-40px infinite-loop regression', () => {
  it('terminates on a 16×16 image (would hang with the un-clamped step-0 loop)', () => {
    const w = 16;
    const h = 16;
    const data = new Float32Array(w * h * 4).fill(0.5);

    // If the center-sampling step is 0 this call never returns and the test times out.
    const start = Date.now();
    const hash = computeRenderCacheHash('/tmp/tiny.png', w, h, data);
    expect(Date.now() - start).toBeLessThan(1000);

    expect(typeof hash).toBe('string');
    expect(hash.startsWith('/tmp/tiny.png_16x16_')).toBe(true);
  }, 2000);

  it('terminates across the whole sub-40px danger band (1..39 px squares)', () => {
    for (let n = 1; n < 40; n++) {
      const data = new Float32Array(n * n * 4).fill(0.25);
      const hash = computeRenderCacheHash('x', n, n, data);
      expect(hash).toContain(`_${n}x${n}_`);
    }
  }, 5000);

  it('leaves the hash of a normal (>= 40px) image well-formed and content-sensitive', () => {
    const w = 64;
    const h = 48;
    const a = new Float32Array(w * h * 4).fill(0.1);
    const b = new Float32Array(w * h * 4).fill(0.1);
    // Change one center pixel so the sampling picks it up.
    const center = ((h / 2) * w + w / 2) * 4;
    b[center] = 0.9;

    const hashA = computeRenderCacheHash('img', w, h, a);
    const hashB = computeRenderCacheHash('img', w, h, b);
    expect(hashA).not.toBe(hashB);
  });

  it('handles an empty buffer without sampling', () => {
    const hash = computeRenderCacheHash('img', 0, 0, new Float32Array(0));
    expect(hash).toBe('img_0x0_0');
  });
});
