/**
 * HDRTransferService - HDR Transfer Function Implementation
 *
 * Implements industry-standard HDR transfer functions for professional
 * color grading and display workflows.
 *
 * Supported transfer functions:
 * - PQ (SMPTE ST 2084) - Perceptual Quantizer for HDR mastering
 * - HLG (ARIB STD-B67) - Hybrid Log-Gamma for broadcast HDR
 *
 * Features:
 * - Encode/decode for both PQ and HLG
 * - Tone mapping for SDR display
 * - HDR metadata handling (MaxCLL, MaxFALL)
 * - GPU-accelerated processing support
 */

// Logger could be used for debugging HDR processing
// import { logger } from '../utils/Logger';

/**
 * HDR metadata for content
 */
export interface HDRMetadata {
  /** Maximum Content Light Level (nits) */
  maxCLL: number;
  /** Maximum Frame-Average Light Level (nits) */
  maxFALL: number;
  /** Mastering display max luminance (nits) */
  masteringDisplayMaxLuminance: number;
  /** Mastering display min luminance (nits) */
  masteringDisplayMinLuminance: number;
  /** Content color primaries */
  colorPrimaries: 'bt709' | 'bt2020' | 'p3';
}

/**
 * Tone mapping parameters
 */
export interface ToneMappingParams {
  /** Target peak luminance for SDR (typically 100 nits) */
  targetPeakNits: number;
  /** Source peak luminance (HDR content) */
  sourcePeakNits: number;
  /** Knee point for soft rolloff (0-1) */
  knee: number;
  /** Shoulder compression ratio */
  shoulder: number;
  /** Saturation preservation (0-1) */
  saturationPreservation: number;
}

/**
 * Default tone mapping parameters
 */
const DEFAULT_TONE_MAPPING: ToneMappingParams = {
  targetPeakNits: 100,
  sourcePeakNits: 1000,
  knee: 0.5,
  shoulder: 0.97,
  saturationPreservation: 0.7,
};

// PQ (ST 2084) constants
const PQ_M1 = 2610 / 16384;
const PQ_M2 = 2523 / 4096 * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = 2413 / 4096 * 32;
const PQ_C3 = 2392 / 4096 * 32;

// PQ peak luminance in nits
const PQ_PEAK_LUMINANCE = 10000;

// HLG constants
const HLG_A = 0.17883277;
const HLG_B = 0.28466892; // 1 - 4 * HLG_A
const HLG_C = 0.55991073; // 0.5 - HLG_A * ln(4 * HLG_A)

// Reference white for HLG system gamma
const HLG_REF_WHITE = 203; // nits

/**
 * HDR Transfer Service
 */
class HDRTransferServiceImpl {
  /**
   * Encode linear light to PQ (SMPTE ST 2084)
   * Input: linear light normalized to 0-1 (where 1 = 10000 nits)
   * Output: PQ encoded value 0-1
   */
  linearToPQ(linear: number): number {
    if (linear <= 0) return 0;
    if (linear >= 1) return 1;

    const Ym1 = Math.pow(linear, PQ_M1);
    const numerator = PQ_C1 + PQ_C2 * Ym1;
    const denominator = 1 + PQ_C3 * Ym1;
    return Math.pow(numerator / denominator, PQ_M2);
  }

  /**
   * Decode PQ to linear light
   * Input: PQ encoded value 0-1
   * Output: linear light normalized to 0-1 (where 1 = 10000 nits)
   */
  pqToLinear(pq: number): number {
    if (pq <= 0) return 0;
    if (pq >= 1) return 1;

    const Vm1m2 = Math.pow(pq, 1 / PQ_M2);
    const numerator = Math.max(Vm1m2 - PQ_C1, 0);
    const denominator = PQ_C2 - PQ_C3 * Vm1m2;
    return Math.pow(numerator / denominator, 1 / PQ_M1);
  }

