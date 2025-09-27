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

    // Shadow recovery - start with neutral values
    shadows: 0.0,
    shadowsRadius: 50.0,
    shadowsColorTransfer: 0.0,

    // Highlight recovery - start with neutral values
    highlights: 0.0,
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
      shadows: 0.0,
      shadowsRadius: 50.0,
      shadowsColorTransfer: 25.0,
      highlights: 0.0,
      highlightsRadius: 50.0,
      highlightsColorTransfer: 25.0,
      whitePoint: 0.0,
      blackPoint: 0.0,
      compress: 50.0,
      shadowsColorCorrection: 100.0,
      highlightsColorCorrection: 100.0,
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
      shadows: 25.0,              // Moderate shadow recovery
      shadowsRadius: 40.0,        // Slightly tighter radius
      shadowsColorTransfer: 30.0, // Enhanced color transfer
      highlights: 15.0,           // Mild highlight recovery
      highlightsRadius: 45.0,     // Standard highlight radius
      highlightsColorTransfer: 20.0, // Moderate color transfer
      compress: 40.0,             // Reduced compression for more natural look
      strength: 1.2               // Slightly enhanced strength
    };

    this.params = { ...autoParams };
    logger.info('ShadowsHighlights auto adjustments applied:', autoParams);
    return { ...autoParams };
  }

  process(imageData: ImageData): ImageData {
    if (!this.params.enabled) {
      return imageData;
    }

    const startTime = performance.now();
    const { width, height, data } = imageData;
    const processedData = new Float32Array(data);

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
        // Apply shadow recovery
        if (this.params.shadows > 0) {
          this.applyShadowRecovery(processedData, shadowMask, width, height);
        }

        // Apply highlight recovery
        if (this.params.highlights > 0) {
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
    const radius = 1.0 - (this.params.highlightsRadius / 100.0);
    const falloff = this.params.maskFalloff;

    for (let i = 0; i < mask.length; i++) {
      const lum = luminance[i];

      // Highlight mask: stronger for brighter areas
      if (lum > radius) {
        mask[i] = 1.0;
      } else if (lum > radius / 2) {
        // Smooth falloff
        const t = (radius - lum) / (radius / 2);
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
    const shadowAmount = this.params.shadows / 100.0;
    const colorTransfer = this.params.shadowsColorTransfer / 100.0;
    const strength = this.params.strength;

    for (let i = 0; i < data.length; i += 4) {
      const maskValue = shadowMask[i / 4];
      const effect = maskValue * shadowAmount * strength;

      if (effect > 0) {
        // Calculate current luminance
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = r * this.luminanceWeights.r + g * this.luminanceWeights.g + b * this.luminanceWeights.b;

        // Shadow recovery with tone mapping
        const recovery = Math.pow(1 - lum, 0.5) * effect;

        if (this.params.preserveColor) {
          // Preserve color ratios while lifting shadows
          const lift = 1.0 + recovery;
          data[i] = Math.min(1.0, r * lift);
          data[i + 1] = Math.min(1.0, g * lift);
          data[i + 2] = Math.min(1.0, b * lift);
        } else {
          // Apply color transfer for more natural shadow recovery
          const mixAmount = colorTransfer * effect;
          const avgColor = (r + g + b) / 3;

          data[i] = Math.min(1.0, r + recovery + (avgColor - r) * mixAmount);
          data[i + 1] = Math.min(1.0, g + recovery + (avgColor - g) * mixAmount);
          data[i + 2] = Math.min(1.0, b + recovery + (avgColor - b) * mixAmount);
        }
      }
    }
  }

  private applyHighlightRecovery(data: Float32Array, highlightMask: Float32Array, _width: number, _height: number): void {
    const highlightAmount = this.params.highlights / 100.0;
    const colorTransfer = this.params.highlightsColorTransfer / 100.0;
    const strength = this.params.strength;

    for (let i = 0; i < data.length; i += 4) {
      const maskValue = highlightMask[i / 4];
      const effect = maskValue * highlightAmount * strength;

      if (effect > 0) {
        // Calculate current luminance
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = r * this.luminanceWeights.r + g * this.luminanceWeights.g + b * this.luminanceWeights.b;

        // Highlight recovery with tone mapping
        const recovery = Math.pow(lum, 0.5) * effect;

        if (this.params.preserveColor) {
          // Preserve color ratios while recovering highlights
          const compress = 1.0 - recovery * 0.5;
          data[i] = Math.max(0.0, r * compress);
          data[i + 1] = Math.max(0.0, g * compress);
          data[i + 2] = Math.max(0.0, b * compress);
        } else {
          // Apply color transfer for more natural highlight recovery
          const mixAmount = colorTransfer * effect;
          const avgColor = (r + g + b) / 3;

          data[i] = Math.max(0.0, r - recovery + (avgColor - r) * mixAmount);
          data[i + 1] = Math.max(0.0, g - recovery + (avgColor - g) * mixAmount);
          data[i + 2] = Math.max(0.0, b - recovery + (avgColor - b) * mixAmount);
        }
      }
    }
  }

  private applyWhiteBlackPointAdjustment(data: Float32Array, _width: number, _height: number): void {
    const whiteAdjust = Math.pow(2, this.params.whitePoint);
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
    const compressionCurve = (x: number) => x / (1 + x * compress);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = compressionCurve(data[i]);
      data[i + 1] = compressionCurve(data[i + 1]);
      data[i + 2] = compressionCurve(data[i + 2]);
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

    for (let i = 0; i < data.length; i += 4) {
      const shadowMaskValue = shadowMask[i / 4];
      const highlightMaskValue = highlightMask[i / 4];

      // Apply color correction based on masks
      if (shadowMaskValue > 0 && shadowCorrection < 1.0) {
        const correction = 1.0 - (1.0 - shadowCorrection) * shadowMaskValue;
        data[i] *= correction;
        data[i + 1] *= correction;
        data[i + 2] *= correction;
      }

      if (highlightMaskValue > 0 && highlightCorrection < 1.0) {
        const correction = 1.0 - (1.0 - highlightCorrection) * highlightMaskValue;
        data[i] *= correction;
        data[i + 1] *= correction;
        data[i + 2] *= correction;
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
          shadows: 15.0,
          highlights: 10.0,
          shadowsRadius: 40.0,
          highlightsRadius: 40.0,
          compress: 25.0,
          strength: 0.7
        });
        break;

      case 'moderate':
        this.setParams({
          shadows: 30.0,
          highlights: 25.0,
          shadowsRadius: 50.0,
          highlightsRadius: 50.0,
          compress: 40.0,
          strength: 1.0
        });
        break;

      case 'strong':
        this.setParams({
          shadows: 50.0,
          highlights: 40.0,
          shadowsRadius: 60.0,
          highlightsRadius: 60.0,
          compress: 60.0,
          strength: 1.3,
          iterations: 2
        });
        break;

      case 'highlights-only':
        this.setParams({
          shadows: 0.0,
          highlights: 35.0,
          highlightsRadius: 45.0,
          compress: 50.0,
          strength: 1.0
        });
        break;

      case 'shadows-only':
        this.setParams({
          shadows: 40.0,
          highlights: 0.0,
          shadowsRadius: 55.0,
          compress: 30.0,
          strength: 1.0
        });
        break;
    }
  }
}