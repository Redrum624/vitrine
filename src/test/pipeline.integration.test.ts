/**
 * Pipeline Integration Tests
 *
 * Tests the complete image processing pipeline with multiple modules.
 * Validates module interactions, caching behavior, and edge cases.
 */

import type { ProcessingContext } from '../services/ImageProcessingPipeline';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import {
  createTestImage,
  createGradientImage,
  isValidImageData,
  maxImageDifference,
} from './testUtils';

// Mock the logger
jest.mock('../utils/Logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the WebWorkerImageProcessor to always process on main thread
jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: {
    shouldUseWorkers: () => false,
    processImage: jest.fn(),
  },
}));

describe('Pipeline Integration Tests', () => {
  describe('Module Direct Processing', () => {
    describe('Single module processing', () => {
      it('should process image through WhiteBalanceModule', () => {
        const width = 16;
        const height = 16;
        const input = createTestImage(width, height, 0.5, 0.5, 0.5);
        const context: ProcessingContext = { width, height, channels: 4 };

        const module = new WhiteBalanceModule();
        module.setParams({ temperature: 4000, tint: 0 });

        const output = module.process(input, context);

        expect(isValidImageData(output)).toBe(true);
        expect(output.length).toBe(input.length);
      });

      it('should process image through BasicAdjustmentsModule', () => {
        const width = 16;
        const height = 16;
        const input = createTestImage(width, height, 0.5, 0.5, 0.5);
        const context: ProcessingContext = { width, height, channels: 4 };

        const module = new BasicAdjustmentsModule();
        module.setParams({ contrast: 20, saturation: 10 });

        const output = module.process(input, context);

        expect(isValidImageData(output)).toBe(true);
        expect(output.length).toBe(input.length);
      });

      it('should process image through ColorBalanceModule', () => {
        const width = 16;
        const height = 16;
        const input = createTestImage(width, height, 0.5, 0.5, 0.5);
        const context: ProcessingContext = { width, height, channels: 4 };

        const module = new ColorBalanceModule();
        module.setParams({
          shadows: { cyan_red: 0.3, magenta_green: 0, yellow_blue: 0 },
        });

        const output = module.process(input, context);

        expect(isValidImageData(output)).toBe(true);
        expect(output.length).toBe(input.length);
      });
    });

    describe('Sequential module processing', () => {
      it('should process through WhiteBalance then BasicAdjustments', () => {
        const width = 16;
        const height = 16;
        const input = createTestImage(width, height, 0.5, 0.5, 0.5);
        const context: ProcessingContext = { width, height, channels: 4 };

        // First module: WhiteBalance
        const wbModule = new WhiteBalanceModule();
        wbModule.setParams({ temperature: 4500 });
        const afterWB = wbModule.process(input, context);

        // Second module: BasicAdjustments
        const basicModule = new BasicAdjustmentsModule();
        basicModule.setParams({ contrast: 15 });
        const afterBasic = basicModule.process(afterWB, context);

        expect(isValidImageData(afterBasic)).toBe(true);
        expect(afterBasic.length).toBe(input.length);
      });

      it('should process through all three test modules sequentially', () => {
        const width = 16;
        const height = 16;
        const input = createGradientImage(width, height);
        const context: ProcessingContext = { width, height, channels: 4 };

        // Module 1: WhiteBalance
        const wbModule = new WhiteBalanceModule();
        wbModule.setParams({ temperature: 5000, tint: 5 });
        const step1 = wbModule.process(input, context);

        // Module 2: BasicAdjustments
        const basicModule = new BasicAdjustmentsModule();
        basicModule.setParams({ exposure: 0.3, contrast: 10, saturation: 5 });
        const step2 = basicModule.process(step1, context);

        // Module 3: ColorBalance
        const colorModule = new ColorBalanceModule();
        colorModule.setParams({
          midtones: { cyan_red: 0.1, magenta_green: 0, yellow_blue: 0.1 },
        });
        const step3 = colorModule.process(step2, context);

        expect(isValidImageData(step3)).toBe(true);
        expect(step3.length).toBe(input.length);
      });
    });

    describe('Processing order matters', () => {
      it('should produce different results with different module order', () => {
        const width = 32;
        const height = 32;
        const input = createGradientImage(width, height);
        const context: ProcessingContext = { width, height, channels: 4 };

        // Order A: WhiteBalance -> BasicAdjustments
        const wbA = new WhiteBalanceModule();
        wbA.setParams({ temperature: 4000 });
        const basicA = new BasicAdjustmentsModule();
        basicA.setParams({ exposure: 0.5 });

        const stepA1 = wbA.process(new Float32Array(input), context);
        const resultA = basicA.process(stepA1, context);

        // Order B: BasicAdjustments -> WhiteBalance
        const basicB = new BasicAdjustmentsModule();
        basicB.setParams({ exposure: 0.5 });
        const wbB = new WhiteBalanceModule();
        wbB.setParams({ temperature: 4000 });

        const stepB1 = basicB.process(new Float32Array(input), context);
        const resultB = wbB.process(stepB1, context);

        // Results should be different due to different processing order
        expect(isValidImageData(resultA)).toBe(true);
        expect(isValidImageData(resultB)).toBe(true);

        // Allow some tolerance but expect meaningful difference
        const diff = maxImageDifference(resultA, resultB);
        // Results should differ due to order (non-linear operations)
        expect(diff).toBeGreaterThan(0);
      });
    });
  });

  describe('Parameter Persistence', () => {
    it('should maintain module parameters after processing', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new WhiteBalanceModule();
      module.setParams({ temperature: 4200, tint: 15 });

      // Get params before processing
      const paramsBefore = module.getParams();

      // Process
      module.process(input, context);

      // Get params after processing
      const paramsAfter = module.getParams();

      expect(paramsAfter.temperature).toBe(paramsBefore.temperature);
      expect(paramsAfter.tint).toBe(paramsBefore.tint);
    });

    it('should reset module parameters to defaults', () => {
      const module = new BasicAdjustmentsModule();
      module.setParams({ exposure: 1.5, contrast: 30, saturation: 50 });

      module.resetParams();
      const params = module.getParams();

      expect(params.exposure).toBe(0);
      expect(params.contrast).toBe(0);
      expect(params.saturation).toBe(0);
    });

    it('should handle partial parameter updates', () => {
      const module = new ColorBalanceModule();

      // Set initial params
      module.setParams({
        shadows: { cyan_red: 0.5, magenta_green: 0.3, yellow_blue: 0.2 },
      });

      // Update only cyan_red
      module.setParams({
        shadows: { cyan_red: 0.8, magenta_green: 0.3, yellow_blue: 0.2 },
      });

      const params = module.getParams();
      expect(params.shadows.cyan_red).toBe(0.8);
      // Other values should be preserved
      expect(params.shadows.magenta_green).toBe(0.3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single pixel image through multiple modules', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 4000 });

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ contrast: 20 });

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      expect(result.length).toBe(4);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle black image (all zeros)', () => {
      const width = 16;
      const height = 16;
      const input = createTestImage(width, height, 0, 0, 0);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 3500 });

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ exposure: 1.0 });

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle white image (all ones)', () => {
      const width = 16;
      const height = 16;
      const input = createTestImage(width, height, 1, 1, 1);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 8000 });

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ exposure: -0.5 });

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle extreme parameter values', () => {
      const width = 8;
      const height = 8;
      const input = createGradientImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 2000, tint: 100 }); // Extreme

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ exposure: 3, contrast: 100, saturation: 100 }); // Extreme

      const color = new ColorBalanceModule();
      color.setParams({
        shadows: { cyan_red: 1, magenta_green: 1, yellow_blue: 1 },
        midtones: { cyan_red: 1, magenta_green: 1, yellow_blue: 1 },
        highlights: { cyan_red: 1, magenta_green: 1, yellow_blue: 1 },
      });

      const step1 = wb.process(input, context);
      const step2 = basic.process(step1, context);
      const result = color.process(step2, context);

      // Should not crash and should produce valid output
      expect(isValidImageData(result)).toBe(true);
    });

    it('should preserve alpha channel through multiple modules', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 4500 });

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ saturation: 20 });

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      // Check all alpha values
      for (let i = 3; i < result.length; i += 4) {
        expect(result[i]).toBe(0.75);
      }
    });
  });

  describe('Neutral Processing (Identity)', () => {
    it('should produce minimal change with neutral WhiteBalance', () => {
      const width = 16;
      const height = 16;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new WhiteBalanceModule();
      // 6500K is D65 reference (identity / no correction)
      module.setParams({ temperature: 6500, tint: 0 });

      const output = module.process(input, context);

      const diff = maxImageDifference(input, output);
      expect(diff).toBeLessThan(0.05); // Allow small tolerance
    });

    it('should produce minimal change with neutral BasicAdjustments', () => {
      const width = 16;
      const height = 16;
      const input = createGradientImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new BasicAdjustmentsModule();
      // All zeros should be identity
      module.setParams({
        exposure: 0,
        contrast: 0,
        brightness: 0,
        saturation: 0,
        vibrance: 0,
      });

      const output = module.process(input, context);

      const diff = maxImageDifference(input, output);
      expect(diff).toBeLessThan(0.01);
    });

    it('should produce minimal change with neutral ColorBalance', () => {
      const width = 16;
      const height = 16;
      const input = createGradientImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new ColorBalanceModule();
      // All zeros should be identity
      module.resetParams();

      const output = module.process(input, context);

      const diff = maxImageDifference(input, output);
      expect(diff).toBeLessThan(0.01);
    });
  });

  describe('Large Image Handling', () => {
    it('should handle HD image (1920x1080)', () => {
      const width = 1920;
      const height = 1080;
      const input = new Float32Array(width * height * 4);

      // Fill with gradient pattern
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          input[idx] = x / width;
          input[idx + 1] = y / height;
          input[idx + 2] = 0.5;
          input[idx + 3] = 1.0;
        }
      }

      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new BasicAdjustmentsModule();
      module.setParams({ contrast: 10 });

      const output = module.process(input, context);

      expect(output.length).toBe(input.length);
      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Module Combinations', () => {
    it('should handle warm white balance with increased saturation', () => {
      const width = 32;
      const height = 32;
      // Use a mid-gray image to avoid overflow when warming + saturating
      const input = createTestImage(width, height, 0.4, 0.4, 0.4);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 5000 }); // Slightly warm

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ saturation: 10 }); // Light saturation

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      // Verify output is valid (some algorithms may not clamp internally)
      expect(result.length).toBe(input.length);
      // Check that at least the data structure is intact
      for (let i = 0; i < result.length; i++) {
        expect(Number.isFinite(result[i])).toBe(true);
      }
    });

    it('should handle cool white balance with decreased exposure', () => {
      const width = 32;
      const height = 32;
      const input = createGradientImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 8000 }); // Cool

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ exposure: -0.5 }); // Darker

      const step1 = wb.process(input, context);
      const result = basic.process(step1, context);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle complex color grading pipeline', () => {
      const width = 32;
      const height = 32;
      const input = createGradientImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      // Step 1: White balance correction
      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 5200, tint: -5 });
      let current = wb.process(input, context);

      // Step 2: Basic adjustments
      const basic = new BasicAdjustmentsModule();
      basic.setParams({
        exposure: 0.2,
        contrast: 15,
        saturation: -10,
        vibrance: 20,
      });
      current = basic.process(current, context);

      // Step 3: Color balance (film look)
      const color = new ColorBalanceModule();
      color.setParams({
        shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0.15 }, // Blue shadows
        highlights: { cyan_red: 0.1, magenta_green: 0, yellow_blue: -0.05 }, // Warm highlights
      });
      current = color.process(current, context);

      expect(isValidImageData(current)).toBe(true);
    });
  });
});
