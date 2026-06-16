import { logger } from '../utils/Logger';
import { ModuleParams } from '../types/darktable';

export interface ImageData {
  width: number;
  height: number;
  data: Float32Array;
  channels: number;
}

export interface ImageProcessingModule {
  id: string;
  name: string;
  group: string;
  flags: Record<string, unknown>;
  process(imageData: ImageData): ImageData;
}

export interface ShadowsHighlightsParams extends ModuleParams {
  // Shadow recovery
  shadows: number;           // 0.0 to 100.0 - amount of shadow recovery
  shadowsRadius: number;     // 0.1 to 100.0 - radius for shadow detection
  shadowsColorTransfer: number; // 0.0 to 100.0 - color transfer in shadows

  // Highlight recovery
  highlights: number;        // 0.0 to 100.0 - amount of highlight recovery
  highlightsRadius: number;  // 0.1 to 100.0 - radius for highlight detection
  highlightsColorTransfer: number; // 0.0 to 100.0 - color transfer in highlights

  // White and black point adjustment
  whitePoint: number;        // -4.0 to +4.0 - white point adjustment
  blackPoint: number;        // -4.0 to +4.0 - black point adjustment

  // Advanced controls
  compress: number;          // 0.0 to 100.0 - compression amount
  shadowsColorCorrection: number; // 0.0 to 100.0 - shadow color correction
  highlightsColorCorrection: number; // 0.0 to 100.0 - highlight color correction

  // Masking and blending
  maskBlur: number;          // 0.0 to 10.0 - mask blur radius
  maskFalloff: number;       // 0.1 to 10.0 - mask falloff steepness
  preserveColor: boolean;    // preserve color during adjustment

  // Advanced options
  bilateralFilter: boolean;  // use bilateral filtering for smoother results
  iterations: number;        // 1 to 5 - number of processing iterations
  strength: number;          // 0.0 to 2.0 - overall effect strength
}

export class ShadowsHighlightsModule implements ImageProcessingModule {
  id = 'shadowshighlights';
  name = 'Shadows & Highlights';
  group = 'tone';
  flags = {};

  private params: ShadowsHighlightsParams = {
    enabled: true,

    // Shadow adjustment - 50 = neutral (no change)
    shadows: 50.0,
    shadowsRadius: 50.0,
    shadowsColorTransfer: 0.0,

    // Highlight adjustment - 50 = neutral (no change)
    highlights: 50.0,
    highlightsRadius: 50.0,
    highlightsColorTransfer: 0.0,

    // White and black points
    whitePoint: 0.0,
    blackPoint: 0.0,

    // Advanced controls - neutral defaults
    compress: 0.0,
    shadowsColorCorrection: 0.0,
    highlightsColorCorrection: 0.0,

    // Masking
    maskBlur: 1.0,
    maskFalloff: 2.0,
    preserveColor: true,

    // Advanced options
    bilateralFilter: false,
    iterations: 1,
    strength: 1.0
  };

  // Luminance weights for tone mapping calculations
  private readonly luminanceWeights = {
    r: 0.2126,
    g: 0.7152,
    b: 0.0722
  };

  getParams(): ShadowsHighlightsParams {
    return { ...this.params };
  }

  setParams(newParams: Partial<ShadowsHighlightsParams>): void {
    this.params = { ...this.params, ...newParams };
    logger.debug('ShadowsHighlights params updated:', this.params);
  }

  resetParams(): void {
    this.params = {
      enabled: true,
      shadows: 50.0,
      shadowsRadius: 50.0,
      shadowsColorTransfer: 0.0,
      highlights: 50.0,
      highlightsRadius: 50.0,
      highlightsColorTransfer: 0.0,
      whitePoint: 0.0,
      blackPoint: 0.0,
      compress: 0.0,
      shadowsColorCorrection: 0.0,
      highlightsColorCorrection: 0.0,
      maskBlur: 1.0,
      maskFalloff: 2.0,
      preserveColor: true,
      bilateralFilter: false,
      iterations: 1,
      strength: 1.0
    };
    logger.debug('ShadowsHighlights params reset to defaults');
  }

