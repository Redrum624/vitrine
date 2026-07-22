import { logger } from '../utils/Logger';
import { validateInputDimensions, temperatureToRgb, safeDivide } from './utils/ColorUtils';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

export interface WhiteBalanceParams {
  temperature: number;    // 2000K to 50000K, default: 6500K (D65 reference, no correction)
  tint: number;          // -100.0 to 100.0, default: 0.0
  auto: boolean;         // Auto white balance enabled
  preset: string;        // 'custom' | 'daylight' | 'cloudy' | 'tungsten' | 'fluorescent' | 'flash'
  [key: string]: unknown; // Index signature for Record compatibility
}

export interface WhiteBalanceProcessingContext {
  width: number;
  height: number;
  channels: number;
}

// White balance presets (approximate values)
export const WHITE_BALANCE_PRESETS = {
  custom: { temperature: 6500, tint: 0 }, // D65 reference (no correction)
  daylight: { temperature: 5500, tint: 0 },
  cloudy: { temperature: 6000, tint: 0 },
  shade: { temperature: 7500, tint: 0 },
  tungsten: { temperature: 3200, tint: 0 },
  fluorescent: { temperature: 4000, tint: 10 },
  flash: { temperature: 5500, tint: 0 }
};

/**
 * Compute normalized per-channel WB gains from temperature (K) + tint (-100..100).
 * Exported as a module-level pure function so both WhiteBalanceModule.process() and
 * the GPU pass-list builder can share the SAME formula with zero drift risk.
 */
export function computeWBGains(temperature: number, tint: number): { r: number; g: number; b: number } {
  const tempRGB = temperatureToRgb(temperature);
  const referenceRGB = temperatureToRgb(6500);

  // Only the R/B RATIO of the Tanner-Helland kelvin→RGB curve is trusted here.
  // Its green component does not track the geometric mean of R and B (log on
  // the cool side, power-law on the warm side), so deriving a green gain from
  // it leaked every temperature move onto the green↔magenta axis (at tint=0:
  // ≈ +4.5% green at 9250K, ≈ −2.9% magenta at 3200K — "temperature shifts the
  // tint"). Pinning r = k, g = 1, b = 1/k keeps G/√(R·B) ≡ 1, so temperature
  // moves strictly along blue↔amber and tint below stays the sole
  // green↔magenta control. The R/B ratio (k²) is unchanged from the old model,
  // so solveTemperature/solveTint still invert this exactly.
  const rRatio = safeDivide(referenceRGB.r, tempRGB.r, 1);
  const bRatio = safeDivide(referenceRGB.b, tempRGB.b, 1);
  const k = Math.sqrt(safeDivide(rRatio, bRatio, 1));

  let r = k;
  let g = 1;
  let b = safeDivide(1, k, 1);

  // Apply green/magenta tint (positive = more green, negative = more magenta)
  const tintFactor = tint / 100.0;
  if (tintFactor > 0) {
    r *= (1 - tintFactor * 0.1);
    g *= (1 + tintFactor * 0.1);
    b *= (1 - tintFactor * 0.1);
  } else {
    const m = -tintFactor;
    r *= (1 + m * 0.1);
    g *= (1 - m * 0.1);
    b *= (1 + m * 0.1);
  }

  const avg = (r + g + b) / 3 || 1;
  return { r: r / avg, g: g / avg, b: b / avg };
}

/**
 * Fraction of the solved auto-WB correction that actually gets applied. Retains
 * ~30% of the scene's cast so auto WB cleans the cast without sterilising warm
 * scenes (sunsets, tungsten interiors) — matches camera/Lightroom auto behaviour.
 */
const AUTO_WB_STRENGTH = 0.7;

/**
 * No-cast dead-band: when the SOLVED correction is this small, auto WB applies
 * exactly 6500K / 0 instead of a token nudge. A near-balanced image (e.g. camera
 * WB already correct) must read as "no cast detected", not drift a few percent
 * warmer or cooler on estimator noise.
 *
 * The tint bound is widened to 30 (was 10) to cover LibRaw's slight near-gray
 * magenta bias on RAW sRGB output: a genuinely camera-correct RAW file measures
 * a solved tint around +27 (medians ~R0.61/G0.575/B0.606), which used to escape
 * the dead-band and apply a token 6452K/+19.3 nudge instead of a no-op. Real
 * casts (e.g. a green-cast scene solving ≈ -91) are far outside this bound and
 * still correct normally.
 */
const AUTO_WB_DEADBAND_TEMP_RATIO = 1.08; // solved temp within 6500/1.08..6500*1.08
const AUTO_WB_DEADBAND_TINT = 30;         // and |solved tint| below this

