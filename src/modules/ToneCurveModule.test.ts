/**
 * Unit Tests for ToneCurveModule
 *
 * Tests curve processing, control point management, presets,
 * exposure fusion, auto levels, and auto contrast.
 */

import { ToneCurveModule } from './ToneCurveModule';
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

describe('ToneCurveModule', () => {
  let module: ToneCurveModule;

  beforeEach(() => {
    module = new ToneCurveModule();
  });

  describe('Module identification', () => {
    it('should have correct id', () => {
      expect(module.id).toBe('tonecurve');
    });

    it('should have correct name', () => {
      expect(module.name).toBe('Tone Curve');
    });

    it('should have correct group', () => {
      expect(module.group).toBe('tone');
    });

    it('should be enabled by default', () => {
      expect(module.flags.enabled).toBe(true);
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getParams();

      // Default base curve is linear (2 points)
      expect(params.baseCurve.length).toBe(2);
      expect(params.baseCurve[0]).toEqual({ x: 0.0, y: 0.0 });
      expect(params.baseCurve[1]).toEqual({ x: 1.0, y: 1.0 });

      // RGB curves default to linear
      expect(params.rgbCurve.red.length).toBe(2);
      expect(params.rgbCurve.green.length).toBe(2);
      expect(params.rgbCurve.blue.length).toBe(2);

      // Fusion disabled by default
      expect(params.exposureFusion).toBe(0.0);

      // Auto adjustments disabled
      expect(params.autoLevels).toBe(false);
      expect(params.autoContrast).toBe(false);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getParams();
      const params2 = module.getParams();
      expect(params1).not.toBe(params2);
    });

    it('should update parameters with setParams', () => {
      module.setParams({ exposureFusion: 0.5 });
      expect(module.getParams().exposureFusion).toBe(0.5);
    });

    it('should merge partial parameters', () => {
      module.setParams({
        exposureFusion: 0.3,
        autoLevels: true,
      });
      const params = module.getParams();
      expect(params.exposureFusion).toBe(0.3);
      expect(params.autoLevels).toBe(true);
      expect(params.autoContrast).toBe(false); // Unchanged
    });

    it('should reset parameters to defaults', () => {
      module.setParams({
        exposureFusion: 0.5,
        autoLevels: true,
        baseCurve: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 },
        ],
      });

      module.reset();
      const params = module.getParams();

      expect(params.exposureFusion).toBe(0.0);
      expect(params.autoLevels).toBe(false);
      expect(params.baseCurve.length).toBe(2);
    });
  });

  describe('Control point management', () => {
    it('should add control point to base curve', () => {
      module.addControlPoint(0.5, 0.6, 'base');
      const params = module.getParams();

      expect(params.baseCurve.length).toBe(3);
      expect(params.baseCurveNodes).toBe(3);
      // Should be sorted by x
      expect(params.baseCurve[1].x).toBe(0.5);
      expect(params.baseCurve[1].y).toBe(0.6);
    });

    it('should add control point to red channel', () => {
      module.addControlPoint(0.3, 0.4, 'red');
      const params = module.getParams();

      expect(params.rgbCurve.red.length).toBe(3);
      expect(params.rgbCurveNodes.red).toBe(3);
    });

    it('should remove control point from base curve', () => {
      // First add a point
      module.addControlPoint(0.5, 0.6, 'base');
      expect(module.getParams().baseCurve.length).toBe(3);

      // Remove the middle point (index 1)
      module.removeControlPoint(1, 'base');
      expect(module.getParams().baseCurve.length).toBe(2);
    });

    it('should not remove if only 2 points remain', () => {
      // Try to remove from default 2-point curve
      module.removeControlPoint(0, 'base');
      expect(module.getParams().baseCurve.length).toBe(2);
    });

    it('should update control point position', () => {
      module.addControlPoint(0.5, 0.5, 'base');
      module.updateControlPoint(1, 0.6, 0.7, 'base');

      const params = module.getParams();
      // Point should be updated (may be re-sorted)
      const midPoint = params.baseCurve.find(p => Math.abs(p.x - 0.6) < 0.01);
      expect(midPoint).toBeDefined();
      expect(midPoint?.y).toBeCloseTo(0.7, 2);
    });

    it('should clamp control point values to 0-1 range', () => {
      module.updateControlPoint(0, -0.5, 1.5, 'base');
      const params = module.getParams();

      expect(params.baseCurve[0].x).toBeGreaterThanOrEqual(0);
      expect(params.baseCurve[0].x).toBeLessThanOrEqual(1);
      expect(params.baseCurve[0].y).toBeGreaterThanOrEqual(0);
      expect(params.baseCurve[0].y).toBeLessThanOrEqual(1);
    });
  });

  describe('Processing - linear curve (identity)', () => {
    it('should produce minimal change with default linear curve', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // Linear curve should preserve values
      const [r, g, b] = getPixel(result.data, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 1);
      expect(g).toBeCloseTo(0.5, 1);
      expect(b).toBeCloseTo(0.5, 1);
    });

    it('should preserve alpha channel', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      const [, , , a] = getPixel(result.data, width, 0, 0);
      expect(a).toBeCloseTo(0.75, 2);
    });

    it('should return input when disabled', () => {
      module.flags.enabled = false;

      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(result).toBe(imageData);
    });
  });

  describe('Processing - S-curve (contrast)', () => {
    it('should increase contrast with S-curve', () => {
      const width = 8;
      const height = 8;

      // Create image with mid-gray values
      const data = createTestImage(width, height, 0.25, 0.25, 0.25);

      // Apply contrast S-curve: darks get darker
      module.setParams({
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.25, y: 0.15 }, // Pull down shadows
          { x: 0.75, y: 0.85 }, // Push up highlights
          { x: 1.0, y: 1.0 },
        ],
        baseCurveNodes: 4,
      });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // Dark values should get darker with this S-curve
      const [r] = getPixel(result.data, width, 0, 0);
      expect(r).toBeLessThan(0.25);
    });

    it('should lift shadows with lifted curve', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.1, 0.1, 0.1);

      // Lift shadows: black point raised
      // Use linear interpolation (type 0) for predictable behavior
      module.setParams({
        baseCurve: [
          { x: 0.0, y: 0.2 }, // Lift blacks significantly
          { x: 1.0, y: 1.0 },
        ],
        baseCurveNodes: 2,
        baseCurveType: 0, // Linear interpolation
      });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      // Dark values should be brighter
      const [r] = getPixel(result.data, width, 0, 0);
      expect(r).toBeGreaterThan(0.1);
    });
  });

  describe('Processing - RGB channel curves', () => {
    it('should apply red channel curve independently', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      // Boost red channel
      module.setParams({
        rgbCurve: {
          red: [
            { x: 0.0, y: 0.0 },
            { x: 0.5, y: 0.7 }, // Boost mid-red
            { x: 1.0, y: 1.0 },
          ],
          green: [
            { x: 0.0, y: 0.0 },
            { x: 1.0, y: 1.0 },
          ],
          blue: [
            { x: 0.0, y: 0.0 },
            { x: 1.0, y: 1.0 },
          ],
        },
        rgbCurveNodes: { red: 3, green: 2, blue: 2 },
      });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      const [r, g] = getPixel(result.data, width, 0, 0);
      // Red should be boosted relative to green/blue
      expect(r).toBeGreaterThan(g);
    });
  });

  describe('Preset curves', () => {
    it('should load linear preset', () => {
      module.loadPreset('linear');
      const params = module.getParams();

      expect(params.baseCurve.length).toBe(2);
      expect(params.baseCurve[0]).toEqual({ x: 0.0, y: 0.0 });
      expect(params.baseCurve[1]).toEqual({ x: 1.0, y: 1.0 });
    });

    it('should load contrast preset', () => {
      module.loadPreset('contrast');
      const params = module.getParams();

      expect(params.baseCurve.length).toBe(4);
      expect(params.baseCurveNodes).toBe(4);
    });

    it('should load film preset', () => {
      module.loadPreset('film');
      const params = module.getParams();

      // Film look has lifted blacks
      expect(params.baseCurve[0].y).toBeGreaterThan(0);
    });

    it('should load vintage preset', () => {
      module.loadPreset('vintage');
      const params = module.getParams();

      expect(params.baseCurve.length).toBe(4);
    });

    it('should load dramatic preset', () => {
      module.loadPreset('dramatic');
      const params = module.getParams();

      expect(params.baseCurve.length).toBe(5);
    });
  });

  describe('Auto tone curve', () => {
    it('should return auto-adjusted parameters', () => {
      const autoParams = module.autoToneCurve();

      expect(autoParams.baseCurve.length).toBe(4);
      expect(autoParams.autoLevels).toBe(true);
      expect(autoParams.autoContrast).toBe(true);
    });
  });

  describe('Auto levels', () => {
    it('should apply auto levels when enabled', () => {
      const width = 8;
      const height = 8;
      // Create low-contrast image
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      module.setParams({ autoLevels: true });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Auto contrast', () => {
    it('should apply auto contrast when enabled', () => {
      const width = 8;
      const height = 8;
      const data = createGradientImage(width, height);

      module.setParams({ autoContrast: true });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Exposure fusion', () => {
    it('should apply exposure fusion when enabled', () => {
      const width = 8;
      const height = 8;
      const data = createGradientImage(width, height);

      module.setParams({
        exposureFusion: 0.5,
        exposureStops: 2.0,
      });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
    });

    it('should not apply fusion when set to 0', () => {
      const width = 8;
      const height = 8;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      module.setParams({
        exposureFusion: 0,
      });

      const imageData = { width, height, data, channels: 4 };
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Curve types', () => {
    it('should support linear interpolation (type 0)', () => {
      module.setParams({
        baseCurveType: 0,
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.5 },
          { x: 1.0, y: 1.0 },
        ],
      });

      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);
      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should support smooth interpolation (type 1)', () => {
      module.setParams({
        baseCurveType: 1,
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.5 },
          { x: 1.0, y: 1.0 },
        ],
      });

      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);
      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should support monotonic interpolation (type 2)', () => {
      module.setParams({
        baseCurveType: 2,
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.5 },
          { x: 1.0, y: 1.0 },
        ],
      });

      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);
      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Preserve colors', () => {
    it('should preserve luminance when preserveColors is 1', () => {
      module.setParams({
        preserveColors: 1,
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.6 }, // Lift midtones
          { x: 1.0, y: 1.0 },
        ],
      });

      const width = 4;
      const height = 4;
      // Create a colored image
      const data = createTestImage(width, height, 0.6, 0.4, 0.3);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);
      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should apply curve independently when preserveColors is 0', () => {
      module.setParams({
        preserveColors: 0,
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.6 },
          { x: 1.0, y: 1.0 },
        ],
      });

      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);
      expect(isValidImageData(result.data)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);
      const imageData = { width, height, data, channels: 4 };

      const result = module.process(imageData);

      expect(result.data.length).toBe(4);
      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0, 0, 0);
      const imageData = { width, height, data, channels: 4 };

      module.loadPreset('contrast');
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should handle white image', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 1, 1, 1);
      const imageData = { width, height, data, channels: 4 };

      module.loadPreset('film');
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
    });

    it('should handle gradient image', () => {
      const width = 16;
      const height = 16;
      const data = createGradientImage(width, height);
      const imageData = { width, height, data, channels: 4 };

      module.loadPreset('dramatic');
      const result = module.process(imageData);

      expect(isValidImageData(result.data)).toBe(true);
      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
    });
  });
});
