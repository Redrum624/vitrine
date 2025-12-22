/**
 * Unit Tests for ExposureModule
 *
 * Tests parameter management, exposure processing, black level adjustment,
 * and auto-deflicker functionality.
 */

import { ExposureModule } from './ExposureModule';
import {
  createTestImage,
  createGradientImage,
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

describe('ExposureModule', () => {
  let module: ExposureModule;

  beforeEach(() => {
    module = new ExposureModule();
  });

  describe('Module identification', () => {
    it('should return correct id', () => {
      expect(module.getId()).toBe('exposure');
    });

    it('should return correct name', () => {
      expect(module.getName()).toBe('Exposure');
    });

    it('should have correct metadata', () => {
      expect(module.metadata.description).toBe('Exposure and black level adjustments');
      expect(module.metadata.version).toBe(6);
    });
  });

  describe('Parameter management', () => {
    it('should return default parameters', () => {
      const params = module.getCurrentParams();
      expect(params.mode).toBe('manual');
      expect(params.black).toBe(0.0);
      expect(params.exposure).toBe(0.0);
      expect(params.deflicker_percentile).toBe(50.0);
      expect(params.deflicker_target_level).toBe(-4.0);
      expect(params.compensate_exposure_bias).toBe(false);
    });

    it('should return a copy of parameters (immutability)', () => {
      const params1 = module.getCurrentParams();
      const params2 = module.getCurrentParams();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });

    it('should update parameters with setCurrentParams', () => {
      module.setCurrentParams({ exposure: 0.5 });
      expect(module.getCurrentParams().exposure).toBe(0.5);
      // Other params should remain unchanged
      expect(module.getCurrentParams().black).toBe(0.0);
    });

    it('should merge partial parameters', () => {
      module.setCurrentParams({ exposure: 0.3, black: 0.1 });
      const params = module.getCurrentParams();
      expect(params.exposure).toBe(0.3);
      expect(params.black).toBe(0.1);
      expect(params.mode).toBe('manual');
    });

    it('should reset parameters to defaults', () => {
      module.setCurrentParams({ exposure: 1.0, black: 0.5 });
      module.resetParams();
      const params = module.getCurrentParams();
      expect(params.exposure).toBe(0.0);
      expect(params.black).toBe(0.0);
    });

    it('should support getParams for pipeline compatibility', () => {
      module.setCurrentParams({ exposure: 0.5 });
      const params = module.getParams();
      expect(params.exposure).toBe(0.5);
    });
  });

  describe('Parameter validation', () => {
    it('should clamp exposure to valid range', () => {
      module.setCurrentParams({ exposure: 2.0 }); // Above max
      expect(module.getCurrentParams().exposure).toBe(1.0);

      module.setCurrentParams({ exposure: -2.0 }); // Below min
      expect(module.getCurrentParams().exposure).toBe(-1.0);
    });

    it('should clamp black level to valid range', () => {
      module.setCurrentParams({ black: 2.0 }); // Above max
      expect(module.getCurrentParams().black).toBe(1.0);

      module.setCurrentParams({ black: -2.0 }); // Below min
      expect(module.getCurrentParams().black).toBe(-1.0);
    });

    it('should validate mode parameter', () => {
      module.setCurrentParams({ mode: 'automatic' });
      expect(module.getCurrentParams().mode).toBe('automatic');

      module.setCurrentParams({ mode: 'manual' });
      expect(module.getCurrentParams().mode).toBe('manual');
    });

    it('should convert boolean for compensate_exposure_bias', () => {
      module.setCurrentParams({ compensate_exposure_bias: true });
      expect(module.getCurrentParams().compensate_exposure_bias).toBe(true);
    });
  });

  describe('Parameter constraints', () => {
    it('should provide valid constraint values', () => {
      const constraints = module.getParamConstraints();

      expect(constraints.exposure.min).toBe(-1.0);
      expect(constraints.exposure.max).toBe(1.0);
      expect(constraints.exposure.default).toBe(0.0);

      expect(constraints.black.min).toBe(-1.0);
      expect(constraints.black.max).toBe(1.0);

      expect(constraints.deflicker_percentile.min).toBe(0.0);
      expect(constraints.deflicker_percentile.max).toBe(100.0);
    });
  });

  describe('Processing with neutral parameters', () => {
    it('should produce minimal change with exposure at 0', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Default params should be neutral
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
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
    it('should increase brightness with positive exposure', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.25, 0.25, 0.25);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: 1.0 }); // +1 EV = 2x brightness
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // 0.25 * 2^1 = 0.5
      expect(r).toBeCloseTo(0.5, 2);
      expect(g).toBeCloseTo(0.5, 2);
      expect(b).toBeCloseTo(0.5, 2);
    });

    it('should decrease brightness with negative exposure', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: -1.0 }); // -1 EV = 0.5x brightness
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // 0.5 * 2^-1 = 0.25
      expect(r).toBeCloseTo(0.25, 2);
      expect(g).toBeCloseTo(0.25, 2);
      expect(b).toBeCloseTo(0.25, 2);
    });

    it('should apply 2^x multiplier correctly', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.1, 0.1, 0.1);
      const context = createProcessingContext(width, height);

      // Test different exposure values
      const testCases = [
        { exposure: 0.5, expected: 0.1 * Math.pow(2, 0.5) },
        { exposure: -0.5, expected: 0.1 * Math.pow(2, -0.5) },
      ];

      for (const { exposure, expected } of testCases) {
        module.setCurrentParams({ exposure });
        const output = module.process(input, context);
        const [r] = getPixel(output, width, 0, 0);
        expect(r).toBeCloseTo(expected, 2);
      }
    });
  });

  describe('Black level adjustment', () => {
    it('should subtract black level from pixels', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ black: 0.1 }); // Subtract 0.1
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // 0.5 - 0.1 = 0.4
      expect(r).toBeCloseTo(0.4, 2);
      expect(g).toBeCloseTo(0.4, 2);
      expect(b).toBeCloseTo(0.4, 2);
    });

    it('should clamp negative values to 0', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.1, 0.1, 0.1);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ black: 0.2 }); // Subtract more than pixel value
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      // max(0, 0.1 - 0.2) = 0
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });
  });

  describe('Combined adjustments', () => {
    it('should apply black level before exposure', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      // Black level: 0.5 - 0.1 = 0.4
      // Exposure: 0.4 * 2^0.5 = ~0.566
      module.setCurrentParams({ black: 0.1, exposure: 0.5 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r] = getPixel(output, width, 0, 0);
      const expected = 0.4 * Math.pow(2, 0.5);
      expect(r).toBeCloseTo(expected, 2);
    });
  });

  describe('Auto exposure', () => {
    it('should return auto exposure parameters', () => {
      const autoParams = module.autoExposure();

      expect(autoParams.exposure).toBe(0.5);
      expect(autoParams.black).toBe(0.01);
      expect(autoParams.mode).toBe('manual');
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const input = createTestImage(width, height, 0.5, 0.5, 0.5);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: 0.5 });
      const output = module.process(input, context);

      expect(output.length).toBe(4);
      expect(isValidImageData(output)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0, 0, 0);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: 1.0 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      // Black stays black even with exposure increase
      const [r, g, b] = getPixel(output, width, 0, 0);
      expect(r).toBeCloseTo(0, 2);
      expect(g).toBeCloseTo(0, 2);
      expect(b).toBeCloseTo(0, 2);
    });

    it('should clamp bright values to 1.0', () => {
      const width = 4;
      const height = 4;
      const input = createTestImage(width, height, 0.9, 0.9, 0.9);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: 1.0 }); // Would be 1.8 without clamping
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      const [r, g, b] = getPixel(output, width, 0, 0);
      expect(r).toBe(1.0);
      expect(g).toBe(1.0);
      expect(b).toBe(1.0);
    });

    it('should handle gradient image', () => {
      const width = 8;
      const height = 8;
      const input = createGradientImage(width, height);
      const context = createProcessingContext(width, height);

      module.setCurrentParams({ exposure: 0.3 });
      const output = module.process(input, context);

      expect(isValidImageData(output)).toBe(true);
      expect(output.length).toBe(input.length);
    });
  });

  describe('processWithContext', () => {
    it('should process with full context object', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const processingContext = {
        width,
        height,
        channels: 4,
        data,
        roi: { x: 0, y: 0, width, height },
      };

      const result = module.processWithContext(processingContext, {
        mode: 'manual',
        black: 0,
        exposure: 0.5,
        deflicker_percentile: 50,
        deflicker_target_level: -4,
        compensate_exposure_bias: false,
      });

      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
      expect(result.data.length).toBe(data.length);
    });
  });

  describe('processWithAutoDeflicker', () => {
    it('should return computed exposure in automatic mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const processingContext = {
        width,
        height,
        channels: 4,
        data,
        roi: { x: 0, y: 0, width, height },
      };

      const { output, computedExposure } = module.processWithAutoDeflicker(processingContext, {
        mode: 'automatic',
        black: 0,
        exposure: 0,
        deflicker_percentile: 50,
        deflicker_target_level: -4,
        compensate_exposure_bias: false,
      });

      expect(output).toBeDefined();
      expect(typeof computedExposure).toBe('number');
    });

    it('should return 0 computed exposure in manual mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const processingContext = {
        width,
        height,
        channels: 4,
        data,
        roi: { x: 0, y: 0, width, height },
      };

      const { computedExposure } = module.processWithAutoDeflicker(processingContext, {
        mode: 'manual',
        black: 0,
        exposure: 0.5,
        deflicker_percentile: 50,
        deflicker_target_level: -4,
        compensate_exposure_bias: false,
      });

      expect(computedExposure).toBe(0);
    });
  });
});
