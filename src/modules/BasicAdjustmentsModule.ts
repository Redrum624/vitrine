import { logger } from '../utils/Logger';
import { validateInputDimensions, calculateLuminance } from './utils/ColorUtils';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

export interface BasicAdjParams {
  black_point: number;    // -1.0 to 1.0, default: 0.0
  exposure: number;       // -1.0 to 1.0, default: 0.0
  contrast: number;       // -1.0 to 5.0, default: 0.0
  brightness: number;     // -4.0 to 4.0, default: 0.0
  saturation: number;     // -1.0 to 1.0, default: 0.0
  vibrance: number;       // -1.0 to 1.0, default: 0.0
  dehaze: number;         // -1.0 to 1.0, default: 0.0
  highlights: number;     // -1.0 to 1.0, default: 0.0 (negative recovers, positive brightens)
  shadows: number;        // -1.0 to 1.0, default: 0.0 (positive lifts, negative deepens)
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
    vibrance: 0.0,
    dehaze: 0.0,
    highlights: 0.0,
    shadows: 0.0
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
      vibrance: 0.0,
      dehaze: 0.0,
      highlights: 0.0,
      shadows: 0.0
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
      vibrance: 0.15,         // Moderate vibrance increase
      dehaze: 0.0,            // No haze removal by default
      highlights: 0.0,
      shadows: 0.0
    };

    this.params = { ...autoParams };
    logger.info('BasicAdj auto adjustments applied:', autoParams);
    return { ...autoParams };
  }

  process(input: Float32Array, context: BasicAdjProcessingContext): Float32Array {
    const { width, height, channels } = context;

    // Validate input dimensions
    validateInputDimensions(input, width, height, channels, 'BasicAdjustmentsModule');

    const output = new Float32Array(input.length);

    // Copy input to output
    output.set(input);

    // GPU fast-path: when WebGL2 is available and its output has been verified to
    // match this CPU code (self-check on init), run the whole per-pixel pass on the
    // GPU. RGBA only (the shader assumes 4 channels); otherwise the CPU loop below
    // runs. The GPU path itself falls back to an identical CPU reference on error.
    if (channels === 4 && webGLImageProcessor.isAvailable()) {
      return webGLImageProcessor.applyBasicAdjustments(output, width, height, this.params);
    }

    // Log key parameters for monitoring (debug level to reduce noise)
    logger.debug(`BasicAdj processing with exposure: ${this.params.exposure}, contrast: ${this.params.contrast}`);

    logger.debug(`Processing BasicAdj: ${width}x${height}, channels: ${channels}`);

    // Dehaze pre-pass: estimate the atmospheric/haze floor ONCE before the loop.
    // Hazy images have a lifted black floor (light scattered into the shadows), so
    // we sample the per-pixel minimum channel (dark-channel proxy) over a strided
    // grid and take a low percentile as the haze floor to subtract back out.
    const clampedDehaze = Math.max(-1.0, Math.min(1.0, this.params.dehaze));
    const dehazeActive = Math.abs(clampedDehaze) > 0.001;
    let hazeFloor = 0.0;
    if (dehazeActive) {
      const totalPixels = width * height;
      // Stride so we sample roughly a few thousand pixels regardless of size.
      const step = Math.max(1, Math.floor(totalPixels / 4096));
      const darkChannelSamples: number[] = [];
      for (let p = 0; p < totalPixels; p += step) {
        const idx = p * channels;
        const minChannel = Math.min(output[idx], output[idx + 1], output[idx + 2]);
        darkChannelSamples.push(minChannel);
      }
      if (darkChannelSamples.length > 0) {
        darkChannelSamples.sort((a, b) => a - b);
        // 10th percentile of the dark channel approximates the haze floor.
        const percentileIndex = Math.floor(darkChannelSamples.length * 0.1);
        hazeFloor = darkChannelSamples[percentileIndex];
      }
    }
    // Scale the floor by the dehaze amount; cap the strength so we never divide by
    // a value close to 0 (keeps the transmission divisor safely above 0).
    const hazeStrength = dehazeActive ? clampedDehaze * 0.5 * hazeFloor : 0.0;
    const hazeDivisor = 1.0 - hazeStrength;

    // Highlights / Shadows: simple luminance-masked tone shifts (params -1..1).
    const clampedHighlights = Math.max(-1.0, Math.min(1.0, this.params.highlights));
    const clampedShadows = Math.max(-1.0, Math.min(1.0, this.params.shadows));
    const highlightsActive = Math.abs(clampedHighlights) > 0.001;
    const shadowsActive = Math.abs(clampedShadows) > 0.001;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;

        // Luminance masks for highlights/shadows, from the as-yet-unmodified pixel.
        const lumHS = (highlightsActive || shadowsActive)
          ? calculateLuminance(output[pixelIndex], output[pixelIndex + 1], output[pixelIndex + 2])
          : 0;
        const hMask = highlightsActive ? lumHS * lumHS : 0;
        const sMask = shadowsActive ? (1 - lumHS) * (1 - lumHS) : 0;

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

          // Apply black point adjustment (scaled down — raw param is -1 to 1)
          if (this.params.black_point !== 0.0) {
            pixel = Math.max(0.0, pixel - this.params.black_point * 0.1);
          }

          // Apply brightness adjustment (additive)
          if (this.params.brightness !== 0.0) {
            pixel += this.params.brightness * 0.1; // Scale to reasonable range
          }

          // Apply contrast adjustment (scaled — raw param is -1 to 5)
          if (this.params.contrast !== 0.0) {
            // Contrast around midpoint (0.5)
            const contrastFactor = 1.0 + this.params.contrast * 0.1;
            pixel = 0.5 + (pixel - 0.5) * contrastFactor;
          }

          // Apply dehaze (globally-approximated haze removal). Subtract the scaled
          // haze floor then renormalize by the transmission divisor so the tonal
          // range re-expands toward black — darktable-style global haze removal.
          // Positive dehaze removes haze (more contrast); negative adds haze back.
          if (dehazeActive) {
            pixel = (pixel - hazeStrength) / hazeDivisor;
            // A small contrast bump around the midpoint reinforces the de-hazed look.
            const dehazeContrastFactor = 1.0 + clampedDehaze * 0.15;
            pixel = 0.5 + (pixel - 0.5) * dehazeContrastFactor;
          }

          // Highlights / Shadows tone shift (luminance-masked).
          if (highlightsActive) pixel += clampedHighlights * 0.4 * hMask;
          if (shadowsActive) pixel += clampedShadows * 0.4 * sMask;

          // Clamp to valid range and ensure minimum visibility
          pixel = Math.max(0.0, Math.min(1.0, pixel));

          // Prevent very small values from being lost in subsequent processing
          if (pixel > 0.0 && pixel < 0.001) {
            pixel = 0.001;
          }

          output[pixelIndex + c] = pixel;
        }

        // Apply saturation and vibrance to RGB as a group.
        // Dehaze also nudges saturation (haze desaturates; removing it restores colour).
        if (this.params.saturation !== 0.0 || this.params.vibrance !== 0.0 || dehazeActive) {
          const r = output[pixelIndex];
          const g = output[pixelIndex + 1];
          const b = output[pixelIndex + 2];

          // Convert to perceived luminance using shared utility
          const luminance = calculateLuminance(r, g, b);

          // Apply saturation (with a mild dehaze-driven boost)
          const dehazeSaturationBoost = dehazeActive ? clampedDehaze * 0.3 : 0.0;
          if (this.params.saturation !== 0.0 || dehazeSaturationBoost !== 0.0) {
            // Floor at 0 so a strong negative saturation combined with the dehaze
            // boost can't drive the factor negative and INVERT the channels; it caps
            // at full desaturation (pure luminance / grayscale).
            const saturationFactor = Math.max(0, 1.0 + this.params.saturation + dehazeSaturationBoost);
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
    logger.debug(`BasicAdj OUTPUT: range=${minVal.toFixed(4)}-${maxVal.toFixed(4)}, nonZero=${nonZeroCount}/${output.length/4}`);

    logger.debug('BasicAdj processing completed');
    return output;
  }
}