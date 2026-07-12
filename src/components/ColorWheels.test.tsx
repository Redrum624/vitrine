/**
 * ColorWheels Component Tests
 */

import {
  ColorWheelsValues,
  defaultColorWheelsValues,
  colorWheelToRGB,
  applyColorWheels,
} from './ColorWheels';

describe('ColorWheels', () => {
  describe('defaultColorWheelsValues', () => {
    it('should have neutral default values', () => {
      expect(defaultColorWheelsValues.lift).toEqual({ x: 0, y: 0, luminance: 0 });
      expect(defaultColorWheelsValues.gamma).toEqual({ x: 0, y: 0, luminance: 0 });
      expect(defaultColorWheelsValues.gain).toEqual({ x: 0, y: 0, luminance: 0 });
      expect(defaultColorWheelsValues.masterLuminance).toBe(0);
    });
  });

  describe('colorWheelToRGB', () => {
    it('should return zero offsets for neutral wheel', () => {
      const result = colorWheelToRGB({ x: 0, y: 0, luminance: 0 });

      expect(result.r).toBeCloseTo(0, 5);
      expect(result.g).toBeCloseTo(0, 5);
      expect(result.b).toBeCloseTo(0, 5);
    });

    it('should add luminance equally to all channels', () => {
      const result = colorWheelToRGB({ x: 0, y: 0, luminance: 0.5 });

      expect(result.r).toBeCloseTo(0.5, 5);
      expect(result.g).toBeCloseTo(0.5, 5);
      expect(result.b).toBeCloseTo(0.5, 5);
    });

    it('should handle positive x (towards red)', () => {
      const result = colorWheelToRGB({ x: 1, y: 0, luminance: 0 });

      // Moving towards red should increase R
      expect(result.r).toBeGreaterThan(0);
    });

    it('should handle positive y (towards green/yellow)', () => {
      const result = colorWheelToRGB({ x: 0, y: 1, luminance: 0 });

      // Moving up should change colors
      expect(Math.abs(result.r) + Math.abs(result.g) + Math.abs(result.b)).toBeGreaterThan(0);
    });

    it('should scale by magnitude', () => {
      const halfMag = colorWheelToRGB({ x: 0.5, y: 0, luminance: 0 });
      const fullMag = colorWheelToRGB({ x: 1, y: 0, luminance: 0 });

      // Full magnitude should have larger absolute values
      const halfSum = Math.abs(halfMag.r) + Math.abs(halfMag.g) + Math.abs(halfMag.b);
      const fullSum = Math.abs(fullMag.r) + Math.abs(fullMag.g) + Math.abs(fullMag.b);

      expect(fullSum).toBeGreaterThan(halfSum);
    });
  });

  describe('applyColorWheels', () => {
    const createNeutralValues = (): ColorWheelsValues => ({
      lift: { x: 0, y: 0, luminance: 0 },
      gamma: { x: 0, y: 0, luminance: 0 },
      gain: { x: 0, y: 0, luminance: 0 },
      masterLuminance: 0,
    });

    it('should not change image with neutral values', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
      const values = createNeutralValues();

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeCloseTo(0.5, 4);
      expect(output[1]).toBeCloseTo(0.5, 4);
      expect(output[2]).toBeCloseTo(0.5, 4);
      expect(output[3]).toBe(1.0);
    });

    it('should preserve alpha channel', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 0.75]);
      const values = createNeutralValues();
      values.masterLuminance = 0.5;

      const output = applyColorWheels(input, values);

      expect(output[3]).toBe(0.75);
    });

    it('should brighten with positive master luminance', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
      const values = createNeutralValues();
      values.masterLuminance = 0.5;

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeGreaterThan(0.5);
      expect(output[1]).toBeGreaterThan(0.5);
      expect(output[2]).toBeGreaterThan(0.5);
    });

    it('should darken with negative master luminance', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
      const values = createNeutralValues();
      values.masterLuminance = -0.5;

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeLessThan(0.5);
      expect(output[1]).toBeLessThan(0.5);
      expect(output[2]).toBeLessThan(0.5);
    });

    it('should affect shadows with lift', () => {
      // Dark pixel
      const input = new Float32Array([0.1, 0.1, 0.1, 1.0]);
      const values = createNeutralValues();
      values.lift.luminance = 0.5;

      const output = applyColorWheels(input, values);

      // Lift should brighten shadows more than highlights
      expect(output[0]).toBeGreaterThan(0.1);
    });

    it('should affect highlights with gain', () => {
      // Bright pixel
      const input = new Float32Array([0.9, 0.9, 0.9, 1.0]);
      const values = createNeutralValues();
      values.gain.luminance = 0.2;

      const output = applyColorWheels(input, values);

      // Gain should affect highlights
      expect(output[0]).toBeGreaterThan(0.9);
    });

    it('should affect midtones with gamma', () => {
      // Midtone pixel
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
      const values = createNeutralValues();
      values.gamma.luminance = 0.3;

      const output = applyColorWheels(input, values);

      // Gamma should affect midtones
      expect(output[0]).not.toBe(0.5);
    });

    it('should clamp output to 0-1', () => {
      const input = new Float32Array([0.9, 0.9, 0.9, 1.0]);
      const values = createNeutralValues();
      values.gain.luminance = 1.0;
      values.masterLuminance = 1.0;

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeLessThanOrEqual(1);
      expect(output[1]).toBeLessThanOrEqual(1);
      expect(output[2]).toBeLessThanOrEqual(1);
    });

    it('should not produce negative values', () => {
      const input = new Float32Array([0.1, 0.1, 0.1, 1.0]);
      const values = createNeutralValues();
      values.lift.luminance = -1.0;
      values.masterLuminance = -1.0;

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeGreaterThanOrEqual(0);
      expect(output[1]).toBeGreaterThanOrEqual(0);
      expect(output[2]).toBeGreaterThanOrEqual(0);
    });

    it('should handle black correctly', () => {
      const input = new Float32Array([0, 0, 0, 1.0]);
      const values = createNeutralValues();

      const output = applyColorWheels(input, values);

      expect(output[0]).toBe(0);
      expect(output[1]).toBe(0);
      expect(output[2]).toBe(0);
    });

    it('should handle white correctly', () => {
      const input = new Float32Array([1, 1, 1, 1.0]);
      const values = createNeutralValues();

      const output = applyColorWheels(input, values);

      expect(output[0]).toBeCloseTo(1, 4);
      expect(output[1]).toBeCloseTo(1, 4);
      expect(output[2]).toBeCloseTo(1, 4);
    });

    it('should process multiple pixels', () => {
      const input = new Float32Array([
        0.2, 0.2, 0.2, 1.0, // Dark
        0.5, 0.5, 0.5, 1.0, // Mid
        0.8, 0.8, 0.8, 1.0, // Bright
      ]);
      const values = createNeutralValues();
      values.masterLuminance = 0.1;

      const output = applyColorWheels(input, values);

      expect(output.length).toBe(12);

      // All pixels should be brightened
      expect(output[0]).toBeGreaterThan(0.2);
      expect(output[4]).toBeGreaterThan(0.5);
      expect(output[8]).toBeGreaterThan(0.8);
    });

    it('should add color tint with lift x/y', () => {
      const input = new Float32Array([0.2, 0.2, 0.2, 1.0]);
      const values = createNeutralValues();
      values.lift.x = 0.5; // Push towards red

      const output = applyColorWheels(input, values);

      // Red should be affected differently than blue/green
      // The exact values depend on the color wheel mapping
      expect(output).not.toEqual(input);
    });

    it('should handle large images', () => {
      // Test with a smaller image to avoid Jest overhead issues
      // 640x480 image
      const pixelCount = 640 * 480;
      const input = new Float32Array(pixelCount * 4);
      for (let i = 0; i < pixelCount * 4; i += 4) {
        input[i] = Math.random();
        input[i + 1] = Math.random();
        input[i + 2] = Math.random();
        input[i + 3] = 1;
      }

      const values = createNeutralValues();
      values.lift.luminance = 0.1;
      values.gamma.luminance = 0.05;
      values.gain.luminance = 0.1;
      values.masterLuminance = 0.05;

      const output = applyColorWheels(input, values);

      // Verify output is correct size and contains valid values
      expect(output.length).toBe(input.length);

      // Check a few random pixels are in valid range
      for (let i = 0; i < 20; i++) {
        const idx = Math.floor(Math.random() * pixelCount) * 4;
        expect(output[idx]).toBeGreaterThanOrEqual(0);
        expect(output[idx]).toBeLessThanOrEqual(1);
        expect(output[idx + 1]).toBeGreaterThanOrEqual(0);
        expect(output[idx + 1]).toBeLessThanOrEqual(1);
        expect(output[idx + 2]).toBeGreaterThanOrEqual(0);
        expect(output[idx + 2]).toBeLessThanOrEqual(1);
      }
    });
  });
});
