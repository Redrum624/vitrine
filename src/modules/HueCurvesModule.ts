/**
 * HueCurvesModule - Professional Hue-Based Color Grading
 *
 * Provides professional color grading tools using curve-based controls:
 * - Hue vs Hue: Shift specific hue ranges to different hues
 * - Hue vs Saturation: Adjust saturation based on hue
 * - Hue vs Luminance: Adjust luminance based on hue
 * - Saturation vs Saturation: Non-linear saturation adjustments
 * - Luminance vs Saturation: Adjust saturation based on luminance
 *
 * Each curve is defined by control points with smooth interpolation.
 */

import { logger } from '../utils/Logger';
import { rgbToHsl, hslToRgb } from './utils/ColorUtils';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

/**
 * A single control point on a curve
 */
export interface CurvePoint {
  x: number; // Input value (0-1)
  y: number; // Output value (0-1 for most, -1 to 1 for shifts)
}

/**
 * A curve defined by control points
 */
export interface HueCurve {
  enabled: boolean;
  points: CurvePoint[];
}

/**
 * Parameters for HueCurvesModule
 */
export interface HueCurvesParams {
  /** Hue vs Hue curve - shift hues based on input hue */
  hueVsHue: HueCurve;

  /** Hue vs Saturation curve - adjust saturation based on hue */
  hueVsSat: HueCurve;

  /** Hue vs Luminance curve - adjust luminance based on hue */
  hueVsLum: HueCurve;

  /** Saturation vs Saturation curve - non-linear saturation */
  satVsSat: HueCurve;

  /** Luminance vs Saturation curve - saturation based on brightness */
  lumVsSat: HueCurve;

  /** Master blend strength (0-1) */
  masterBlend: number;

  [key: string]: unknown;
}

/**
 * Processing context for the module
 */
export interface HueCurvesContext {
  width: number;
  height: number;
  channels: number;
}

/**
 * Default identity curve (diagonal line)
 */
function createIdentityCurve(): HueCurve {
  return {
    enabled: false,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };
}

/**
 * Default neutral shift curve (horizontal line at 0.5)
 */
function createNeutralShiftCurve(): HueCurve {
  return {
    enabled: false,
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
  };
}

/**
 * HueCurvesModule class
 */
export class HueCurvesModule {
  private params: HueCurvesParams = {
    hueVsHue: createNeutralShiftCurve(), // Neutral = no hue shift
    hueVsSat: createIdentityCurve(),
    hueVsLum: createIdentityCurve(),
    satVsSat: createIdentityCurve(),
    lumVsSat: createIdentityCurve(),
    masterBlend: 1.0,
  };

  // Lookup tables for performance
  private luts: {
    hueVsHue: Float32Array | null;
    hueVsSat: Float32Array | null;
    hueVsLum: Float32Array | null;
    satVsSat: Float32Array | null;
    lumVsSat: Float32Array | null;
  } = {
    hueVsHue: null,
    hueVsSat: null,
    hueVsLum: null,
    satVsSat: null,
    lumVsSat: null,
  };

  private readonly LUT_SIZE = 256;
  private lutsDirty = true;

  /**
   * Set module parameters
   */
  setParams(params: Partial<HueCurvesParams>): void {
    this.params = { ...this.params, ...params };
    this.lutsDirty = true;
    logger.debug('HueCurvesModule: Parameters updated', { params });
  }

  /**
   * Get current parameters
   */
  getParams(): HueCurvesParams {
    return { ...this.params };
  }

  /**
   * Reset all curves to default
   */
  reset(): void {
    this.params = {
      hueVsHue: createNeutralShiftCurve(),
      hueVsSat: createIdentityCurve(),
      hueVsLum: createIdentityCurve(),
      satVsSat: createIdentityCurve(),
      lumVsSat: createIdentityCurve(),
      masterBlend: 1.0,
    };
    this.lutsDirty = true;
    logger.debug('HueCurvesModule: Reset to defaults');
  }

  /**
   * Set a specific curve
   */
  setCurve(
    curveType: 'hueVsHue' | 'hueVsSat' | 'hueVsLum' | 'satVsSat' | 'lumVsSat',
    curve: HueCurve
  ): void {
    this.params[curveType] = curve;
    this.lutsDirty = true;
  }

  /**
   * Enable/disable a specific curve
   */
  setCurveEnabled(
    curveType: 'hueVsHue' | 'hueVsSat' | 'hueVsLum' | 'satVsSat' | 'lumVsSat',
    enabled: boolean
  ): void {
    (this.params[curveType] as HueCurve).enabled = enabled;
    this.lutsDirty = true;
  }

  /**
   * Add a control point to a curve
   */
  addControlPoint(
    curveType: 'hueVsHue' | 'hueVsSat' | 'hueVsLum' | 'satVsSat' | 'lumVsSat',
    point: CurvePoint
  ): void {
    const curve = this.params[curveType] as HueCurve;
    curve.points.push(point);
    // Sort points by x value
    curve.points.sort((a, b) => a.x - b.x);
    this.lutsDirty = true;
  }

