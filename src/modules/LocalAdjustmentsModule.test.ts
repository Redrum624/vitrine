/**
 * Unit Tests for LocalAdjustmentsModule
 *
 * Tests layer management, mask creation, local adjustments,
 * brush parameters, and image processing with layers.
 */

import { LocalAdjustmentsModule, GradientParameters, ParametricMaskParameters, MaskGeometry } from './LocalAdjustmentsModule';
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

describe('LocalAdjustmentsModule', () => {
  let module: LocalAdjustmentsModule;

  beforeEach(() => {
    module = new LocalAdjustmentsModule();
  });

  describe('Radial/linear masks apply local adjustments', () => {
    const width = 32, height = 32;

    it('creating a radial layer generates a non-empty centred mask', () => {
      const id = module.createLayer('radial_gradient', 'Radial', width, height);
      const layer = module.getLayer(id)!;
      const center = layer.mask[(height / 2) * width + (width / 2)];
      const corner = layer.mask[0];
      expect(center).toBeGreaterThan(0.9); // full effect at the centre
      expect(corner).toBeLessThan(0.1);    // ~no effect at the corner
    });

    it('a radial exposure boost brightens the centre but not the corner', () => {
      const id = module.createLayer('radial_gradient', 'Radial', width, height);
      module.updateLayerParameters(id, { exposure: 1.0 }); // +1 EV inside the mask
      const input = createTestImage(width, height, 0.4, 0.4, 0.4);
      const out = module.processImage(input, width, height);

      const [cr] = getPixel(out, width, width / 2, height / 2);
      const cornerR = getPixel(out, width, 0, 0)[0];
      expect(cr).toBeGreaterThan(0.4 + 0.05); // centre brightened
      expect(cornerR).toBeCloseTo(0.4, 1);    // corner ~unchanged
    });

    it('setLayerGeometry can move/resize the mask and invert it', () => {
      const id = module.createLayer('radial_gradient', 'Radial', width, height);
      module.setLayerGeometry(id, {
        type: 'radial', centerX: 0.5, centerY: 0.5, radiusX: 0.25, radiusY: 0.25,
        startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.3, invert: true,
      }, width, height);
      const layer = module.getLayer(id)!;
      // Inverted: centre now ~0, corner ~1.
      expect(layer.mask[(height / 2) * width + (width / 2)]).toBeLessThan(0.1);
      expect(layer.mask[0]).toBeGreaterThan(0.9);
    });

    it('a linear gradient layer produces a ramped mask', () => {
      const id = module.createLayer('linear_gradient', 'Linear', width, height);
      const layer = module.getLayer(id)!;
      const top = layer.mask[2 * width + width / 2];               // near top
      const bottom = layer.mask[(height - 3) * width + width / 2]; // near bottom
      expect(bottom).toBeGreaterThan(top); // default gradient runs top -> bottom
    });

    it('the linear gradient is one-sided; feather 1 = solid below, 0.5 = ramp', () => {
      const id = module.createLayer('linear_gradient', 'Grad', width, height);
      const geom = (feather: number): MaskGeometry => ({
        type: 'linear', centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
        startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather, invert: false, rotation: 0,
      });
      const mid = width >> 1;

      module.setLayerGeometry(id, geom(1), width, height);
      let mask = module.getLayer(id)!.mask;
      expect(mask[2 * width + mid]).toBeLessThan(0.05);           // nothing above the line
      expect(mask[(height - 3) * width + mid]).toBeGreaterThan(0.95); // solid full effect below

      module.setLayerGeometry(id, geom(0.5), width, height);
      mask = module.getLayer(id)!.mask;
      const midBot = mask[Math.floor(height * 0.65) * width + mid];
      const farBot = mask[(height - 3) * width + mid];
      expect(mask[2 * width + mid]).toBeLessThan(0.05);           // still one-sided
      expect(midBot).toBeLessThan(farBot);                        // ramps toward the bottom
      expect(farBot).toBeGreaterThan(0.75);                       // near-full by the bottom edge
    });

    it('a mask with basicAdj applies Basic Adjustments to the masked region only', () => {
      const id = module.createLayer('radial_gradient', 'Circle', width, height);
      module.updateLayerBasicAdj(id, { exposure: 1.0 }); // +1 EV inside the mask
      const input = createTestImage(width, height, 0.4, 0.4, 0.4);
      const out = module.processImage(input, width, height);
      const [cr] = getPixel(out, width, width / 2, height / 2);
      const cornerR = getPixel(out, width, 0, 0)[0];
      expect(cr).toBeGreaterThan(0.4 + 0.05); // centre brightened via masked Basic Adjustments
      expect(cornerR).toBeCloseTo(0.4, 1);    // corner ~unchanged
    });

    it('a neutral mask (no slider moved) leaves the image pixel-for-pixel unchanged', () => {
      const id = module.createLayer('radial_gradient', 'Neutral', width, height);
      module.updateLayerBasicAdj(id, {}); // mark as a Basic-Adjustments mask, all-neutral
      const input = createTestImage(width, height, 0.4, 0.55, 0.7);
      const out = module.processImage(new Float32Array(input), width, height);
      for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(input[i], 6);
    });

    it('a masked adjustment applies when processed at a different resolution than the mask', () => {
      // Mask built at 40x40, but processed at a 16x16 "preview" — the mask must be
      // rebuilt at the processing resolution or it indexes the wrong pixels.
      const id = module.createLayer('radial_gradient', 'Circle', 40, 40);
      module.updateLayerBasicAdj(id, { exposure: 1.0 });
      expect(module.getLayer(id)!.mask.length).toBe(40 * 40);

      const pw = 16, ph = 16;
      const out = module.processImage(createTestImage(pw, ph, 0.4, 0.4, 0.4), pw, ph);
      expect(getPixel(out, pw, pw / 2, ph / 2)[0]).toBeGreaterThan(0.45); // centre brightened
      expect(getPixel(out, pw, 0, 0)[0]).toBeCloseTo(0.4, 1);             // corner ~unchanged
      expect(module.getLayer(id)!.mask.length).toBe(pw * ph);            // mask rebuilt at preview res
    });
  });

  describe('Module identification', () => {
    it('should have correct id', () => {
      expect(module.id).toBe('localadjustments');
    });

    it('should have correct name', () => {
      expect(module.name).toBe('Local Adjustments');
    });
  });

  describe('Layer management', () => {
    it('should start with no layers', () => {
      const layers = module.getLayers();
      expect(layers).toHaveLength(0);
    });

    it('should create a brush layer', () => {
      const layerId = module.createLayer('brush', 'Test Brush', 100, 100);
      expect(layerId).toBeDefined();
      expect(typeof layerId).toBe('string');

      const layers = module.getLayers();
      expect(layers).toHaveLength(1);
      expect(layers[0].type).toBe('brush');
      expect(layers[0].name).toBe('Test Brush');
    });

    it('should create a linear gradient layer', () => {
      const layerId = module.createLayer('linear_gradient', 'Linear Grad', 100, 100);
      const layer = module.getLayer(layerId);
      expect(layer).not.toBeNull();
      expect(layer?.type).toBe('linear_gradient');
    });

    it('should create a radial gradient layer', () => {
      const layerId = module.createLayer('radial_gradient', 'Radial Grad', 100, 100);
      const layer = module.getLayer(layerId);
      expect(layer?.type).toBe('radial_gradient');
    });

    it('should create a parametric layer', () => {
      const layerId = module.createLayer('parametric', 'Parametric', 100, 100);
      const layer = module.getLayer(layerId);
      expect(layer?.type).toBe('parametric');
    });

    it('should initialize layer with default parameters', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);
      const layer = module.getLayer(layerId);

      expect(layer?.parameters.exposure).toBe(0);
      expect(layer?.parameters.saturation).toBe(0);
      expect(layer?.parameters.contrast).toBe(0);
      expect(layer?.parameters.brightness).toBe(0);
      expect(layer?.parameters.colorBalance).toEqual([0, 0, 0]);
    });

    it('should initialize layer with empty mask', () => {
      const width = 50;
      const height = 50;
      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);

      expect(layer?.mask.length).toBe(width * height);
      // Mask should be initialized to zero
      for (let i = 0; i < layer!.mask.length; i++) {
        expect(layer?.mask[i]).toBe(0);
      }
    });

    it('should remove a layer', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);
      expect(module.getLayers()).toHaveLength(1);

      const removed = module.removeLayer(layerId);
      expect(removed).toBe(true);
      expect(module.getLayers()).toHaveLength(0);
    });

    it('should return false when removing non-existent layer', () => {
      const removed = module.removeLayer('non-existent-id');
      expect(removed).toBe(false);
    });

    it('should set active layer', () => {
      const id1 = module.createLayer('brush', 'Layer 1', 100, 100);
      // Create a second layer to ensure setActiveLayer works with multiple layers
      module.createLayer('brush', 'Layer 2', 100, 100);

      const success = module.setActiveLayer(id1);
      expect(success).toBe(true);

      const stats = module.getStats();
      expect(stats.activeLayerId).toBe(id1);
    });

    it('should return false when setting non-existent layer active', () => {
      const success = module.setActiveLayer('non-existent-id');
      expect(success).toBe(false);
    });

    it('should return copy of layers array (immutability)', () => {
      module.createLayer('brush', 'Test', 100, 100);
      const layers1 = module.getLayers();
      const layers2 = module.getLayers();
      expect(layers1).not.toBe(layers2);
    });
  });

  describe('Layer parameters', () => {
    it('should update layer parameters', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);

      const success = module.updateLayerParameters(layerId, { exposure: 0.5, saturation: 25 });
      expect(success).toBe(true);

      const layer = module.getLayer(layerId);
      expect(layer?.parameters.exposure).toBe(0.5);
      expect(layer?.parameters.saturation).toBe(25);
    });

    it('should return false when updating non-existent layer', () => {
      const success = module.updateLayerParameters('non-existent', { exposure: 0.5 });
      expect(success).toBe(false);
    });

    it('should merge partial parameters', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);

      module.updateLayerParameters(layerId, { exposure: 0.3 });
      module.updateLayerParameters(layerId, { saturation: 50 });

      const layer = module.getLayer(layerId);
      expect(layer?.parameters.exposure).toBe(0.3);
      expect(layer?.parameters.saturation).toBe(50);
      expect(layer?.parameters.contrast).toBe(0); // Unchanged
    });
  });

  describe('Brush parameters', () => {
    it('should return default brush parameters', () => {
      const params = module.getBrushParameters();
      expect(params.size).toBe(50);
      expect(params.hardness).toBe(0.5);
      expect(params.opacity).toBe(1.0);
      expect(params.flow).toBe(1.0);
    });

    it('should set brush size with clamping', () => {
      module.setBrushSize(200);
      expect(module.getBrushParameters().size).toBe(200);

      module.setBrushSize(0);
      expect(module.getBrushParameters().size).toBe(1);

      module.setBrushSize(600);
      expect(module.getBrushParameters().size).toBe(500);
    });

    it('should set brush hardness with clamping', () => {
      module.setBrushHardness(0.8);
      expect(module.getBrushParameters().hardness).toBe(0.8);

      module.setBrushHardness(-0.5);
      expect(module.getBrushParameters().hardness).toBe(0);

      module.setBrushHardness(1.5);
      expect(module.getBrushParameters().hardness).toBe(1);
    });

    it('should set brush opacity with clamping', () => {
      module.setBrushOpacity(0.5);
      expect(module.getBrushParameters().opacity).toBe(0.5);

      module.setBrushOpacity(-1);
      expect(module.getBrushParameters().opacity).toBe(0);

      module.setBrushOpacity(2);
      expect(module.getBrushParameters().opacity).toBe(1);
    });

    it('should set brush flow with clamping', () => {
      module.setBrushFlow(0.7);
      expect(module.getBrushParameters().flow).toBe(0.7);
    });

    it('should return copy of brush parameters (immutability)', () => {
      const params1 = module.getBrushParameters();
      const params2 = module.getBrushParameters();
      expect(params1).not.toBe(params2);
      expect(params1).toEqual(params2);
    });
  });

  describe('Brush stroke', () => {
    it('should add brush stroke to brush layer', () => {
      const width = 100;
      const height = 100;
      const layerId = module.createLayer('brush', 'Test', width, height);

      module.setBrushSize(20);
      module.setBrushHardness(1.0);

      const points = [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
        { x: 70, y: 50 },
      ];

      const success = module.addBrushStroke(layerId, points, width, height, false);
      expect(success).toBe(true);

      // Check that mask has non-zero values where stroke was applied
      const layer = module.getLayer(layerId);
      const centerIndex = 50 * width + 50;
      expect(layer?.mask[centerIndex]).toBeGreaterThan(0);
    });

    it('should erase from mask when isErase is true', () => {
      const width = 100;
      const height = 100;
      const layerId = module.createLayer('brush', 'Test', width, height);

      // First, paint something
      const points = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
      module.setBrushSize(20);
      module.addBrushStroke(layerId, points, width, height, false);

      const layer = module.getLayer(layerId);
      const centerIndex = 50 * width + 50;
      const valueBefore = layer?.mask[centerIndex] || 0;
      expect(valueBefore).toBeGreaterThan(0);

      // Now erase
      module.addBrushStroke(layerId, points, width, height, true);
      const valueAfter = layer?.mask[centerIndex] || 0;
      expect(valueAfter).toBeLessThan(valueBefore);
    });

    it('should return false for non-brush layer', () => {
      const layerId = module.createLayer('linear_gradient', 'Test', 100, 100);
      const success = module.addBrushStroke(layerId, [{ x: 50, y: 50 }], 100, 100, false);
      expect(success).toBe(false);
    });

    it('should return false for non-existent layer', () => {
      const success = module.addBrushStroke('non-existent', [{ x: 50, y: 50 }], 100, 100, false);
      expect(success).toBe(false);
    });
  });

  describe('Linear gradient mask', () => {
    it('should create linear gradient mask', () => {
      const width = 100;
      const height = 100;
      const layerId = module.createLayer('linear_gradient', 'Test', width, height);

      const gradientParams = {
        startX: 0,
        startY: 0.5,
        endX: 1,
        endY: 0.5,
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.5,
        radiusY: 0.5,
        falloff: 1,
        symmetry: false,
      };

      const success = module.createLinearGradientMask(layerId, gradientParams, width, height);
      expect(success).toBe(true);

      const layer = module.getLayer(layerId);
      // Mask should have values
      let hasNonZero = false;
      for (let i = 0; i < layer!.mask.length; i++) {
        if (layer!.mask[i] > 0) {
          hasNonZero = true;
          break;
        }
      }
      expect(hasNonZero).toBe(true);
    });

    it('should return false for non-linear-gradient layer', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);
      const emptyParams: GradientParameters = {
        startX: 0, startY: 0, endX: 1, endY: 1,
        centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
        falloff: 1, symmetry: false,
      };
      const success = module.createLinearGradientMask(layerId, emptyParams, 100, 100);
      expect(success).toBe(false);
    });
  });

  describe('Radial gradient mask', () => {
    it('should create radial gradient mask', () => {
      const width = 100;
      const height = 100;
      const layerId = module.createLayer('radial_gradient', 'Test', width, height);

      const gradientParams = {
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 1,
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.3,
        radiusY: 0.3,
        falloff: 1,
        symmetry: false,
      };

      const success = module.createRadialGradientMask(layerId, gradientParams, width, height);
      expect(success).toBe(true);

      const layer = module.getLayer(layerId);
      // Center should have higher mask value than edges
      const centerIndex = 50 * width + 50;
      const edgeIndex = 0;
      expect(layer?.mask[centerIndex]).toBeGreaterThan(layer?.mask[edgeIndex] || 0);
    });

    it('should return false for non-radial-gradient layer', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);
      const emptyParams: GradientParameters = {
        startX: 0, startY: 0, endX: 1, endY: 1,
        centerX: 0.5, centerY: 0.5, radiusX: 0.3, radiusY: 0.3,
        falloff: 1, symmetry: false,
      };
      const success = module.createRadialGradientMask(layerId, emptyParams, 100, 100);
      expect(success).toBe(false);
    });
  });

  describe('Parametric mask', () => {
    it('should create parametric mask based on luminance', () => {
      const width = 10;
      const height = 10;
      const layerId = module.createLayer('parametric', 'Test', width, height);

      // Create image with varying luminance
      const imageData = createGradientImage(width, height);

      const maskParams = {
        luminanceMin: 0.3,
        luminanceMax: 0.7,
        luminanceFeather: 0.05,
        hueCenter: 0,
        hueRange: 0, // No hue masking
        saturationMin: 0,
        saturationMax: 1,
        edgeThreshold: 0,
        edgeRadius: 0,
      };

      const success = module.createParametricMask(layerId, maskParams, imageData, width, height);
      expect(success).toBe(true);
    });

    it('should return false for non-parametric layer', () => {
      const layerId = module.createLayer('brush', 'Test', 100, 100);
      const emptyParams: ParametricMaskParameters = {
        luminanceMin: 0, luminanceMax: 1, luminanceFeather: 0,
        hueCenter: 0, hueRange: 0, saturationMin: 0, saturationMax: 1,
        edgeThreshold: 0, edgeRadius: 0,
      };
      const success = module.createParametricMask(layerId, emptyParams, new Float32Array(0), 100, 100);
      expect(success).toBe(false);
    });
  });

  describe('Image processing', () => {
    it('should return input unchanged when no layers exist', () => {
      const width = 4;
      const height = 4;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const result = module.processImage(data, width, height);

      // Should return the input data when no layers
      expect(result).toBe(data);
    });

    it('should apply exposure adjustment through layer', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      // Create layer with full mask
      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0); // Full effect everywhere

      module.updateLayerParameters(layerId, { exposure: 1.0 }); // +1 EV

      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      const [r] = getPixel(result, width, 0, 0);
      // Exposure +1 should double brightness
      expect(r).toBeGreaterThan(0.3);
    });

    it('should apply saturation adjustment', () => {
      const width = 10;
      const height = 10;
      // Create colorful image
      const data = createTestImage(width, height, 0.8, 0.4, 0.2);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { saturation: 50 });

      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply contrast adjustment', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { contrast: 50 });

      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply brightness adjustment', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { brightness: 30 });

      const result = module.processImage(data, width, height);

      expect(isValidImageData(result)).toBe(true);
      const [r] = getPixel(result, width, 0, 0);
      expect(r).toBeGreaterThan(0.3);
    });

    it('should skip disabled layers', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.enabled = false;

      module.updateLayerParameters(layerId, { exposure: 2.0 });

      const result = module.processImage(data, width, height);

      // Should be unchanged since layer is disabled
      const [r] = getPixel(result, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 2);
    });

    it('should skip layers with zero opacity', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.opacity = 0;

      module.updateLayerParameters(layerId, { exposure: 2.0 });

      const result = module.processImage(data, width, height);

      const [r] = getPixel(result, width, 0, 0);
      expect(r).toBeCloseTo(0.5, 2);
    });

    it('should respect layer opacity', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.opacity = 0.5; // 50% opacity

      module.updateLayerParameters(layerId, { brightness: 40 });

      const result = module.processImage(data, width, height);

      const [r] = getPixel(result, width, 0, 0);
      // Effect should be partial due to 50% opacity
      expect(r).toBeGreaterThan(0.3);
      expect(r).toBeLessThan(0.7); // Less than full effect
    });
  });

  describe('Blend modes', () => {
    it('should apply normal blend mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.blendMode = 'normal';

      module.updateLayerParameters(layerId, { brightness: 20 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply multiply blend mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.blendMode = 'multiply';

      module.updateLayerParameters(layerId, { brightness: 20 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply screen blend mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.blendMode = 'screen';

      module.updateLayerParameters(layerId, { brightness: 20 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply overlay blend mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.blendMode = 'overlay';

      module.updateLayerParameters(layerId, { brightness: 20 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should apply soft_light blend mode', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);
      layer!.blendMode = 'soft_light';

      module.updateLayerParameters(layerId, { brightness: 20 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should report correct stats with no layers', () => {
      const stats = module.getStats();
      expect(stats.layerCount).toBe(0);
      expect(stats.activeLayerId).toBeNull();
      expect(stats.enabledLayers).toBe(0);
    });

    it('should report correct stats with layers', () => {
      module.createLayer('brush', 'Layer 1', 100, 100);
      const id2 = module.createLayer('brush', 'Layer 2', 100, 100);
      module.getLayer(id2)!.enabled = false;

      const stats = module.getStats();
      expect(stats.layerCount).toBe(2);
      expect(stats.enabledLayers).toBe(1);
      expect(stats.activeLayerId).toBe(id2); // Last created is active
    });
  });

  describe('Clear all layers', () => {
    it('should remove all layers', () => {
      module.createLayer('brush', 'Layer 1', 100, 100);
      module.createLayer('brush', 'Layer 2', 100, 100);
      expect(module.getLayers()).toHaveLength(2);

      module.clearAllLayers();

      expect(module.getLayers()).toHaveLength(0);
      expect(module.getStats().activeLayerId).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle single pixel image', () => {
      const width = 1;
      const height = 1;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { exposure: 0.5 });

      const result = module.processImage(data, width, height);
      expect(result.length).toBe(4);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle black image', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0, 0, 0);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { brightness: 30 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should handle white image', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 1, 1, 1);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { contrast: 30 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });

    it('should clamp output values', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.9, 0.9, 0.9);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      // Extreme adjustments
      module.updateLayerParameters(layerId, { exposure: 3.0, brightness: 50 });

      const result = module.processImage(data, width, height);

      // All values should be clamped to [0, 1]
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(result[i]).toBeLessThanOrEqual(1);
      }
    });

    it('should preserve alpha channel', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.5, 0.5, 0.5, 0.75);

      const layerId = module.createLayer('brush', 'Test', width, height);
      const layer = module.getLayer(layerId);
      layer!.mask.fill(1.0);

      module.updateLayerParameters(layerId, { exposure: 0.5 });

      const result = module.processImage(data, width, height);

      const [, , , a] = getPixel(result, width, 0, 0);
      expect(a).toBeCloseTo(0.75, 5);
    });

    it('should handle multiple layers', () => {
      const width = 10;
      const height = 10;
      const data = createTestImage(width, height, 0.3, 0.3, 0.3);

      // Create multiple layers
      const id1 = module.createLayer('brush', 'Layer 1', width, height);
      const layer1 = module.getLayer(id1);
      layer1!.mask.fill(1.0);
      module.updateLayerParameters(id1, { exposure: 0.5 });

      const id2 = module.createLayer('brush', 'Layer 2', width, height);
      const layer2 = module.getLayer(id2);
      layer2!.mask.fill(1.0);
      module.updateLayerParameters(id2, { saturation: 30 });

      const result = module.processImage(data, width, height);
      expect(isValidImageData(result)).toBe(true);
    });
  });
});