  autoAdjust(): ShadowsHighlightsParams {
    // Auto adjustment for shadows and highlights
    const autoParams: ShadowsHighlightsParams = {
      ...this.params,
      shadows: 63.0,              // 50 + 13 (moderate shadow lift)
      shadowsRadius: 40.0,        // Slightly tighter radius
      shadowsColorTransfer: 30.0, // Enhanced color transfer
      highlights: 58.0,           // 50 + 8 (mild highlight recovery)
      highlightsRadius: 45.0,     // Standard highlight radius
      highlightsColorTransfer: 20.0, // Moderate color transfer
      compress: 40.0,             // Reduced compression for more natural look
      strength: 1.2               // Slightly enhanced strength
    };

    this.params = { ...autoParams };
    logger.info('ShadowsHighlights auto adjustments applied:', autoParams);
    return { ...autoParams };
  }

  /**
   * Returns true when all tonal parameters are at their neutral (no-op) values,
   * meaning process() would return the input unchanged.
   *
   * NOTE: maskBlur, strength, and iterations are NOT part of this check —
   * blurring a zero-effect mask still yields zero net change.
   */
  isNoOp(): boolean {
    return this.params.shadows === 50 &&
           this.params.highlights === 50 &&
           this.params.whitePoint === 0 &&
           this.params.blackPoint === 0 &&
           this.params.compress === 0 &&
           this.params.shadowsColorCorrection === 0 &&
           this.params.highlightsColorCorrection === 0;
  }

  process(imageData: ImageData): ImageData {
    if (!this.params.enabled) {
      return imageData;
    }

    // Single-source: delegate to isNoOp() so the neutral condition is defined once.
    if (this.isNoOp()) {
      logger.debug('ShadowsHighlights: All parameters neutral, passing through unchanged');
      return imageData;
    }

    const startTime = performance.now();
    const { width, height, data } = imageData;
    const processedData = new Float32Array(data);

    // Debug input data
    const inputStats = { min: Infinity, max: -Infinity, nonZero: 0 };
    for (let i = 0; i < processedData.length; i += 4) {
      const r = processedData[i], g = processedData[i + 1], b = processedData[i + 2];
      inputStats.min = Math.min(inputStats.min, r, g, b);
      inputStats.max = Math.max(inputStats.max, r, g, b);
      if (r > 0.001 || g > 0.001 || b > 0.001) inputStats.nonZero++;
    }
    logger.info(`ShadowsHighlights INPUT: range=${inputStats.min.toFixed(4)}-${inputStats.max.toFixed(4)}, nonZero=${inputStats.nonZero}/${processedData.length/4}, params:`, {
      shadows: this.params.shadows,
      highlights: this.params.highlights,
      shadowsColorCorrection: this.params.shadowsColorCorrection,
      highlightsColorCorrection: this.params.highlightsColorCorrection,
      compress: this.params.compress
    });

    try {
      // Generate luminance and tone masks
      const luminanceData = this.generateLuminanceMap(processedData, width, height);
      const shadowMask = this.generateShadowMask(luminanceData, width, height);
      const highlightMask = this.generateHighlightMask(luminanceData, width, height);

      // Apply bilateral filtering if enabled
      if (this.params.bilateralFilter) {
        this.applyBilateralFilter(processedData, width, height);
      }

      // Process multiple iterations for stronger effects
      for (let iter = 0; iter < this.params.iterations; iter++) {
        // Apply shadow adjustment (50 = neutral, >50 = lift, <50 = darken)
        if (this.params.shadows !== 50) {
          this.applyShadowRecovery(processedData, shadowMask, width, height);
        }

        // Apply highlight adjustment (50 = neutral, >50 = recover, <50 = brighten)
        if (this.params.highlights !== 50) {
          this.applyHighlightRecovery(processedData, highlightMask, width, height);
        }

        // Apply white and black point adjustments
        if (this.params.whitePoint !== 0 || this.params.blackPoint !== 0) {
          this.applyWhiteBlackPointAdjustment(processedData, width, height);
        }
      }

      // Apply compression to prevent clipping
      if (this.params.compress > 0) {
        this.applyCompression(processedData, width, height);
      }

      // Apply color correction
      this.applyColorCorrection(processedData, shadowMask, highlightMask, width, height);

      // Debug output data
      const outputStats = { min: Infinity, max: -Infinity, nonZero: 0 };
      for (let i = 0; i < processedData.length; i += 4) {
        const r = processedData[i], g = processedData[i + 1], b = processedData[i + 2];
        outputStats.min = Math.min(outputStats.min, r, g, b);
        outputStats.max = Math.max(outputStats.max, r, g, b);
        if (r > 0.001 || g > 0.001 || b > 0.001) outputStats.nonZero++;
      }
      logger.info(`ShadowsHighlights OUTPUT: range=${outputStats.min.toFixed(4)}-${outputStats.max.toFixed(4)}, nonZero=${outputStats.nonZero}/${processedData.length/4}`);

      const processingTime = performance.now() - startTime;
      logger.debug(`ShadowsHighlights processing completed in ${processingTime.toFixed(2)}ms`);

      return {
        ...imageData,
        data: processedData
      };

    } catch (error) {
      logger.error('Error in ShadowsHighlights processing:', error);
      return imageData; // Return original on error
    }
  }

