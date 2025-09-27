import { logger } from '../utils/Logger';

export interface LuminosityMask {
  id: string;
  name: string;
  type: 'lights' | 'darks' | 'midtones' | 'custom';
  level: number; // 1-6 for lights/darks, 1-3 for midtones
  maskData: Float32Array;
  width: number;
  height: number;
  createdAt: Date;
  inverted: boolean;
}

export interface MaskGroup {
  id: string;
  name: string;
  masks: LuminosityMask[];
  combinationMode: 'intersect' | 'union' | 'subtract' | 'exclude';
}

export interface LuminosityRange {
  shadows: { min: number; max: number; feather: number };
  midtones: { min: number; max: number; feather: number };
  highlights: { min: number; max: number; feather: number };
}

export interface MaskPreview {
  canvas: HTMLCanvasElement;
  opacity: number;
  color: string;
}

export class LuminosityMaskService {
  private static instance: LuminosityMaskService;
  private masks: Map<string, LuminosityMask> = new Map();
  private workingCanvas: HTMLCanvasElement; // Used for future mask operations

  private constructor() {
    this.workingCanvas = document.createElement('canvas');
    // Initialize working canvas for future mask operations
    this.workingCanvas.width = 0;
  }

  static getInstance(): LuminosityMaskService {
    if (!LuminosityMaskService.instance) {
      LuminosityMaskService.instance = new LuminosityMaskService();
    }
    return LuminosityMaskService.instance;
  }

  /**
   * Generate luminosity mask from image data
   */
  generateLuminosityMask(
    imageData: Float32Array,
    width: number,
    height: number,
    type: 'lights' | 'darks' | 'midtones',
    level: number = 1,
    customRange?: { min: number; max: number; feather: number }
  ): LuminosityMask {
    const startTime = performance.now();

    logger.debug(`Generating ${type} mask level ${level} for ${width}x${height} image`);

    // Create mask data
    const maskData = new Float32Array(width * height);

    // Calculate luminosity for each pixel
    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      const r = imageData[pixelIndex];
      const g = imageData[pixelIndex + 1];
      const b = imageData[pixelIndex + 2];

      // Calculate luminosity using Rec. 709 weights
      const luminosity = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      let maskValue = 0;

      if (customRange) {
        maskValue = this.calculateCustomRangeMask(luminosity, customRange);
      } else {
        maskValue = this.calculateStandardMask(luminosity, type, level);
      }

      maskData[i] = maskValue;
    }

    // Apply feathering/smoothing
    const smoothedMask = this.smoothMask(maskData, width, height, 1.0);

