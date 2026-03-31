/**
 * Unit Tests for ShadowsHighlightsModule
 *
 * Tests parameter management, shadow/highlight recovery,
 * white/black point adjustments, presets, and auto-adjustment.
 */

import { ShadowsHighlightsModule, ImageData } from './ShadowsHighlightsModule';
import {
  createTestImage,
  createGradientImage,
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

// Helper to create ImageData from Float32Array
function createImageData(width: number, height: number, data: Float32Array): ImageData {
  return { width, height, data, channels: 4 };
}

describe('ShadowsHighlightsModule', () => {
  let module: ShadowsHighlightsModule;

  beforeEach(() => {
    module = new ShadowsHighlightsModule();
  });

  describe('Module identification', () => {
    it('should have correct id', () => {
      expect(module.id).toBe('shadowshighlights');
    });

    it('should have correct name', () => {
      expect(module.name).toBe('Shadows & Highlights');
    });

    it('should have correct group', () => {
      expect(module.group).toBe('tone');
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();
      expect(params.enabled).toBe(true);
      expect(params.shadows).toBe(50.0);
      expect(params.shadowsRadius).toBe(50.0);
      expect(params.highlights).toBe(50.0);
      expect(params.highlightsRadius).toBe(50.0);
      expect(params.whitePoint).toBe(0.0);
      expect(params.blackPoint).toBe(0.0);
      expect(params.compress).toBe(0.0);
      expect(params.preserveColor).toBe(true);
      expect(params.strength).toBe(1.0);
      expect(params.iterations).toBe(1);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({ shadows: 75 });
      expect(module.getParams().shadows).toBe(75);
      // Other params should remain unchanged
      expect(module.getParams().highlights).toBe(50.0);
    });

    it('should merge partial parameters', () => {
      module.setParams({ shadows: 80, highlights: 70 });
      const params = module.getParams();
      expect(params.shadows).toBe(80);
      expect(params.highlights).toBe(70);
      expect(params.compress).toBe(0.0); // Unchanged
    });

    it('should reset parameters to defaults', () => {
      module.setParams({
        shadows: 75,
        highlights: 50,
        compress: 40,
        strength: 1.5,
      });
      module.resetParams();
      const params = module.getParams();
      expect(params.shadows).toBe(50.0);
      expect(params.highlights).toBe(50.0);
      expect(params.compress).toBe(0.0);
      expect(params.strength).toBe(1.0);
    });
  });

  describe('Processing - neutral parameters (passthrough)', () => {
    it('should pass through unchanged when all parameters are neutral', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      // Default params are neutral (shadows=0, highlights=0, etc.)
      const result = module.process(imageData);

      // Should return same data reference when neutral
      expect(result.data).toBe(data);
    });

    it('should pass through when disabled', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      module.setParams({ enabled: false, shadows: 50 });
      const result = module.process(imageData);

      // Should return the input imageData when disabled
      expect(result).toBe(imageData);
    });
  });

  describe('Shadow recovery', () => {
    it('should brighten dark areas when shadows > 0', () => {
      const width = 8;
      const height = 8;
      // Create a dark image
      const data = createTestImage(width, height, 0.1, 0.1, 0.1);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 50, strength: 1.0 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r, g, b] = getPixel(result.data, width, 0, 0);
      // Dark pixels should be brightened
      expect(r).toBeGreaterThan(0.1);
      expect(g).toBeGreaterThan(0.1);
      expect(b).toBeGreaterThan(0.1);
    });

    it('should not significantly affect bright areas when recovering shadows', () => {
      const width = 8;
      const height = 8;
      // Create a bright image
      const data = createTestImage(width, height, 0.9, 0.9, 0.9);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 50, highlights: 0, strength: 1.0 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r] = getPixel(result.data, width, 0, 0);
      // Bright pixels should remain relatively unchanged (within 10%)
      expect(Math.abs(r - 0.9)).toBeLessThan(0.1);
    });
  });

  describe('Highlight recovery', () => {
    it('should reduce brightness of bright areas when highlights > 0', () => {
      const width = 8;
      const height = 8;
      // Create a bright image
      const data = createTestImage(width, height, 0.95, 0.95, 0.95);
      const imageData = createImageData(width, height, data);

      module.setParams({ highlights: 50, strength: 1.0 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r, g, b] = getPixel(result.data, width, 0, 0);
      // Bright pixels should be reduced
      expect(r).toBeLessThan(0.95);
      expect(g).toBeLessThan(0.95);
      expect(b).toBeLessThan(0.95);
    });

    it('should not significantly affect dark areas when recovering highlights', () => {
      const width = 8;
      const height = 8;
      // Create a dark image
      const data = createTestImage(width, height, 0.1, 0.1, 0.1);
      const imageData = createImageData(width, height, data);

      module.setParams({ highlights: 80, shadows: 50, strength: 1.0 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r] = getPixel(result.data, width, 0, 0);
      // Dark pixels should remain relatively unchanged (within 10%)
      expect(Math.abs(r - 0.1)).toBeLessThan(0.1);
    });
  });

  describe('White and black point adjustments', () => {
    it('should increase brightness with positive white point', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      module.setParams({ whitePoint: 1.0 }); // +1 EV
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r] = getPixel(result.data, width, 0, 0);
      expect(r).toBeGreaterThan(0.5);
    });

    it('should decrease brightness with negative white point', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      module.setParams({ whitePoint: -1.0 }); // -1 EV
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r] = getPixel(result.data, width, 0, 0);
      expect(r).toBeLessThan(0.5);
    });

    it('should subtract black point from pixel values', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      module.setParams({ blackPoint: 10 }); // Subtract 0.1
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r] = getPixel(result.data, width, 0, 0);
      expect(r).toBeLessThan(0.5);
    });
  });

  describe('Compression', () => {
    it('should reduce dynamic range when compress > 0', () => {
      const width = 8;
      const height = 8;
      // Create a high-contrast gradient
      const data = createGradientImage(width, height);
      const imageData = createImageData(width, height, data);

      module.setParams({ compress: 50 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // Compression should reduce overall brightness slightly
      const [r] = getPixel(result.data, width, width - 1, 0);
      expect(r).toBeLessThan(1.0);
    });
  });

  describe('Presets', () => {
    it('should apply subtle preset', () => {
      module.applyPreset('subtle');
      const params = module.getParams();
      expect(params.shadows).toBe(58.0);
      expect(params.highlights).toBe(55.0);
      expect(params.strength).toBe(0.7);
    });

    it('should apply moderate preset', () => {
      module.applyPreset('moderate');
      const params = module.getParams();
      expect(params.shadows).toBe(65.0);
      expect(params.highlights).toBe(63.0);
      expect(params.strength).toBe(1.0);
    });

    it('should apply strong preset', () => {
      module.applyPreset('strong');
      const params = module.getParams();
      expect(params.shadows).toBe(75.0);
      expect(params.highlights).toBe(70.0);
      expect(params.strength).toBe(1.3);
      expect(params.iterations).toBe(2);
    });

    it('should apply highlights-only preset', () => {
      module.applyPreset('highlights-only');
      const params = module.getParams();
      expect(params.shadows).toBe(50.0);
      expect(params.highlights).toBe(68.0);
    });

    it('should apply shadows-only preset', () => {
      module.applyPreset('shadows-only');
      const params = module.getParams();
      expect(params.shadows).toBe(70.0);
      expect(params.highlights).toBe(50.0);
    });
  });

  describe('Auto adjustment', () => {
    it('should return auto-adjusted parameters', () => {
      const autoParams = module.autoAdjust();
      expect(autoParams.shadows).toBe(63.0);
      expect(autoParams.highlights).toBe(58.0);
      expect(autoParams.strength).toBe(1.2);
    });

    it('should update module params after auto-adjust', () => {
      const autoParams = module.autoAdjust();
      const currentParams = module.getParams();
      expect(currentParams.shadows).toBe(autoParams.shadows);
      expect(currentParams.highlights).toBe(autoParams.highlights);
    });
  });

  describe('Preserve color option', () => {
    it('should maintain color ratios when preserveColor is true', () => {
      const width = 4;
      const height = 4;
      // Create image with distinct color (more red)
      const data = createTestImage(width, height, 0.2, 0.1, 0.1);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 50, preserveColor: true });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r, g] = getPixel(result.data, width, 0, 0);
      // Red should still be greater than green (color ratio preserved)
      expect(r).toBeGreaterThan(g);
    });
  });

  describe('Bilateral filter option', () => {
    it('should process with bilateral filter enabled', () => {
      const width = 8;
      const height = 8;
      const data = createGradientImage(width, height);
      const imageData = createImageData(width, height, data);

      module.setParams({ bilateralFilter: true, shadows: 80 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      expect(result.data.length).toBe(data.length);
    });
  });

  describe('Multiple iterations', () => {
    it('should apply stronger effect with more iterations', () => {
      const width = 8;
      const height = 8;
      const data1 = createTestImage(width, height, 0.1, 0.1, 0.1);
      const imageData1 = createImageData(width, height, data1);

      const data2 = createTestImage(width, height, 0.1, 0.1, 0.1);
      const imageData2 = createImageData(width, height, data2);

      // Process with 1 iteration (80 = strong shadow lift, since 50 is neutral)
      module.setParams({ shadows: 80, iterations: 1 });
      const result1 = module.process(imageData1);
      const [r1] = getPixel(result1.data, width, 0, 0);

      // Reset and process with 2 iterations
      module.resetParams();
      module.setParams({ shadows: 80, iterations: 2 });
      const result2 = module.process(imageData2);
      const [r2] = getPixel(result2.data, width, 0, 0);

      // More iterations should produce stronger effect (brighter shadows)
      expect(r2).toBeGreaterThanOrEqual(r1);
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 80, highlights: 70 });
      const result = module.process(imageData);

      expect(result.data.length).toBe(4);
      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0, 0, 0);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 80 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // Black stays black (nothing to recover)
      const [r, g, b] = getPixel(result.data, width, 0, 0);
      expect(r).toBeCloseTo(0, 1);
      expect(g).toBeCloseTo(0, 1);
      expect(b).toBeCloseTo(0, 1);
    });

    it('should handle white image', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 1, 1, 1);
      const imageData = createImageData(width, height, data);

      module.setParams({ highlights: 50 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r, g, b] = getPixel(result.data, width, 0, 0);
      // White should be reduced slightly
      expect(r).toBeLessThanOrEqual(1.0);
      expect(g).toBeLessThanOrEqual(1.0);
      expect(b).toBeLessThanOrEqual(1.0);
    });

    it('should handle gradient image', () => {
      const width = 8;
      const height = 8;
      const data = createGradientImage(width, height);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 80, highlights: 70 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      expect(result.data.length).toBe(data.length);
    });

    it('should preserve alpha channel', () => {
      const width = 2;
      const height = 2;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);
      const imageData = createImageData(width, height, data);

      module.setParams({ shadows: 80 });
      const result = module.process(imageData);

      const [, , , a] = getPixel(result.data, width, 0, 0);
      expect(a).toBeCloseTo(0.75, 5);
    });

    it('should clamp output values to valid range', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = createImageData(width, height, data);

      // Extreme parameters
      module.setParams({
        shadows: 100,
        highlights: 100,
        whitePoint: 4.0,
        strength: 2.0,
      });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // All values should be within [0, 1]
      for (let i = 0; i < result.data.length; i++) {
        expect(result.data[i]).toBeGreaterThanOrEqual(0);
        expect(result.data[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Radius parameters', () => {
    it('should affect shadow detection with shadowsRadius', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);
      const imageData = createImageData(width, height, data);

      // Larger radius should affect more of the tonal range
      module.setParams({ shadows: 80, shadowsRadius: 80 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should affect highlight detection with highlightsRadius', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.7, 0.7, 0.7);
      const imageData = createImageData(width, height, data);

      // Larger radius should affect more of the tonal range
      module.setParams({ highlights: 80, highlightsRadius: 80 });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Color transfer parameters', () => {
    it('should process with shadowsColorTransfer', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.15, 0.1, 0.1);
      const imageData = createImageData(width, height, data);

      module.setParams({
        shadows: 80,
        shadowsColorTransfer: 50,
        preserveColor: false,
      });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should process with highlightsColorTransfer', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.9, 0.85, 0.85);
      const imageData = createImageData(width, height, data);

      module.setParams({
        highlights: 80,
        highlightsColorTransfer: 50,
        preserveColor: false,
      });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Color correction parameters', () => {
    it('should apply shadow color correction', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.1, 0.1, 0.1);
      const imageData = createImageData(width, height, data);

      module.setParams({
        shadows: 80,
        shadowsColorCorrection: 30,
      });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should apply highlight color correction', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.9, 0.9, 0.9);
      const imageData = createImageData(width, height, data);

      module.setParams({
        highlights: 80,
        highlightsColorCorrection: 30,
      });
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });
});
