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
  flags: any;
  process(imageData: ImageData): ImageData;
}

export interface ColorBalanceParams extends ModuleParams {
  // Color balance for different tonal ranges
  shadows: {
    cyan_red: number;    // -1.0 to +1.0 (cyan to red)
    magenta_green: number; // -1.0 to +1.0 (magenta to green)
    yellow_blue: number;   // -1.0 to +1.0 (yellow to blue)
  };
  midtones: {
    cyan_red: number;
    magenta_green: number;
    yellow_blue: number;
  };
  highlights: {
    cyan_red: number;
    magenta_green: number;
    yellow_blue: number;
  };

  // Tonal range definitions
  shadowsRange: {
    start: number;  // 0.0 to 1.0 - where shadows end
    falloff: number; // 0.01 to 0.5 - transition smoothness
  };
  highlightsRange: {
    start: number;  // 0.0 to 1.0 - where highlights start
    falloff: number; // 0.01 to 0.5 - transition smoothness
  };

  // Global settings
  preserveLuminosity: boolean;
  globalSaturation: number; // 0.0 to 2.0
  globalVibrance: number;   // -1.0 to 1.0

  // Advanced options
  maskBlur: number;        // 0.0 to 5.0 - smoothing for tonal masks
  contrastBoost: number;   // 0.0 to 1.0 - enhance local contrast
  temperatureShift: number; // -100 to +100 - global temperature adjustment
}

export class ColorBalanceModule implements ImageProcessingModule {
  id = 'colorbalance';
  name = 'Color Balance';
  group = 'color';
  flags = {
    enabled: true,
    shown: true,
    expand: false,
    focus: false,
    state: 3, // normal
    preferred_csp: 4, // RGB working space
    blend_colorspace: 4 // RGB
  };

  private params: ColorBalanceParams;
  private shadowsMask: Float32Array | null = null;
  private highlightsMask: Float32Array | null = null;

  constructor() {
    this.params = this.getDefaultParams();
    logger.info('ColorBalanceModule initialized');
  }

  getDefaultParams(): ColorBalanceParams {
    return {
      // Neutral color balance for all ranges
      shadows: {
        cyan_red: 0.0,
        magenta_green: 0.0,
        yellow_blue: 0.0
      },
      midtones: {
        cyan_red: 0.0,
        magenta_green: 0.0,
        yellow_blue: 0.0
      },
      highlights: {
        cyan_red: 0.0,
        magenta_green: 0.0,
        yellow_blue: 0.0
      },

      // Default tonal ranges
      shadowsRange: {
        start: 0.25,
        falloff: 0.15
      },
      highlightsRange: {
        start: 0.75,
        falloff: 0.15
      },

      // Global settings
      preserveLuminosity: true,
      globalSaturation: 1.0,
      globalVibrance: 0.0,

      // Advanced options
      maskBlur: 1.0,
      contrastBoost: 0.0,
      temperatureShift: 0.0
    };
  }

  setParams(newParams: Partial<ColorBalanceParams>): void {
    this.params = { ...this.params, ...newParams };

    // Clear cached masks if range parameters changed
    if (
      newParams.shadowsRange !== undefined ||
      newParams.highlightsRange !== undefined ||
      newParams.maskBlur !== undefined
    ) {
      this.shadowsMask = null;
      this.highlightsMask = null;
    }

    logger.debug('ColorBalanceModule params updated:', Object.keys(newParams));
  }

  getParams(): ColorBalanceParams {
    return { ...this.params };
  }

  reset(): void {
    logger.info('Resetting ColorBalanceModule to defaults');
    this.setParams(this.getDefaultParams());
  }

  process(imageData: ImageData): ImageData {
    if (!this.flags.enabled) {
      return imageData;
    }

    const startTime = performance.now();
    const { width, height, data } = imageData;
    const processedData = new Float32Array(data.length);
    processedData.set(data);

    // Generate tonal masks
    this.generateTonalMasks(processedData, width, height);

    // Apply color balance to each tonal range
    this.applyColorBalance(processedData, width, height);

    // Apply global adjustments
    if (this.params.globalSaturation !== 1.0 || this.params.globalVibrance !== 0.0) {
      this.applyGlobalColorAdjustments(processedData, width, height);
    }

    // Apply temperature shift if set
    if (this.params.temperatureShift !== 0.0) {
      this.applyTemperatureShift(processedData, width, height);
    }

    // Apply contrast boost if enabled
    if (this.params.contrastBoost > 0.0) {
      this.applyContrastBoost(processedData, width, height);
    }

    const processTime = performance.now() - startTime;
    logger.debug(`ColorBalanceModule processed ${width}x${height} in ${processTime.toFixed(2)}ms`);

    return {
      width,
      height,
      data: processedData,
      channels: imageData.channels || 4
    };
  }