  /**
   * Remove a control point from a curve
   */
  removeControlPoint(
    curveType: 'hueVsHue' | 'hueVsSat' | 'hueVsLum' | 'satVsSat' | 'lumVsSat',
    index: number
  ): void {
    const curve = this.params[curveType] as HueCurve;
    if (curve.points.length > 2 && index >= 0 && index < curve.points.length) {
      curve.points.splice(index, 1);
      this.lutsDirty = true;
    }
  }

  /**
   * Build lookup tables for all curves
   */
  private buildLUTs(): void {
    if (!this.lutsDirty) return;

    const curves: Array<'hueVsHue' | 'hueVsSat' | 'hueVsLum' | 'satVsSat' | 'lumVsSat'> = [
      'hueVsHue',
      'hueVsSat',
      'hueVsLum',
      'satVsSat',
      'lumVsSat',
    ];

    for (const curveType of curves) {
      const curve = this.params[curveType] as HueCurve;
      if (!curve.enabled) {
        this.luts[curveType] = null;
        continue;
      }

      const lut = new Float32Array(this.LUT_SIZE);
      for (let i = 0; i < this.LUT_SIZE; i++) {
        const x = i / (this.LUT_SIZE - 1);
        lut[i] = this.evaluateCurve(curve, x);
      }
      this.luts[curveType] = lut;
    }

    this.lutsDirty = false;
    logger.debug('HueCurvesModule: LUTs rebuilt');
  }

  /**
   * Evaluate a curve at a given x value using Catmull-Rom interpolation
   */
  private evaluateCurve(curve: HueCurve, x: number): number {
    const points = curve.points;
    if (points.length === 0) return x;
    if (points.length === 1) return points[0].y;

    // Clamp x to curve range
    if (x <= points[0].x) return points[0].y;
    if (x >= points[points.length - 1].x) return points[points.length - 1].y;

    // Find segment
    let i = 0;
    while (i < points.length - 1 && points[i + 1].x < x) {
      i++;
    }

    // Linear interpolation for simple cases
    if (points.length === 2) {
      const t = (x - points[0].x) / (points[1].x - points[0].x);
      return points[0].y + t * (points[1].y - points[0].y);
    }

    // Catmull-Rom spline interpolation
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const t = (x - p1.x) / (p2.x - p1.x);
    const t2 = t * t;
    const t3 = t2 * t;

    // Catmull-Rom basis matrix
    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

    return Math.max(0, Math.min(1, y));
  }

  /**
   * Sample a LUT with linear interpolation
   */
  private sampleLUT(lut: Float32Array, x: number): number {
    const idx = x * (this.LUT_SIZE - 1);
    const low = Math.floor(idx);
    const high = Math.min(low + 1, this.LUT_SIZE - 1);
    const t = idx - low;
    return lut[low] * (1 - t) + lut[high] * t;
  }

  /**
   * Check if any curve is active
   */
  hasActiveAdjustments(): boolean {
    return (
      this.params.hueVsHue.enabled ||
      this.params.hueVsSat.enabled ||
      this.params.hueVsLum.enabled ||
      this.params.satVsSat.enabled ||
      this.params.lumVsSat.enabled
    );
  }

  /**
   * Process image data with hue curves
   */
  process(
    input: Float32Array,
    context: HueCurvesContext
  ): Float32Array {
    const { width, height, channels } = context;

    if (!this.hasActiveAdjustments() || this.params.masterBlend <= 0) {
      return input.slice();
    }

    // Rebuild LUTs if needed
    this.buildLUTs();

    // GPU fast-path (RGBA) when available + verified; else the CPU loop below.
    if (channels === 4 && input.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
      return webGLImageProcessor.applyHueCurves(input, width, height, this.luts, this.params.masterBlend);
    }

    const pixelCount = width * height;
    const output = new Float32Array(input.length);
    const blend = this.params.masterBlend;

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      const r = input[offset];
      const g = input[offset + 1];
      const b = input[offset + 2];
      const a = channels === 4 ? input[offset + 3] : 1;

      // Convert to HSL and normalize to [0,1]. rgbToHsl returns h in 0-360 and
      // s/l in 0-100, but the curves + sampleLUT all operate in [0,1] — feeding the
      // raw 0-360 hue in indexed the LUT out of bounds (NaN). Scale back before
      // hslToRgb below.
      let [h, s, l] = rgbToHsl(r, g, b);
      h /= 360; s /= 100; l /= 100;

      // Apply curves

      // Hue vs Hue: Shift hue based on current hue
      if (this.luts.hueVsHue) {
        const hueShift = this.sampleLUT(this.luts.hueVsHue, h) - 0.5;
        h = (h + hueShift + 1) % 1;
      }

      // Hue vs Saturation: Adjust saturation based on hue
      if (this.luts.hueVsSat) {
        const satMult = this.sampleLUT(this.luts.hueVsSat, h);
        s = Math.min(1, s * (satMult * 2)); // 0-1 maps to 0-2x saturation
      }

      // Hue vs Luminance: Adjust luminance based on hue
      if (this.luts.hueVsLum) {
        const lumMult = this.sampleLUT(this.luts.hueVsLum, h);
        l = Math.min(1, l * (lumMult * 2)); // 0-1 maps to 0-2x luminance
      }

      // Saturation vs Saturation: Non-linear saturation adjustment
      if (this.luts.satVsSat) {
        s = this.sampleLUT(this.luts.satVsSat, s);
      }

      // Luminance vs Saturation: Adjust saturation based on luminance
      if (this.luts.lumVsSat) {
        const satMult = this.sampleLUT(this.luts.lumVsSat, l);
        s = Math.min(1, s * (satMult * 2));
      }

      // Convert back to RGB (hslToRgb expects h 0-360, s/l 0-100).
      const [newR, newG, newB] = hslToRgb(h * 360, s * 100, l * 100);

      // Blend with original
      output[offset] = r + (newR - r) * blend;
      output[offset + 1] = g + (newG - g) * blend;
      output[offset + 2] = b + (newB - b) * blend;
      if (channels === 4) {
        output[offset + 3] = a;
      }
    }