  private generateLuminanceMap(data: Float32Array, width: number, height: number): Float32Array {
    const luminance = new Float32Array(width * height);

    for (let i = 0; i < luminance.length; i++) {
      const pixelIndex = i * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      // Calculate relative luminance
      luminance[i] = r * this.luminanceWeights.r +
                    g * this.luminanceWeights.g +
                    b * this.luminanceWeights.b;
    }

    return luminance;
  }

  private generateShadowMask(luminance: Float32Array, width: number, height: number): Float32Array {
    const mask = new Float32Array(width * height);
    const radius = this.params.shadowsRadius / 100.0;
    const falloff = this.params.maskFalloff;

    for (let i = 0; i < mask.length; i++) {
      const lum = luminance[i];

      // Shadow mask: stronger for darker areas
      if (lum < radius) {
        mask[i] = 1.0;
      } else if (lum < radius * 2) {
        // Smooth falloff
        const t = (lum - radius) / radius;
        mask[i] = 1.0 - Math.pow(t, falloff);
      } else {
        mask[i] = 0.0;
      }
    }

    // Apply blur to mask for smoother transitions
    if (this.params.maskBlur > 0) {
      this.blurMask(mask, width, height, this.params.maskBlur);
    }

    return mask;
  }

  private generateHighlightMask(luminance: Float32Array, width: number, height: number): Float32Array {
    const mask = new Float32Array(width * height);
    const radius = this.params.highlightsRadius / 100.0;
    const falloff = this.params.maskFalloff;
    const threshold = 1.0 - radius; // Highlights are bright areas

    for (let i = 0; i < mask.length; i++) {
      const lum = luminance[i];

      // Highlight mask: stronger for brighter areas
      if (lum > threshold) {
        mask[i] = 1.0;
      } else if (lum > threshold * 0.5) {
        // Smooth falloff
        const t = (threshold - lum) / (threshold * 0.5);
        mask[i] = 1.0 - Math.pow(t, falloff);
      } else {
        mask[i] = 0.0;
      }
    }

    // Apply blur to mask for smoother transitions
    if (this.params.maskBlur > 0) {
      this.blurMask(mask, width, height, this.params.maskBlur);
    }

    return mask;
  }

