/**
 * Unit Tests for BasicAdjustmentsModule
 *
 * Tests parameter management, exposure, contrast, brightness,
 * saturation, vibrance, and auto-adjust functionality.
 */

import { BasicAdjustmentsModule } from './BasicAdjustmentsModule';
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

describe('BasicAdjustmentsModule', () => {
  let module: BasicAdjustmentsModule;

  beforeEach(() => {
    module = new BasicAdjustmentsModule();
  });

  describe('Highlights and Shadows', () => {
    const width = 4, height = 4;
    const ctx = () => createProcessingContext(width, height);

    it('defaults to neutral (0) highlights and shadows', () => {
      const p = module.getParams();
      expect(p.highlights).toBe(0);
      expect(p.shadows).toBe(0);
    });

    it('shadows > 0 lifts dark tones', () => {
      module.setParams({ shadows: 1.0 });
      const [r] = getPixel(module.process(createTestImage(width, height, 0.15, 0.15, 0.15), ctx()), width, 0, 0);
      expect(r).toBeGreaterThan(0.15);
    });

    it('shadows < 0 deepens dark tones', () => {
      module.setParams({ shadows: -1.0 });
      const [r] = getPixel(module.process(createTestImage(width, height, 0.25, 0.25, 0.25), ctx()), width, 0, 0);
      expect(r).toBeLessThan(0.25);
    });

    it('highlights < 0 recovers (darkens) bright tones', () => {
      module.setParams({ highlights: -1.0 });
      const [r] = getPixel(module.process(createTestImage(width, height, 0.9, 0.9, 0.9), ctx()), width, 0, 0);
      expect(r).toBeLessThan(0.9);
    });

    it('highlights > 0 brightens bright tones', () => {
      module.setParams({ highlights: 1.0 });
      const [r] = getPixel(module.process(createTestImage(width, height, 0.8, 0.8, 0.8), ctx()), width, 0, 0);
      expect(r).toBeGreaterThan(0.8);
    });

    it('shadows affect dark tones more than bright tones (luminance mask)', () => {
      module.setParams({ shadows: 1.0 });
      const darkDelta = getPixel(module.process(createTestImage(width, height, 0.1, 0.1, 0.1), ctx()), width, 0, 0)[0] - 0.1;
      const brightDelta = getPixel(module.process(createTestImage(width, height, 0.9, 0.9, 0.9), ctx()), width, 0, 0)[0] - 0.9;
      expect(darkDelta).toBeGreaterThan(brightDelta);
    });
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('basicadj');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('Basic Adjustments');
    });
  });

  describe('Parameter management', () => {
    it('should return default neutral parameters', () => {
      const params = module.getParams();
      expect(params.black_point).toBe(0);
      expect(params.exposure).toBe(0);
      expect(params.contrast).toBe(0);
      expect(params.brightness).toBe(0);
      expect(params.saturation).toBe(0);
      expect(params.vibrance).toBe(0);
      expect(params.dehaze).toBe(0);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({ exposure: 0.5 });
      expect(module.getParams().exposure).toBe(0.5);
      // Other params should remain unchanged
      expect(module.getParams().contrast).toBe(0);
    });

    it('should merge partial parameters', () => {
      module.setParams({ exposure: 0.3, contrast: 0.2 });
      const params = module.getParams();
      expect(params.exposure).toBe(0.3);
      expect(params.contrast).toBe(0.2);
      expect(params.brightness).toBe(0);
    });

    it('should reset parameters to defaults', () => {
      module.setParams({ exposure: 1.0, contrast: 0.5, saturation: 0.5, dehaze: 0.5 });
      module.resetParams();
      const params = module.getParams();
      expect(params.exposure).toBe(0);
      expect(params.contrast).toBe(0);
      expect(params.saturation).toBe(0);
      expect(params.dehaze).toBe(0);
    });
  });

  describe('Processing with neutral parameters', () => {
    it('should produce minimal change with all params at 0', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Output should be very close to input
      const [r, g, b] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 2);
      expect(g).toBeCloseTo(0.5, 2);
      expect(b).toBeCloseTo(0.5, 2);
    });

    it('should preserve alpha channel', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);
      const context = createProcessingContext(width, height);

      const output = module.process(input, context);

      const [, , , a] = getPixel(output, width, 0, 0);
      expect(a).toBe(0.75);
    });
  });

  describe('Exposure adjustment', () => {
    it('should brighten image with positive exposure', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.25, 0.25, 0.25);
      const context = createProcessingContext(width, height);

      module.setParams({ exposure: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Exposure is multiplicative: 2^0.5 = ~1.41
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeGreaterThan(0.25);
    });

    it('should darken image with negative exposure', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ exposure: -0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeLessThan(0.5);
    });

    it('should apply 2^exposure multiplier', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.25, 0.25, 0.25);
      const context = createProcessingContext(width, height);

      module.setParams({ exposure: 1.0 }); // 2^1 = 2x
      const output = module.process(input, context);

      const [r] = getPixel(output, width, 0, 0);
      // Expected: 0.25 * 2 = 0.5
      expect(r).toBeCloseTo(0.5, 1);
    });
  });

  describe('Contrast adjustment', () => {
    it('should increase contrast with positive value', () => {
      const width = 4;
      const height = 4;
      // Create image with varying brightness
      const input = new Float32Array(width * height * 4);
      for (let i = 0; i < input.length; i += 4) {
        const pixel = i / input.length;
        input[i] = pixel;     // Varying R
        input[i + 1] = pixel; // Varying G
        input[i + 2] = pixel; // Varying B
        input[i + 3] = 1.0;   // A
      }
      const context = createProcessingContext(width, height);

      module.setParams({ contrast: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Contrast stretches values away from 0.5
      // Dark pixels should get darker, bright pixels should get brighter
    });

    it('should decrease contrast with negative value', () => {
      const width = 4;
      const height = 4;
      // Create image with high contrast (black and white)
      const input = createTestImage(width, height, 1, 1, 1);
      const context = createProcessingContext(width, height);

      module.setParams({ contrast: -0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // White should move toward gray
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeLessThan(1.0);
    });

    it('should apply contrast around 0.5 midpoint', () => {
      const width = 2;
      const height = 2;
      // Create mid-gray image
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ contrast: 0.5 });
      const output = module.process(input, context);

      // 0.5 is the midpoint, so it should remain close to 0.5
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 1);
    });
  });

  describe('Brightness adjustment', () => {
    it('should brighten image with positive brightness', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.3, 0.3, 0.3);
      const context = createProcessingContext(width, height);

      module.setParams({ brightness: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeGreaterThan(0.3);
    });

    it('should darken image with negative brightness', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.7, 0.7, 0.7);
      const context = createProcessingContext(width, height);

      module.setParams({ brightness: -0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeLessThan(0.7);
    });

    it('should be additive adjustment', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.4, 0.4, 0.4);
      const context = createProcessingContext(width, height);

      module.setParams({ brightness: 1.0 }); // Add 0.1 (scaled)
      const output = module.process(input, context);

      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeGreaterThan(0.4);
    });
  });

  describe('Black point adjustment', () => {
    it('should lift blacks with positive black_point', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.1, 0.1, 0.1);
      const context = createProcessingContext(width, height);

      module.setParams({ black_point: 0.05 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeLessThan(0.1);
    });
  });

  describe('Saturation adjustment', () => {
    it('should increase saturation with positive value', () => {
      const width = 4;
      const height = 4;
      // Create colored image
      const input = createTestImage(width, height, 0.6, 0.4, 0.4);
      const context = createProcessingContext(width, height);

      module.setParams({ saturation: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // More saturated means colors spread further from gray
      // Red should be even more dominant
      expect(r - g).toBeGreaterThan(0.2); // Original was 0.2 diff
    });

    it('should decrease saturation with negative value', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.8, 0.3, 0.3);
      const context = createProcessingContext(width, height);

      module.setParams({ saturation: -0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // Less saturated means colors closer to gray
      // Difference between channels should decrease
      const diff = Math.abs(r - g);
      expect(diff).toBeLessThan(0.5);
    });

    it('should produce grayscale at saturation -1.0', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.8, 0.4, 0.2);
      const context = createProcessingContext(width, height);

      module.setParams({ saturation: -1.0 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // All channels should be approximately equal (grayscale)
      expect(Math.abs(r - g)).toBeLessThan(0.1);
      expect(Math.abs(g - b)).toBeLessThan(0.1);
    });
  });

  describe('Vibrance adjustment', () => {
    it('should increase vibrance of less saturated colors', () => {
      const width = 4;
      const height = 4;
      // Create muted color
      const input = createTestImage(width, height, 0.55, 0.45, 0.45);
      const context = createProcessingContext(width, height);

      module.setParams({ vibrance: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Vibrance should affect muted colors more than saturated ones
    });

    it('should have less effect on already saturated colors', () => {
      const width = 4;
      const height = 4;
      // Create already saturated color
      const input = createTestImage(width, height, 1.0, 0.0, 0.0);
      const context = createProcessingContext(width, height);

      module.setParams({ vibrance: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Highly saturated colors should change less
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(1.0, 1);
    });
  });

  describe('Auto adjust', () => {
    it('should return auto-adjusted parameters', () => {
      const params = module.autoAdjust();

      // Should have positive exposure boost
      expect(params.exposure).toBeGreaterThan(0);
      // Should have moderate contrast
      expect(params.contrast).toBeGreaterThan(0);
      // Should have slight saturation boost
      expect(params.saturation).toBeGreaterThanOrEqual(0);
      // Should have vibrance
      expect(params.vibrance).toBeGreaterThan(0);
    });

    it('should apply auto-adjusted parameters to module', () => {
      const params = module.autoAdjust();

      // Module should now have these params
      const currentParams = module.getParams();
      expect(currentParams.exposure).toBe(params.exposure);
      expect(currentParams.contrast).toBe(params.contrast);
    });
  });

  describe('Dehaze adjustment', () => {
    // Build a synthetic low-contrast / "hazy" image: all channels compressed
    // into the 0.4..0.6 range (lifted black floor, no deep shadows).
    const createHazyImage = (width: number, height: number): Float32Array => {
      const channels = 4;
      const data = new Float32Array(width * height * channels);
      const count = width * height;
      for (let p = 0; p < count; p++) {
        // Ramp brightness across the compressed band so there is some structure.
        const v = 0.4 + (p / Math.max(1, count - 1)) * 0.2; // 0.4 .. 0.6
        const idx = p * channels;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 1.0;
      }
      return data;
    };

    const spread = (data: Float32Array): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = data[i + c];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      return max - min;
    };

    it('should default dehaze to 0 and restore it on reset', () => {
      expect(module.getParams().dehaze).toBe(0);
      module.setParams({ dehaze: 0.7 });
      expect(module.getParams().dehaze).toBe(0.7);
      module.resetParams();
      expect(module.getParams().dehaze).toBe(0);
    });

    it('should leave the image unchanged when dehaze is 0 (identity off)', () => {
      const width = 8;
      const height = 8;
      const input = createHazyImage(width, height);
      const context = createProcessingContext(width, height);

      module.setParams({ dehaze: 0.0 });
      const output = module.process(input, context);

      for (let i = 0; i < input.length; i++) {
        expect(Math.abs(output[i] - input[i])).toBeLessThan(1e-6);
      }
    });

    it('should increase tonal spread on a hazy image (haze removed)', () => {
      const width = 8;
      const height = 8;
      const baseInput = createHazyImage(width, height);
      const context = createProcessingContext(width, height);

      // Reference run with dehaze off.
      const off = module.process(baseInput.slice(), context);
      const spreadOff = spread(off);

      // Dehaze on.
      module.setParams({ dehaze: 0.5 });
      const on = module.process(baseInput.slice(), context);
      const spreadOn = spread(on);

      expect(isValidImageData(on)).toBe(true);
      expect(spreadOn).toBeGreaterThan(spreadOff);
    });

    it('should clamp out-of-range dehaze and never produce NaN or negatives', () => {
      const width = 4;
      const height = 4;
      const input = createHazyImage(width, height);
      const context = createProcessingContext(width, height);

      module.setParams({ dehaze: 5.0 }); // Outside -1..1
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      for (let i = 0; i < output.length; i++) {
        expect(Number.isNaN(output[i])).toBe(false);
        expect(output[i]).toBeGreaterThanOrEqual(0.0);
        expect(output[i]).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({ exposure: 0.5, contrast: 0.5 });
      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should clamp output values to valid range', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.9, 0.9, 0.9);
      const context = createProcessingContext(width, height);

      // Strong adjustments that could overflow
      module.setParams({ exposure: 1.0, brightness: 1.0 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
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

      module.setParams({ exposure: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle white image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 1, 1, 1);
      const context = createProcessingContext(width, height);

      module.setParams({ contrast: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle extreme parameter values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Maximum values
      module.setParams({
        exposure: 1.0,
        contrast: 5.0,
        brightness: 4.0,
        saturation: 1.0,
        vibrance: 1.0,
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle minimum parameter values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Minimum values
      module.setParams({
        exposure: -1.0,
        contrast: -1.0,
        brightness: -4.0,
        saturation: -1.0,
        vibrance: -1.0,
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('should throw error for mismatched dimensions', () => {
      const input = new Float32Array(100); // Wrong size
      const context = createProcessingContext(10, 10); // Expects 400

      expect(() => {
        module.process(input, context);
      }).toThrow();
    });
  });
});
