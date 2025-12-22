/**
 * Unit Tests for ColorUtils
 *
 * Tests all shared color utility functions used by processing modules.
 */

import {
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  rgbToHS,
  calculateLuminance,
  calculateSrgbLuminance,
  smoothStep,
  lerp,
  clamp,
  clampRgb,
  temperatureToRgb,
  safeDivide,
  validateInputDimensions,
  validateNumericParam,
  LUMINANCE_WEIGHTS,
  PERCEIVED_LUMINANCE_WEIGHTS,
} from './ColorUtils';

describe('ColorUtils', () => {
  describe('RGB to HSL conversion', () => {
    it('should convert pure red correctly', () => {
      const [h, s, l] = rgbToHsl(1, 0, 0);
      expect(h).toBeCloseTo(0, 1);
      expect(s).toBeCloseTo(100, 1);
      expect(l).toBeCloseTo(50, 1);
    });

    it('should convert pure green correctly', () => {
      const [h, s, l] = rgbToHsl(0, 1, 0);
      expect(h).toBeCloseTo(120, 1);
      expect(s).toBeCloseTo(100, 1);
      expect(l).toBeCloseTo(50, 1);
    });

    it('should convert pure blue correctly', () => {
      const [h, s, l] = rgbToHsl(0, 0, 1);
      expect(h).toBeCloseTo(240, 1);
      expect(s).toBeCloseTo(100, 1);
      expect(l).toBeCloseTo(50, 1);
    });

    it('should convert white correctly', () => {
      const [h, s, l] = rgbToHsl(1, 1, 1);
      expect(h).toBeCloseTo(0, 1);
      expect(s).toBeCloseTo(0, 1);
      expect(l).toBeCloseTo(100, 1);
    });

    it('should convert black correctly', () => {
      const [h, s, l] = rgbToHsl(0, 0, 0);
      expect(h).toBeCloseTo(0, 1);
      expect(s).toBeCloseTo(0, 1);
      expect(l).toBeCloseTo(0, 1);
    });

    it('should convert gray correctly', () => {
      const [, s, l] = rgbToHsl(0.5, 0.5, 0.5);
      expect(s).toBeCloseTo(0, 1);
      expect(l).toBeCloseTo(50, 1);
    });
  });

  describe('HSL to RGB conversion', () => {
    it('should convert red HSL correctly', () => {
      const [r, g, b] = hslToRgb(0, 100, 50);
      expect(r).toBeCloseTo(1, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });

    it('should convert green HSL correctly', () => {
      const [r, g, b] = hslToRgb(120, 100, 50);
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(1, 2);
      expect(b).toBeCloseTo(0, 2);
    });

    it('should convert blue HSL correctly', () => {
      const [r, g, b] = hslToRgb(240, 100, 50);
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(1, 2);
    });

    it('should convert white HSL correctly', () => {
      const [r, g, b] = hslToRgb(0, 0, 100);
      expect(r).toBeCloseTo(1, 2);
      expect(g).toBeCloseTo(1, 2);
      expect(b).toBeCloseTo(1, 2);
    });

    it('should convert black HSL correctly', () => {
      const [r, g, b] = hslToRgb(0, 0, 0);
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });
  });

  describe('RGB-HSL round-trip', () => {
    const testCases = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
      [1, 0, 1],
      [0.5, 0.25, 0.75],
      [0.3, 0.6, 0.9],
    ];

    testCases.forEach(([r, g, b]) => {
      it(`should round-trip RGB(${r}, ${g}, ${b})`, () => {
        const [h, s, l] = rgbToHsl(r, g, b);
        const [r2, g2, b2] = hslToRgb(h, s, l);
        expect(r2).toBeCloseTo(r, 2);
        expect(g2).toBeCloseTo(g, 2);
        expect(b2).toBeCloseTo(b, 2);
      });
    });
  });

  describe('RGB to HSV conversion', () => {
    it('should convert pure red correctly', () => {
      const [h, s, v] = rgbToHsv(1, 0, 0);
      expect(h).toBeCloseTo(0, 1);
      expect(s).toBeCloseTo(1, 2);
      expect(v).toBeCloseTo(1, 2);
    });

    it('should convert white correctly', () => {
      const [, s, v] = rgbToHsv(1, 1, 1);
      expect(s).toBeCloseTo(0, 2);
      expect(v).toBeCloseTo(1, 2);
    });

    it('should convert black correctly', () => {
      const [, s, v] = rgbToHsv(0, 0, 0);
      expect(s).toBeCloseTo(0, 2);
      expect(v).toBeCloseTo(0, 2);
    });
  });

  describe('HSV to RGB conversion', () => {
    it('should convert red HSV correctly', () => {
      const [r, g, b] = hsvToRgb(0, 1, 1);
      expect(r).toBeCloseTo(1, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });

    it('should convert gray HSV correctly', () => {
      const [r, g, b] = hsvToRgb(0, 0, 0.5);
      expect(r).toBeCloseTo(0.5, 2);
      expect(g).toBeCloseTo(0.5, 2);
      expect(b).toBeCloseTo(0.5, 2);
    });
  });

  describe('RGB-HSV round-trip', () => {
    const testCases = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0.5],
      [0.3, 0.6, 0.9],
    ];

    testCases.forEach(([r, g, b]) => {
      it(`should round-trip RGB(${r}, ${g}, ${b})`, () => {
        const [h, s, v] = rgbToHsv(r, g, b);
        const [r2, g2, b2] = hsvToRgb(h, s, v);
        expect(r2).toBeCloseTo(r, 2);
        expect(g2).toBeCloseTo(g, 2);
        expect(b2).toBeCloseTo(b, 2);
      });
    });
  });

  describe('rgbToHS', () => {
    it('should extract hue and saturation from red', () => {
      const [h, s] = rgbToHS(1, 0, 0);
      expect(h).toBeCloseTo(0, 1);
      expect(s).toBeCloseTo(1, 2);
    });

    it('should return zero saturation for gray', () => {
      const [, s] = rgbToHS(0.5, 0.5, 0.5);
      expect(s).toBeCloseTo(0, 2);
    });
  });

  describe('luminance calculations', () => {
    it('should calculate perceived luminance correctly', () => {
      // White should be 1.0
      expect(calculateLuminance(1, 1, 1)).toBeCloseTo(1, 2);
      // Black should be 0.0
      expect(calculateLuminance(0, 0, 0)).toBeCloseTo(0, 2);
      // Green contributes most
      expect(calculateLuminance(0, 1, 0)).toBeGreaterThan(calculateLuminance(1, 0, 0));
      expect(calculateLuminance(0, 1, 0)).toBeGreaterThan(calculateLuminance(0, 0, 1));
    });

    it('should use perceived luminance weights', () => {
      const expected = PERCEIVED_LUMINANCE_WEIGHTS.R * 0.5 +
                       PERCEIVED_LUMINANCE_WEIGHTS.G * 0.3 +
                       PERCEIVED_LUMINANCE_WEIGHTS.B * 0.2;
      expect(calculateLuminance(0.5, 0.3, 0.2)).toBeCloseTo(expected, 4);
    });

    it('should calculate sRGB luminance correctly', () => {
      const expected = LUMINANCE_WEIGHTS.R * 0.5 +
                       LUMINANCE_WEIGHTS.G * 0.3 +
                       LUMINANCE_WEIGHTS.B * 0.2;
      expect(calculateSrgbLuminance(0.5, 0.3, 0.2)).toBeCloseTo(expected, 4);
    });
  });

  describe('smoothStep', () => {
    it('should return 0 below edge0', () => {
      expect(smoothStep(0.2, 0.8, 0.1)).toBeCloseTo(0, 4);
    });

    it('should return 1 above edge1', () => {
      expect(smoothStep(0.2, 0.8, 0.9)).toBeCloseTo(1, 4);
    });

    it('should return 0.5 at midpoint', () => {
      expect(smoothStep(0, 1, 0.5)).toBeCloseTo(0.5, 4);
    });

    it('should handle edge0 equal to edge1', () => {
      expect(smoothStep(0.5, 0.5, 0.6)).toBe(1);
      expect(smoothStep(0.5, 0.5, 0.4)).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should return a when t=0', () => {
      expect(lerp(10, 20, 0)).toBe(10);
    });

    it('should return b when t=1', () => {
      expect(lerp(10, 20, 1)).toBe(20);
    });

    it('should return midpoint when t=0.5', () => {
      expect(lerp(10, 20, 0.5)).toBe(15);
    });
  });

  describe('clamp', () => {
    it('should clamp values below min', () => {
      expect(clamp(-0.5, 0, 1)).toBe(0);
    });

    it('should clamp values above max', () => {
      expect(clamp(1.5, 0, 1)).toBe(1);
    });

    it('should pass through values in range', () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5);
    });
  });

  describe('clampRgb', () => {
    it('should clamp all RGB values to [0, 1]', () => {
      const [r, g, b] = clampRgb(-0.5, 1.5, 0.5);
      expect(r).toBe(0);
      expect(g).toBe(1);
      expect(b).toBe(0.5);
    });
  });

  describe('temperatureToRgb', () => {
    it('should produce warm colors for low temperatures', () => {
      const warm = temperatureToRgb(3000);
      // Warm light has more red than blue
      expect(warm.r).toBeGreaterThan(warm.b);
    });

    it('should produce cool colors for high temperatures', () => {
      const cool = temperatureToRgb(10000);
      // Cool light has more blue than red
      expect(cool.b).toBeGreaterThan(cool.r);
    });

    it('should produce neutral white around 6500K', () => {
      const neutral = temperatureToRgb(6500);
      // Should be close to white
      expect(neutral.r).toBeGreaterThan(0.9);
      expect(neutral.g).toBeGreaterThan(0.9);
      expect(neutral.b).toBeGreaterThan(0.9);
    });

    it('should clamp temperature to valid range', () => {
      // Very low temperature should be clamped
      const veryLow = temperatureToRgb(500);
      expect(veryLow.r).toBeGreaterThan(0);

      // Very high temperature should be clamped
      const veryHigh = temperatureToRgb(50000);
      expect(veryHigh.b).toBeLessThanOrEqual(1);
    });
  });

  describe('safeDivide', () => {
    it('should divide normally for non-zero denominator', () => {
      expect(safeDivide(10, 2)).toBe(5);
    });

    it('should return fallback for zero denominator', () => {
      expect(safeDivide(10, 0, 99)).toBe(99);
    });

    it('should return 0 by default for zero denominator', () => {
      expect(safeDivide(10, 0)).toBe(0);
    });

    it('should handle non-finite denominator', () => {
      expect(safeDivide(10, Infinity, 99)).toBe(99);
      expect(safeDivide(10, NaN, 99)).toBe(99);
    });
  });

  describe('validateInputDimensions', () => {
    it('should pass for valid dimensions', () => {
      const input = new Float32Array(100 * 100 * 4);
      expect(() => {
        validateInputDimensions(input, 100, 100, 4, 'TestModule');
      }).not.toThrow();
    });

    it('should throw for mismatched length', () => {
      const input = new Float32Array(100);
      expect(() => {
        validateInputDimensions(input, 100, 100, 4, 'TestModule');
      }).toThrow(/doesn't match/);
    });

    it('should throw for invalid dimensions', () => {
      const input = new Float32Array(0);
      expect(() => {
        validateInputDimensions(input, 0, 100, 4, 'TestModule');
      }).toThrow(/Invalid dimensions/);
    });

    it('should throw for invalid channel count', () => {
      const input = new Float32Array(100 * 100 * 2);
      expect(() => {
        validateInputDimensions(input, 100, 100, 2, 'TestModule');
      }).toThrow(/Invalid channel count/);
    });
  });

  describe('validateNumericParam', () => {
    it('should return value when within range', () => {
      expect(validateNumericParam(5, 0, 10, 0)).toBe(5);
    });

    it('should clamp to min', () => {
      expect(validateNumericParam(-5, 0, 10, 0)).toBe(0);
    });

    it('should clamp to max', () => {
      expect(validateNumericParam(15, 0, 10, 0)).toBe(10);
    });

    it('should return default for non-numeric', () => {
      expect(validateNumericParam('string', 0, 10, 5)).toBe(5);
      expect(validateNumericParam(null, 0, 10, 5)).toBe(5);
      expect(validateNumericParam(undefined, 0, 10, 5)).toBe(5);
    });

    it('should return default for non-finite', () => {
      expect(validateNumericParam(NaN, 0, 10, 5)).toBe(5);
      expect(validateNumericParam(Infinity, 0, 10, 5)).toBe(5);
    });
  });
});