  private blurMask(mask: Float32Array, width: number, height: number, radius: number): void {
    // Simple box blur approximation for mask smoothing
    const kernel = Math.ceil(radius * 2) + 1;
    const temp = new Float32Array(mask);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;

        for (let ky = -kernel; ky <= kernel; ky++) {
          for (let kx = -kernel; kx <= kernel; kx++) {
            const nx = Math.max(0, Math.min(width - 1, x + kx));
            const ny = Math.max(0, Math.min(height - 1, y + ky));
            const idx = ny * width + nx;

            const distance = Math.sqrt(kx * kx + ky * ky);
            if (distance <= radius) {
              const weight = Math.max(0, 1 - distance / radius);
              sum += temp[idx] * weight;
              count += weight;
            }
          }
        }

        mask[y * width + x] = count > 0 ? sum / count : temp[y * width + x];
      }
    }
  }

  private applyShadowRecovery(data: Float32Array, shadowMask: Float32Array, _width: number, _height: number): void {
    // Remap: 0=-1 (darken), 50=0 (neutral), 100=+1 (lift)
    const shadowAmount = (this.params.shadows - 50) / 50.0;
    const colorTransfer = this.params.shadowsColorTransfer / 100.0;
    const strength = this.params.strength;

    for (let i = 0; i < data.length; i += 4) {
      const maskValue = shadowMask[i / 4];
      const effect = maskValue * shadowAmount * strength;

      if (effect !== 0) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = r * this.luminanceWeights.r + g * this.luminanceWeights.g + b * this.luminanceWeights.b;

        // Positive = lift shadows, negative = darken shadows
        const recovery = Math.pow(1 - lum, 0.5) * effect;

        if (this.params.preserveColor) {
          const lift = 1.0 + recovery;
          data[i] = Math.max(0.0, Math.min(1.0, r * lift));
          data[i + 1] = Math.max(0.0, Math.min(1.0, g * lift));
          data[i + 2] = Math.max(0.0, Math.min(1.0, b * lift));
        } else {
          const mixAmount = colorTransfer * Math.abs(effect);
          const avgColor = (r + g + b) / 3;

          data[i] = Math.max(0.0, Math.min(1.0, r + recovery + (avgColor - r) * mixAmount));
          data[i + 1] = Math.max(0.0, Math.min(1.0, g + recovery + (avgColor - g) * mixAmount));
          data[i + 2] = Math.max(0.0, Math.min(1.0, b + recovery + (avgColor - b) * mixAmount));
        }
      }
    }
  }

  private applyHighlightRecovery(data: Float32Array, highlightMask: Float32Array, _width: number, _height: number): void {
    // Remap: 0=-1 (brighten), 50=0 (neutral), 100=+1 (recover/darken)
    const highlightAmount = (this.params.highlights - 50) / 50.0;
    const colorTransfer = this.params.highlightsColorTransfer / 100.0;
    const strength = this.params.strength;

    for (let i = 0; i < data.length; i += 4) {
      const maskValue = highlightMask[i / 4];
      const effect = maskValue * highlightAmount * strength;

      if (effect !== 0) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = r * this.luminanceWeights.r + g * this.luminanceWeights.g + b * this.luminanceWeights.b;

        // Positive = recover/darken highlights, negative = brighten highlights
        const recovery = Math.pow(lum, 0.5) * effect * 0.3;

        if (this.params.preserveColor) {
          data[i] = Math.max(0.0, Math.min(1.0, r - recovery));
          data[i + 1] = Math.max(0.0, Math.min(1.0, g - recovery));
          data[i + 2] = Math.max(0.0, Math.min(1.0, b - recovery));
        } else {
          const mixAmount = colorTransfer * Math.abs(effect) * 0.3;
          const avgColor = (r + g + b) / 3;

          data[i] = Math.max(0.0, Math.min(1.0, r - recovery + (avgColor - r) * mixAmount));
          data[i + 1] = Math.max(0.0, Math.min(1.0, g - recovery + (avgColor - g) * mixAmount));
          data[i + 2] = Math.max(0.0, Math.min(1.0, b - recovery + (avgColor - b) * mixAmount));
        }
      }
    }
  }

  private applyWhiteBlackPointAdjustment(data: Float32Array, _width: number, _height: number): void {
    // Linear formula: whitePoint 0 → 1x, +2 → 1.5x, -2 → 0.5x (gentle range)
    const whiteAdjust = 1.0 + this.params.whitePoint * 0.25;
    const blackAdjust = this.params.blackPoint / 100.0;

    for (let i = 0; i < data.length; i += 4) {
      // Apply black point adjustment
      data[i] = Math.max(0.0, data[i] - blackAdjust);
      data[i + 1] = Math.max(0.0, data[i + 1] - blackAdjust);
      data[i + 2] = Math.max(0.0, data[i + 2] - blackAdjust);

      // Apply white point adjustment
      data[i] = Math.min(1.0, data[i] * whiteAdjust);
      data[i + 1] = Math.min(1.0, data[i + 1] * whiteAdjust);
      data[i + 2] = Math.min(1.0, data[i + 2] * whiteAdjust);
    }
  }

  private applyCompression(data: Float32Array, _width: number, _height: number): void {
    const compress = this.params.compress / 100.0;

    // Only apply compression if parameter is significant
    if (compress < 0.01) return;

    // Simple linear compression that preserves dynamic range
    const compressionFactor = 1.0 - compress * 0.3; // Gentle compression

    for (let i = 0; i < data.length; i += 4) {
      // Apply gentle linear compression
      data[i] = Math.max(0.0, Math.min(1.0, data[i] * compressionFactor));
      data[i + 1] = Math.max(0.0, Math.min(1.0, data[i + 1] * compressionFactor));
      data[i + 2] = Math.max(0.0, Math.min(1.0, data[i + 2] * compressionFactor));
    }
  }

  private applyColorCorrection(
    data: Float32Array,
    shadowMask: Float32Array,
    highlightMask: Float32Array,
    _width: number,
    _height: number
  ): void {
    const shadowCorrection = this.params.shadowsColorCorrection / 100.0;
    const highlightCorrection = this.params.highlightsColorCorrection / 100.0;

    // Skip color correction if both parameters are at neutral values
    if (Math.abs(shadowCorrection) < 0.001 && Math.abs(highlightCorrection) < 0.001) {
      return;
    }

    for (let i = 0; i < data.length; i += 4) {
      const shadowMaskValue = shadowMask[i / 4];
      const highlightMaskValue = highlightMask[i / 4];

      // Apply color correction based on masks - only if parameters are non-zero
      // 0 = no correction, 100 = maximum correction
      if (shadowMaskValue > 0 && Math.abs(shadowCorrection) > 0.001) {
        const correction = 1.0 + (shadowCorrection * shadowMaskValue);
        data[i] = Math.max(0.0, Math.min(1.0, data[i] * correction));
        data[i + 1] = Math.max(0.0, Math.min(1.0, data[i + 1] * correction));
        data[i + 2] = Math.max(0.0, Math.min(1.0, data[i + 2] * correction));
      }

      if (highlightMaskValue > 0 && Math.abs(highlightCorrection) > 0.001) {
        const correction = 1.0 - (highlightCorrection * highlightMaskValue);
        data[i] = Math.max(0.0, Math.min(1.0, data[i] * correction));
        data[i + 1] = Math.max(0.0, Math.min(1.0, data[i + 1] * correction));
        data[i + 2] = Math.max(0.0, Math.min(1.0, data[i + 2] * correction));
      }
    }
  }

  private applyBilateralFilter(data: Float32Array, width: number, height: number): void {
    // Simplified bilateral filter for noise reduction
    const temp = new Float32Array(data);
    const spatialSigma = 2.0;
    const intensitySigma = 0.1;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const centerIdx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) { // RGB channels only
          let sum = 0;
          let weightSum = 0;
          const centerValue = temp[centerIdx + c];

          // 3x3 kernel
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const neighborIdx = ((y + dy) * width + (x + dx)) * 4;
              const neighborValue = temp[neighborIdx + c];

              const spatialWeight = Math.exp(-(dx * dx + dy * dy) / (2 * spatialSigma * spatialSigma));
              const intensityWeight = Math.exp(-(centerValue - neighborValue) * (centerValue - neighborValue) / (2 * intensitySigma * intensitySigma));
              const weight = spatialWeight * intensityWeight;

              sum += neighborValue * weight;
              weightSum += weight;
            }
          }

          data[centerIdx + c] = weightSum > 0 ? sum / weightSum : temp[centerIdx + c];
        }
      }
    }
  }

  // Preset methods for common use cases
  applyPreset(preset: 'subtle' | 'moderate' | 'strong' | 'highlights-only' | 'shadows-only'): void {
    switch (preset) {
      case 'subtle':
        this.setParams({
          shadows: 58.0,   // 50 + 8 (light lift)
          highlights: 55.0, // 50 + 5 (light recovery)
          shadowsRadius: 40.0,
          highlightsRadius: 40.0,
          compress: 25.0,
          strength: 0.7
        });
        break;

      case 'moderate':
        this.setParams({
          shadows: 65.0,   // 50 + 15
          highlights: 63.0, // 50 + 13
          shadowsRadius: 50.0,
          highlightsRadius: 50.0,
          compress: 40.0,
          strength: 1.0
        });
        break;

      case 'strong':
        this.setParams({
          shadows: 75.0,   // 50 + 25
          highlights: 70.0, // 50 + 20
          shadowsRadius: 60.0,
          highlightsRadius: 60.0,
          compress: 60.0,
          strength: 1.3,
          iterations: 2
        });
        break;

      case 'highlights-only':
        this.setParams({
          shadows: 50.0,   // neutral
          highlights: 68.0, // 50 + 18
          highlightsRadius: 45.0,
          compress: 50.0,
          strength: 1.0
        });
        break;

      case 'shadows-only':
        this.setParams({
          shadows: 70.0,   // 50 + 20
          highlights: 50.0, // neutral
          shadowsRadius: 55.0,
          compress: 30.0,
          strength: 1.0
        });
        break;
    }
  }
}