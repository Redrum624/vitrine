import { logger } from '../utils/Logger';

export type BlendMode =
  // Normal modes
  | 'normal' | 'dissolve'
  // Darkening modes
  | 'darken' | 'multiply' | 'color-burn' | 'linear-burn' | 'darker-color'
  // Lightening modes
  | 'lighten' | 'screen' | 'color-dodge' | 'linear-dodge' | 'lighter-color'
  // Contrast modes
  | 'overlay' | 'soft-light' | 'hard-light' | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix'
  // Comparative modes
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  // Component modes
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  // Advanced modes
  | 'grain-extract' | 'grain-merge' | 'split' | 'reflect' | 'glow' | 'freeze' | 'heat';

export interface BlendOperation {
  id: string;
  name: string;
  mode: BlendMode;
  opacity: number;
  maskData?: Float32Array;
  parameters: Record<string, number>;
  createdAt: Date;
}

export interface BlendResult {
  imageData: Float32Array;
  processingTime: number;
  operation: BlendOperation;
}

export class AdvancedBlendingService {
  private static instance: AdvancedBlendingService;

  private constructor() {}

  static getInstance(): AdvancedBlendingService {
    if (!AdvancedBlendingService.instance) {
      AdvancedBlendingService.instance = new AdvancedBlendingService();
    }
    return AdvancedBlendingService.instance;
  }

  /**
   * Blend two images with specified mode
   */
  blendImages(
    baseImage: Float32Array,
    overlayImage: Float32Array,
    width: number,
    height: number,
    mode: BlendMode,
    opacity: number = 1.0,
    maskData?: Float32Array
  ): BlendResult {
    const startTime = performance.now();

    if (baseImage.length !== overlayImage.length) {
      throw new Error('Image dimensions must match');
    }

    const result = new Float32Array(baseImage.length);
    const totalPixels = width * height;

    for (let i = 0; i < totalPixels; i++) {
      const pixelIndex = i * 4;

      // Get base and overlay colors
      const base = {
        r: baseImage[pixelIndex],
        g: baseImage[pixelIndex + 1],
        b: baseImage[pixelIndex + 2],
        a: baseImage[pixelIndex + 3]
      };

      const overlay = {
        r: overlayImage[pixelIndex],
        g: overlayImage[pixelIndex + 1],
        b: overlayImage[pixelIndex + 2],
        a: overlayImage[pixelIndex + 3]
      };

      // Apply blend mode
      const blended = this.applyBlendMode(base, overlay, mode);

      // Apply opacity
      let finalOpacity = opacity;
      if (maskData) {
        finalOpacity *= maskData[i] || 0;
      }

      // Composite with base
      result[pixelIndex] = base.r + (blended.r - base.r) * finalOpacity;
      result[pixelIndex + 1] = base.g + (blended.g - base.g) * finalOpacity;
      result[pixelIndex + 2] = base.b + (blended.b - base.b) * finalOpacity;
      result[pixelIndex + 3] = Math.max(base.a, overlay.a * finalOpacity);
    }

    const processingTime = performance.now() - startTime;

    const operation: BlendOperation = {
      id: `blend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${mode} blend`,
      mode,
      opacity,
      maskData,
      parameters: {},
      createdAt: new Date()
    };

    logger.debug(`Applied ${mode} blend in ${processingTime.toFixed(2)}ms`);

    return {
      imageData: result,
      processingTime,
      operation
    };
  }

