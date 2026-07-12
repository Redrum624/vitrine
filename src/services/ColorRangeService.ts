import { logger } from '../utils/Logger';

export interface ColorRange {
  id: string;
  name: string;
  colorModel: 'hsv' | 'lab' | 'rgb';
  ranges: {
    min: number[];
    max: number[];
  };
  tolerance: number;
  feather: number;
  createdAt: Date;
}

export interface ColorRangeMask {
  id: string;
  name: string;
  maskData: Float32Array;
  width: number;
  height: number;
  colorRange: ColorRange;
  createdAt: Date;
}

export interface ColorSample {
  r: number;
  g: number;
  b: number;
  position: { x: number; y: number };
}

export class ColorRangeService {
  private static instance: ColorRangeService;
  private colorRanges: Map<string, ColorRange> = new Map();
  private colorMasks: Map<string, ColorRangeMask> = new Map();
  private presets: ColorRange[] = [];

  private constructor() {
    this.initializePresets();
  }

  static getInstance(): ColorRangeService {
    if (!ColorRangeService.instance) {
      ColorRangeService.instance = new ColorRangeService();
    }
    return ColorRangeService.instance;
  }

  private initializePresets() {
    this.presets = [
      {
        id: 'reds',
        name: 'Reds',
        colorModel: 'hsv',
        ranges: {
          min: [0, 0.3, 0.2],    // H: 0°, S: 30%, V: 20%
          max: [15, 1.0, 1.0]    // H: 15°, S: 100%, V: 100%
        },
        tolerance: 10,
        feather: 5,
        createdAt: new Date()
      },
      {
        id: 'oranges',
        name: 'Oranges',
        colorModel: 'hsv',
        ranges: {
          min: [15, 0.4, 0.3],
          max: [35, 1.0, 1.0]
        },
        tolerance: 8,
        feather: 4,
        createdAt: new Date()
      },
      {
        id: 'yellows',
        name: 'Yellows',
        colorModel: 'hsv',
        ranges: {
          min: [35, 0.3, 0.3],
          max: [75, 1.0, 1.0]
        },
        tolerance: 12,
        feather: 6,
        createdAt: new Date()
      },
      {
        id: 'greens',
        name: 'Greens',
        colorModel: 'hsv',
        ranges: {
          min: [75, 0.25, 0.2],
          max: [165, 1.0, 1.0]
        },
        tolerance: 15,
        feather: 8,
        createdAt: new Date()
      },
      {
        id: 'cyans',
        name: 'Cyans',
        colorModel: 'hsv',
        ranges: {
          min: [165, 0.3, 0.3],
          max: [195, 1.0, 1.0]
        },
        tolerance: 10,
        feather: 5,
        createdAt: new Date()
      },
      {
        id: 'blues',
        name: 'Blues',
        colorModel: 'hsv',
        ranges: {
          min: [195, 0.3, 0.2],
          max: [255, 1.0, 1.0]
        },
        tolerance: 12,
        feather: 6,
        createdAt: new Date()
      },
      {
        id: 'magentas',
        name: 'Magentas',
        colorModel: 'hsv',
        ranges: {
          min: [255, 0.3, 0.3],
          max: [315, 1.0, 1.0]
        },
        tolerance: 10,
        feather: 5,
        createdAt: new Date()
      },
      {
        id: 'highlights',
        name: 'Highlights',
        colorModel: 'lab',
        ranges: {
          min: [70, -20, -20],
          max: [100, 20, 20]
        },
        tolerance: 15,
        feather: 10,
        createdAt: new Date()
      },
      {
        id: 'shadows',
        name: 'Shadows',
        colorModel: 'lab',
        ranges: {
          min: [0, -30, -30],
          max: [30, 30, 30]
        },
        tolerance: 12,
        feather: 8,
        createdAt: new Date()
      },
      {
        id: 'skin-tones',
        name: 'Skin Tones',
        colorModel: 'hsv',
        ranges: {
          min: [5, 0.15, 0.25],
          max: [25, 0.65, 0.95]
        },
        tolerance: 8,
        feather: 6,
        createdAt: new Date()
      }
    ];
  }

  /**
   * Convert RGB to HSV
   */
  private rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    const s = max === 0 ? 0 : delta / max;
    const v = max;

