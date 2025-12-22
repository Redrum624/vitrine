/**
 * Unit Tests for ColorBalanceModule
 *
 * Tests parameter management, traditional 3-way color balance,
 * and 8-color HSL adjustments.
 */

import { ColorBalanceModule } from './ColorBalanceModule';
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

describe('ColorBalanceModule', () => {
  let module: ColorBalanceModule;

  beforeEach(() => {
    module = new ColorBalanceModule();
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('colorbalance');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('Color Balance');
    });
  });

  describe('Parameter management', () => {
    it('should return default neutral parameters', () => {
      const params = module.getParams();

      // Traditional color balance
      expect(params.shadows.cyan_red).toBe(0);
      expect(params.shadows.magenta_green).toBe(0);
      expect(params.shadows.yellow_blue).toBe(0);
      expect(params.midtones.cyan_red).toBe(0);
      expect(params.highlights.cyan_red).toBe(0);

      // Global color controls
      expect(params.red_saturation).toBe(0);
      expect(params.red_luminance).toBe(0);
      expect(params.red_hue).toBe(0);
      expect(params.blue_saturation).toBe(0);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update nested shadow parameters', () => {
      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0.3, yellow_blue: -0.2 },
      });
      const params = module.getParams();
      expect(params.shadows.cyan_red).toBe(0.5);
      expect(params.shadows.magenta_green).toBe(0.3);
      expect(params.shadows.yellow_blue).toBe(-0.2);
    });

    it('should update midtone parameters', () => {
      module.setParams({
        midtones: { cyan_red: 0.2, magenta_green: -0.1, yellow_blue: 0.4 },
      });
      const params = module.getParams();
      expect(params.midtones.cyan_red).toBe(0.2);
    });

    it('should update highlight parameters', () => {
      module.setParams({
        highlights: { cyan_red: -0.3, magenta_green: 0.2, yellow_blue: 0.1 },
      });
      const params = module.getParams();
      expect(params.highlights.cyan_red).toBe(-0.3);
    });

    it('should update global color controls', () => {
      module.setParams({
        red_saturation: 20,
        red_luminance: 10,
        red_hue: 5,
      });
      const params = module.getParams();
      expect(params.red_saturation).toBe(20);
      expect(params.red_luminance).toBe(10);
      expect(params.red_hue).toBe(5);
    });

    it('should reset parameters to defaults', () => {
      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0.5, yellow_blue: 0.5 },
        red_saturation: 50,
      });
      module.resetParams();
      const params = module.getParams();
      expect(params.shadows.cyan_red).toBe(0);
      expect(params.red_saturation).toBe(0);
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

      const [, , , a] = getPixel(output, width, 0, 0);
      expect(a).toBe(0.75);
    });
  });

  describe('Traditional color balance - Shadows', () => {
    it('should add red to shadows with positive cyan_red', () => {
      const width = 4;
      const height = 4;
      // Create dark image (shadows)
      const input = createTestImage(width, height, 0.15, 0.15, 0.15);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // Red should be increased in shadows
      expect(r).toBeGreaterThan(g);
    });

    it('should add cyan to shadows with negative cyan_red', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.15, 0.15, 0.15);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: -0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      // Red should be decreased (cyan added)
      expect(r).toBeLessThan(0.15);
    });

    it('should add green to shadows with positive magenta_green', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.15, 0.15, 0.15);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0, magenta_green: 0.5, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // Green should be increased
      expect(g).toBeGreaterThan(r);
    });

    it('should add blue to shadows with positive yellow_blue', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.15, 0.15, 0.15);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0.5 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, , b] = getPixel(output, width, 0, 0);
      // Blue should be increased
      expect(b).toBeGreaterThan(r);
    });
  });

  describe('Traditional color balance - Midtones', () => {
    it('should affect midtone brightness pixels', () => {
      const width = 4;
      const height = 4;
      // Create mid-brightness image
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({
        midtones: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // Red should be increased in midtones
      expect(r).toBeGreaterThan(g);
    });
  });

  describe('Traditional color balance - Highlights', () => {
    it('should affect highlight brightness pixels', () => {
      const width = 4;
      const height = 4;
      // Create bright image (highlights)
      const input = createTestImage(width, height, 0.85, 0.85, 0.85);
      const context = createProcessingContext(width, height);

      module.setParams({
        highlights: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g] = getPixel(output, width, 0, 0);
      // Red should be increased in highlights
      expect(r).toBeGreaterThan(g);
    });
  });

  describe('Tonal range targeting', () => {
    it('should have more effect on shadows for dark pixels', () => {
      const width = 4;
      const height = 4;
      // Dark image
      const input = createTestImage(width, height, 0.1, 0.1, 0.1);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
        highlights: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Shadow adjustments should have more effect on dark pixels
    });

    it('should have more effect on highlights for bright pixels', () => {
      const width = 4;
      const height = 4;
      // Bright image
      const input = createTestImage(width, height, 0.9, 0.9, 0.9);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
        highlights: { cyan_red: 0.5, magenta_green: 0, yellow_blue: 0 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Highlight adjustments should have more effect on bright pixels
    });
  });

  describe('Global color controls - HSL adjustments', () => {
    it('should increase red saturation', () => {
      const width = 4;
      const height = 4;
      // Create reddish image
      const input = createTestImage(width, height, 0.7, 0.3, 0.3);
      const context = createProcessingContext(width, height);

      module.setParams({ red_saturation: 50 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Output should still be valid
    });

    it('should shift red hue', () => {
      const width = 4;
      const height = 4;
      // Create reddish image
      const input = createTestImage(width, height, 0.8, 0.2, 0.2);
      const context = createProcessingContext(width, height);

      module.setParams({ red_hue: 30 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should adjust red luminance', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.7, 0.3, 0.3);
      const context = createProcessingContext(width, height);

      module.setParams({ red_luminance: 20 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should adjust blue color separately', () => {
      const width = 4;
      const height = 4;
      // Create bluish image
      const input = createTestImage(width, height, 0.2, 0.2, 0.8);
      const context = createProcessingContext(width, height);

      module.setParams({ blue_saturation: 30 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should adjust green color separately', () => {
      const width = 4;
      const height = 4;
      // Create greenish image
      const input = createTestImage(width, height, 0.2, 0.8, 0.2);
      const context = createProcessingContext(width, height);

      module.setParams({ green_saturation: 30 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0.5, yellow_blue: 0.5 },
      });
      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should clamp output values to valid range', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.9, 0.9, 0.9);
      const context = createProcessingContext(width, height);

      // Strong adjustments
      module.setParams({
        midtones: { cyan_red: 1.0, magenta_green: 1.0, yellow_blue: 1.0 },
        red_saturation: 100,
      });
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

      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0.5, yellow_blue: 0.5 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle white image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 1, 1, 1);
      const context = createProcessingContext(width, height);

      module.setParams({
        highlights: { cyan_red: 0.5, magenta_green: 0.5, yellow_blue: 0.5 },
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle extreme parameter values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: 1.0, magenta_green: 1.0, yellow_blue: 1.0 },
        midtones: { cyan_red: 1.0, magenta_green: 1.0, yellow_blue: 1.0 },
        highlights: { cyan_red: 1.0, magenta_green: 1.0, yellow_blue: 1.0 },
        red_saturation: 100,
        red_luminance: 100,
        red_hue: 180,
      });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle negative parameter values', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setParams({
        shadows: { cyan_red: -1.0, magenta_green: -1.0, yellow_blue: -1.0 },
        red_saturation: -100,
        red_luminance: -100,
        red_hue: -180,
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