  /**
   * Apply specific blend mode to two colors
   */
  private applyBlendMode(
    base: { r: number; g: number; b: number; a: number },
    overlay: { r: number; g: number; b: number; a: number },
    mode: BlendMode
  ): { r: number; g: number; b: number; a: number } {
    const result = { ...base };

    switch (mode) {
      case 'normal':
        return overlay;

      case 'dissolve': {
        // Random dither based on alpha
        const random = Math.random();
        return random < overlay.a ? overlay : base;
      }

      // Darkening modes
      case 'darken':
        result.r = Math.min(base.r, overlay.r);
        result.g = Math.min(base.g, overlay.g);
        result.b = Math.min(base.b, overlay.b);
        break;

      case 'multiply':
        result.r = base.r * overlay.r;
        result.g = base.g * overlay.g;
        result.b = base.b * overlay.b;
        break;

      case 'color-burn':
        result.r = overlay.r === 0 ? 0 : Math.max(0, 1 - (1 - base.r) / overlay.r);
        result.g = overlay.g === 0 ? 0 : Math.max(0, 1 - (1 - base.g) / overlay.g);
        result.b = overlay.b === 0 ? 0 : Math.max(0, 1 - (1 - base.b) / overlay.b);
        break;

      case 'linear-burn':
        result.r = Math.max(0, base.r + overlay.r - 1);
        result.g = Math.max(0, base.g + overlay.g - 1);
        result.b = Math.max(0, base.b + overlay.b - 1);
        break;

      case 'darker-color': {
        const baseLum = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b;
        const overlayLum = 0.299 * overlay.r + 0.587 * overlay.g + 0.114 * overlay.b;
        return baseLum < overlayLum ? base : overlay;
      }

      // Lightening modes
      case 'lighten':
        result.r = Math.max(base.r, overlay.r);
        result.g = Math.max(base.g, overlay.g);
        result.b = Math.max(base.b, overlay.b);
        break;

      case 'screen':
        result.r = 1 - (1 - base.r) * (1 - overlay.r);
        result.g = 1 - (1 - base.g) * (1 - overlay.g);
        result.b = 1 - (1 - base.b) * (1 - overlay.b);
        break;

      case 'color-dodge':
        result.r = overlay.r === 1 ? 1 : Math.min(1, base.r / (1 - overlay.r));
        result.g = overlay.g === 1 ? 1 : Math.min(1, base.g / (1 - overlay.g));
        result.b = overlay.b === 1 ? 1 : Math.min(1, base.b / (1 - overlay.b));
        break;

      case 'linear-dodge':
        result.r = Math.min(1, base.r + overlay.r);
        result.g = Math.min(1, base.g + overlay.g);
        result.b = Math.min(1, base.b + overlay.b);
        break;

      case 'lighter-color': {
        const baseLum2 = 0.299 * base.r + 0.587 * base.g + 0.114 * base.b;
        const overlayLum2 = 0.299 * overlay.r + 0.587 * overlay.g + 0.114 * overlay.b;
        return baseLum2 > overlayLum2 ? base : overlay;
      }

      // Contrast modes
      case 'overlay':
        result.r = base.r < 0.5 ? 2 * base.r * overlay.r : 1 - 2 * (1 - base.r) * (1 - overlay.r);
        result.g = base.g < 0.5 ? 2 * base.g * overlay.g : 1 - 2 * (1 - base.g) * (1 - overlay.g);
        result.b = base.b < 0.5 ? 2 * base.b * overlay.b : 1 - 2 * (1 - base.b) * (1 - overlay.b);
        break;

      case 'soft-light':
        result.r = this.softLightBlend(base.r, overlay.r);
        result.g = this.softLightBlend(base.g, overlay.g);
        result.b = this.softLightBlend(base.b, overlay.b);
        break;

      case 'hard-light':
        result.r = overlay.r < 0.5 ? 2 * base.r * overlay.r : 1 - 2 * (1 - base.r) * (1 - overlay.r);
        result.g = overlay.g < 0.5 ? 2 * base.g * overlay.g : 1 - 2 * (1 - base.g) * (1 - overlay.g);
        result.b = overlay.b < 0.5 ? 2 * base.b * overlay.b : 1 - 2 * (1 - base.b) * (1 - overlay.b);
        break;

      case 'vivid-light':
        result.r = overlay.r < 0.5 ? (overlay.r === 0 ? 0 : Math.max(0, 1 - (1 - base.r) / (2 * overlay.r))) :
                                     (overlay.r === 1 ? 1 : Math.min(1, base.r / (2 * (1 - overlay.r))));
        result.g = overlay.g < 0.5 ? (overlay.g === 0 ? 0 : Math.max(0, 1 - (1 - base.g) / (2 * overlay.g))) :
                                     (overlay.g === 1 ? 1 : Math.min(1, base.g / (2 * (1 - overlay.g))));
        result.b = overlay.b < 0.5 ? (overlay.b === 0 ? 0 : Math.max(0, 1 - (1 - base.b) / (2 * overlay.b))) :
                                     (overlay.b === 1 ? 1 : Math.min(1, base.b / (2 * (1 - overlay.b))));
        break;

      case 'linear-light':
        result.r = Math.max(0, Math.min(1, base.r + 2 * overlay.r - 1));
        result.g = Math.max(0, Math.min(1, base.g + 2 * overlay.g - 1));
        result.b = Math.max(0, Math.min(1, base.b + 2 * overlay.b - 1));
        break;

      case 'pin-light':
        result.r = overlay.r < 0.5 ? Math.min(base.r, 2 * overlay.r) : Math.max(base.r, 2 * overlay.r - 1);
        result.g = overlay.g < 0.5 ? Math.min(base.g, 2 * overlay.g) : Math.max(base.g, 2 * overlay.g - 1);
        result.b = overlay.b < 0.5 ? Math.min(base.b, 2 * overlay.b) : Math.max(base.b, 2 * overlay.b - 1);
        break;

      case 'hard-mix':
        result.r = (base.r + overlay.r) < 1 ? 0 : 1;
        result.g = (base.g + overlay.g) < 1 ? 0 : 1;
        result.b = (base.b + overlay.b) < 1 ? 0 : 1;
        break;

      // Comparative modes
      case 'difference':
        result.r = Math.abs(base.r - overlay.r);
        result.g = Math.abs(base.g - overlay.g);
        result.b = Math.abs(base.b - overlay.b);
        break;

      case 'exclusion':
        result.r = base.r + overlay.r - 2 * base.r * overlay.r;
        result.g = base.g + overlay.g - 2 * base.g * overlay.g;
        result.b = base.b + overlay.b - 2 * base.b * overlay.b;
        break;

      case 'subtract':
        result.r = Math.max(0, base.r - overlay.r);
        result.g = Math.max(0, base.g - overlay.g);
        result.b = Math.max(0, base.b - overlay.b);
        break;

      case 'divide':
        result.r = overlay.r === 0 ? 1 : Math.min(1, base.r / overlay.r);
        result.g = overlay.g === 0 ? 1 : Math.min(1, base.g / overlay.g);
        result.b = overlay.b === 0 ? 1 : Math.min(1, base.b / overlay.b);
        break;

      // Component modes
      case 'hue':
        return this.blendHsv(base, overlay, 'hue');

      case 'saturation':
        return this.blendHsv(base, overlay, 'saturation');

      case 'color':
        return this.blendHsv(base, overlay, 'color');

      case 'luminosity':
        return this.blendHsv(base, overlay, 'luminosity');

      // Advanced modes
      case 'grain-extract':
        result.r = Math.max(0, Math.min(1, base.r - overlay.r + 0.5));
        result.g = Math.max(0, Math.min(1, base.g - overlay.g + 0.5));
        result.b = Math.max(0, Math.min(1, base.b - overlay.b + 0.5));
        break;

      case 'grain-merge':
        result.r = Math.max(0, Math.min(1, base.r + overlay.r - 0.5));
        result.g = Math.max(0, Math.min(1, base.g + overlay.g - 0.5));
        result.b = Math.max(0, Math.min(1, base.b + overlay.b - 0.5));
        break;

      case 'reflect':
        result.r = overlay.r === 1 ? 1 : Math.min(1, (base.r * base.r) / (1 - overlay.r));
        result.g = overlay.g === 1 ? 1 : Math.min(1, (base.g * base.g) / (1 - overlay.g));
        result.b = overlay.b === 1 ? 1 : Math.min(1, (base.b * base.b) / (1 - overlay.b));
        break;

      case 'glow':
        result.r = base.r === 1 ? 1 : Math.min(1, (overlay.r * overlay.r) / (1 - base.r));
        result.g = base.g === 1 ? 1 : Math.min(1, (overlay.g * overlay.g) / (1 - base.g));
        result.b = base.b === 1 ? 1 : Math.min(1, (overlay.b * overlay.b) / (1 - base.b));
        break;

      case 'freeze':
        result.r = overlay.r === 0 ? 0 : Math.max(0, 1 - (1 - base.r) * (1 - base.r) / overlay.r);
        result.g = overlay.g === 0 ? 0 : Math.max(0, 1 - (1 - base.g) * (1 - base.g) / overlay.g);
        result.b = overlay.b === 0 ? 0 : Math.max(0, 1 - (1 - base.b) * (1 - base.b) / overlay.b);
        break;

      case 'heat':
        result.r = base.r === 0 ? 0 : Math.max(0, 1 - (1 - overlay.r) * (1 - overlay.r) / base.r);
        result.g = base.g === 0 ? 0 : Math.max(0, 1 - (1 - overlay.g) * (1 - overlay.g) / base.g);
        result.b = base.b === 0 ? 0 : Math.max(0, 1 - (1 - overlay.b) * (1 - overlay.b) / base.b);
        break;

      default:
        return base;
    }

    // Clamp values
    result.r = Math.max(0, Math.min(1, result.r));
    result.g = Math.max(0, Math.min(1, result.g));
    result.b = Math.max(0, Math.min(1, result.b));

    return result;
  }

