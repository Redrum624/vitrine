/**
 * ACES Color Science Service
 *
 * Implements the Academy Color Encoding System (ACES) for professional
 * color grading and tone mapping. Used by Hollywood for film production.
 *
 * References:
 * - ACES 1.2 Specification
 * - ACES Central: https://acescentral.com
 * - sRGB/Rec.709 to ACES transforms
 */

import { logger } from '../utils/Logger';

/**
 * ACES Color Spaces
 */
export enum ACESColorSpace {
  SRGB = 'sRGB',
  ACES_AP0 = 'ACES2065-1',  // ACES Primaries 0 (wide gamut)
  ACES_AP1 = 'ACEScg',       // ACES Primaries 1 (working space)
  ACES_CCT = 'ACEScct',      // ACES Color Corrector Transform
  REC709 = 'Rec.709'
}

/**
 * ACES Transform Parameters
 */
export interface ACESTransformParams {
  exposure: number;         // Pre-transform exposure adjustment
  gamma: number;            // Gamma for view transform
  highlights: number;       // Highlight rolloff
  shadows: number;          // Shadow preservation
  saturation: number;       // Color saturation
}

export class ACESColorService {
  private static instance: ACESColorService;

  private constructor() {
    logger.info('ACES Color Service initialized');
  }

  static getInstance(): ACESColorService {
    if (!ACESColorService.instance) {
      ACESColorService.instance = new ACESColorService();
    }
    return ACESColorService.instance;
  }

  /**
   * sRGB to ACES AP1 (ACEScg) transform
   * Converts sRGB display-referred to ACES scene-referred
   */
  sRGBToACES(rgb: [number, number, number]): [number, number, number] {
    // First convert sRGB to linear
    const linear = this.srgbToLinear(rgb);

    // Matrix from sRGB/Rec.709 to ACES AP1
    // These are the Bradford-adapted matrices
    const matrix = [
      [ 0.613097,  0.339523,  0.047379],
      [ 0.070194,  0.916354,  0.013452],
      [ 0.020616,  0.109570,  0.869815]
    ];

    const aces: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      aces[i] = matrix[i][0] * linear[0] +
                matrix[i][1] * linear[1] +
                matrix[i][2] * linear[2];
    }