    if (delta !== 0) {
      if (max === r) {
        h = ((g - b) / delta) % 6;
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }

    return [h, s, v];
  }

  /**
   * Convert RGB to LAB (simplified)
   */
  private rgbToLab(r: number, g: number, b: number): [number, number, number] {
    // Simplified RGB to LAB conversion
    // In production, would use proper XYZ intermediate conversion
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = (r - g) * 0.5;
    const b_lab = (r + g - 2 * b) * 0.25;

    return [l * 100, a * 100, b_lab * 100];
  }

  /**
   * Convert color based on model
   */
  private convertColor(r: number, g: number, b: number, model: 'hsv' | 'lab' | 'rgb'): number[] {
    switch (model) {
      case 'hsv':
        return this.rgbToHsv(r, g, b);
      case 'lab':
        return this.rgbToLab(r, g, b);
      case 'rgb':
      default:
        return [r, g, b];
    }
  }

  /**
   * Calculate color distance
   */
  private calculateColorDistance(
    color1: number[],
    color2: number[],
    model: 'hsv' | 'lab' | 'rgb'
  ): number {
    switch (model) {
      case 'hsv': {
        // Special handling for hue wraparound
        const [h1, s1, v1] = color1;
        const [h2, s2, v2] = color2;

        let hueDiff = Math.abs(h1 - h2);
        if (hueDiff > 180) hueDiff = 360 - hueDiff;

        return Math.sqrt(
          Math.pow(hueDiff / 180, 2) +
          Math.pow(s1 - s2, 2) +
          Math.pow(v1 - v2, 2)
        );
      }

      case 'lab': {
        // Perceptually uniform color space
        const [l1, a1, b1] = color1;
        const [l2, a2, b2] = color2;
        return Math.sqrt(
          Math.pow((l1 - l2) / 100, 2) +
          Math.pow((a1 - a2) / 100, 2) +
          Math.pow((b1 - b2) / 100, 2)
        );
      }

      case 'rgb':
      default:
        return Math.sqrt(
          Math.pow(color1[0] - color2[0], 2) +
          Math.pow(color1[1] - color2[1], 2) +
          Math.pow(color1[2] - color2[2], 2)
        );
    }
  }