  /**
   * Encode linear light to HLG (ARIB STD-B67)
   * Input: linear light normalized to 0-1 (scene-referred)
   * Output: HLG encoded value 0-1
   */
  linearToHLG(linear: number): number {
    if (linear <= 0) return 0;

    if (linear <= 1 / 12) {
      return Math.sqrt(3 * linear);
    } else {
      return HLG_A * Math.log(12 * linear - HLG_B) + HLG_C;
    }
  }

  /**
   * Decode HLG to linear light
   * Input: HLG encoded value 0-1
   * Output: linear light normalized to 0-1 (scene-referred)
   */
  hlgToLinear(hlg: number): number {
    if (hlg <= 0) return 0;

    if (hlg <= 0.5) {
      return (hlg * hlg) / 3;
    } else {
      return (Math.exp((hlg - HLG_C) / HLG_A) + HLG_B) / 12;
    }
  }

  /**
   * Apply HLG OOTF (Opto-Optical Transfer Function)
   * Converts scene-referred to display-referred light
   * @param linear Scene-referred linear value
   * @param displayGamma Display gamma (typically 1.2 for 1000 nits)
   * @param peakNits Display peak luminance
   */
  applyHLGOOTF(linear: number, displayGamma: number = 1.2, peakNits: number = 1000): number {
    // Calculate system gamma based on peak luminance, using displayGamma as base
    const systemGamma = displayGamma + 0.42 * Math.log10(peakNits / 1000);
    return Math.pow(linear, systemGamma);
  }

  /**
   * Convert nits to PQ-normalized value
   */
  nitsToPQNormalized(nits: number): number {
    return nits / PQ_PEAK_LUMINANCE;
  }

  /**
   * Convert PQ-normalized value to nits
   */
  pqNormalizedToNits(normalized: number): number {
    return normalized * PQ_PEAK_LUMINANCE;
  }