    return aces;
  }

  /**
   * ACES AP1 to sRGB transform
   * Converts ACES scene-referred to sRGB display-referred
   */
  acesToSRGB(aces: [number, number, number]): [number, number, number] {
    // Matrix from ACES AP1 to sRGB/Rec.709
    const matrix = [
      [ 1.704858,  -0.621716, -0.083142],
      [-0.130079,   1.140735, -0.010656],
      [-0.023964,  -0.128975,  1.152939]
    ];

    const linear: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      linear[i] = matrix[i][0] * aces[0] +
                  matrix[i][1] * aces[1] +
                  matrix[i][2] * aces[2];
    }

    // Convert linear to sRGB
    return this.linearToSrgb(linear);
  }

  /**
   * ACES Reference Rendering Transform (RRT)
   * Converts scene-referred ACES to output-referred display
   *
   * This is a simplified version of the full ACES RRT + ODT pipeline
   */
  acesRRT(aces: [number, number, number], params?: Partial<ACESTransformParams>): [number, number, number] {
    const p: ACESTransformParams = {
      exposure: params?.exposure ?? 0,
      gamma: params?.gamma ?? 1.0,
      highlights: params?.highlights ?? 1.0,
      shadows: params?.shadows ?? 1.0,
      saturation: params?.saturation ?? 1.0
    };

    // Apply pre-transform exposure
    let [r, g, b] = aces;
    if (p.exposure !== 0) {
      const exposureMult = Math.pow(2, p.exposure);
      r *= exposureMult;
      g *= exposureMult;
      b *= exposureMult;
    }

    // ACES Filmic Tone Curve (simplified)
    r = this.acesFilmic(r, p.highlights, p.shadows);
    g = this.acesFilmic(g, p.highlights, p.shadows);
    b = this.acesFilmic(b, p.highlights, p.shadows);

    // Saturation adjustment
    if (p.saturation !== 1.0) {
      const luma = 0.2722287 * r + 0.6740818 * g + 0.0536895 * b;
      r = luma + (r - luma) * p.saturation;
      g = luma + (g - luma) * p.saturation;
      b = luma + (b - luma) * p.saturation;
    }

    // Apply gamma
    if (p.gamma !== 1.0) {
      r = Math.pow(Math.max(0, r), 1.0 / p.gamma);
      g = Math.pow(Math.max(0, g), 1.0 / p.gamma);
      b = Math.pow(Math.max(0, b), 1.0 / p.gamma);
    }

    return [r, g, b];
  }

  /**
   * ACES Filmic Tone Curve
   * S-curve with smooth highlight rolloff
   */
  private acesFilmic(x: number, highlights: number, shadows: number): number {
    // Simplified ACES tone curve (approximation)
    // Full ACES uses a more complex spline-based curve

    // Parameters (tuned for pleasing highlights)
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;

    // Adjust for highlights and shadows
    const xAdj = x * shadows;

    // ACES tone curve formula
    const numerator = xAdj * (a * xAdj + b);
    const denominator = xAdj * (c * xAdj + d) + e;

    let result = numerator / denominator;

    // Highlight rolloff
    if (highlights !== 1.0) {
      // Compress highlights
      const threshold = 0.8;
      if (result > threshold) {
        const over = result - threshold;
        const compressed = over * highlights;
        result = threshold + compressed;
      }
    }

    return Math.max(0, Math.min(1, result));
  }

  /**
   * ACES Output Device Transform (ODT) for sRGB/Rec.709
   */
  acesODTsRGB(aces: [number, number, number]): [number, number, number] {
    // Apply RRT (Reference Rendering Transform)
    const rendered = this.acesRRT(aces);

    // Clamp to valid range
    return [
      Math.max(0, Math.min(1, rendered[0])),
      Math.max(0, Math.min(1, rendered[1])),
      Math.max(0, Math.min(1, rendered[2]))
    ];
  }

  /**
   * Full ACES Pipeline: sRGB → ACES → RRT → sRGB
   * Complete round-trip through ACES color science
   */
  processACESPipeline(
    rgb: [number, number, number],
    params?: Partial<ACESTransformParams>
  ): [number, number, number] {
    // Input Transform: sRGB → ACES
    const aces = this.sRGBToACES(rgb);

    // Reference Rendering Transform
    const rendered = this.acesRRT(aces, params);

    // Output Device Transform: ACES → sRGB
    return this.acesODTsRGB(rendered);
  }

  /**
   * Process entire image through ACES pipeline
   */
  processImage(
    imageData: Float32Array,
    width: number,
    height: number,
    params?: Partial<ACESTransformParams>
  ): Float32Array {
    const output = new Float32Array(imageData.length);
    const pixelCount = width * height;

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;

      // Extract RGB
      const rgb: [number, number, number] = [
        imageData[idx],
        imageData[idx + 1],
        imageData[idx + 2]
      ];

      // Process through ACES
      const result = this.processACESPipeline(rgb, params);

      // Write result
      output[idx] = result[0];
      output[idx + 1] = result[1];
      output[idx + 2] = result[2];
      output[idx + 3] = imageData[idx + 3];  // Preserve alpha
    }

    return output;
  }

  /**
   * sRGB to Linear conversion
   */
  private srgbToLinear(srgb: [number, number, number]): [number, number, number] {
    const linear: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
      if (srgb[i] <= 0.04045) {
        linear[i] = srgb[i] / 12.92;
      } else {
        linear[i] = Math.pow((srgb[i] + 0.055) / 1.055, 2.4);
      }
    }

    return linear;
  }

  /**
   * Linear to sRGB conversion
   */
  private linearToSrgb(linear: [number, number, number]): [number, number, number] {
    const srgb: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
      if (linear[i] <= 0.0031308) {
        srgb[i] = linear[i] * 12.92;
      } else {
        srgb[i] = 1.055 * Math.pow(linear[i], 1.0 / 2.4) - 0.055;
      }
    }

    return srgb;
  }

  /**
   * Color Decision List (CDL) - ASC-CDL grading
   * Industry standard color grading format
   */
  applyCDL(
    rgb: [number, number, number],
    slope: [number, number, number],
    offset: [number, number, number],
    power: [number, number, number],
    saturation: number
  ): [number, number, number] {
    // CDL formula: out = (in * slope + offset)^power
    let r = Math.pow(rgb[0] * slope[0] + offset[0], power[0]);
    let g = Math.pow(rgb[1] * slope[1] + offset[1], power[1]);
    let b = Math.pow(rgb[2] * slope[2] + offset[2], power[2]);

    // Apply saturation
    if (saturation !== 1.0) {
      const luma = 0.2722287 * r + 0.6740818 * g + 0.0536895 * b;
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;
    }

    return [
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b))
    ];
  }
}

export const acesColorService = ACESColorService.getInstance();