  /**
   * Create color range from samples
   */
  createColorRangeFromSamples(
    samples: ColorSample[],
    name: string,
    colorModel: 'hsv' | 'lab' | 'rgb' = 'hsv',
    tolerance: number = 10,
    feather: number = 5
  ): string {
    if (samples.length === 0) return '';

    // Convert all samples to target color model
    const convertedSamples = samples.map(sample =>
      this.convertColor(sample.r, sample.g, sample.b, colorModel)
    );

    // Calculate bounds
    const mins = [Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity];

    convertedSamples.forEach(sample => {
      for (let i = 0; i < 3; i++) {
        mins[i] = Math.min(mins[i], sample[i]);
        maxs[i] = Math.max(maxs[i], sample[i]);
      }
    });

    // Expand by tolerance
    const toleranceFactors = colorModel === 'hsv' ? [tolerance, tolerance/100, tolerance/100] :
                           colorModel === 'lab' ? [tolerance/2, tolerance/2, tolerance/2] :
                           [tolerance/100, tolerance/100, tolerance/100];

    for (let i = 0; i < 3; i++) {
      mins[i] -= toleranceFactors[i];
      maxs[i] += toleranceFactors[i];
    }

    const colorRange: ColorRange = {
      id: `range-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      colorModel,
      ranges: {
        min: mins,
        max: maxs
      },
      tolerance,
      feather,
      createdAt: new Date()
    };

    this.colorRanges.set(colorRange.id, colorRange);
    logger.info(`Created color range: ${name} from ${samples.length} samples`);

    return colorRange.id;
  }

  /**
   * Generate mask from color range
   */
  generateColorRangeMask(
    imageData: Float32Array,
    width: number,
    height: number,
    colorRangeId: string
  ): ColorRangeMask | null {
    const colorRange = this.colorRanges.get(colorRangeId);
    if (!colorRange) return null;

    const startTime = performance.now();
    const maskData = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      const r = imageData[pixelIndex];
      const g = imageData[pixelIndex + 1];
      const b = imageData[pixelIndex + 2];

      // Convert to target color model
      const convertedColor = this.convertColor(r, g, b, colorRange.colorModel);

      // Check if color is in range
      let inRange = true;
      for (let j = 0; j < 3; j++) {
        if (convertedColor[j] < colorRange.ranges.min[j] ||
            convertedColor[j] > colorRange.ranges.max[j]) {
          inRange = false;
          break;
        }
      }

      let maskValue = 0;

      if (inRange) {
        maskValue = 1;
      } else if (colorRange.feather > 0) {
        // Calculate feathered edge
        const centerColor = [
          (colorRange.ranges.min[0] + colorRange.ranges.max[0]) / 2,
          (colorRange.ranges.min[1] + colorRange.ranges.max[1]) / 2,
          (colorRange.ranges.min[2] + colorRange.ranges.max[2]) / 2
        ];

        const distance = this.calculateColorDistance(
          convertedColor,
          centerColor,
          colorRange.colorModel
        );

        const featherDistance = colorRange.feather / 100;
        const rangeSize = this.calculateColorDistance(
          colorRange.ranges.min,
          colorRange.ranges.max,
          colorRange.colorModel
        ) / 2;

        if (distance <= rangeSize + featherDistance) {
          const falloff = Math.max(0, 1 - (distance - rangeSize) / featherDistance);
          maskValue = Math.pow(falloff, 2); // Smooth falloff
        }
      }

      maskData[i] = Math.max(0, Math.min(1, maskValue));
    }

    const mask: ColorRangeMask = {
      id: `colormask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${colorRange.name} Mask`,
      maskData,
      width,
      height,
      colorRange,
      createdAt: new Date()
    };

    this.colorMasks.set(mask.id, mask);

    const processingTime = performance.now() - startTime;
    logger.info(`Generated color range mask in ${processingTime.toFixed(2)}ms`);

    return mask;
  }

  /**
   * Generate mask from preset
   */
  generatePresetMask(
    imageData: Float32Array,
    width: number,
    height: number,
    presetId: string
  ): ColorRangeMask | null {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return null;

    // Create temporary color range from preset
    const tempId = `temp-${Date.now()}`;
    this.colorRanges.set(tempId, preset);

    const mask = this.generateColorRangeMask(imageData, width, height, tempId);

    // Clean up temporary range
    this.colorRanges.delete(tempId);

    return mask;
  }

  /**
   * Magic wand selection
   */
  magicWandSelection(
    imageData: Float32Array,
    width: number,
    height: number,
    seedPoint: { x: number; y: number },
    tolerance: number = 10,
    contiguous: boolean = true
  ): ColorRangeMask {
    const seedIndex = (seedPoint.y * width + seedPoint.x) * 4;
    const seedR = imageData[seedIndex];
    const seedG = imageData[seedIndex + 1];
    const seedB = imageData[seedIndex + 2];

    const maskData = new Float32Array(width * height);
    const visited = new Set<number>();
    const queue: { x: number; y: number }[] = [];

    // Start flood fill from seed point
    queue.push(seedPoint);
    visited.add(seedPoint.y * width + seedPoint.x);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentIndex = (current.y * width + current.x) * 4;

      const r = imageData[currentIndex];
      const g = imageData[currentIndex + 1];
      const b = imageData[currentIndex + 2];

      // Check color similarity
      const distance = Math.sqrt(
        Math.pow((r - seedR) * 255, 2) +
        Math.pow((g - seedG) * 255, 2) +
        Math.pow((b - seedB) * 255, 2)
      );

      if (distance <= tolerance) {
        maskData[current.y * width + current.x] = 1;

        if (contiguous) {
          // Add neighbors to queue
          const neighbors = [
            { x: current.x - 1, y: current.y },
            { x: current.x + 1, y: current.y },
            { x: current.x, y: current.y - 1 },
            { x: current.x, y: current.y + 1 }
          ];

          neighbors.forEach(neighbor => {
            if (neighbor.x >= 0 && neighbor.x < width &&
                neighbor.y >= 0 && neighbor.y < height) {
              const neighborIndex = neighbor.y * width + neighbor.x;
              if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                queue.push(neighbor);
              }
            }
          });
        }
      }
    }

    // If not contiguous, select all similar colors
    if (!contiguous) {
      for (let i = 0; i < width * height; i++) {
        const pixelIndex = i * 4;
        const r = imageData[pixelIndex];
        const g = imageData[pixelIndex + 1];
        const b = imageData[pixelIndex + 2];

        const distance = Math.sqrt(
          Math.pow((r - seedR) * 255, 2) +
          Math.pow((g - seedG) * 255, 2) +
          Math.pow((b - seedB) * 255, 2)
        );

        if (distance <= tolerance) {
          maskData[i] = 1;
        }
      }
    }

    const mask: ColorRangeMask = {
      id: `magicwand-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: 'Magic Wand Selection',
      maskData,
      width,
      height,
      colorRange: {
        id: 'temp',
        name: 'Magic Wand',
        colorModel: 'rgb',
        ranges: {
          min: [seedR - tolerance/255, seedG - tolerance/255, seedB - tolerance/255],
          max: [seedR + tolerance/255, seedG + tolerance/255, seedB + tolerance/255]
        },
        tolerance,
        feather: 0,
        createdAt: new Date()
      },
      createdAt: new Date()
    };

    this.colorMasks.set(mask.id, mask);
    logger.info(`Magic wand selection completed with tolerance ${tolerance}`);

    return mask;
  }

