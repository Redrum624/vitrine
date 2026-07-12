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
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { ToneCurveModule } from '../modules/ToneCurveModule';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { HueCurvesModule } from '../modules/HueCurvesModule';

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

describe('GPU tone-curve CPU reference matches ToneCurveModule', () => {
  const w = 4, h = 4;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 4) / 4; src[i * 4 + 1] = ((i * 5) % 7) / 7;
    src[i * 4 + 2] = ((i * 3) % 5) / 5; src[i * 4 + 3] = 1;
  }

  test('parity (base curve + RGB curves, luminance preserve)', () => {
    const mod = new ToneCurveModule();
    mod.setParams({
      baseCurve: [{ x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }],
      baseCurveType: 1, preserveColors: 1,
      rgbCurve: {
        red: [{ x: 0, y: 0 }, { x: 1, y: 0.95 }],
        green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0.05 }, { x: 1, y: 1 }],
      },
    });
    const expected = mod.process({ width: w, height: h, channels: 4, data: new Float32Array(src) }).data as Float32Array;
    const m = mod as unknown as { lookupTable: Float32Array; rgbLookupTables: { red: Float32Array; green: Float32Array; blue: Float32Array } };
    const ref = webGLImageProcessor.toneCurveCPU(
      new Float32Array(src), w, h,
      m.lookupTable, m.rgbLookupTables.red, m.rgbLookupTables.green, m.rgbLookupTables.blue,
      mod.getParams().preserveColors,
    );
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('GPU hue-curves CPU reference matches HueCurvesModule', () => {
  const w = 5, h = 4;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 5) / 5; src[i * 4 + 1] = ((i * 3) % 7) / 7;
    src[i * 4 + 2] = ((i * 2) % 4) / 4; src[i * 4 + 3] = 1;
  }

  test('parity (curves enabled, post HSL-scale fix)', () => {
    const mod = new HueCurvesModule();
    const p0 = mod.getParams();
    mod.setParams({
      hueVsSat: { ...p0.hueVsSat, enabled: true },
      hueVsLum: { ...p0.hueVsLum, enabled: true },
      satVsSat: { ...p0.satVsSat, enabled: true },
      masterBlend: 0.8,
    });
    const expected = mod.process(new Float32Array(src), { width: w, height: h, channels: 4 });
    const m = mod as unknown as {
      luts: { hueVsHue: Float32Array | null; hueVsSat: Float32Array | null; hueVsLum: Float32Array | null; satVsSat: Float32Array | null; lumVsSat: Float32Array | null };
    };
    const ref = webGLImageProcessor.hueCurvesCPU(new Float32Array(src), w, h, m.luts, mod.getParams().masterBlend);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('GPU lateral-CA CPU reference matches LensCorrectionsModule', () => {
  const w = 8, h = 6;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 8) / 8; src[i * 4 + 1] = ((i * 4) % 9) / 9;
    src[i * 4 + 2] = ((i * 5) % 7) / 7; src[i * 4 + 3] = 1;
  }

  test('parity (lateral R/B radial shift)', () => {
    const mod = new LensCorrectionsModule();
    mod.setParams({
      chromaticAberration: {
        enabled: true, redCyan: 30, blueMagenta: -20,
        purple: { amount: 0, hue: 300, range: 10 }, green: { amount: 0, hue: 60, range: 10 },
      },
    });
    const expected = mod.processImage(new Float32Array(src), w, h);
    const ref = webGLImageProcessor.lateralCACPU(new Float32Array(src), w, h, 30 * 0.001, -20 * 0.001);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('GPU distortion CPU reference matches LensCorrectionsModule', () => {
  const w = 8, h = 6;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 8) / 8; src[i * 4 + 1] = ((i * 3) % 7) / 7;
    src[i * 4 + 2] = ((i * 5) % 9) / 9; src[i * 4 + 3] = 1;
  }

  test('parity (barrel distortion + bilinear)', () => {
    const mod = new LensCorrectionsModule();
    mod.setParams({ distortion: { enabled: true, barrel: 20, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 } });
    const expected = mod.processImage(new Float32Array(src), w, h);
    const ref = webGLImageProcessor.distortionCPU(new Float32Array(src), w, h, 20 / 100, 1.0, 0, 0);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('GPU vignette CPU reference matches LensCorrectionsModule', () => {
  const w = 6, h = 5;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { src[i * 4] = 0.6; src[i * 4 + 1] = 0.55; src[i * 4 + 2] = 0.5; src[i * 4 + 3] = 1; }

  test('parity (vignetting only)', () => {
    const mod = new LensCorrectionsModule();
    mod.setParams({ vignetting: { enabled: true, amount: 60, midpoint: 1.0, roundness: 20, feather: 60 } });
    const expected = mod.processImage(new Float32Array(src), w, h);
    const ref = webGLImageProcessor.vignettingCPU(new Float32Array(src), w, h, 60 / 100, 1.0, 20 / 100, 60 / 100);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

describe('GPU color-balance CPU reference matches ColorBalanceModule', () => {
  const w = 4, h = 4;
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = (i % 4) / 4; src[i * 4 + 1] = ((i * 5) % 7) / 7;
    src[i * 4 + 2] = ((i * 3) % 5) / 5; src[i * 4 + 3] = 1;
  }

  test('parity (3-range tonal + 8-hue HSL)', () => {
    const mod = new ColorBalanceModule();
    mod.setParams({
      shadows: { cyan_red: 0.3, magenta_green: -0.2, yellow_blue: 0.1 },
      midtones: { cyan_red: 0.1, magenta_green: 0.2, yellow_blue: -0.1 },
      highlights: { cyan_red: -0.2, magenta_green: 0.1, yellow_blue: 0.3 },
      red_saturation: 10, red_luminance: 5, red_hue: 10,
      yellow_saturation: 8, yellow_hue: -10, cyan_hue: 15,
      blue_saturation: 12, purple_luminance: 10, magenta_saturation: -8,
    });
    const expected = mod.process(new Float32Array(src), { width: w, height: h, channels: 4 });

    const p = mod.getParams();
    const flat = p as unknown as Record<string, number>;
    const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
    const num = (k: string) => (typeof flat[k] === 'number' ? flat[k] : 0);
    const ref = webGLImageProcessor.colorBalanceCPU(
      new Float32Array(src), w, h,
      [p.shadows.cyan_red, p.shadows.magenta_green, p.shadows.yellow_blue],
      [p.midtones.cyan_red, p.midtones.magenta_green, p.midtones.yellow_blue],
      [p.highlights.cyan_red, p.highlights.magenta_green, p.highlights.yellow_blue],
      colors.map(c => num(`${c}_saturation`)),
      colors.map(c => num(`${c}_luminance`)),
      colors.map(c => num(`${c}_hue`)),
    );
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - ref[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});