    // Create mask object
    const mask: LuminosityMask = {
      id: `mask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: customRange ? 'Custom Range' : `${type.charAt(0).toUpperCase() + type.slice(1)} ${level}`,
      type: customRange ? 'custom' : type,
      level,
      maskData: smoothedMask,
      width,
      height,
      createdAt: new Date(),
      inverted: false
    };

    this.masks.set(mask.id, mask);

    const processingTime = performance.now() - startTime;
    logger.info(`Generated ${mask.name} mask in ${processingTime.toFixed(2)}ms`);

    return mask;
  }

  /**
   * Calculate standard luminosity mask value
   */
  private calculateStandardMask(
    luminosity: number,
    type: 'lights' | 'darks' | 'midtones',
    level: number
  ): number {
    let baseSelection = 0;

    switch (type) {
      case 'lights':
        // Lights masks select bright areas
        baseSelection = luminosity;
        break;

      case 'darks':
        // Darks masks select dark areas (inverted lights)
        baseSelection = 1 - luminosity;
        break;

      case 'midtones': {
        // Midtones masks select middle values
        const distanceFromMid = Math.abs(luminosity - 0.5) * 2;
        baseSelection = 1 - distanceFromMid;
        break;
      }
    }

    // Apply level progression
    let maskValue = baseSelection;
    for (let i = 1; i < level; i++) {
      maskValue = maskValue * baseSelection; // Progressive intersection
    }

    return Math.max(0, Math.min(1, maskValue));
  }

  /**
   * Calculate custom range mask value
   */
  private calculateCustomRangeMask(
    luminosity: number,
    range: { min: number; max: number; feather: number }
  ): number {
    const { min, max, feather } = range;

    if (luminosity < min || luminosity > max) {
      // Outside range - check feather
      if (feather > 0) {
        const featherMin = Math.max(0, min - feather);
        const featherMax = Math.min(1, max + feather);

        if (luminosity >= featherMin && luminosity < min) {
          // Feather in from bottom
          return (luminosity - featherMin) / feather;
        } else if (luminosity > max && luminosity <= featherMax) {
          // Feather out from top
          return 1 - ((luminosity - max) / feather);
        }
      }
      return 0;
    }

    // Inside range
    return 1;
  }

  /**
   * Smooth mask using gaussian-like blur
   */
  private smoothMask(
    maskData: Float32Array,
    width: number,
    height: number,
    radius: number
  ): Float32Array {
    if (radius <= 0) return maskData;

    const smoothed = new Float32Array(maskData.length);
    const kernelSize = Math.ceil(radius * 2) * 2 + 1;
    const kernel = this.createGaussianKernel(kernelSize, radius);
    const offset = Math.floor(kernelSize / 2);

    // Horizontal pass
    const temp = new Float32Array(maskData.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;

        for (let k = 0; k < kernelSize; k++) {
          const sampleX = x + k - offset;
          if (sampleX >= 0 && sampleX < width) {
            const weight = kernel[k];
            sum += maskData[y * width + sampleX] * weight;
            weightSum += weight;
          }
        }

        temp[y * width + x] = sum / weightSum;
      }
    }

    // Vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;

        for (let k = 0; k < kernelSize; k++) {
          const sampleY = y + k - offset;
          if (sampleY >= 0 && sampleY < height) {
            const weight = kernel[k];
            sum += temp[sampleY * width + x] * weight;
            weightSum += weight;
          }
        }

        smoothed[y * width + x] = sum / weightSum;
      }
    }

    return smoothed;
  }

  /**
   * Create gaussian kernel for smoothing
   */
  private createGaussianKernel(size: number, sigma: number): Float32Array {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;

    for (let i = 0; i < size; i++) {
      const x = i - center;
      const value = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel[i] = value;
      sum += value;
    }

    // Normalize
    for (let i = 0; i < size; i++) {
      kernel[i] /= sum;
    }

    return kernel;
  }

  /**
   * Generate complete set of luminosity masks
   */
  generateCompleteMaskSet(
    imageData: Float32Array,
    width: number,
    height: number
  ): { lights: LuminosityMask[]; darks: LuminosityMask[]; midtones: LuminosityMask[] } {
    logger.info('Generating complete luminosity mask set');

    const lights: LuminosityMask[] = [];
    const darks: LuminosityMask[] = [];
    const midtones: LuminosityMask[] = [];

    // Generate lights masks (L1-L6)
    for (let level = 1; level <= 6; level++) {
      lights.push(this.generateLuminosityMask(imageData, width, height, 'lights', level));
    }

    // Generate darks masks (D1-D6)
    for (let level = 1; level <= 6; level++) {
      darks.push(this.generateLuminosityMask(imageData, width, height, 'darks', level));
    }

    // Generate midtones masks (M1-M3)
    for (let level = 1; level <= 3; level++) {
      midtones.push(this.generateLuminosityMask(imageData, width, height, 'midtones', level));
    }

    return { lights, darks, midtones };
  }

  /**
   * Invert mask
   */
  invertMask(maskId: string): boolean {
    const mask = this.masks.get(maskId);
    if (!mask) return false;

    // Invert mask data
    for (let i = 0; i < mask.maskData.length; i++) {
      mask.maskData[i] = 1 - mask.maskData[i];
    }

    mask.inverted = !mask.inverted;
    mask.name = mask.inverted ? `${mask.name} (Inverted)` : mask.name.replace(' (Inverted)', '');

    logger.debug(`Inverted mask: ${mask.name}`);
    return true;
  }

  /**
   * Combine multiple masks
   */
  combineMasks(
    maskIds: string[],
    mode: 'intersect' | 'union' | 'subtract' | 'exclude',
    name: string
  ): LuminosityMask | null {
    if (maskIds.length < 2) return null;

    const masks = maskIds.map(id => this.masks.get(id)).filter(Boolean) as LuminosityMask[];
    if (masks.length !== maskIds.length) return null;

    const firstMask = masks[0];
    const combinedData = new Float32Array(firstMask.maskData.length);

    // Initialize with first mask
    for (let i = 0; i < combinedData.length; i++) {
      combinedData[i] = firstMask.maskData[i];
    }

    // Combine with other masks
    for (let maskIndex = 1; maskIndex < masks.length; maskIndex++) {
      const currentMask = masks[maskIndex];

      for (let i = 0; i < combinedData.length; i++) {
        const a = combinedData[i];
        const b = currentMask.maskData[i];

        switch (mode) {
          case 'intersect':
            combinedData[i] = a * b;
            break;
          case 'union':
            combinedData[i] = a + b - (a * b);
            break;
          case 'subtract':
            combinedData[i] = Math.max(0, a - b);
            break;
          case 'exclude':
            combinedData[i] = Math.abs(a - b);
            break;
        }
      }
    }

    const combinedMask: LuminosityMask = {
      id: `combined-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type: 'custom',
      level: 1,
      maskData: combinedData,
      width: firstMask.width,
      height: firstMask.height,
      createdAt: new Date(),
      inverted: false
    };

    this.masks.set(combinedMask.id, combinedMask);
    logger.info(`Combined ${masks.length} masks using ${mode} mode`);