export class WhiteBalanceModule {
  private params: WhiteBalanceParams = {
    temperature: 6500, // D65 reference (no correction / identity)
    tint: 0.0,
    auto: false,
    preset: 'custom'
  };

  getId(): string {
    return 'temperature';
  }

  getName(): string {
    return 'White Balance';
  }

  getParams(): WhiteBalanceParams {
    return { ...this.params };
  }

  setParams(params: Partial<WhiteBalanceParams>): void {
    this.params = { ...this.params, ...params };
    logger.debug(`WhiteBalance params updated:`, this.params);
  }

  setPreset(preset: string): void {
    if (preset in WHITE_BALANCE_PRESETS) {
      const presetValues = WHITE_BALANCE_PRESETS[preset as keyof typeof WHITE_BALANCE_PRESETS];
      this.setParams({
        preset,
        temperature: presetValues.temperature,
        tint: presetValues.tint
      });
      logger.debug(`WhiteBalance preset applied: ${preset}`);
    }
  }

  resetParams(): void {
    this.params = {
      temperature: 6500, // D65 reference (no correction / identity)
      tint: 0.0,
      auto: false,
      preset: 'custom'
    };
    logger.debug('WhiteBalance params reset to defaults');
  }

  /**
   * Normalized per-channel gains the module applies for a given temperature (K) +
   * tint. Delegates to the module-level `computeWBGains` so both process() and the
   * GPU pass-list builder share the identical formula.
   */
  private computeGains(temperature: number, tint: number): { r: number; g: number; b: number } {
    return computeWBGains(temperature, tint);
  }

