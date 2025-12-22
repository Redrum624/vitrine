/**
 * Unit Tests for WhiteBalanceModule
 *
 * Tests parameter management, preset application, and processing behavior.
 */

import { WhiteBalanceModule, WHITE_BALANCE_PRESETS } from './WhiteBalanceModule';
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
      expect(params.temperature).toBe(5500);
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
      expect(params.temperature).toBe(5500);
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
    it('should produce minimal change with 5500K (neutral daylight)', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Default is 5500K which is neutral daylight
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
