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

  private applyTint(r: number, g: number, b: number, tint: number): { r: number; g: number; b: number } {
    // Apply green/magenta tint adjustment
    // Positive tint = more green, negative tint = more magenta
    const tintFactor = tint / 100.0;

    if (tintFactor > 0) {
      // Add green, reduce magenta (red + blue)
      return {
        r: r * (1 - tintFactor * 0.1),
        g: g * (1 + tintFactor * 0.1),
        b: b * (1 - tintFactor * 0.1)
      };
    } else {
      // Add magenta, reduce green
      const magentaFactor = -tintFactor;
      return {
        r: r * (1 + magentaFactor * 0.1),
        g: g * (1 - magentaFactor * 0.1),
        b: b * (1 + magentaFactor * 0.1)
      };
    }
  }

  process(input: Float32Array, context: WhiteBalanceProcessingContext): Float32Array {
    const { width, height, channels } = context;

    // Validate input dimensions
    validateInputDimensions(input, width, height, channels, 'WhiteBalanceModule');

    const output = new Float32Array(input.length);

    // Copy input to output
    output.set(input);

    logger.debug(`Processing WhiteBalance: ${width}x${height}, temp: ${this.params.temperature}K, tint: ${this.params.tint}`);

    // Calculate RGB multipliers from temperature using shared utility
    const tempRGB = temperatureToRgb(this.params.temperature);

    // Reference white point (6500K)
    const referenceRGB = temperatureToRgb(6500);

    // Calculate correction factors with safe division
    let rFactor = safeDivide(referenceRGB.r, tempRGB.r, 1);
    let gFactor = safeDivide(referenceRGB.g, tempRGB.g, 1);
    let bFactor = safeDivide(referenceRGB.b, tempRGB.b, 1);

    // Apply tint correction
    const tintedFactors = this.applyTint(rFactor, gFactor, bFactor, this.params.tint);
    rFactor = tintedFactors.r;
    gFactor = tintedFactors.g;
    bFactor = tintedFactors.b;

    // Normalize factors to prevent overall brightness change
    const avgFactor = (rFactor + gFactor + bFactor) / 3;
    rFactor /= avgFactor;
    gFactor /= avgFactor;
    bFactor /= avgFactor;

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

  autoDetectWhiteBalance(input: Float32Array, context: WhiteBalanceProcessingContext): void {
    // Simple auto white balance using grey world assumption
    const { width, height, channels } = context;

    let rSum = 0, gSum = 0, bSum = 0;
    let pixelCount = 0;

    // Sample middle portion of image to avoid edges
    const startX = Math.floor(width * 0.25);
    const endX = Math.floor(width * 0.75);
    const startY = Math.floor(height * 0.25);
    const endY = Math.floor(height * 0.75);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const pixelIndex = (y * width + x) * channels;
        rSum += input[pixelIndex];
        gSum += input[pixelIndex + 1];
        bSum += input[pixelIndex + 2];
        pixelCount++;
      }
    }

    if (pixelCount > 0) {
      const rAvg = rSum / pixelCount;
      const gAvg = gSum / pixelCount;
      const bAvg = bSum / pixelCount;

      // Estimate temperature based on R/B ratio (with safe division)
      const rbRatio = safeDivide(rAvg, bAvg, 1);
      const estimatedTemp = Math.max(2000, Math.min(50000, safeDivide(6500, rbRatio, 6500)));

      // Estimate tint based on G deviation from average
      const avgColor = (rAvg + gAvg + bAvg) / 3;
      const gDeviation = safeDivide(gAvg - avgColor, avgColor, 0);
      const estimatedTint = Math.max(-100, Math.min(100, gDeviation * 100));

      this.setParams({
        temperature: Math.round(estimatedTemp),
        tint: Math.round(estimatedTint * 10) / 10,
        auto: true
      });

      logger.info(`Auto white balance detected: ${Math.round(estimatedTemp)}K, tint: ${Math.round(estimatedTint * 10) / 10}`);
    }
  }
}