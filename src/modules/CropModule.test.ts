/**
 * Unit Tests for CropModule
 *
 * Tests cropping, aspect ratios, transforms (flip/rotate),
 * preview mode, and auto-crop functionality.
 */

import { CropModule, ASPECT_RATIO_VALUES } from './CropModule';
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

describe('CropModule', () => {
  let module: CropModule;

  beforeEach(() => {
    module = new CropModule();
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('crop');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('Crop');
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();
      expect(params.enabled).toBe(true);
      expect(params.x).toBe(0.0);
      expect(params.y).toBe(0.0);
      expect(params.width).toBe(1.0);
      expect(params.height).toBe(1.0);
      expect(params.aspectRatio).toBe('original');
      expect(params.angle).toBe(0.0);
      expect(params.flipHorizontal).toBe(false);
      expect(params.flipVertical).toBe(false);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setParams', () => {
      // Need to also set width/height smaller to allow x/y offset
      module.setParams({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
      const params = module.getParams();
      expect(params.x).toBe(0.1);
      expect(params.y).toBe(0.1);
    });

    it('should clamp x and y to valid bounds', () => {
      module.setParams({ x: 0.9, width: 0.5 }); // Would exceed bounds
      const params = module.getParams();
      // x should be clamped so x + width <= 1.0
      expect(params.x + params.width).toBeLessThanOrEqual(1.0);
    });

    it('should enforce minimum crop size', () => {
      module.setParams({ width: 0, height: 0 });
      const params = module.getParams();
      expect(params.width).toBeGreaterThanOrEqual(0.01);
      expect(params.height).toBeGreaterThanOrEqual(0.01);
    });

    it('should reset parameters to defaults', () => {
      module.setParams({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
      module.resetParams();
      const params = module.getParams();
      expect(params.x).toBe(0.0);
      expect(params.y).toBe(0.0);
      expect(params.width).toBe(1.0);
      expect(params.height).toBe(1.0);
      expect(params.enabled).toBe(false); // Reset to disabled
    });
  });

  describe('Aspect ratio handling', () => {
    it('should return null for free aspect ratio', () => {
      module.setParams({ aspectRatio: 'free' });
      expect(module.getAspectRatioValue()).toBeNull();
    });

    it('should return correct value for 1:1', () => {
      module.setParams({ aspectRatio: '1:1' });
      expect(module.getAspectRatioValue()).toBe(1.0);
    });

    it('should return correct value for 16:9', () => {
      module.setParams({ aspectRatio: '16:9' });
      expect(module.getAspectRatioValue()).toBeCloseTo(16 / 9, 4);
    });

    it('should return correct value for 3:2', () => {
      module.setParams({ aspectRatio: '3:2' });
      expect(module.getAspectRatioValue()).toBeCloseTo(3 / 2, 4);
    });

    it('should return custom aspect ratio value', () => {
      module.setParams({
        aspectRatio: 'custom',
        customAspectWidth: 5,
        customAspectHeight: 4,
      });
      expect(module.getAspectRatioValue()).toBeCloseTo(5 / 4, 4);
    });

    it('should return original aspect ratio when set', () => {
      module.setOriginalDimensions(1920, 1080);
      module.setParams({ aspectRatio: 'original' });
      expect(module.getAspectRatioValue()).toBeCloseTo(1920 / 1080, 4);
    });

    it('should have all aspect ratio constants defined', () => {
      expect(ASPECT_RATIO_VALUES['1:1']).toBe(1.0);
      expect(ASPECT_RATIO_VALUES['4:3']).toBeCloseTo(4 / 3);
      expect(ASPECT_RATIO_VALUES['3:2']).toBeCloseTo(3 / 2);
      expect(ASPECT_RATIO_VALUES['16:9']).toBeCloseTo(16 / 9);
    });
  });

  describe('Crop state checking', () => {
    it('should return false for full frame (no crop)', () => {
      module.setParams({
        enabled: true,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
      });
      expect(module.isCropped()).toBe(false);
    });

    it('should return true when cropped', () => {
      module.setParams({
        enabled: true,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
      });
      expect(module.isCropped()).toBe(true);
    });

    it('should return false when disabled', () => {
      module.setParams({
        enabled: false,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
      });
      expect(module.isCropped()).toBe(false);
    });
  });

  describe('Original dimensions', () => {
    it('should store and retrieve original dimensions', () => {
      module.setOriginalDimensions(4000, 3000);
      const dims = module.getOriginalDimensions();
      expect(dims.width).toBe(4000);
      expect(dims.height).toBe(3000);
    });
  });

  describe('Output dimensions', () => {
    it('should return original dimensions when disabled', () => {
      module.setParams({ enabled: false });
      const dims = module.getOutputDimensions(1920, 1080);
      expect(dims.width).toBe(1920);
      expect(dims.height).toBe(1080);
    });

    it('should return cropped dimensions when enabled', () => {
      module.setParams({
        enabled: true,
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      });
      const dims = module.getOutputDimensions(1920, 1080);
      expect(dims.width).toBe(960);
      expect(dims.height).toBe(540);
    });
  });

  describe('Processing - disabled', () => {
    it('should return input unchanged when disabled', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({ enabled: false });
      const output = module.process(input, context);

      expect(output).toBe(input); // Same reference
    });
  });

  describe('Processing - cropping', () => {
    it('should crop image to specified region', () => {
      const width = 8;
      const height = 8;
      const input = createGradientImage(width, height);
      const context = { width, height, channels: 4 };

      // Crop to center 50%
      module.setParams({
        enabled: true,
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
        angle: 0,
        flipHorizontal: false,
        flipVertical: false,
      });

      const output = module.process(input, context);

      // Output should be 4x4 (half of 8x8)
      expect(output.length).toBe(4 * 4 * 4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle full frame (no actual crop)', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
        angle: 0,
        flipHorizontal: false,
        flipVertical: false,
      });

      const output = module.process(input, context);

      // Should be same size
      expect(output.length).toBe(input.length);
      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Processing - flip horizontal', () => {
    it('should flip image horizontally', () => {
      const width = 4;
      const height = 2;
      const input = createGradientImage(width, height);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        flipHorizontal: true,
        flipVertical: false,
        angle: 0,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
      });

      const output = module.process(input, context);

      expect(output.length).toBe(input.length);
      expect(isValidImageData(output)).toBe(true);

      // In gradient image, left pixels (x=0) are dark (r=0)
      // After horizontal flip, right pixels should be dark
      const [leftR] = getPixel(output, width, 0, 0);
      const [rightR] = getPixel(output, width, width - 1, 0);

      // Left should now have what was right (higher value)
      expect(leftR).toBeGreaterThan(rightR);
    });
  });

  describe('Processing - flip vertical', () => {
    it('should flip image vertically', () => {
      const width = 2;
      const height = 4;
      const input = createGradientImage(width, height);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        flipHorizontal: false,
        flipVertical: true,
        angle: 0,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
      });

      const output = module.process(input, context);

      expect(output.length).toBe(input.length);
      expect(isValidImageData(output)).toBe(true);

      // In gradient image, top pixels (y=0) have g=0
      // After vertical flip, bottom pixels should have g=0
      const [, topG] = getPixel(output, width, 0, 0);
      const [, bottomG] = getPixel(output, width, 0, height - 1);

      // Top should now have what was bottom (higher value)
      expect(topG).toBeGreaterThan(bottomG);
    });
  });

  describe('Processing - rotation', () => {
    it('should rotate image by specified angle', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        angle: 15, // 15 degrees
        flipHorizontal: false,
        flipVertical: false,
        expandCanvas: true,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
      });

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Rotated image with expanded canvas should be larger
      expect(output.length).toBeGreaterThanOrEqual(input.length);
    });

    it('should handle negative rotation angles', () => {
      const width = 8;
      const height = 8;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        angle: -10,
        expandCanvas: false,
        x: 0,
        y: 0,
        width: 1.0,
        height: 1.0,
      });

      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
    });
  });

  describe('Rotated dimensions', () => {
    it('should calculate expanded dimensions for rotation', () => {
      module.setParams({ expandCanvas: true });
      const dims = module.getRotatedDimensions(100, 100, 45);

      // 45 degree rotation of square should result in larger dimensions
      expect(dims.width).toBeGreaterThan(100);
      expect(dims.height).toBeGreaterThan(100);
    });

    it('should return original dimensions when expandCanvas is false', () => {
      module.setParams({ expandCanvas: false });
      const dims = module.getRotatedDimensions(100, 100, 45);

      expect(dims.width).toBe(100);
      expect(dims.height).toBe(100);
    });

    it('should return original dimensions for 0 rotation', () => {
      module.setParams({ expandCanvas: true });
      const dims = module.getRotatedDimensions(100, 100, 0);

      expect(dims.width).toBe(100);
      expect(dims.height).toBe(100);
    });
  });

  describe('Center crop', () => {
    it('should center crop to target aspect ratio (wider image)', () => {
      module.centerCrop(1.0, 1920, 1080); // Target 1:1 from 16:9

      const params = module.getParams();
      expect(params.height).toBeCloseTo(1.0, 2);
      expect(params.width).toBeLessThan(1.0);
      // Should be centered
      expect(params.x).toBeGreaterThan(0);
    });

    it('should center crop to target aspect ratio (taller image)', () => {
      module.centerCrop(16 / 9, 1080, 1920); // Target 16:9 from 9:16

      const params = module.getParams();
      expect(params.width).toBeCloseTo(1.0, 2);
      expect(params.height).toBeLessThan(1.0);
      // Should be centered
      expect(params.y).toBeGreaterThan(0);
    });

    it('should not crop if already at target aspect ratio', () => {
      module.centerCrop(16 / 9, 1920, 1080);

      const params = module.getParams();
      expect(params.x).toBeCloseTo(0, 2);
      expect(params.y).toBeCloseTo(0, 2);
      expect(params.width).toBeCloseTo(1.0, 2);
      expect(params.height).toBeCloseTo(1.0, 2);
    });
  });

  describe('Uncrop', () => {
    it('should reset to full image', () => {
      module.setParams({
        enabled: true,
        x: 0.2,
        y: 0.2,
        width: 0.5,
        height: 0.5,
      });

      module.uncrop();
      const params = module.getParams();

      expect(params.x).toBe(0.0);
      expect(params.y).toBe(0.0);
      expect(params.width).toBe(1.0);
      expect(params.height).toBe(1.0);
      expect(params.enabled).toBe(false);
    });
  });

  describe('Preview mode', () => {
    it('should track preview mode state', () => {
      expect(module.isInPreviewMode()).toBe(false);

      module.enterPreviewMode();
      expect(module.isInPreviewMode()).toBe(true);
    });

    it('should save applied params when entering preview', () => {
      module.setParams({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
      module.enterPreviewMode();

      const applied = module.getAppliedParams();
      expect(applied).not.toBeNull();
      expect(applied?.x).toBe(0.1);
    });

    it('should commit changes on apply', () => {
      module.enterPreviewMode();
      module.setParams({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
      module.applyChanges();

      expect(module.isInPreviewMode()).toBe(false);
      const applied = module.getAppliedParams();
      expect(applied?.x).toBe(0.2);
    });

    it('should revert changes on cancel', () => {
      module.setParams({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
      module.enterPreviewMode();
      module.setParams({ x: 0.3, y: 0.3, width: 0.5, height: 0.5 });
      module.cancelChanges();

      expect(module.isInPreviewMode()).toBe(false);
      const params = module.getParams();
      expect(params.x).toBe(0.1);
    });

    it('should reset after apply', () => {
      module.setParams({ x: 0.2, angle: 10, flipHorizontal: true });
      module.resetAfterApply();

      const params = module.getParams();
      expect(params.x).toBe(0.0);
      expect(params.angle).toBe(0.0);
      expect(params.flipHorizontal).toBe(false);
    });
  });

  describe('Apply aspect ratio constraint', () => {
    it('should apply constraint with free ratio', () => {
      module.setParams({ aspectRatio: 'free' });
      const result = module.applyCropAspectRatio(0.1, 0.1, 0.5, 0.3);

      // Should pass through unchanged
      expect(result.x).toBe(0.1);
      expect(result.y).toBe(0.1);
      expect(result.width).toBe(0.5);
      expect(result.height).toBe(0.3);
    });

    it('should constrain to 1:1 aspect ratio', () => {
      module.setParams({ aspectRatio: '1:1' });
      const result = module.applyCropAspectRatio(0, 0, 0.5, 0.3);

      // Width/height should be equal
      expect(result.width).toBeCloseTo(result.height, 2);
    });
  });

  describe('Auto-crop for rotation', () => {
    it('should return full frame for 0 rotation', () => {
      const crop = module.calculateAutoCropForRotation(100, 100, 0);

      expect(crop.x).toBe(0);
      expect(crop.y).toBe(0);
      expect(crop.width).toBe(1.0);
      expect(crop.height).toBe(1.0);
    });

    it('should calculate inscribed rectangle for rotation', () => {
      // Use a larger angle to ensure visible cropping
      const crop = module.calculateAutoCropForRotation(100, 100, 30);

      // Should be smaller than full frame for significant rotation
      expect(crop.width).toBeLessThanOrEqual(1.0);
      expect(crop.height).toBeLessThanOrEqual(1.0);
      // Should have valid values
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({ enabled: true, x: 0, y: 0, width: 1.0, height: 1.0 });
      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle very small crop region', () => {
      const width = 100;
      const height = 100;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        x: 0.45,
        y: 0.45,
        width: 0.1,
        height: 0.1,
        angle: 0,
      });
      const output = module.process(input, context);

      // Should output 10x10 pixels
      expect(output.length).toBe(10 * 10 * 4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle combined transform and crop', () => {
      const width = 16;
      const height = 16;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = { width, height, channels: 4 };

      module.setParams({
        enabled: true,
        flipHorizontal: true,
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
        angle: 0,
      });

      const output = module.process(input, context);

      // Should be 8x8 after crop
      expect(output.length).toBe(8 * 8 * 4);
      expect(isValidImageData(output)).toBe(true);
    });
  });
});
