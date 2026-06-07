/**
 * WebGLImageProcessor — Phase-1 GPU POC.
 *
 * jsdom has no WebGL2 context, so these tests exercise the CPU fallback path:
 * they prove the exposure math is correct and that the processor degrades
 * gracefully (no GPU available) without throwing. The GPU path itself is verified
 * in-app via the startup benchmark (real Chromium/GPU in Electron).
 */
import { webGLImageProcessor } from './WebGLImageProcessor';

function img(pixels: number[][]): Float32Array {
  const a = new Float32Array(pixels.length * 4);
  pixels.forEach((p, i) => { a[i * 4] = p[0]; a[i * 4 + 1] = p[1]; a[i * 4 + 2] = p[2]; a[i * 4 + 3] = p[3]; });
  return a;
}

describe('WebGLImageProcessor (CPU fallback in jsdom)', () => {
  test('is unavailable in jsdom and reports so without throwing', () => {
    expect(webGLImageProcessor.isAvailable()).toBe(false);
  });

  test('exposure +1 stop doubles RGB and leaves alpha', () => {
    const out = webGLImageProcessor.applyExposure(img([[0.1, 0.2, 0.3, 1], [0.4, 0.0, 0.5, 0.5]]), 2, 1, 1);
    expect(out[0]).toBeCloseTo(0.2, 5);
    expect(out[1]).toBeCloseTo(0.4, 5);
    expect(out[2]).toBeCloseTo(0.6, 5);
    expect(out[3]).toBe(1);          // alpha untouched
    expect(out[4]).toBeCloseTo(0.8, 5);
    expect(out[7]).toBe(0.5);        // alpha untouched
  });

  test('exposure 0 stops is identity', () => {
    const src = img([[0.3, 0.6, 0.9, 1]]);
    const out = webGLImageProcessor.applyExposure(src, 1, 1, 0);
    // gain = 1, so the output equals the (already float32-rounded) input exactly.
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  test('exposure -1 stop halves RGB', () => {
    const out = webGLImageProcessor.applyExposure(img([[0.8, 0.4, 0.2, 1]]), 1, 1, -1);
    expect(out[0]).toBeCloseTo(0.4, 5);
    expect(out[1]).toBeCloseTo(0.2, 5);
    expect(out[2]).toBeCloseTo(0.1, 5);
  });

  test('benchmark runs the CPU path and reports no GPU in jsdom', () => {
    const r = webGLImageProcessor.benchmark(8, 8, 1);
    expect(r.available).toBe(false);
    expect(r.gpuMs).toBeNull();
    expect(r.cpuMs).toBeGreaterThanOrEqual(0);
    expect(r.maxDiff).toBe(0);
  });
});