  private generateTonalMasks(data: Float32Array, width: number, height: number): void {
    if (this.shadowsMask && this.highlightsMask) {
      return; // Use cached masks
    }

    const pixelCount = width * height;
    this.shadowsMask = new Float32Array(pixelCount);
    this.highlightsMask = new Float32Array(pixelCount);

    // Generate initial masks based on luminance
    for (let i = 0; i < pixelCount; i++) {
      const pixelIndex = i * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      // Calculate luminance
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Calculate shadows mask
      const shadowDistance = Math.max(0, this.params.shadowsRange.start - luminance);
      const shadowWeight = shadowDistance > 0
        ? Math.exp(-shadowDistance * shadowDistance / (2 * this.params.shadowsRange.falloff * this.params.shadowsRange.falloff))
        : 0.0;

      // Calculate highlights mask
      const highlightDistance = Math.max(0, luminance - this.params.highlightsRange.start);
      const highlightWeight = highlightDistance > 0
        ? Math.exp(-highlightDistance * highlightDistance / (2 * this.params.highlightsRange.falloff * this.params.highlightsRange.falloff))
        : 0.0;

      this.shadowsMask[i] = Math.max(0, Math.min(1, shadowWeight));
      this.highlightsMask[i] = Math.max(0, Math.min(1, highlightWeight));
    }

    // Apply blur to masks for smoother transitions
    if (this.params.maskBlur > 0) {
      this.blurMask(this.shadowsMask, width, height, this.params.maskBlur);
      this.blurMask(this.highlightsMask, width, height, this.params.maskBlur);
    }

    logger.debug('Generated tonal masks with blur:', this.params.maskBlur);
  }

  private blurMask(mask: Float32Array, width: number, height: number, radius: number): void {
    const blurred = new Float32Array(mask.length);
    const kernelSize = Math.ceil(radius * 2) * 2 + 1;
    const kernelRadius = Math.floor(kernelSize / 2);

    // Gaussian kernel
    const kernel: number[] = [];
    const sigma = radius / 3;
    let kernelSum = 0;

    for (let i = 0; i < kernelSize; i++) {
      const x = i - kernelRadius;
      const value = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel[i] = value;
      kernelSum += value;
    }

    // Normalize kernel
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= kernelSum;
    }

