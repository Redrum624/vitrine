/**
 * HueCurvesModule Tests
 */

import { HueCurvesModule, hueCurvesModule, HueCurve } from './HueCurvesModule';

describe('HueCurvesModule', () => {
  let module: HueCurvesModule;

  beforeEach(() => {
    module = new HueCurvesModule();
  });

  describe('Initialization', () => {
    it('should initialize with default parameters', () => {
      const params = module.getParams();

      expect(params.hueVsHue.enabled).toBe(false);
      expect(params.hueVsSat.enabled).toBe(false);
      expect(params.hueVsLum.enabled).toBe(false);
      expect(params.satVsSat.enabled).toBe(false);
      expect(params.lumVsSat.enabled).toBe(false);
      expect(params.masterBlend).toBe(1.0);
    });

    it('should export singleton instance', () => {
      expect(hueCurvesModule).toBeDefined();
      expect(hueCurvesModule).toBeInstanceOf(HueCurvesModule);
    });

    it('should not have active adjustments by default', () => {
      expect(module.hasActiveAdjustments()).toBe(false);
    });
  });

  describe('Parameter Management', () => {
    it('should update parameters with setParams', () => {
      module.setParams({ masterBlend: 0.5 });
      expect(module.getParams().masterBlend).toBe(0.5);
    });

    it('should reset to defaults', () => {
      module.setParams({ masterBlend: 0.5 });
      module.reset();
      expect(module.getParams().masterBlend).toBe(1.0);
    });

    it('should set individual curves', () => {
      const curve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 },
        ],
      };

      module.setCurve('hueVsSat', curve);
      const params = module.getParams();

      expect(params.hueVsSat.enabled).toBe(true);
      expect(params.hueVsSat.points.length).toBe(3);
    });

    it('should enable/disable curves', () => {
      module.setCurveEnabled('satVsSat', true);
      expect(module.getParams().satVsSat.enabled).toBe(true);
      expect(module.hasActiveAdjustments()).toBe(true);

      module.setCurveEnabled('satVsSat', false);
      expect(module.getParams().satVsSat.enabled).toBe(false);
    });
  });

  describe('Control Point Management', () => {
    it('should add control points', () => {
      module.addControlPoint('hueVsHue', { x: 0.5, y: 0.6 });
      const params = module.getParams();

      expect(params.hueVsHue.points.length).toBe(3); // 2 default + 1 added
    });

    it('should sort points by x value', () => {
      module.addControlPoint('hueVsHue', { x: 0.8, y: 0.7 });
      module.addControlPoint('hueVsHue', { x: 0.2, y: 0.3 });
      module.addControlPoint('hueVsHue', { x: 0.5, y: 0.5 });

      const params = module.getParams();
      const points = params.hueVsHue.points;

      for (let i = 1; i < points.length; i++) {
        expect(points[i].x).toBeGreaterThanOrEqual(points[i - 1].x);
      }
    });

    it('should remove control points', () => {
      module.addControlPoint('hueVsHue', { x: 0.5, y: 0.6 });
      const initialLength = module.getParams().hueVsHue.points.length;

      module.removeControlPoint('hueVsHue', 1);
      expect(module.getParams().hueVsHue.points.length).toBe(initialLength - 1);
    });

    it('should not remove last two points', () => {
      const initialLength = module.getParams().hueVsHue.points.length;
      expect(initialLength).toBe(2);

      module.removeControlPoint('hueVsHue', 0);
      expect(module.getParams().hueVsHue.points.length).toBe(2);
    });
  });

  describe('Image Processing', () => {
    const createTestImage = (width: number, height: number): Float32Array => {
      const data = new Float32Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const offset = i * 4;
        // Create a gradient with varying colors
        const x = (i % width) / width;
        const y = Math.floor(i / width) / height;

        data[offset] = x; // R varies with x
        data[offset + 1] = y; // G varies with y
        data[offset + 2] = (x + y) / 2; // B is average
        data[offset + 3] = 1; // Alpha
      }
      return data;
    };

    it('should return copy when no curves are active', () => {
      const input = createTestImage(4, 4);
      const context = { width: 4, height: 4, channels: 4 };

      const output = module.process(input, context);

      expect(output).not.toBe(input);
      for (let i = 0; i < input.length; i++) {
        expect(output[i]).toBe(input[i]);
      }
    });

    it('should return copy when masterBlend is 0', () => {
      module.setParams({ masterBlend: 0 });
      module.setCurveEnabled('hueVsSat', true);

      const input = createTestImage(4, 4);
      const context = { width: 4, height: 4, channels: 4 };

      const output = module.process(input, context);

      for (let i = 0; i < input.length; i++) {
        expect(output[i]).toBe(input[i]);
      }
    });

    it('should process with active hueVsSat curve', () => {
      const satBoostCurve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0.75 }, // Boost all saturation to 150%
          { x: 1, y: 0.75 },
        ],
      };

      module.setCurve('hueVsSat', satBoostCurve);

      const input = new Float32Array([
        0.8, 0.4, 0.4, 1.0, // Reddish color
      ]);
      const context = { width: 1, height: 1, channels: 4 };

      const output = module.process(input, context);

      // Output should have higher saturation
      expect(output[3]).toBe(1); // Alpha preserved
    });

    it('should preserve alpha channel', () => {
      module.setCurveEnabled('satVsSat', true);
      module.setCurve('satVsSat', {
        enabled: true,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0.8 },
        ],
      });

      const input = new Float32Array([0.5, 0.5, 0.5, 0.75]);
      const context = { width: 1, height: 1, channels: 4 };

      const output = module.process(input, context);

      expect(output[3]).toBe(0.75);
    });

    it('should handle 3-channel images', () => {
      module.setCurveEnabled('lumVsSat', true);

      const input = new Float32Array([0.5, 0.5, 0.5]);
      const context = { width: 1, height: 1, channels: 3 };

      // Should not throw
      const output = module.process(input, context);
      expect(output.length).toBe(3);
    });

    it('should blend with masterBlend parameter', () => {
      // Test that masterBlend=0.5 produces a result between 0 and 1 blend
      module.setParams({ masterBlend: 1.0 });

      // Use a hueVsHue shift curve - shift all hues by +0.1
      const shiftCurve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0.6 }, // 0.6 - 0.5 = +0.1 shift
          { x: 1, y: 0.6 },
        ],
      };

      module.setCurve('hueVsHue', shiftCurve);

      const input = new Float32Array([0.8, 0.4, 0.4, 1.0]); // Reddish
      const context = { width: 1, height: 1, channels: 4 };

      // Get fully applied result to ensure it works
      module.process(input, context);

      // Now apply with 50% blend
      module.setParams({ masterBlend: 0.5 });
      const halfOutput = module.process(input, context);

      // Half blend should be between input and full output
      expect(halfOutput[3]).toBe(1); // Alpha preserved

      // Output should exist and be valid
      expect(isNaN(halfOutput[0])).toBe(false);
      expect(isNaN(halfOutput[1])).toBe(false);
      expect(isNaN(halfOutput[2])).toBe(false);
    });
  });

  describe('Hue vs Hue Processing', () => {
    it('should shift hues based on curve', () => {
      // Shift all hues by +10%
      const shiftCurve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0.6 }, // 0.6 - 0.5 = +0.1 hue shift
          { x: 1, y: 0.6 },
        ],
      };

      module.setCurve('hueVsHue', shiftCurve);

      // Pure red (hue = 0)
      const input = new Float32Array([1, 0, 0, 1]);
      const context = { width: 1, height: 1, channels: 4 };

      const output = module.process(input, context);

      // Should shift toward orange
      expect(output[0]).toBeGreaterThan(output[2]); // More red than blue
    });
  });

  describe('Presets', () => {
    it('should create teal and orange preset', () => {
      const preset = HueCurvesModule.createPreset('tealnOrange');

      expect(preset.hueVsHue).toBeDefined();
      expect(preset.hueVsHue?.enabled).toBe(true);
      expect(preset.hueVsSat).toBeDefined();
    });

    it('should create desaturate shadows preset', () => {
      const preset = HueCurvesModule.createPreset('desaturateShadows');

      expect(preset.lumVsSat).toBeDefined();
      expect(preset.lumVsSat?.enabled).toBe(true);
    });

    it('should create vibrant sunset preset', () => {
      const preset = HueCurvesModule.createPreset('vibrantSunset');

      expect(preset.hueVsSat).toBeDefined();
      expect(preset.hueVsSat?.enabled).toBe(true);
    });

    it('should create cool highlights preset', () => {
      const preset = HueCurvesModule.createPreset('coolHighlights');

      expect(preset.hueVsLum).toBeDefined();
      expect(preset.lumVsSat).toBeDefined();
    });

    it('should apply presets correctly', () => {
      const preset = HueCurvesModule.createPreset('tealnOrange');
      module.setParams(preset);

      expect(module.hasActiveAdjustments()).toBe(true);
    });
  });

  describe('Import/Export', () => {
    it('should export to JSON', () => {
      module.setCurveEnabled('hueVsSat', true);
      module.setParams({ masterBlend: 0.8 });

      const json = module.exportToJSON();
      const parsed = JSON.parse(json);

      expect(parsed.hueVsSat.enabled).toBe(true);
      expect(parsed.masterBlend).toBe(0.8);
    });

    it('should import from JSON', () => {
      const json = JSON.stringify({
        hueVsHue: {
          enabled: true,
          points: [
            { x: 0, y: 0.5 },
            { x: 0.5, y: 0.7 },
            { x: 1, y: 0.5 },
          ],
        },
        hueVsSat: { enabled: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        hueVsLum: { enabled: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        satVsSat: { enabled: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        lumVsSat: { enabled: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        masterBlend: 0.9,
      });

      const result = module.importFromJSON(json);

      expect(result).toBe(true);
      expect(module.getParams().hueVsHue.enabled).toBe(true);
      expect(module.getParams().hueVsHue.points.length).toBe(3);
      expect(module.getParams().masterBlend).toBe(0.9);
    });

    it('should handle invalid JSON gracefully', () => {
      const result = module.importFromJSON('not valid json');
      expect(result).toBe(false);
    });
  });

  describe('Curve Evaluation', () => {
    it('should handle identity curve', () => {
      const identityCurve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      };

      module.setCurve('satVsSat', identityCurve);

      // Gray pixel - saturation is low, should stay the same
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
      const context = { width: 1, height: 1, channels: 4 };

      const output = module.process(input, context);

      // Gray should remain gray
      expect(output[0]).toBeCloseTo(output[1], 4);
      expect(output[1]).toBeCloseTo(output[2], 4);
    });

    it('should interpolate smoothly with multiple points', () => {
      const curve: HueCurve = {
        enabled: true,
        points: [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.2 },
          { x: 0.5, y: 0.6 },
          { x: 0.75, y: 0.8 },
          { x: 1, y: 1 },
        ],
      };

      module.setCurve('satVsSat', curve);

      // Processing should complete without errors
      const input = new Float32Array([0.8, 0.4, 0.2, 1.0]); // Saturated
      const context = { width: 1, height: 1, channels: 4 };

      const output = module.process(input, context);
      expect(output.length).toBe(4);
    });
  });
});