    logger.debug('HueCurvesModule: Processing complete', {
      pixelCount,
      activeCurves: Object.entries(this.luts)
        .filter(([, v]) => v !== null)
        .map(([k]) => k),
    });

    return output;
  }

  /**
   * Create a preset hue curve for a specific effect
   */
  static createPreset(
    type:
      | 'tealnOrange'
      | 'desaturateShadows'
      | 'vibrantSunset'
      | 'coolHighlights'
  ): Partial<HueCurvesParams> {
    switch (type) {
      case 'tealnOrange':
        // Classic teal and orange color grading
        return {
          hueVsHue: {
            enabled: true,
            points: [
              { x: 0, y: 0.5 }, // Red stays
              { x: 0.1, y: 0.48 }, // Orange pushed toward red
              { x: 0.25, y: 0.55 }, // Yellow/green pushed toward cyan
              { x: 0.5, y: 0.52 }, // Cyan enhanced
              { x: 0.6, y: 0.5 }, // Blue stays
              { x: 0.8, y: 0.5 }, // Purple stays
              { x: 1, y: 0.5 }, // Back to red
            ],
          },
          hueVsSat: {
            enabled: true,
            points: [
              { x: 0, y: 0.6 }, // Boost red saturation
              { x: 0.08, y: 0.65 }, // Boost orange saturation
              { x: 0.25, y: 0.3 }, // Reduce green saturation
              { x: 0.5, y: 0.55 }, // Slight boost to cyan
              { x: 0.65, y: 0.4 }, // Reduce blue saturation
              { x: 1, y: 0.6 },
            ],
          },
        };

      case 'desaturateShadows':
        return {
          lumVsSat: {
            enabled: true,
            points: [
              { x: 0, y: 0.2 }, // Very low saturation in shadows
              { x: 0.2, y: 0.35 }, // Gradual increase
              { x: 0.5, y: 0.5 }, // Normal in midtones
              { x: 1, y: 0.5 }, // Normal in highlights
            ],
          },
        };

      case 'vibrantSunset':
        return {
          hueVsSat: {
            enabled: true,
            points: [
              { x: 0, y: 0.7 }, // Boost reds
              { x: 0.08, y: 0.8 }, // Boost oranges
              { x: 0.15, y: 0.7 }, // Boost yellows
              { x: 0.35, y: 0.4 }, // Reduce greens
              { x: 0.5, y: 0.45 }, // Slightly boost cyans
              { x: 0.7, y: 0.55 }, // Slight boost to blues
              { x: 0.85, y: 0.6 }, // Boost purples
              { x: 1, y: 0.7 },
            ],
          },
        };

      case 'coolHighlights':
        return {
          hueVsLum: {
            enabled: true,
            points: [
              { x: 0, y: 0.5 },
              { x: 0.5, y: 0.55 }, // Brighten cyans
              { x: 0.65, y: 0.55 }, // Brighten blues
              { x: 1, y: 0.5 },
            ],
          },
          lumVsSat: {
            enabled: true,
            points: [
              { x: 0, y: 0.5 },
              { x: 0.7, y: 0.55 }, // Slightly boost saturation in highlights
              { x: 1, y: 0.45 }, // Reduce saturation in pure white
            ],
          },
        };

      default:
        return {};
    }
  }

  /**
   * Export curves to JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.params, null, 2);
  }

  /**
   * Import curves from JSON
   */
  importFromJSON(json: string): boolean {
    try {
      const params = JSON.parse(json) as HueCurvesParams;
      this.setParams(params);
      return true;
    } catch (err) {
      logger.error('HueCurvesModule: Failed to import JSON', { error: err });
      return false;
    }
  }
}

// Export singleton for convenience
export const hueCurvesModule = new HueCurvesModule();
