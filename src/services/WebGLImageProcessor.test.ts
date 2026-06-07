/**
 * WebGLImageProcessor — Phase-1 GPU POC.
 *
 * jsdom has no WebGL2 context, so these tests exercise the CPU fallback path:
 * they prove the exposure math is correct and that the processor degrades
 * gracefully (no GPU available) without throwing. The GPU path itself is verified
 * in-app via the startup benchmark (real Chromium/GPU in Electron).
 */
import { webGLImageProcessor } from './WebGLImageProcessor';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

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

  test('applyChannelGains multiplies + clamps per channel (CPU fallback)', () => {
    const out = webGLImageProcessor.applyChannelGains(
      new Float32Array([0.4, 0.5, 0.6, 1, 0.9, 0.2, 0.1, 1]), 2, 1, 1.5, 1.0, 2.0);
    expect(out[0]).toBeCloseTo(0.6, 5);  // 0.4*1.5
    expect(out[1]).toBeCloseTo(0.5, 5);  // 0.5*1.0
    expect(out[2]).toBeCloseTo(1.0, 5);  // 0.6*2.0 = 1.2 -> clamp 1
    expect(out[3]).toBe(1);              // alpha untouched
    expect(out[4]).toBeCloseTo(1.0, 5);  // 0.9*1.5 = 1.35 -> clamp 1
  });

  test('denoise returns null in jsdom (no GPU) so the module falls back to CPU', () => {
    const d = new Float32Array(4 * 4 * 4).fill(0.5);
    expect(webGLImageProcessor.denoise(d, 4, 4, 50)).toBeNull();
  });
});

/**
 * The GPU basic-adjustments shader is a port of BasicAdjustmentsModule. We can't
 * run WebGL in jsdom, so we instead verify the processor's CPU REFERENCE (the same
 * math the shader implements, and the GPU-vs-reference self-check) is identical to
 * the real module. Transitively: shader == reference (in-app self-check) and
 * reference == module (here) ⇒ shader == module.
 */
describe('GPU basic-adjustments CPU reference matches BasicAdjustmentsModule', () => {
  const w = 4, h = 4;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 4) / 4; src[i * 4 + 1] = ((i * 2) % 5) / 5;
    src[i * 4 + 2] = ((i * 3) % 7) / 7; src[i * 4 + 3] = 1;
  }
  const PARAM_SETS = [
    { exposure: 0.3, contrast: 0.5, brightness: 0.2, black_point: 0.1, saturation: 0.3, vibrance: 0.2, dehaze: 0.2, highlights: 0.4, shadows: -0.3 },
    { exposure: -0.5, contrast: 2.0, brightness: -0.3, black_point: 0, saturation: -0.5, vibrance: 0, dehaze: 0, highlights: 0, shadows: 0 },
    { exposure: 0.6, contrast: 0, brightness: 0, black_point: 0, saturation: 0, vibrance: 0.4, dehaze: 0.5, highlights: -0.6, shadows: 0.5 },
    { exposure: 0, contrast: 0, brightness: 0, black_point: 0, saturation: 0, vibrance: 0, dehaze: 0, highlights: 0, shadows: 0 },
  ];

  test.each(PARAM_SETS)('parity for %o', (p) => {
    const mod = new BasicAdjustmentsModule();
    mod.setParams(p);
    const params = mod.getParams();
    const expected = mod.process(new Float32Array(src), { width: w, height: h, channels: 4 });
    const ref = webGLImageProcessor.basicAdjustmentsCPU(new Float32Array(src), w, h, params);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});
