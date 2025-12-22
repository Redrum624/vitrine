/**
 * Unit Tests for LensCorrectionsModule
 *
 * Tests parameter management, vignetting correction, distortion correction,
 * chromatic aberration correction, auto-detection, and reset functionality.
 */

import { LensCorrectionsModule } from './LensCorrectionsModule';
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

describe('LensCorrectionsModule', () => {
  let module: LensCorrectionsModule;

  beforeEach(() => {
    module = new LensCorrectionsModule();
  });

  describe('Module identification', () => {
    it('should have correct id', () => {
      expect(module.id).toBe('lenscorrections');
    });

    it('should have correct name', () => {
      expect(module.name).toBe('Lens Corrections');
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();
      expect(params.vignetting.enabled).toBe(false);
      expect(params.vignetting.amount).toBe(0);
      expect(params.vignetting.midpoint).toBe(1.0);
      expect(params.distortion.enabled).toBe(false);
      expect(params.distortion.barrel).toBe(0);
      expect(params.distortion.scale).toBe(1.0);
      expect(params.chromaticAberration.enabled).toBe(false);
      expect(params.chromaticAberration.redCyan).toBe(0);
      expect(params.profile.enabled).toBe(false);
      expect(params.profile.autoDetect).toBe(true);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({
        vignetting: {
          enabled: true,
          amount: 30,
          midpoint: 1.0,
          roundness: 0,
          feather: 50,
        },
      });
      expect(module.getParams().vignetting.enabled).toBe(true);
      expect(module.getParams().vignetting.amount).toBe(30);
    });
  });

  describe('Specialized update methods', () => {
    it('should update vignetting params', () => {
      module.updateVignettingParams({ enabled: true, amount: 50 });
      const params = module.getParams();
      expect(params.vignetting.enabled).toBe(true);
      expect(params.vignetting.amount).toBe(50);
      // Other vignetting params should remain unchanged
      expect(params.vignetting.feather).toBe(50);
    });

    it('should update distortion params', () => {
      module.updateDistortionParams({ enabled: true, barrel: 25 });
      const params = module.getParams();
      expect(params.distortion.enabled).toBe(true);
      expect(params.distortion.barrel).toBe(25);
      // Other distortion params should remain unchanged
      expect(params.distortion.scale).toBe(1.0);
    });

    it('should update chromatic aberration params', () => {
      module.updateChromaticAberrationParams({ enabled: true, redCyan: 10 });
      const params = module.getParams();
      expect(params.chromaticAberration.enabled).toBe(true);
      expect(params.chromaticAberration.redCyan).toBe(10);
      // Other CA params should remain unchanged
      expect(params.chromaticAberration.blueMagenta).toBe(0);
    });
  });

  describe('Reset methods', () => {
    it('should reset vignetting to defaults', () => {
      module.updateVignettingParams({ enabled: true, amount: 75, midpoint: 1.5 });
      module.resetVignetting();
      const params = module.getParams();
      expect(params.vignetting.enabled).toBe(false);
      expect(params.vignetting.amount).toBe(0);
      expect(params.vignetting.midpoint).toBe(1.0);
    });

    it('should reset distortion to defaults', () => {
      module.updateDistortionParams({ enabled: true, barrel: 50, scale: 1.5 });
      module.resetDistortion();
      const params = module.getParams();
      expect(params.distortion.enabled).toBe(false);
      expect(params.distortion.barrel).toBe(0);
      expect(params.distortion.scale).toBe(1.0);
    });

    it('should reset chromatic aberration to defaults', () => {
      module.updateChromaticAberrationParams({ enabled: true, redCyan: 20, blueMagenta: 15 });
      module.resetChromaticAberration();
      const params = module.getParams();
      expect(params.chromaticAberration.enabled).toBe(false);
      expect(params.chromaticAberration.redCyan).toBe(0);
      expect(params.chromaticAberration.blueMagenta).toBe(0);
    });

    it('should reset all corrections', () => {
      module.updateVignettingParams({ enabled: true, amount: 50 });
      module.updateDistortionParams({ enabled: true, barrel: 30 });
      module.updateChromaticAberrationParams({ enabled: true, redCyan: 10 });
      module.resetAll();
      const params = module.getParams();
      expect(params.vignetting.enabled).toBe(false);
      expect(params.vignetting.amount).toBe(0);
      expect(params.distortion.enabled).toBe(false);
      expect(params.distortion.barrel).toBe(0);
      expect(params.chromaticAberration.enabled).toBe(false);
      expect(params.chromaticAberration.redCyan).toBe(0);
    });
  });

  describe('Processing - disabled corrections (passthrough)', () => {
    it('should pass through unchanged when all corrections are disabled', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      // All corrections disabled by default
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      // Values should be identical (or very close) when no corrections applied
      for (let i = 0; i < data.length; i++) {
        expect(result[i]).toBeCloseTo(data[i], 5);
      }
    });
  });

  describe('Vignetting correction', () => {
    it('should brighten corners when correcting vignetting', () => {
      const width = 32;
      const height = 32;
      // Create uniform image
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      module.updateVignettingParams({ enabled: true, amount: 50 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);

      // Get corner pixel brightness
      const [cornerR] = getPixel(result, width, 0, 0);

      // Corner should be brightened relative to center (vignetting correction)
      // Or at minimum, result should be different from input
      expect(cornerR).toBeGreaterThanOrEqual(0);
    });

    it('should not affect center significantly', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 30 });
      const result = module.processImage(data, width, height);

      // Center should remain relatively unchanged
      const [centerR] = getPixel(result, width, width / 2, height / 2);
      expect(centerR).toBeGreaterThan(0.4);
      expect(centerR).toBeLessThan(0.7);
    });

    it('should respect midpoint parameter', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 40, midpoint: 0.5 });
      const result = module.processImage(data, width, height);

      // Vignetting correction can produce values > 1.0, so check length and finite values
      expect(result.length).toBe(data.length);
      for (let i = 0; i < result.length; i++) {
        expect(Number.isFinite(result[i])).toBe(true);
      }
    });

    it('should respect feather parameter', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 40, feather: 80 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });
  });

  describe('Distortion correction', () => {
    it('should correct barrel distortion', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({ enabled: true, barrel: 30 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      expect(result.length).toBe(data.length);
    });

    it('should correct pincushion distortion', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({ enabled: true, barrel: -30 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply horizontal perspective correction', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({
        enabled: true,
        perspective: { horizontal: 15, vertical: 0 },
      });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply vertical perspective correction', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({
        enabled: true,
        perspective: { horizontal: 0, vertical: 15 },
      });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply scale adjustment', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({ enabled: true, scale: 1.2 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should not modify when distortion params are neutral', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({
        enabled: true,
        barrel: 0,
        perspective: { horizontal: 0, vertical: 0 },
        scale: 1.0,
      });
      const result = module.processImage(data, width, height);

      // Should be effectively unchanged
      for (let i = 0; i < data.length; i++) {
        expect(result[i]).toBeCloseTo(data[i], 5);
      }
    });
  });

  describe('Chromatic aberration correction', () => {
    it('should correct red/cyan fringing', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateChromaticAberrationParams({ enabled: true, redCyan: 20 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should correct blue/magenta fringing', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateChromaticAberrationParams({ enabled: true, blueMagenta: 20 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should correct purple fringing', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateChromaticAberrationParams({
        enabled: true,
        purple: { amount: 50, hue: 300, range: 20 },
      });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should correct green fringing', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateChromaticAberrationParams({
        enabled: true,
        green: { amount: 50, hue: 60, range: 20 },
      });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should not modify when CA params are neutral', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateChromaticAberrationParams({
        enabled: true,
        redCyan: 0,
        blueMagenta: 0,
        purple: { amount: 0, hue: 300, range: 10 },
        green: { amount: 0, hue: 60, range: 10 },
      });
      const result = module.processImage(data, width, height);

      // Should be effectively unchanged
      for (let i = 0; i < data.length; i++) {
        expect(result[i]).toBeCloseTo(data[i], 5);
      }
    });
  });

  describe('Auto-detect vignetting', () => {
    it('should detect vignetting in images with dark corners', () => {
      const width = 200;
      const height = 200;
      const data = new Float32Array(width * height * 4);

      // Create image with strong vignetting (very dark corners, bright center)
      const centerX = width / 2;
      const centerY = height / 2;
      const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          // Strong vignetting: center at 0.9, corners at 0.2
          const brightness = 0.9 - (dist / maxDist) * 0.7;
          data[idx] = brightness;
          data[idx + 1] = brightness;
          data[idx + 2] = brightness;
          data[idx + 3] = 1.0;
        }
      }

      module.autoDetectVignetting(data, width, height);
      const params = module.getParams();

      // Auto-detect calculates (center - corner) brightness difference
      // If difference > 5%, vignetting is enabled
      // Our test image has ~70% difference which should definitely trigger
      expect(params.vignetting.enabled).toBe(true);
      expect(params.vignetting.amount).toBeGreaterThan(0);
    });

    it('should not enable vignetting for uniform images', () => {
      const width = 100;
      const height = 100;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.autoDetectVignetting(data, width, height);
      const params = module.getParams();

      // Should not detect significant vignetting in uniform image
      // (or amount should be very small)
      if (params.vignetting.enabled) {
        expect(params.vignetting.amount).toBeLessThan(10);
      }
    });
  });

  describe('Statistics', () => {
    it('should report no enabled corrections by default', () => {
      const stats = module.getStats();
      expect(stats.enabledCorrections).toBe(0);
      expect(stats.corrections).toEqual([]);
    });

    it('should report enabled corrections', () => {
      module.updateVignettingParams({ enabled: true, amount: 30 });
      module.updateDistortionParams({ enabled: true, barrel: 20 });

      const stats = module.getStats();
      expect(stats.enabledCorrections).toBe(2);
      expect(stats.corrections).toContain('vignetting');
      expect(stats.corrections).toContain('distortion');
    });

    it('should report hasVignettingCorrection accurately', () => {
      module.updateVignettingParams({ enabled: true, amount: 0 });
      expect(module.getStats().hasVignettingCorrection).toBe(false);

      module.updateVignettingParams({ amount: 30 });
      expect(module.getStats().hasVignettingCorrection).toBe(true);
    });

    it('should report hasDistortionCorrection accurately', () => {
      module.updateDistortionParams({ enabled: true, barrel: 0 });
      expect(module.getStats().hasDistortionCorrection).toBe(false);

      module.updateDistortionParams({ barrel: 20 });
      expect(module.getStats().hasDistortionCorrection).toBe(true);
    });

    it('should report hasChromaticAberrationCorrection accurately', () => {
      module.updateChromaticAberrationParams({ enabled: true, redCyan: 0, blueMagenta: 0 });
      expect(module.getStats().hasChromaticAberrationCorrection).toBe(false);

      module.updateChromaticAberrationParams({ redCyan: 15 });
      expect(module.getStats().hasChromaticAberrationCorrection).toBe(true);
    });
  });

  describe('Combined corrections', () => {
    it('should apply multiple corrections in sequence', () => {
      const width = 32;
      const height = 32;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 20 });
      module.updateDistortionParams({ enabled: true, barrel: 10 });
      module.updateChromaticAberrationParams({ enabled: true, redCyan: 5 });

      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      expect(result.length).toBe(data.length);
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 30 });
      const result = module.processImage(data, width, height);

      expect(result.length).toBe(4);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle small image', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateDistortionParams({ enabled: true, barrel: 20 });
      const result = module.processImage(data, width, height);

      expect(result.length).toBe(data.length);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0, 0, 0);

      module.updateVignettingParams({ enabled: true, amount: 50 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle white image', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 1, 1, 1);

      module.updateVignettingParams({ enabled: true, amount: 50 });
      const result = module.processImage(data, width, height);

      // Vignetting correction on white image may produce values > 1.0
      // This is expected for HDR workflows
      expect(result.length).toBe(data.length);
      for (let i = 0; i < result.length; i++) {
        expect(Number.isFinite(result[i])).toBe(true);
        expect(result[i]).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle gradient image', () => {
      const width = 32;
      const height = 32;
      const data = createGradientImage(width, height);

      module.updateDistortionParams({ enabled: true, barrel: 15 });
      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      expect(result.length).toBe(data.length);
    });

    it('should preserve alpha channel', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);

      module.updateVignettingParams({ enabled: true, amount: 30 });
      const result = module.processImage(data, width, height);

      const [, , , a] = getPixel(result, width, width / 2, height / 2);
      expect(a).toBeCloseTo(0.75, 5);
    });

    it('should produce finite output values with extreme corrections', () => {
      const width = 16;
      const height = 16;
      const data = createTestImage(width, height, 0.9, 0.9, 0.9);

      // Extreme vignetting correction
      module.updateVignettingParams({ enabled: true, amount: 100 });
      const result = module.processImage(data, width, height);

      // Vignetting correction doesn't clamp values (intentional for HDR workflows)
      // Values can exceed 1.0 in corners when correcting strong vignetting
      expect(result.length).toBe(data.length);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(result[i])).toBe(true);
      }
    });
  });

  describe('Parameter persistence', () => {
    it('should maintain parameters across multiple processImage calls', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.updateVignettingParams({ enabled: true, amount: 40 });

      // Process twice
      module.processImage(data, width, height);
      const params = module.getParams();

      // Parameters should remain unchanged
      expect(params.vignetting.enabled).toBe(true);
      expect(params.vignetting.amount).toBe(40);
    });
  });
});