  process(input: Float32Array, context: WhiteBalanceProcessingContext): Float32Array {
    const { width, height, channels } = context;

    // Validate input dimensions
    validateInputDimensions(input, width, height, channels, 'WhiteBalanceModule');

    const output = new Float32Array(input.length);

    // Copy input to output
    output.set(input);

    logger.debug(`Processing WhiteBalance: ${width}x${height}, temp: ${this.params.temperature}K, tint: ${this.params.tint}`);

    // Channel gains for the current temperature + tint (shared with auto-detect so
    // the auto estimator inverts the EXACT model that gets applied here).
    const { r: rFactor, g: gFactor, b: bFactor } = this.computeGains(this.params.temperature, this.params.tint);

    // GPU fast-path: apply the pre-computed channel gains on the GPU (RGBA only).
    if (channels === 4 && webGLImageProcessor.isAvailable()) {
      return webGLImageProcessor.applyChannelGains(output, width, height, rFactor, gFactor, bFactor);
    }

    // Apply white balance correction to each pixel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;

        const r = output[pixelIndex] * rFactor;
        const g = output[pixelIndex + 1] * gFactor;
        const b = output[pixelIndex + 2] * bFactor;

        // Clamp values to valid range
        output[pixelIndex] = Math.max(0.0, Math.min(1.0, r));
        output[pixelIndex + 1] = Math.max(0.0, Math.min(1.0, g));
        output[pixelIndex + 2] = Math.max(0.0, Math.min(1.0, b));
      }
    }

    logger.debug('WhiteBalance processing completed');
    return output;
  }

  /**
   * Auto white balance — gray-candidate estimation with a damped, warmth-preserving
   * correction. Samples the whole image, prefers NEAR-NEUTRAL (low relative chroma)
   * samples for the illuminant estimate (a colourful subject like a sunset sky must
   * not drag it), takes per-channel MEDIANS (robust to outliers), solves the
   * temperature AND tint that would neutralise that median cast by inverting the
   * module's own gain model, then applies only AUTO_WB_STRENGTH of the correction —
   * deliberately NOT full neutralisation, so warm scenes keep part of their cast.
   */
  autoDetectWhiteBalance(input: Float32Array, context: WhiteBalanceProcessingContext): void {
    const { width, height, channels } = context;
    const totalPixels = width * height;
    if (totalPixels === 0) return;

    // Sample across the whole image (stride for speed). Skip clipped pixels
    // (near-black / near-white) — they carry no reliable colour for gray-world.
    const targetSamples = 40000;
    const step = Math.max(1, Math.floor(totalPixels / targetSamples));
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let p = 0; p < totalPixels; p += step) {
      const i = p * channels;
      const r = input[i], g = input[i + 1], b = input[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 0.04 || lum > 0.96) continue;
      rs.push(r); gs.push(g); bs.push(b);
    }
    // Fallback when almost everything is clipped: use every sampled pixel.
    if (rs.length < 50) {
      rs.length = 0; gs.length = 0; bs.length = 0;
      for (let p = 0; p < totalPixels; p += step) {
        const i = p * channels;
        rs.push(input[i]); gs.push(input[i + 1]); bs.push(input[i + 2]);
      }
    }

    // Gray-candidate subset: near-neutral (low relative chroma) samples reveal the
    // illuminant; a colourful subject (e.g. a sunset sky) must not drag the estimate.
    const grayR: number[] = [], grayG: number[] = [], grayB: number[] = [];
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i], g = gs[i], b = bs[i];
      const maxC = Math.max(r, g, b);
      const chroma = (maxC - Math.min(r, g, b)) / Math.max(maxC, 1e-6);
      if (chroma < 0.25) { grayR.push(r); grayG.push(g); grayB.push(b); }
    }
    // Only trust the subset when it is big enough to be representative; otherwise
    // fall back to all kept samples (whole-scene median gray-world).
    const useGray = grayR.length >= Math.max(200, rs.length * 0.02);

    const mR = this.median(useGray ? grayR : rs);
    const mG = this.median(useGray ? grayG : gs);
    const mB = this.median(useGray ? grayB : bs);
    if (mR <= 0 && mG <= 0 && mB <= 0) return; // black image — nothing to balance

    // 1) Temperature that would neutralise the red/blue (warm/cool) cast.
    const solvedTemperature = this.solveTemperature(mR, mB);
    // 2) Tint that would neutralise the residual green/magenta cast (R/B preserved).
    const solvedTint = this.solveTint(solvedTemperature, mR, mG, mB);

    // Damp the correction so it cleans the cast without sterilising the scene:
    // temperature is damped in log-temperature ratio space (6500K is the fixed
    // point, direction is preserved), tint is scaled and clamped. A solved
    // correction inside the no-cast dead-band snaps to exactly 6500K / 0.
    const tempRatio = Math.max(solvedTemperature, 6500) / Math.min(solvedTemperature, 6500);
    const noCast = tempRatio <= AUTO_WB_DEADBAND_TEMP_RATIO && Math.abs(solvedTint) < AUTO_WB_DEADBAND_TINT;
    const appliedTemperature = noCast ? 6500 : 6500 * Math.pow(solvedTemperature / 6500, AUTO_WB_STRENGTH);
    const appliedTint = noCast ? 0 : Math.max(-35, Math.min(35, solvedTint * AUTO_WB_STRENGTH));

    this.setParams({
      temperature: Math.round(appliedTemperature),
      tint: Math.round(appliedTint * 10) / 10,
      auto: true
    });

    logger.info(`Auto white balance (gray-candidate, damped ×${AUTO_WB_STRENGTH}): samples=${useGray ? grayR.length : rs.length}/${rs.length} (${grayR.length} gray candidates, ${useGray ? 'subset' : 'all-sample fallback'}), median RGB=(${mR.toFixed(3)}, ${mG.toFixed(3)}, ${mB.toFixed(3)}), solved ${Math.round(solvedTemperature)}K / tint ${Math.round(solvedTint * 10) / 10} → applied ${Math.round(appliedTemperature)}K / tint ${Math.round(appliedTint * 10) / 10}${noCast ? ' (no-cast dead-band)' : ''}`);
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Find the temperature whose channel gains make corrected R equal corrected B.
   * f(T) = gainR·mR − gainB·mB is monotonic increasing in T, so binary-search it.
   */
  private solveTemperature(mR: number, mB: number): number {
    let lo = 2000, hi = 12000;
    const f = (t: number) => {
      const g = this.computeGains(t, 0);
      return g.r * mR - g.b * mB;
    };
    const flo = f(lo), fhi = f(hi);
    if (flo > 0 && fhi > 0) return lo; // even the coolest temp can't remove the warm cast
    if (flo < 0 && fhi < 0) return hi; // even the warmest can't remove the cool cast
    for (let iter = 0; iter < 40; iter++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * With temperature fixed, find the tint that makes corrected G equal the average
   * of corrected R and B. h(tint) is monotonic increasing in tint, so binary-search.
   */
  private solveTint(temperature: number, mR: number, mG: number, mB: number): number {
    let lo = -100, hi = 100;
    const h = (t: number) => {
      const g = this.computeGains(temperature, t);
      return g.g * mG - (g.r * mR + g.b * mB) / 2;
    };
    const hlo = h(lo), hhi = h(hi);
    if (hlo > 0 && hhi > 0) return lo;
    if (hlo < 0 && hhi < 0) return hi;
    for (let iter = 0; iter < 40; iter++) {
      const mid = (lo + hi) / 2;
      if (h(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
}