  /**
   * Apply PQ encoding to RGB image data
   * @param input Float32Array of linear RGB values (normalized to peak luminance)
   * @param sourcePeakNits Source content peak luminance
   */
  applyPQEncode(input: Float32Array, sourcePeakNits: number = 1000): Float32Array {
    const output = new Float32Array(input.length);
    const normalizer = sourcePeakNits / PQ_PEAK_LUMINANCE;

    for (let i = 0; i < input.length; i += 4) {
      // Normalize to PQ range and encode
      output[i] = this.linearToPQ(input[i] * normalizer);
      output[i + 1] = this.linearToPQ(input[i + 1] * normalizer);
      output[i + 2] = this.linearToPQ(input[i + 2] * normalizer);
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Apply PQ decoding to RGB image data
   * @param input Float32Array of PQ-encoded RGB values
   * @param targetPeakNits Target peak luminance for output
   */
  applyPQDecode(input: Float32Array, targetPeakNits: number = 1000): Float32Array {
    const output = new Float32Array(input.length);
    const denormalizer = PQ_PEAK_LUMINANCE / targetPeakNits;

    for (let i = 0; i < input.length; i += 4) {
      // Decode and scale to target luminance range
      output[i] = this.pqToLinear(input[i]) * denormalizer;
      output[i + 1] = this.pqToLinear(input[i + 1]) * denormalizer;
      output[i + 2] = this.pqToLinear(input[i + 2]) * denormalizer;
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Apply HLG encoding to RGB image data
   * @param input Float32Array of linear RGB values
   */
  applyHLGEncode(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);

    for (let i = 0; i < input.length; i += 4) {
      output[i] = this.linearToHLG(input[i]);
      output[i + 1] = this.linearToHLG(input[i + 1]);
      output[i + 2] = this.linearToHLG(input[i + 2]);
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Apply HLG decoding to RGB image data
   * @param input Float32Array of HLG-encoded RGB values
   * @param applyOOTF Whether to apply the OOTF for display
   * @param displayPeakNits Display peak luminance for OOTF
   */
  applyHLGDecode(
    input: Float32Array,
    applyOOTF: boolean = true,
    displayPeakNits: number = 1000
  ): Float32Array {
    const output = new Float32Array(input.length);

    for (let i = 0; i < input.length; i += 4) {
      let r = this.hlgToLinear(input[i]);
      let g = this.hlgToLinear(input[i + 1]);
      let b = this.hlgToLinear(input[i + 2]);

      if (applyOOTF) {
        // Calculate luminance for OOTF
        const Y = 0.2627 * r + 0.6780 * g + 0.0593 * b;
        const ootfScale = this.applyHLGOOTF(Y, 1.2, displayPeakNits) / (Y || 1);
        r *= ootfScale;
        g *= ootfScale;
        b *= ootfScale;
      }

      output[i] = r;
      output[i + 1] = g;
      output[i + 2] = b;
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Tone map HDR to SDR using Reinhard-inspired curve
   * @param input Float32Array of linear HDR RGB values
   * @param params Tone mapping parameters
   */
  toneMapToSDR(
    input: Float32Array,
    params: Partial<ToneMappingParams> = {}
  ): Float32Array {
    const config = { ...DEFAULT_TONE_MAPPING, ...params };
    const output = new Float32Array(input.length);

    // Calculate scale factor based on peak luminances
    const peakRatio = config.sourcePeakNits / config.targetPeakNits;
    const kneeStart = config.knee;
    const kneeEnd = config.shoulder;

    for (let i = 0; i < input.length; i += 4) {
      // Calculate luminance for color preservation
      const r = input[i];
      const g = input[i + 1];
      const b = input[i + 2];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (luminance <= 0) {
        output[i] = 0;
        output[i + 1] = 0;
        output[i + 2] = 0;
        output[i + 3] = input[i + 3];
        continue;
      }

      // Apply tone curve
      let mappedLuminance: number;
      const normalizedLum = luminance * peakRatio;

      if (normalizedLum <= kneeStart) {
        // Linear region
        mappedLuminance = normalizedLum;
      } else if (normalizedLum >= kneeEnd) {
        // Shoulder region - compressed to 1.0
        mappedLuminance = 1.0;
      } else {
        // Knee region - smooth transition
        const t = (normalizedLum - kneeStart) / (kneeEnd - kneeStart);
        const smoothT = t * t * (3 - 2 * t); // Hermite interpolation
        mappedLuminance = kneeStart + (1.0 - kneeStart) * smoothT;
      }

      // Scale colors while preserving hue
      const scale = mappedLuminance / normalizedLum;

      // Apply desaturation for very bright highlights
      const saturationScale = Math.min(1, 1 / (normalizedLum * 0.5 + 0.5));
      const finalSaturation = 1 - (1 - saturationScale) * (1 - config.saturationPreservation);

      let outR = r * scale;
      let outG = g * scale;
      let outB = b * scale;

      // Desaturate towards mapped luminance
      const avgMapped = (outR + outG + outB) / 3;
      outR = avgMapped + (outR - avgMapped) * finalSaturation;
      outG = avgMapped + (outG - avgMapped) * finalSaturation;
      outB = avgMapped + (outB - avgMapped) * finalSaturation;

      output[i] = Math.max(0, Math.min(1, outR));
      output[i + 1] = Math.max(0, Math.min(1, outG));
      output[i + 2] = Math.max(0, Math.min(1, outB));
      output[i + 3] = input[i + 3];
    }

    return output;
  }

  /**
   * Apply Hable filmic tone mapping (used in Uncharted 2)
   * Good for games and cinematic looks
   */
  toneMapHable(input: Float32Array, exposure: number = 1.0): Float32Array {
    const output = new Float32Array(input.length);

    // Hable curve helper
    const hableCurve = (x: number): number => {
      const A = 0.15; // Shoulder strength
      const B = 0.50; // Linear strength
      const C = 0.10; // Linear angle
      const D = 0.20; // Toe strength
      const E = 0.02; // Toe numerator
      const F = 0.30; // Toe denominator
      return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
    };

    // White point for normalization
    const whiteScale = 1.0 / hableCurve(11.2);

    for (let i = 0; i < input.length; i += 4) {
      const r = input[i] * exposure;
      const g = input[i + 1] * exposure;
      const b = input[i + 2] * exposure;

      output[i] = hableCurve(r) * whiteScale;
      output[i + 1] = hableCurve(g) * whiteScale;
      output[i + 2] = hableCurve(b) * whiteScale;
      output[i + 3] = input[i + 3];
    }

    return output;
  }

  /**
   * Apply ACES filmic tone mapping
   * Industry standard for film/TV production
   */
  toneMapACES(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);

    // Simplified ACES RRT + ODT
    const acesToneMap = (x: number): number => {
      const a = 2.51;
      const b = 0.03;
      const c = 2.43;
      const d = 0.59;
      const e = 0.14;
      return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
    };

    for (let i = 0; i < input.length; i += 4) {
      output[i] = acesToneMap(input[i]);
      output[i + 1] = acesToneMap(input[i + 1]);
      output[i + 2] = acesToneMap(input[i + 2]);
      output[i + 3] = input[i + 3];
    }

    return output;
  }

  /**
   * Convert between PQ and HLG
   * Useful for broadcast workflows
   */
  pqToHLG(input: Float32Array, hlgPeakNits: number = 1000): Float32Array {
    const output = new Float32Array(input.length);

    for (let i = 0; i < input.length; i += 4) {
      // Decode PQ to linear (10000 nits reference)
      const rLin = this.pqToLinear(input[i]) * (PQ_PEAK_LUMINANCE / hlgPeakNits);
      const gLin = this.pqToLinear(input[i + 1]) * (PQ_PEAK_LUMINANCE / hlgPeakNits);
      const bLin = this.pqToLinear(input[i + 2]) * (PQ_PEAK_LUMINANCE / hlgPeakNits);

      // Calculate luminance and inverse OOTF
      const Y = 0.2627 * rLin + 0.6780 * gLin + 0.0593 * bLin;
      const gamma = 1.2 + 0.42 * Math.log10(hlgPeakNits / 1000);
      const inverseOOTF = Y > 0 ? Math.pow(Y, (1 - gamma) / gamma) : 1;

      // Scale and encode to HLG
      output[i] = this.linearToHLG(Math.min(1, rLin * inverseOOTF));
      output[i + 1] = this.linearToHLG(Math.min(1, gLin * inverseOOTF));
      output[i + 2] = this.linearToHLG(Math.min(1, bLin * inverseOOTF));
      output[i + 3] = input[i + 3];
    }

    return output;
  }

  /**
   * Convert between HLG and PQ
   */
  hlgToPQ(input: Float32Array, hlgPeakNits: number = 1000): Float32Array {
    const output = new Float32Array(input.length);

    for (let i = 0; i < input.length; i += 4) {
      // Decode HLG to linear
      let rLin = this.hlgToLinear(input[i]);
      let gLin = this.hlgToLinear(input[i + 1]);
      let bLin = this.hlgToLinear(input[i + 2]);

      // Apply OOTF
      const Y = 0.2627 * rLin + 0.6780 * gLin + 0.0593 * bLin;
      const gamma = 1.2 + 0.42 * Math.log10(hlgPeakNits / 1000);
      const ootfScale = Y > 0 ? Math.pow(Y, gamma - 1) : 1;

      rLin *= ootfScale * (hlgPeakNits / PQ_PEAK_LUMINANCE);
      gLin *= ootfScale * (hlgPeakNits / PQ_PEAK_LUMINANCE);
      bLin *= ootfScale * (hlgPeakNits / PQ_PEAK_LUMINANCE);

      // Encode to PQ
      output[i] = this.linearToPQ(rLin);
      output[i + 1] = this.linearToPQ(gLin);
      output[i + 2] = this.linearToPQ(bLin);
      output[i + 3] = input[i + 3];
    }

    return output;
  }

  /**
   * Analyze HDR content for metadata extraction
   */
  analyzeHDRContent(input: Float32Array): HDRMetadata {
    let maxPixelValue = 0;
    let sumPixelValues = 0;
    let pixelCount = 0;

    for (let i = 0; i < input.length; i += 4) {
      const r = input[i];
      const g = input[i + 1];
      const b = input[i + 2];

      // Calculate luminance
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      maxPixelValue = Math.max(maxPixelValue, luminance);
      sumPixelValues += luminance;
      pixelCount++;
    }

    const avgLuminance = sumPixelValues / pixelCount;

    // Estimate nits (assuming linear values normalized to 1.0 = 100 nits SDR)
    const estimatedMaxNits = maxPixelValue * 100;
    const estimatedAvgNits = avgLuminance * 100;

    return {
      maxCLL: Math.round(estimatedMaxNits),
      maxFALL: Math.round(estimatedAvgNits),
      masteringDisplayMaxLuminance: Math.min(10000, Math.round(estimatedMaxNits * 1.2)),
      masteringDisplayMinLuminance: 0.0001,
      colorPrimaries: 'bt2020',
    };
  }

  /**
   * Generate GLSL code for PQ encoding
   */
  getGLSLPQEncode(): string {
    return `
// PQ (ST 2084) constants
const float PQ_M1 = 0.1593017578125;
const float PQ_M2 = 78.84375;
const float PQ_C1 = 0.8359375;
const float PQ_C2 = 18.8515625;
const float PQ_C3 = 18.6875;

vec3 linearToPQ(vec3 linear) {
  vec3 Ym1 = pow(max(linear, vec3(0.0)), vec3(PQ_M1));
  vec3 numerator = PQ_C1 + PQ_C2 * Ym1;
  vec3 denominator = 1.0 + PQ_C3 * Ym1;
  return pow(numerator / denominator, vec3(PQ_M2));
}

vec3 pqToLinear(vec3 pq) {
  vec3 Vm1m2 = pow(max(pq, vec3(0.0)), vec3(1.0 / PQ_M2));
  vec3 numerator = max(Vm1m2 - PQ_C1, vec3(0.0));
  vec3 denominator = PQ_C2 - PQ_C3 * Vm1m2;
  return pow(numerator / denominator, vec3(1.0 / PQ_M1));
}
`;
  }

  /**
   * Generate GLSL code for HLG encoding
   */
  getGLSLHLGEncode(): string {
    return `
// HLG (ARIB STD-B67) constants
const float HLG_A = 0.17883277;
const float HLG_B = 0.28466892;
const float HLG_C = 0.55991073;

float linearToHLGChannel(float linear) {
  if (linear <= 0.08333333) {
    return sqrt(3.0 * linear);
  } else {
    return HLG_A * log(12.0 * linear - HLG_B) + HLG_C;
  }
}

float hlgToLinearChannel(float hlg) {
  if (hlg <= 0.5) {
    return (hlg * hlg) / 3.0;
  } else {
    return (exp((hlg - HLG_C) / HLG_A) + HLG_B) / 12.0;
  }
}

vec3 linearToHLG(vec3 linear) {
  return vec3(
    linearToHLGChannel(linear.r),
    linearToHLGChannel(linear.g),
    linearToHLGChannel(linear.b)
  );
}

vec3 hlgToLinear(vec3 hlg) {
  return vec3(
    hlgToLinearChannel(hlg.r),
    hlgToLinearChannel(hlg.g),
    hlgToLinearChannel(hlg.b)
  );
}
`;
  }

  /**
   * Get constants for external use
   */
  getConstants(): {
    pqPeakLuminance: number;
    hlgRefWhite: number;
    pqConstants: { m1: number; m2: number; c1: number; c2: number; c3: number };
    hlgConstants: { a: number; b: number; c: number };
  } {
    return {
      pqPeakLuminance: PQ_PEAK_LUMINANCE,
      hlgRefWhite: HLG_REF_WHITE,
      pqConstants: {
        m1: PQ_M1,
        m2: PQ_M2,
        c1: PQ_C1,
        c2: PQ_C2,
        c3: PQ_C3,
      },
      hlgConstants: {
        a: HLG_A,
        b: HLG_B,
        c: HLG_C,
      },
    };
  }
}

// Export singleton instance
export const hdrTransferService = new HDRTransferServiceImpl();

// Export class for testing
export { HDRTransferServiceImpl };