  /**
   * Get all presets
   */
  getPresets(): ColorRange[] {
    return [...this.presets];
  }

  /**
   * Get all color ranges
   */
  getColorRanges(): ColorRange[] {
    return Array.from(this.colorRanges.values());
  }

  /**
   * Get all color masks
   */
  getColorMasks(): ColorRangeMask[] {
    return Array.from(this.colorMasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get mask by ID
   */
  getColorMask(id: string): ColorRangeMask | null {
    return this.colorMasks.get(id) || null;
  }

  /**
   * Delete color mask
   */
  deleteColorMask(id: string): boolean {
    return this.colorMasks.delete(id);
  }

  /**
   * Create mask preview
   */
  createColorMaskPreview(
    maskId: string,
    previewWidth: number,
    previewHeight: number,
    overlayColor: string = '#00ff00'
  ): HTMLCanvasElement | null {
    const mask = this.colorMasks.get(maskId);
    if (!mask) return null;

    const canvas = document.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d')!;

    const imageData = ctx.createImageData(previewWidth, previewHeight);

    // Scale mask data to preview size
    const scaleX = mask.width / previewWidth;
    const scaleY = mask.height / previewHeight;

    // Parse overlay color
    const colorMatch = overlayColor.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    const r = colorMatch ? parseInt(colorMatch[1], 16) : 0;
    const g = colorMatch ? parseInt(colorMatch[2], 16) : 255;
    const b = colorMatch ? parseInt(colorMatch[3], 16) : 0;

    for (let y = 0; y < previewHeight; y++) {
      for (let x = 0; x < previewWidth; x++) {
        const sourceX = Math.floor(x * scaleX);
        const sourceY = Math.floor(y * scaleY);
        const sourceIndex = sourceY * mask.width + sourceX;
        const maskValue = mask.maskData[sourceIndex] || 0;

        const targetIndex = (y * previewWidth + x) * 4;

        imageData.data[targetIndex] = r;
        imageData.data[targetIndex + 1] = g;
        imageData.data[targetIndex + 2] = b;
        imageData.data[targetIndex + 3] = Math.round(maskValue * 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Export color range
   */
  exportColorRange(rangeId: string): string | null {
    const range = this.colorRanges.get(rangeId);
    if (!range) return null;

    return JSON.stringify(range, null, 2);
  }

  /**
   * Import color range
   */
  importColorRange(jsonData: string): string | null {
    try {
      const data = JSON.parse(jsonData);
      const range: ColorRange = {
        ...data,
        id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date()
      };

      this.colorRanges.set(range.id, range);
      logger.info(`Imported color range: ${range.name}`);

      return range.id;
    } catch (error) {
      logger.error('Failed to import color range:', error);
      return null;
    }
  }
}

// Export singleton instance
export const colorRangeService = ColorRangeService.getInstance();