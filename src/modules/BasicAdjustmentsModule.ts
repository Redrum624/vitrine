import { logger } from '../utils/Logger';

export interface BasicAdjParams {
  black_point: number;    // -1.0 to 1.0, default: 0.0
  exposure: number;       // -1.0 to 1.0, default: 0.0
  contrast: number;       // -1.0 to 5.0, default: 0.0
  brightness: number;     // -4.0 to 4.0, default: 0.0
  saturation: number;     // -1.0 to 1.0, default: 0.0
  vibrance: number;       // -1.0 to 1.0, default: 0.0
  [key: string]: unknown; // Index signature for Record compatibility
}

export interface BasicAdjProcessingContext {
  width: number;
  height: number;
  channels: number;
}

export class BasicAdjustmentsModule {
  private params: BasicAdjParams = {
    black_point: 0.0,
    exposure: 0.0,      // Neutral starting point
    contrast: 0.0,      // Neutral starting point
    brightness: 0.0,
    saturation: 0.0,
    vibrance: 0.0
  };

  getId(): string {
    return 'basicadj';
  }

  getName(): string {
    return 'Basic Adjustments';
  }

  getParams(): BasicAdjParams {
    return { ...this.params };
  }

  setParams(params: Partial<BasicAdjParams>): void {
    this.params = { ...this.params, ...params };
    logger.debug(`BasicAdj params updated:`, this.params);
  }

  resetParams(): void {
    this.params = {
      black_point: 0.0,
      exposure: 0.0,      // Neutral defaults
      contrast: 0.0,      // Neutral defaults
      brightness: 0.0,
      saturation: 0.0,
      vibrance: 0.0
    };
    logger.debug('BasicAdj params reset to neutral defaults');
  }

  autoAdjust(): BasicAdjParams {
    // Simple auto adjustment algorithm
    // In a real implementation, this would analyze the image histogram
    const autoParams: BasicAdjParams = {
      black_point: 0.0,       // No black point adjustment (was causing zero values)
      exposure: 0.5,          // More exposure boost to brighten image
      contrast: 0.2,          // Moderate contrast increase
      brightness: 0.1,        // Slight brightness boost
      saturation: 0.1,        // Slight saturation boost
      vibrance: 0.15          // Moderate vibrance increase
    };

    this.params = { ...autoParams };
    logger.info('BasicAdj auto adjustments applied:', autoParams);
    return { ...autoParams };
  }

  process(input: Float32Array, context: BasicAdjProcessingContext): Float32Array {
    const { width, height, channels } = context;
    const output = new Float32Array(input.length);

    // Copy input to output
    output.set(input);

    // Log key parameters for monitoring
    logger.info(`BasicAdj processing with exposure: ${this.params.exposure}, contrast: ${this.params.contrast}`);

    logger.debug(`Processing BasicAdj: ${width}x${height}, channels: ${channels}`);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;

        for (let c = 0; c < 3; c++) { // Process RGB channels
          let pixel = output[pixelIndex + c];

          // Apply exposure adjustment (multiplicative)
          if (this.params.exposure !== 0.0) {
            // Clamp exposure to reasonable range to prevent data corruption
            const clampedExposure = Math.max(-1.0, Math.min(1.0, this.params.exposure));
            const exposureFactor = Math.pow(2.0, clampedExposure);
            pixel *= exposureFactor;


            // Warn if exposure was clamped
            if (clampedExposure !== this.params.exposure) {
              logger.warn(`BasicAdj: Exposure clamped from ${this.params.exposure} to ${clampedExposure} to prevent data corruption`);
            }
          }

          // Apply black point adjustment
          if (this.params.black_point !== 0.0) {
            pixel = Math.max(0.0, pixel - this.params.black_point);
          }

          // Apply brightness adjustment (additive)
          if (this.params.brightness !== 0.0) {
            pixel += this.params.brightness * 0.1; // Scale to reasonable range
          }

          // Apply contrast adjustment
          if (this.params.contrast !== 0.0) {
            // Contrast around midpoint (0.5)
            const contrastFactor = 1.0 + this.params.contrast;
            pixel = 0.5 + (pixel - 0.5) * contrastFactor;
          }

          // Clamp to valid range and ensure minimum visibility
          pixel = Math.max(0.0, Math.min(1.0, pixel));

          // Prevent very small values from being lost in subsequent processing
          if (pixel > 0.0 && pixel < 0.001) {
            pixel = 0.001;
          }

          output[pixelIndex + c] = pixel;
        }

        // Apply saturation and vibrance to RGB as a group
        if (this.params.saturation !== 0.0 || this.params.vibrance !== 0.0) {
          const r = output[pixelIndex];
          const g = output[pixelIndex + 1];
          const b = output[pixelIndex + 2];

          // Convert to perceived luminance
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

          // Apply saturation
          if (this.params.saturation !== 0.0) {
            const saturationFactor = 1.0 + this.params.saturation;
            output[pixelIndex] = luminance + (r - luminance) * saturationFactor;
            output[pixelIndex + 1] = luminance + (g - luminance) * saturationFactor;
            output[pixelIndex + 2] = luminance + (b - luminance) * saturationFactor;
          }

          // Apply vibrance (more subtle, affects less saturated colors more)
          if (this.params.vibrance !== 0.0) {
            const maxColor = Math.max(r, g, b);
            const minColor = Math.min(r, g, b);
            const currentSaturation = maxColor > 0 ? (maxColor - minColor) / maxColor : 0;

            // Vibrance affects less saturated colors more
            const vibranceStrength = this.params.vibrance * (1.0 - currentSaturation);
            const vibranceFactor = 1.0 + vibranceStrength;

            output[pixelIndex] = Math.max(0.0, Math.min(1.0, luminance + (output[pixelIndex] - luminance) * vibranceFactor));
            output[pixelIndex + 1] = Math.max(0.0, Math.min(1.0, luminance + (output[pixelIndex + 1] - luminance) * vibranceFactor));
            output[pixelIndex + 2] = Math.max(0.0, Math.min(1.0, luminance + (output[pixelIndex + 2] - luminance) * vibranceFactor));
          }
        }
      }
    }

    // Quick statistics for monitoring
    let minVal = Infinity, maxVal = -Infinity, nonZeroCount = 0;
    for (let i = 0; i < output.length; i += 4) {
      const r = output[i], g = output[i + 1], b = output[i + 2];
      minVal = Math.min(minVal, r, g, b);
      maxVal = Math.max(maxVal, r, g, b);
      if (r > 0.001 || g > 0.001 || b > 0.001) nonZeroCount++;
    }
    logger.info(`BasicAdj OUTPUT: range=${minVal.toFixed(4)}-${maxVal.toFixed(4)}, nonZero=${nonZeroCount}/${output.length/4}`);

    logger.debug('BasicAdj processing completed');
    return output;
  }
}