  /**
   * Soft light blend helper
   */
  private softLightBlend(base: number, overlay: number): number {
    if (overlay < 0.5) {
      return base - (1 - 2 * overlay) * base * (1 - base);
    } else {
      const d = base < 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
      return base + (2 * overlay - 1) * (d - base);
    }
  }

  /**
   * HSV-based blend modes
   */
  private blendHsv(
    base: { r: number; g: number; b: number; a: number },
    overlay: { r: number; g: number; b: number; a: number },
    component: 'hue' | 'saturation' | 'color' | 'luminosity'
  ): { r: number; g: number; b: number; a: number } {
    // Convert to HSV
    const baseHsv = this.rgbToHsv(base.r, base.g, base.b);
    const overlayHsv = this.rgbToHsv(overlay.r, overlay.g, overlay.b);

    let resultHsv: [number, number, number];

    switch (component) {
      case 'hue':
        resultHsv = [overlayHsv[0], baseHsv[1], baseHsv[2]];
        break;
      case 'saturation':
        resultHsv = [baseHsv[0], overlayHsv[1], baseHsv[2]];
        break;
      case 'color':
        resultHsv = [overlayHsv[0], overlayHsv[1], baseHsv[2]];
        break;
      case 'luminosity':
        resultHsv = [baseHsv[0], baseHsv[1], overlayHsv[2]];
        break;
    }

    // Convert back to RGB
    const [r, g, b] = this.hsvToRgb(resultHsv[0], resultHsv[1], resultHsv[2]);
    return { r, g, b, a: base.a };
  }