    // Horizontal blur
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + k - kernelRadius));
          sum += mask[y * width + sampleX] * kernel[k];
        }
        blurred[y * width + x] = sum;
      }
    }

    // Vertical blur
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let k = 0; k < kernelSize; k++) {
          const sampleY = Math.max(0, Math.min(height - 1, y + k - kernelRadius));
          sum += blurred[sampleY * width + x] * kernel[k];
        }
        mask[y * width + x] = sum;
      }
    }
  }

  private applyColorBalance(data: Float32Array, width: number, height: number): void {
    if (!this.shadowsMask || !this.highlightsMask) return;

    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      let r = data[pixelIndex];
      let g = data[pixelIndex + 1];
      let b = data[pixelIndex + 2];

      // Store original luminance for preservation
      const originalLuminance = this.params.preserveLuminosity
        ? 0.2126 * r + 0.7152 * g + 0.0722 * b
        : 0;

      // Get mask weights
      const shadowWeight = this.shadowsMask[i];
      const highlightWeight = this.highlightsMask[i];
      const midtoneWeight = 1.0 - shadowWeight - highlightWeight;

      // Apply shadows color balance
      if (shadowWeight > 0) {
        const shadows = this.params.shadows;
        r += shadowWeight * (shadows.cyan_red * (shadows.cyan_red > 0 ? (1 - r) : r));
        g += shadowWeight * (shadows.magenta_green * (shadows.magenta_green < 0 ? (1 - g) : g));
        b += shadowWeight * (shadows.yellow_blue * (shadows.yellow_blue < 0 ? (1 - b) : b));
      }

      // Apply midtones color balance
      if (midtoneWeight > 0) {
        const midtones = this.params.midtones;
        r += midtoneWeight * (midtones.cyan_red * (midtones.cyan_red > 0 ? (1 - r) : r));
        g += midtoneWeight * (midtones.magenta_green * (midtones.magenta_green < 0 ? (1 - g) : g));
        b += midtoneWeight * (midtones.yellow_blue * (midtones.yellow_blue < 0 ? (1 - b) : b));
      }

      // Apply highlights color balance
      if (highlightWeight > 0) {
        const highlights = this.params.highlights;
        r += highlightWeight * (highlights.cyan_red * (highlights.cyan_red > 0 ? (1 - r) : r));
        g += highlightWeight * (highlights.magenta_green * (highlights.magenta_green < 0 ? (1 - g) : g));
        b += highlightWeight * (highlights.yellow_blue * (highlights.yellow_blue < 0 ? (1 - b) : b));
      }

      // Preserve luminosity if enabled
      if (this.params.preserveLuminosity && originalLuminance > 0) {
        const newLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (newLuminance > 0) {
          const scale = originalLuminance / newLuminance;
          r *= scale;
          g *= scale;
          b *= scale;
        }
      }

      // Clamp values
      data[pixelIndex] = Math.max(0, Math.min(1, r));
      data[pixelIndex + 1] = Math.max(0, Math.min(1, g));
      data[pixelIndex + 2] = Math.max(0, Math.min(1, b));
    }
  }

  private applyGlobalColorAdjustments(data: Float32Array, _width: number, _height: number): void {
    const saturation = this.params.globalSaturation;
    const vibrance = this.params.globalVibrance;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Calculate luminance and current saturation
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxColor = Math.max(r, g, b);
      const minColor = Math.min(r, g, b);
      const currentSaturation = maxColor > 0 ? (maxColor - minColor) / maxColor : 0;

      // Apply saturation
      if (saturation !== 1.0) {
        r = luminance + (r - luminance) * saturation;
        g = luminance + (g - luminance) * saturation;
        b = luminance + (b - luminance) * saturation;
      }

      // Apply vibrance (protect already saturated colors)
      if (vibrance !== 0.0) {
        const vibranceAmount = vibrance * (1.0 - currentSaturation);
        r = luminance + (r - luminance) * (1.0 + vibranceAmount);
        g = luminance + (g - luminance) * (1.0 + vibranceAmount);
        b = luminance + (b - luminance) * (1.0 + vibranceAmount);
      }

      // Clamp values
      data[i] = Math.max(0, Math.min(1, r));
      data[i + 1] = Math.max(0, Math.min(1, g));
      data[i + 2] = Math.max(0, Math.min(1, b));
    }
  }

  private applyTemperatureShift(data: Float32Array, _width: number, _height: number): void {
    const shift = this.params.temperatureShift / 100.0; // Normalize to -1 to +1

    // Temperature adjustment matrix (simplified)
    // Warmer (positive): more red/yellow, less blue/cyan
    // Cooler (negative): more blue/cyan, less red/yellow
    const tempMatrix = {
      rr: 1.0 + shift * 0.3,
      rg: shift * 0.1,
      rb: -shift * 0.2,
      gr: shift * 0.05,
      gg: 1.0,
      gb: -shift * 0.1,
      br: -shift * 0.2,
      bg: -shift * 0.1,
      bb: 1.0 + shift * 0.3
    };

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      data[i] = Math.max(0, Math.min(1,
        r * tempMatrix.rr + g * tempMatrix.rg + b * tempMatrix.rb
      ));
      data[i + 1] = Math.max(0, Math.min(1,
        r * tempMatrix.gr + g * tempMatrix.gg + b * tempMatrix.gb
      ));
      data[i + 2] = Math.max(0, Math.min(1,
        r * tempMatrix.br + g * tempMatrix.bg + b * tempMatrix.bb
      ));
    }
  }

  private applyContrastBoost(data: Float32Array, _width: number, _height: number): void {
    const boost = this.params.contrastBoost;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const value = data[i + c];
        // S-curve for contrast enhancement
        const enhanced = value < 0.5
          ? Math.pow(value * 2, 1 + boost) / 2
          : 1 - Math.pow((1 - value) * 2, 1 + boost) / 2;

        data[i + c] = Math.max(0, Math.min(1, enhanced));
      }
    }
  }

  // Utility methods for automatic color balance
  autoBalanceGrays(): void {
    // This would analyze the image to find neutral grays and adjust color balance
    // For now, we'll implement a simple neutral adjustment
    logger.info('Auto-balancing grays (placeholder implementation)');

    // Reset to neutral as a starting point
    this.setParams({
      shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      midtones: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      highlights: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 }
    });
  }

  // Preset color looks
  applyColorLook(look: 'neutral' | 'warm' | 'cool' | 'vintage' | 'cinematic' | 'vibrant'): void {
    const looks = {
      neutral: {
        shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
        midtones: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
        highlights: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
        globalSaturation: 1.0,
        globalVibrance: 0.0,
        temperatureShift: 0
      },
      warm: {
        shadows: { cyan_red: 0.1, magenta_green: -0.05, yellow_blue: 0.15 },
        midtones: { cyan_red: 0.05, magenta_green: -0.02, yellow_blue: 0.08 },
        highlights: { cyan_red: 0.02, magenta_green: -0.01, yellow_blue: 0.05 },
        globalSaturation: 1.1,
        globalVibrance: 0.1,
        temperatureShift: 15
      },
      cool: {
        shadows: { cyan_red: -0.1, magenta_green: 0.05, yellow_blue: -0.15 },
        midtones: { cyan_red: -0.05, magenta_green: 0.02, yellow_blue: -0.08 },
        highlights: { cyan_red: -0.02, magenta_green: 0.01, yellow_blue: -0.05 },
        globalSaturation: 1.05,
        globalVibrance: 0.05,
        temperatureShift: -15
      },
      vintage: {
        shadows: { cyan_red: 0.15, magenta_green: -0.1, yellow_blue: 0.2 },
        midtones: { cyan_red: 0.1, magenta_green: -0.05, yellow_blue: 0.15 },
        highlights: { cyan_red: -0.05, magenta_green: 0.1, yellow_blue: -0.1 },
        globalSaturation: 0.9,
        globalVibrance: -0.1,
        temperatureShift: 10
      },
      cinematic: {
        shadows: { cyan_red: -0.1, magenta_green: 0.05, yellow_blue: -0.2 },
        midtones: { cyan_red: 0.02, magenta_green: -0.01, yellow_blue: 0.05 },
        highlights: { cyan_red: 0.08, magenta_green: -0.05, yellow_blue: 0.12 },
        globalSaturation: 1.15,
        globalVibrance: 0.15,
        temperatureShift: 5
      },
      vibrant: {
        shadows: { cyan_red: 0.05, magenta_green: -0.05, yellow_blue: 0.1 },
        midtones: { cyan_red: 0.0, magenta_green: 0.0, yellow_blue: 0.0 },
        highlights: { cyan_red: -0.05, magenta_green: 0.05, yellow_blue: -0.1 },
        globalSaturation: 1.3,
        globalVibrance: 0.25,
        temperatureShift: 0
      }
    };

    const lookParams = looks[look];
    this.setParams(lookParams);
    logger.info(`Applied color look: ${look}`);
  }

  // Get color wheel positions for UI
  getColorWheelPosition(range: 'shadows' | 'midtones' | 'highlights'): { x: number; y: number; strength: number } {
    const balance = this.params[range];

    // Convert color balance to polar coordinates for color wheel
    const x = balance.cyan_red; // -1 to +1 (cyan to red)
    const y = balance.yellow_blue; // -1 to +1 (yellow to blue)
    const strength = Math.sqrt(x * x + y * y);

    return { x, y, strength: Math.min(1, strength) };
  }

  // Set color balance from color wheel position
  setColorWheelPosition(range: 'shadows' | 'midtones' | 'highlights', x: number, y: number): void {
    // Clamp to unit circle
    const distance = Math.sqrt(x * x + y * y);
    if (distance > 1) {
      x /= distance;
      y /= distance;
    }

    // Update color balance
    const newBalance = {
      cyan_red: x,
      magenta_green: this.params[range].magenta_green, // Keep existing magenta-green
      yellow_blue: y
    };

    this.setParams({
      [range]: newBalance
    });
  }
}