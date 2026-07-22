/**
 * Unit Tests for WhiteBalanceModule
 *
 * Tests parameter management, preset application, and processing behavior.
 */

import { WhiteBalanceModule, WHITE_BALANCE_PRESETS, computeWBGains } from './WhiteBalanceModule';
import {
  createTestImage,
  createProcessingContext,
  isValidImageData,
  getPixel,
} from '../test/testUtils';

// Mock the logger
jest.mock('../utils/Logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('WhiteBalanceModule', () => {
  let module: WhiteBalanceModule;

  beforeEach(() => {
    module = new WhiteBalanceModule();
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('temperature');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('White Balance');
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();
      expect(params.temperature).toBe(6500);
      expect(params.tint).toBe(0);
      expect(params.auto).toBe(false);
      expect(params.preset).toBe('custom');
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({ temperature: 3200 });
      expect(module.getParams().temperature).toBe(3200);
      // Other params should remain unchanged
      expect(module.getParams().tint).toBe(0);
    });

    it('should merge partial parameters', () => {
      module.setParams({ temperature: 7000, tint: 10 });
      const params = module.getParams();
      expect(params.temperature).toBe(7000);
      expect(params.tint).toBe(10);
      expect(params.auto).toBe(false);
    });

    it('should reset parameters to defaults', () => {
      module.setParams({ temperature: 3000, tint: 50, auto: true });
      module.resetParams();
      const params = module.getParams();
      expect(params.temperature).toBe(6500);
      expect(params.tint).toBe(0);
      expect(params.auto).toBe(false);
    });
  });

  describe('Preset application', () => {
    it('should apply daylight preset', () => {
      module.setPreset('daylight');
      const params = module.getParams();
      expect(params.temperature).toBe(WHITE_BALANCE_PRESETS.daylight.temperature);
      expect(params.tint).toBe(WHITE_BALANCE_PRESETS.daylight.tint);
      expect(params.preset).toBe('daylight');
    });

    it('should apply tungsten preset', () => {
      module.setPreset('tungsten');
      const params = module.getParams();
      expect(params.temperature).toBe(WHITE_BALANCE_PRESETS.tungsten.temperature);
      expect(params.preset).toBe('tungsten');
    });

    it('should apply cloudy preset', () => {
      module.setPreset('cloudy');
      const params = module.getParams();
      expect(params.temperature).toBe(WHITE_BALANCE_PRESETS.cloudy.temperature);
      expect(params.preset).toBe('cloudy');
    });

    it('should apply fluorescent preset', () => {
      module.setPreset('fluorescent');
      const params = module.getParams();
      expect(params.temperature).toBe(WHITE_BALANCE_PRESETS.fluorescent.temperature);
      expect(params.tint).toBe(WHITE_BALANCE_PRESETS.fluorescent.tint);
    });

    it('should not change params for invalid preset', () => {
      const originalParams = module.getParams();
      module.setPreset('invalid_preset');
      expect(module.getParams()).toEqual(originalParams);
    });
  });

  describe('Processing with neutral parameters', () => {
    it('should produce no change with 6500K (D65 reference / identity)', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Default is now 6500K which is the D65 reference (identity transform)
      const output = module.process(input, context);

      // Output should be very close to input for neutral gray
      expect(isValidImageData(output)).toBe(true);
      // Allow small tolerance for numerical precision
      const [r, g, b] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 1);
      expect(g).toBeCloseTo(0.5, 1);
      expect(b).toBeCloseTo(0.5, 1);
    });

    it('should preserve alpha channel', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      // Check alpha is preserved
      const [, , , a] = getPixel(output, width, 0, 0);
      expect(a).toBe(0.75);
    });
  });

  describe('Processing with warm temperature', () => {
    it('should warm image with low temperature (3200K)', () => {
      const width = 4;
      const height = 4;
      // Create neutral gray image
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ temperature: 3200 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Warm temperature should increase blue relative to red
      // (counteracts warm light by adding cool tones)
      const [r, , b] = getPixel(output, width, 0, 0);
      // At 3200K (tungsten), correction adds blue
      expect(b).toBeGreaterThan(r);
    });
  });

  describe('Processing with cool temperature', () => {
    it('should cool image with high temperature (10000K)', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ temperature: 10000 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Cool temperature should increase red relative to blue
      // (counteracts cool light by adding warm tones)
      const [r, , b] = getPixel(output, width, 0, 0);
      // At 10000K, correction adds warmth
      expect(r).toBeGreaterThan(b);
    });
  });

  describe('Tint adjustment', () => {
    it('should add green with positive tint', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ tint: 50 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // Positive tint should increase green relative to red and blue
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    });

    it('should add magenta with negative tint', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ tint: -50 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // Negative tint should decrease green relative to red and blue
      expect(g).toBeLessThan(r);
      expect(g).toBeLessThan(b);
    });
  });

  describe('Auto white balance detection', () => {
    it('should estimate temperature from image data', () => {
      const width = 10;
      const height = 10;
      // Create warm-tinted image (more red than blue)
      const input = createTestImage(width, height, 0.6, 0.5, 0.4);
      const context = createProcessingContext(width, height);

      module.autoDetectWhiteBalance(input, context);

      // Should have set auto flag
      expect(module.getParams().auto).toBe(true);
      // Temperature should be estimated (may vary based on algorithm)
      expect(module.getParams().temperature).toBeGreaterThan(0);
    });

    it('should estimate tint from image data', () => {
      const width = 10;
      const height = 10;
      // Create green-tinted image
      const input = createTestImage(width, height, 0.5, 0.6, 0.5);
      const context = createProcessingContext(width, height);

      module.autoDetectWhiteBalance(input, context);

      // Should have estimated a tint value
      const tint = module.getParams().tint;
      expect(typeof tint).toBe('number');
    });
  });

  describe('Auto white balance (gray-candidate estimation + damped correction)', () => {
    const fill = (w: number, h: number, r: number, g: number, b: number) => {
      const d = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 1; }
      return d;
    };

    // Test-side replica of the module's solvers (same binary search over the SAME
    // exported gain model) so the expected damped values can be derived exactly.
    const AUTO_WB_STRENGTH = 0.7;
    const solveTemp = (mR: number, mB: number): number => {
      let lo = 2000, hi = 12000;
      const f = (t: number) => { const g = computeWBGains(t, 0); return g.r * mR - g.b * mB; };
      const flo = f(lo), fhi = f(hi);
      if (flo > 0 && fhi > 0) return lo;
      if (flo < 0 && fhi < 0) return hi;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    };
    const solveTintAt = (temperature: number, mR: number, mG: number, mB: number): number => {
      let lo = -100, hi = 100;
      const h = (t: number) => { const g = computeWBGains(temperature, t); return g.g * mG - (g.r * mR + g.b * mB) / 2; };
      const hlo = h(lo), hhi = h(hi);
      if (hlo > 0 && hhi > 0) return lo;
      if (hlo < 0 && hhi < 0) return hi;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        if (h(mid) > 0) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    };
    // Fixtures are stored in a Float32Array, so the medians the module sees are the
    // float32-rounded values — replicate that with Math.fround.
    const expected = (r: number, g: number, b: number) => {
      const mR = Math.fround(r), mG = Math.fround(g), mB = Math.fround(b);
      const solvedTemperature = solveTemp(mR, mB);
      const solvedTint = solveTintAt(solvedTemperature, mR, mG, mB);
      // No-cast dead-band mirror: tiny solved corrections snap to exactly 6500/0.
      const tempRatio = Math.max(solvedTemperature, 6500) / Math.min(solvedTemperature, 6500);
      const noCast = tempRatio <= 1.08 && Math.abs(solvedTint) < 30;
      return {
        solvedTemperature,
        solvedTint,
        noCast,
        temperature: noCast ? 6500 : Math.round(6500 * Math.pow(solvedTemperature / 6500, AUTO_WB_STRENGTH)),
        tint: noCast ? 0 : Math.round(Math.max(-35, Math.min(35, solvedTint * AUTO_WB_STRENGTH)) * 10) / 10,
      };
    };

    it('damps a warm cast: correct direction, warmth retained, cast meaningfully reduced', () => {
      const w = 24, h = 24;
      // Uniform warm fill — relative chroma 0.355 > 0.25, so NO gray candidates
      // exist and estimation falls back to all kept samples.
      const input = fill(w, h, 0.62, 0.5, 0.40);
      const ctx = { width: w, height: h, channels: 4 };
      module.autoDetectWhiteBalance(input, ctx);
      const params = module.getParams();
      const exp = expected(0.62, 0.5, 0.40);
      expect(params.auto).toBe(true);
      expect(params.temperature).toBeLessThan(6500);                    // still cools (correct direction)
      expect(params.temperature).toBeGreaterThan(exp.solvedTemperature); // but milder than the full solve
      expect(params.temperature).toBe(exp.temperature);                 // exact damping formula
      expect(params.tint).toBe(exp.tint);
      const out = module.process(input, ctx);
      // Warmth is RETAINED — R stays decisively above B (no flip past neutral).
      expect(out[0]).toBeGreaterThan(out[2] + 0.02);
      // …but the cast is meaningfully reduced: warm excess (R/B − 1) drops ≥ 25%.
      const inExcess = 0.62 / 0.40 - 1;
      const outExcess = out[0] / out[2] - 1;
      expect(outExcess).toBeLessThan(inExcess * 0.75);
    });

    it('applies temperature = round(6500·(Tsolved/6500)^0.7) — warmth-retention formula', () => {
      const w = 24, h = 24;
      const input = fill(w, h, 0.65, 0.45, 0.3); // strong warm cast
      module.autoDetectWhiteBalance(input, { width: w, height: h, channels: 4 });
      const exp = expected(0.65, 0.45, 0.3);
      expect(module.getParams().temperature).toBe(
        Math.round(6500 * Math.pow(exp.solvedTemperature / 6500, 0.7))
      );
    });

    it('estimates from near-neutral gray candidates, not the colourful subject', () => {
      const w = 100, h = 100;
      const ctx = { width: w, height: h, channels: 4 };
      // ~30% warm-cast gray (0.5 × (1.15, 1.0, 0.9) → chroma 0.217 < 0.25: gray
      // candidate) + 70% strongly coloured warm subject (chroma 0.778: excluded).
      const grayCast: [number, number, number] = [0.575, 0.5, 0.45];
      const subject: [number, number, number] = [0.9, 0.45, 0.2];
      const composite = new Float32Array(w * h * 4);
      const graySplit = Math.floor(w * h * 0.3);
      for (let i = 0; i < w * h; i++) {
        const [r, g, b] = i < graySplit ? grayCast : subject;
        composite[i * 4] = r; composite[i * 4 + 1] = g; composite[i * 4 + 2] = b; composite[i * 4 + 3] = 1;
      }
      module.autoDetectWhiteBalance(composite, ctx);
      const compositeParams = module.getParams();

      // The estimate must track the GRAY region's mild cast, not the subject.
      const expGray = expected(...grayCast);
      expect(compositeParams.temperature).toBe(expGray.temperature);

      // A 100%-subject image (no gray candidates → all-sample fallback) solves a much
      // stronger correction; the composite must be strictly milder (closer to 6500).
      const subjectOnly = new WhiteBalanceModule();
      subjectOnly.autoDetectWhiteBalance(fill(w, h, ...subject), ctx);
      expect(compositeParams.temperature).toBeGreaterThan(subjectOnly.getParams().temperature);

      const out = module.process(composite, ctx);
      // Gray region ends up closer to neutral than before…
      const grayIdx = 0;
      expect(Math.abs(out[grayIdx] - out[grayIdx + 2])).toBeLessThan(Math.abs(grayCast[0] - grayCast[2]));
      // …while the subject stays warm.
      const subjIdx = (w * h - 1) * 4;
      expect(out[subjIdx]).toBeGreaterThan(out[subjIdx + 2]);
    });

    it('leaves a neutral image essentially unchanged (damping keeps the identity fixed point)', () => {
      const w = 24, h = 24;
      const ctx = { width: w, height: h, channels: 4 };
      module.autoDetectWhiteBalance(fill(w, h, 0.5, 0.5, 0.5), ctx);
      expect(Math.abs(module.getParams().temperature - 6500)).toBeLessThan(400);
      expect(Math.abs(module.getParams().tint)).toBeLessThan(2);
    });

    it('damps and clamps a green cast: negative tint, magnitude capped at 35', () => {
      const w = 24, h = 24;
      const input = fill(w, h, 0.5, 0.6, 0.5); // green: G high
      const ctx = { width: w, height: h, channels: 4 };
      module.autoDetectWhiteBalance(input, ctx);
      const params = module.getParams();
      const exp = expected(0.5, 0.6, 0.5);
      expect(params.tint).toBeLessThan(0);                              // still removes green (direction)
      expect(Math.abs(params.tint)).toBeLessThanOrEqual(35);            // clamp
      expect(Math.abs(params.tint)).toBeLessThan(Math.abs(exp.solvedTint)); // weaker than the full solve
      expect(params.tint).toBe(-35); // 0.7 × solved (−90.9) = −63.6 → clamped to −35
      const out = module.process(input, ctx);
      // Green excess is reduced but NOT fully neutralised (and never flips to magenta).
      const inGreenExcess = 0.6 - (0.5 + 0.5) / 2;
      const outGreenExcess = out[1] - (out[0] + out[2]) / 2;
      expect(outGreenExcess).toBeLessThan(inGreenExcess);
      expect(outGreenExcess).toBeGreaterThan(0);
    });

    it('snaps a near-balanced image to exactly 6500/0 (no-cast dead-band)', () => {
      const w = 24, h = 24;
      const ctx = { width: w, height: h, channels: 4 };
      // Slightly blue-leaning near-grays — the live-app medians measured on an
      // already-balanced sunset (hazy sky). Solved ≈ 6759K / +25.1 under the
      // decoupled-axis gain model (was 6756K / +9.3 under the old coupled one):
      // inside the dead-band, so Auto must report "no cast" instead of a token
      // warm nudge.
      const input = fill(w, h, 0.6, 0.58, 0.62);
      const exp = expected(0.6, 0.58, 0.62);
      expect(exp.noCast).toBe(true); // fixture sanity: solved correction is in-band
      module.autoDetectWhiteBalance(input, ctx);
      expect(module.getParams().temperature).toBe(6500);
      expect(module.getParams().tint).toBe(0);
      expect(module.getParams().auto).toBe(true);
      // Applying the result is an exact identity.
      const out = module.process(input, ctx);
      expect(out[0]).toBeCloseTo(0.6, 5);
      expect(out[2]).toBeCloseTo(0.62, 5);
    });

    it('snaps a RAW-measured near-gray magenta bias to 6500/0 (widened tint dead-band)', () => {
      const w = 24, h = 24;
      const ctx = { width: w, height: h, channels: 4 };
      // Live-measured medians from an ORF (LibRaw sRGB output) that is already
      // camera-correct: LibRaw's slight near-gray magenta bias solves a tint
      // around +27, which used to escape the old ±10 dead-band and apply a
      // token 6452K/+19.3 nudge instead of reporting "no cast".
      const input = fill(w, h, 0.61, 0.575, 0.606);
      const exp = expected(0.61, 0.575, 0.606);
      expect(exp.solvedTint).toBeGreaterThan(10);   // outside the OLD ±10 bound…
      expect(exp.solvedTint).toBeLessThan(30);      // …but inside the NEW ±30 bound
      expect(exp.noCast).toBe(true);                // fixture sanity: in-band under the fix
      module.autoDetectWhiteBalance(input, ctx);
      expect(module.getParams().temperature).toBe(6500);
      expect(module.getParams().tint).toBe(0);
      expect(module.getParams().auto).toBe(true);
      // Applying the result is an exact identity.
      const out = module.process(input, ctx);
      expect(out[0]).toBeCloseTo(0.61, 5);
      expect(out[1]).toBeCloseTo(0.575, 5);
      expect(out[2]).toBeCloseTo(0.606, 5);
    });

    it('still corrects a real green cast beyond the widened tint dead-band', () => {
      const w = 24, h = 24;
      const ctx = { width: w, height: h, channels: 4 };
      const input = fill(w, h, 0.5, 0.6, 0.5); // green cast, solves tint ≈ -91
      const exp = expected(0.5, 0.6, 0.5);
      expect(Math.abs(exp.solvedTint)).toBeGreaterThan(30); // far outside the dead-band
      module.autoDetectWhiteBalance(input, ctx);
      expect(module.getParams().tint).toBeLessThan(0);
      expect(module.getParams().tint).not.toBe(0);
    });

    it('uses the median — blown-out highlights do not drag the estimate toward neutral', () => {
      const w = 40, h = 40;
      const d = fill(w, h, 0.62, 0.5, 0.40);  // warm midtones
      for (let i = 0; i < Math.floor(w * h * 0.3); i++) { d[i * 4] = 1; d[i * 4 + 1] = 1; d[i * 4 + 2] = 1; } // 30% clipped white
      module.autoDetectWhiteBalance(d, { width: w, height: h, channels: 4 });
      expect(module.getParams().temperature).toBeLessThan(6500); // warm cast still detected
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should clamp output values to valid range', () => {
      const width = 2;
      const height = 2;
      // Create bright image that might overflow
      const input = createTestImage(width, height, 0.95, 0.95, 0.95);
      const context = createProcessingContext(width, height);

      module.setParams({ temperature: 10000 }); // Strong warm correction
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // All values should be <= 1.0
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeLessThanOrEqual(1.0);
        expect(output[i]).toBeGreaterThanOrEqual(0.0);
      }
    });

    it('should handle black image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0, 0, 0);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      // Black should remain black
      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });

    it('should handle white image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 1, 1, 1);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle extreme temperature values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Very low temperature
      module.setParams({ temperature: 2000 });
      const output1 = module.process(input, context);
      expect(isValidImageData(output1)).toBe(true);

      // Very high temperature
      module.setParams({ temperature: 50000 });
      const output2 = module.process(input, context);
      expect(isValidImageData(output2)).toBe(true);
    });

    it('should handle extreme tint values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Max positive tint
      module.setParams({ tint: 100 });
      const output1 = module.process(input, context);
      expect(isValidImageData(output1)).toBe(true);

      // Max negative tint
      module.setParams({ tint: -100 });
      const output2 = module.process(input, context);
      expect(isValidImageData(output2)).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should throw error for mismatched dimensions', () => {
      const input = new Float32Array(100); // Wrong size
      const context = createProcessingContext(10, 10); // Expects 10*10*4 = 400

      expect(() => {
        module.process(input, context);
      }).toThrow();
    });
  });
});