    return combinedMask;
  }

  /**
   * Create mask preview canvas
   */
  createMaskPreview(
    maskId: string,
    previewWidth: number,
    previewHeight: number,
    overlayColor: string = '#ff0000',
    overlayOpacity: number = 0.5
  ): HTMLCanvasElement | null {
    const mask = this.masks.get(maskId);
    if (!mask) return null;

    const canvas = document.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d')!;

    // Create ImageData for the mask
    const imageData = ctx.createImageData(previewWidth, previewHeight);

    // Scale mask data to preview size
    const scaleX = mask.width / previewWidth;
    const scaleY = mask.height / previewHeight;

    // Parse overlay color
    const colorMatch = overlayColor.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    const r = colorMatch ? parseInt(colorMatch[1], 16) : 255;
    const g = colorMatch ? parseInt(colorMatch[2], 16) : 0;
    const b = colorMatch ? parseInt(colorMatch[3], 16) : 0;

    for (let y = 0; y < previewHeight; y++) {
      for (let x = 0; x < previewWidth; x++) {
        const sourceX = Math.floor(x * scaleX);
        const sourceY = Math.floor(y * scaleY);
        const sourceIndex = sourceY * mask.width + sourceX;
        const maskValue = mask.maskData[sourceIndex] || 0;

        const targetIndex = (y * previewWidth + x) * 4;

        // Show mask as colored overlay
        imageData.data[targetIndex] = r;     // R
        imageData.data[targetIndex + 1] = g; // G
        imageData.data[targetIndex + 2] = b; // B
        imageData.data[targetIndex + 3] = Math.round(maskValue * overlayOpacity * 255); // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Get all masks
   */
  getMasks(): LuminosityMask[] {
    return Array.from(this.masks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get mask by ID
   */
  getMask(id: string): LuminosityMask | null {
    return this.masks.get(id) || null;
  }

  /**
   * Delete mask
   */
  deleteMask(id: string): boolean {
    const success = this.masks.delete(id);
    if (success) {
      logger.debug(`Deleted mask: ${id}`);
    }
    return success;
  }

  /**
   * Apply mask to adjustment layer
   */
  applyMaskToLayer(
    imageData: Float32Array,
    maskId: string,
    adjustmentFunction: (pixel: { r: number; g: number; b: number; a: number }) => { r: number; g: number; b: number; a: number },
    width: number,
    height: number
  ): Float32Array {
    const mask = this.masks.get(maskId);
    if (!mask) return imageData;

    const result = new Float32Array(imageData.length);

    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      const maskValue = mask.maskData[i] || 0;

      // Get original pixel
      const original = {
        r: imageData[pixelIndex],
        g: imageData[pixelIndex + 1],
        b: imageData[pixelIndex + 2],
        a: imageData[pixelIndex + 3]
      };

      // Apply adjustment
      const adjusted = adjustmentFunction(original);

      // Blend based on mask value
      result[pixelIndex] = original.r + (adjusted.r - original.r) * maskValue;
      result[pixelIndex + 1] = original.g + (adjusted.g - original.g) * maskValue;
      result[pixelIndex + 2] = original.b + (adjusted.b - original.b) * maskValue;
      result[pixelIndex + 3] = original.a + (adjusted.a - original.a) * maskValue;
    }

    return result;
  }

  /**
   * Calculate mask statistics
   */
  calculateMaskStatistics(maskId: string): {
    coverage: number;
    averageValue: number;
    histogram: number[];
  } | null {
    const mask = this.masks.get(maskId);
    if (!mask) return null;

    let sum = 0;
    let coverage = 0;
    const histogram = new Array(256).fill(0);

    for (let i = 0; i < mask.maskData.length; i++) {
      const value = mask.maskData[i];
      sum += value;

      if (value > 0.01) { // Consider anything above 1% as coverage
        coverage++;
      }

      // Add to histogram
      const histIndex = Math.floor(value * 255);
      histogram[histIndex]++;
    }

    return {
      coverage: coverage / mask.maskData.length,
      averageValue: sum / mask.maskData.length,
      histogram
    };
  }

  /**
   * Export mask data
   */
  exportMask(maskId: string): string | null {
    const mask = this.masks.get(maskId);
    if (!mask) return null;

    const exportData = {
      id: mask.id,
      name: mask.name,
      type: mask.type,
      level: mask.level,
      width: mask.width,
      height: mask.height,
      createdAt: mask.createdAt,
      inverted: mask.inverted,
      maskData: Array.from(mask.maskData)
    };

    return JSON.stringify(exportData);
  }

  /**
   * Import mask data
   */
  importMask(jsonData: string): string | null {
    try {
      const data = JSON.parse(jsonData);

      const mask: LuminosityMask = {
        id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: data.name || 'Imported Mask',
        type: data.type || 'custom',
        level: data.level || 1,
        maskData: new Float32Array(data.maskData),
        width: data.width,
        height: data.height,
        createdAt: new Date(),
        inverted: data.inverted || false
      };

      this.masks.set(mask.id, mask);
      logger.info(`Imported mask: ${mask.name}`);

      return mask.id;
    } catch (error) {
      logger.error('Failed to import mask:', error);
      return null;
    }
  }
}

// Export singleton instance
export const luminosityMaskService = LuminosityMaskService.getInstance();