/**
 * Unit Tests for NoiseReductionModule
 *
 * Tests parameter management, noise reduction processing,
 * auto-adjustment, and algorithm selection.
 */

import { NoiseReductionModule, NoiseReductionParams, NoiseReductionContext } from './NoiseReductionModule';
import { nrStrengthToH, legacyNrStrengthToH } from '../utils/nrCurve';
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

// Mock the AdvancedDenoisingService to avoid complex denoising algorithms in tests
jest.mock('../services/AdvancedDenoisingService', () => ({
  AdvancedDenoisingService: jest.fn().mockImplementation(() => ({
    denoiseSync: jest.fn((imageData: Float32Array, _width: number, _height: number, _params: unknown) => {
      // Simple mock: apply a slight smoothing to simulate denoising
      const output = new Float32Array(imageData.length);
      for (let i = 0; i < imageData.length; i++) {
        output[i] = imageData[i] * 0.95; // Slight reduction simulating noise removal
      }
      return output;
    }),
    getStats: jest.fn(() => ({
      cacheHits: 5,
      cacheMisses: 10,
      totalProcessingTime: 1500,
      averageProcessingTime: 100,
    })),
    clearCache: jest.fn(),
  })),
}));

describe('NoiseReductionModule', () => {
  let module: NoiseReductionModule;

  beforeEach(() => {
    module = new NoiseReductionModule();
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('noise-reduction');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('Noise Reduction');
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();
      expect(params.enabled).toBe(false);
      expect(params.strength).toBe(50);
      expect(params.method).toBe('auto');
      expect(params.preserveDetail).toBe(70);
      expect(params.chromaStrength).toBe(50);
      expect(params.lumaStrength).toBe(50);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({ strength: 75 });
      expect(module.getParams().strength).toBe(75);
      // Other params should remain unchanged
      expect(module.getParams().method).toBe('auto');
    });

    it('should merge partial parameters', () => {
      module.setParams({ strength: 80, preserveDetail: 60 });
      const params = module.getParams();
      expect(params.strength).toBe(80);
      expect(params.preserveDetail).toBe(60);
      expect(params.chromaStrength).toBe(50); // Unchanged
    });

    it('should reset parameters to defaults', () => {
      module.setParams({ enabled: true, strength: 100, method: 'bm3d' });
      module.resetParams();
      const params = module.getParams();
      expect(params.enabled).toBe(false);
      expect(params.strength).toBe(50);
      expect(params.method).toBe('auto');
    });
  });

  describe('Parameter validation', () => {
    it('should clamp strength to valid range (0-100)', () => {
      module.setParams({ strength: 150 });
      expect(module.getParams().strength).toBe(100);

      module.setParams({ strength: -20 });
      expect(module.getParams().strength).toBe(0);
    });

    it('should clamp preserveDetail to valid range', () => {
      module.setParams({ preserveDetail: 200 });
      expect(module.getParams().preserveDetail).toBe(100);

      module.setParams({ preserveDetail: -50 });
      expect(module.getParams().preserveDetail).toBe(0);
    });

    it('should clamp chromaStrength to valid range', () => {
      module.setParams({ chromaStrength: 120 });
      expect(module.getParams().chromaStrength).toBe(100);
    });

    it('should clamp lumaStrength to valid range', () => {
      module.setParams({ lumaStrength: 110 });
      expect(module.getParams().lumaStrength).toBe(100);
    });

    it('should validate method to allowed values', () => {
      module.setParams({ method: 'bm3d' });
      expect(module.getParams().method).toBe('bm3d');

      module.setParams({ method: 'nlmeans' });
      expect(module.getParams().method).toBe('nlmeans');

      module.setParams({ method: 'wavelet' });
      expect(module.getParams().method).toBe('wavelet');

      module.setParams({ method: 'hybrid' });
      expect(module.getParams().method).toBe('hybrid');

      module.setParams({ method: 'auto' });
      expect(module.getParams().method).toBe('auto');
    });

    it('should fallback to auto for invalid method', () => {
      // TypeScript prevents this at compile time, but test runtime behavior
      module.setParams({ method: 'invalid' as NoiseReductionParams['method'] });
      expect(module.getParams().method).toBe('auto');
    });

    it('should convert enabled to boolean', () => {
      module.setParams({ enabled: true });
      expect(module.getParams().enabled).toBe(true);

      module.setParams({ enabled: false });
      expect(module.getParams().enabled).toBe(false);
    });
  });

  describe('Parameter constraints', () => {
    it('should provide valid constraint values', () => {
      const constraints = module.getParamConstraints();

      expect(constraints.strength.min).toBe(0);
      expect(constraints.strength.max).toBe(100);
      expect(constraints.strength.default).toBe(50);

      expect(constraints.preserveDetail.min).toBe(0);
      expect(constraints.preserveDetail.max).toBe(100);
      expect(constraints.preserveDetail.default).toBe(70);

      expect(constraints.chromaStrength.min).toBe(0);
      expect(constraints.chromaStrength.max).toBe(100);

      expect(constraints.lumaStrength.min).toBe(0);
      expect(constraints.lumaStrength.max).toBe(100);
    });

    it('should include units in constraints', () => {
      const constraints = module.getParamConstraints();
      expect(constraints.strength.unit).toBe('%');
    });
  });

  describe('Processing - disabled', () => {
    it('should return copy of input when disabled', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      // Module is disabled by default
      expect(module.getParams().enabled).toBe(false);

      const output = module.process(input, context);

      // Output should be a copy, not the same reference
      expect(output).not.toBe(input);
      expect(output.length).toBe(input.length);

      // Values should be identical when disabled
      for (let i = 0; i < input.length; i++) {
        expect(output[i]).toBe(input[i]);
      }
    });

    it('should preserve alpha channel when disabled', () => {
      const width = 2;
      const height = 2;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5, 0.8);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      const [, , , a] = getPixel(output, width, 0, 0);
      expect(a).toBeCloseTo(0.8, 5);
    });
  });

  describe('Processing - enabled', () => {
    beforeEach(() => {
      module.setParams({ enabled: true });
    });

    it('should process image when enabled', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      expect(output.length).toBe(input.length);
    });

    it('should modify pixel values when processing', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      // Mock applies 0.95 multiplier, so values should be different
      const [r] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0.5 * 0.95, 4);
    });

    it('should handle gradient image', () => {
      const width = 8;
      const height = 8;
      const input = createGradientImage(width, height);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      expect(output.length).toBe(input.length);
    });
  });

  describe('Processing with different methods', () => {
    beforeEach(() => {
      module.setParams({ enabled: true });
    });

    it('should process with bm3d method', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      module.setParams({ method: 'bm3d' });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should process with nlmeans method', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      module.setParams({ method: 'nlmeans' });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should process with wavelet method', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      module.setParams({ method: 'wavelet' });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should process with hybrid method', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      module.setParams({ method: 'hybrid' });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should process with auto method', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      module.setParams({ method: 'auto' });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Auto adjustment', () => {
    it('should return enabled parameters after auto-adjust', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      expect(autoParams.enabled).toBe(true);
    });

    it('should set strength based on noise level', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      // Strength should be a valid number between 0-100
      expect(autoParams.strength).toBeGreaterThanOrEqual(0);
      expect(autoParams.strength).toBeLessThanOrEqual(100);
    });

    it('should set preserveDetail based on noise level', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      // PreserveDetail should be a valid number between 0-100
      expect(autoParams.preserveDetail).toBeGreaterThanOrEqual(0);
      expect(autoParams.preserveDetail).toBeLessThanOrEqual(100);
    });

    it('should select an appropriate method', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      const validMethods = ['auto', 'bm3d', 'nlmeans', 'wavelet', 'hybrid'];
      expect(validMethods).toContain(autoParams.method);
    });

    it('should set chromaStrength relative to main strength', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      // ChromaStrength should be less than or equal to lumaStrength
      expect(autoParams.chromaStrength).toBeLessThanOrEqual(autoParams.lumaStrength);
    });

    it('should update module params after auto-adjust', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);
      const currentParams = module.getParams();

      expect(currentParams.enabled).toBe(autoParams.enabled);
      expect(currentParams.strength).toBe(autoParams.strength);
    });
  });

  describe('Cache and statistics', () => {
    it('should return cache statistics', () => {
      const stats = module.getStats();

      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('totalProcessingTime');
      expect(stats).toHaveProperty('averageProcessingTime');
    });

    it('should return numeric cache statistics', () => {
      const stats = module.getStats();

      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.cacheMisses).toBe('number');
      expect(typeof stats.totalProcessingTime).toBe('number');
      expect(typeof stats.averageProcessingTime).toBe('number');
    });

    it('should clear cache without throwing', () => {
      expect(() => module.clearCache()).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      module.setParams({ enabled: true });
    });

    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0, 0, 0);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

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
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle different strength levels', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      // Test various strength levels
      const strengths = [0, 25, 50, 75, 100];

      for (const strength of strengths) {
        module.setParams({ strength });
        const output = module.process(input, context);
        expect(isValidImageData(output)).toBe(true);
      }
    });

    it('should handle different preserveDetail levels', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const detailLevels = [0, 50, 100];

      for (const preserveDetail of detailLevels) {
        module.setParams({ preserveDetail });
        const output = module.process(input, context);
        expect(isValidImageData(output)).toBe(true);
      }
    });
  });

  describe('Noise level estimation', () => {
    it('should detect low noise in uniform image', () => {
      const width = 16;
      const height = 16;
      // Uniform image has low "noise" (variation)
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      const autoParams = module.autoAdjust(input, context);

      // Low noise → the low bucket: higher detail preservation, and a strength whose
      // EFFECTIVE h equals the old tuning (legacy strength 20). v1.36.0 C1/F1: the raw
      // strength is no longer 20 — the slider curve was recalibrated (nrCurve.ts), so the
      // bucket's raw value is remapped to keep the same denoise effect (~85 on the new scale).
      expect(nrStrengthToH(autoParams.strength)).toBeCloseTo(legacyNrStrengthToH(20), 8);
      expect(autoParams.strength).toBeLessThan(100); // below the clamped stronger buckets
      expect(autoParams.preserveDetail).toBeGreaterThanOrEqual(70);
    });

    it('should handle gradient image for noise estimation', () => {
      const width = 16;
      const height = 16;
      const input = createGradientImage(width, height);
      const context: NoiseReductionContext = { width, height, channels: 4 };

      // Should not throw
      expect(() => module.autoAdjust(input, context)).not.toThrow();
    });
  });
});