  /**
   * RGB to HSV conversion
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
   * HSV to RGB conversion
   */
  private hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else if (h >= 300 && h < 360) {
      r = c; g = 0; b = x;
    }

    return [r + m, g + m, b + m];
  }

  /**
   * Get all available blend modes
   */
  getBlendModes(): { category: string; modes: BlendMode[] }[] {
    return [
      {
        category: 'Normal',
        modes: ['normal', 'dissolve']
      },
      {
        category: 'Darkening',
        modes: ['darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color']
      },
      {
        category: 'Lightening',
        modes: ['lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color']
      },
      {
        category: 'Contrast',
        modes: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix']
      },
      {
        category: 'Comparative',
        modes: ['difference', 'exclusion', 'subtract', 'divide']
      },
      {
        category: 'Component',
        modes: ['hue', 'saturation', 'color', 'luminosity']
      },
      {
        category: 'Advanced',
        modes: ['grain-extract', 'grain-merge', 'reflect', 'glow', 'freeze', 'heat']
      }
    ];
  }

  /**
   * Create a duplicate layer for blending
   */
  duplicateLayer(imageData: Float32Array): Float32Array {
    return new Float32Array(imageData);
  }

  /**
   * Apply adjustment to a layer
   */
  applyAdjustmentToLayer(
    imageData: Float32Array,
    adjustment: (pixel: { r: number; g: number; b: number; a: number }) => { r: number; g: number; b: number; a: number }
  ): Float32Array {
    const result = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      const pixel = {
        r: imageData[i],
        g: imageData[i + 1],
        b: imageData[i + 2],
        a: imageData[i + 3]
      };

      const adjusted = adjustment(pixel);

      result[i] = adjusted.r;
      result[i + 1] = adjusted.g;
      result[i + 2] = adjusted.b;
      result[i + 3] = adjusted.a;
    }

    return result;
  }

  /**
   * Create a gradient overlay
   */
  createGradientOverlay(
    width: number,
    height: number,
    startColor: { r: number; g: number; b: number; a: number },
    endColor: { r: number; g: number; b: number; a: number },
    angle: number = 0
  ): Float32Array {
    const imageData = new Float32Array(width * height * 4);

    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;

        // Calculate position along gradient
        const normalizedX = (x / width) - 0.5;
        const normalizedY = (y / height) - 0.5;
        const rotatedX = normalizedX * cos - normalizedY * sin;
        const t = Math.max(0, Math.min(1, rotatedX + 0.5));

        // Interpolate colors
        imageData[index] = startColor.r + (endColor.r - startColor.r) * t;
        imageData[index + 1] = startColor.g + (endColor.g - startColor.g) * t;
        imageData[index + 2] = startColor.b + (endColor.b - startColor.b) * t;
        imageData[index + 3] = startColor.a + (endColor.a - startColor.a) * t;
      }
    }

    return imageData;
  }
}

// Export singleton instance
export const advancedBlendingService = AdvancedBlendingService.getInstance();