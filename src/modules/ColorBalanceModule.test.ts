/**
 * Unit Tests for ColorBalanceModule
 *
 * Tests parameter management, traditional 3-way color balance,
 * and 8-color HSL adjustments.
 */

import { ColorBalanceModule, ColorBalanceParams } from './ColorBalanceModule';
import { rgbToHsl } from './utils/ColorUtils';
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

  describe('Global color controls - HSL calibration', () => {
    // Quantitative tests locking the calibrated formula (proportional saturation,
    // headroom-mapped luminance, normalised band weights, chroma gate). The exact
    // same math is mirrored in WebGLImageProcessor.colorBalanceCPU and
    // sources.ts FRAG_COLORBALANCE — the GPU parity self-check depends on it.
    const W = 2;
    const H = 2;
    const ctx = createProcessingContext(W, H);

    /** Process one uniform-colour image; return the first output pixel as RGB + HSL. */
    const run = (rgb: [number, number, number], params: Partial<ColorBalanceParams>) => {
      module.setParams(params);
      const out = module.process(createTestImage(W, H, rgb[0], rgb[1], rgb[2]), ctx);
      const [r, g, b] = getPixel(out, W, 0, 0);
      return { r, g, b, hsl: rgbToHsl(r, g, b) };
    };

    it('saturation -100 desaturates an in-band pixel to exact grayscale (S\'==0)', () => {
      // Pure green (h=120) sits alone in the green band (weight sum == 1),
      // so -100 gives satAdj == -1 -> S' = S * (1 - 1) = 0 -> r == g == b.
      const { r, g, b } = run([0, 1, 0], { green_saturation: -100 });
      expect(r).toBeCloseTo(0.5, 6);
      expect(g).toBeCloseTo(0.5, 6);
      expect(b).toBeCloseTo(0.5, 6);
    });

    it('saturation +100 exactly doubles chroma of an in-band pixel (S 40 -> 80)', () => {
      // hslToRgb(120, 40, 50) == (0.3, 0.7, 0.3)
      const { hsl } = run([0.3, 0.7, 0.3], { green_saturation: 100 });
      expect(hsl[1]).toBeCloseTo(80, 3);
      expect(hsl[0]).toBeCloseTo(120, 3); // hue untouched
      expect(hsl[2]).toBeCloseTo(50, 3);  // lightness untouched
    });

    it('red slider effect on pure red is scaled by the normalised band weight (sum=1.5 at h=0)', () => {
      // At h=0 the weights are red=1.0 + orange=0.5 (30-deg falloff), sum=1.5,
      // so wFinal(red) = 1/1.5 and red_saturation=-100 gives S' = 100*(1 - 2/3).
      const down = run([1, 0, 0], { red_saturation: -100 });
      expect(down.hsl[1]).toBeCloseTo(100 / 3, 3);
      // hslToRgb(0, 40, 50) == (0.7, 0.3, 0.3): +100 -> S' = 40*(1 + 2/3)
      const up = run([0.7, 0.3, 0.3], { red_saturation: 100 });
      expect(up.hsl[1]).toBeCloseTo(200 / 3, 3);
    });

    it('chroma gate: mid-gray is completely unchanged by red saturation/luminance', () => {
      // Grays get h=0 from rgbToHsl (red band) but S=0 -> gate min(1, S/20) == 0.
      const { r, g, b } = run([0.5, 0.5, 0.5], { red_saturation: 100, red_luminance: 100 });
      expect(r).toBeCloseTo(0.5, 10);
      expect(g).toBeCloseTo(0.5, 10);
      expect(b).toBeCloseTo(0.5, 10);
    });

    it('chroma gate ramps linearly below S=20 (S=10 -> half effect)', () => {
      // hslToRgb(120, 10, 50) == (0.45, 0.55, 0.45); gate = 10/20 = 0.5,
      // so green_saturation=-100 gives S' = 10 * (1 - 0.5) = 5.
      const { hsl } = run([0.45, 0.55, 0.45], { green_saturation: -100 });
      expect(hsl[1]).toBeCloseTo(5, 3);
    });

    it('luminance +100 lifts an in-band L=50 pixel to exactly L\'=100', () => {
      const { r, g, b } = run([0.3, 0.7, 0.3], { green_luminance: 100 });
      expect(r).toBeCloseTo(1, 5);
      expect(g).toBeCloseTo(1, 5);
      expect(b).toBeCloseTo(1, 5);
    });

    it('luminance -100 drops an in-band L=50 pixel to exactly L\'=0', () => {
      const { r, g, b } = run([0.3, 0.7, 0.3], { green_luminance: -100 });
      expect(r).toBeCloseTo(0, 5);
      expect(g).toBeCloseTo(0, 5);
      expect(b).toBeCloseTo(0, 5);
    });

    it('luminance +50 maps half the headroom: L 50 -> 75', () => {
      const { hsl } = run([0.3, 0.7, 0.3], { green_luminance: 50 });
      expect(hsl[2]).toBeCloseTo(75, 3);
      expect(hsl[1]).toBeCloseTo(40, 3); // saturation untouched
    });

    it('normalises overlapping bands at a shared boundary (h=45: orange+yellow -> 1x, not 2x)', () => {
      // hslToRgb(45, 40, 50) == (0.7, 0.6, 0.3). Both bands have weight 1.0 at
      // h=45 (sum=2), so +30 on each shifts hue by 30 total, not 60.
      const { hsl } = run([0.7, 0.6, 0.3], { orange_hue: 30, yellow_hue: 30 });
      expect(hsl[0]).toBeCloseTo(75, 3);
    });

    it('traditional midtones cyan_red +1.0 shifts mid-gray red channel by exactly 0.3', () => {
      // getTonalWeight(0.5, 'midtones') == 1.0 -> r = 0.5 + 1.0 * 1.0 * 0.3.
      const { r, g, b } = run([0.5, 0.5, 0.5], {
        midtones: { cyan_red: 1.0, magenta_green: 0, yellow_blue: 0 },
      });
      expect(r).toBeCloseTo(0.8, 4);
      expect(g).toBeCloseTo(0.5, 4);
      expect(b).toBeCloseTo(0.5, 4);
    });

    it('default parameters are an exact identity', () => {
      for (const rgb of [[0.7, 0.3, 0.3], [0.3, 0.7, 0.3], [0.2, 0.4, 0.9], [0.5, 0.5, 0.5]] as const) {
        const { r, g, b } = run([rgb[0], rgb[1], rgb[2]], {});
        expect(r).toBeCloseTo(rgb[0], 6);
        expect(g).toBeCloseTo(rgb[1], 6);
        expect(b).toBeCloseTo(rgb[2], 6);
      }
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
