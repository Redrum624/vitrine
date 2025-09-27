import { logger } from '../utils/Logger';

export interface ColorBalanceParams {
  // Traditional 3-range color balance (shadows, midtones, highlights)
  shadows: {
    cyan_red: number;        // -1.0 to +1.0 (cyan to red)
    magenta_green: number;   // -1.0 to +1.0 (magenta to green)
    yellow_blue: number;     // -1.0 to +1.0 (yellow to blue)
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

  // 8-color HSL controls (Global Color Controls)
  red_saturation: number;     // -100 to +100
  red_luminance: number;      // -100 to +100
  red_hue: number;           // -180 to +180

  orange_saturation: number;
  orange_luminance: number;
  orange_hue: number;

  yellow_saturation: number;
  yellow_luminance: number;
  yellow_hue: number;

  green_saturation: number;
  green_luminance: number;
  green_hue: number;

  cyan_saturation: number;
  cyan_luminance: number;
  cyan_hue: number;

  blue_saturation: number;
  blue_luminance: number;
  blue_hue: number;

  purple_saturation: number;
  purple_luminance: number;
  purple_hue: number;

  magenta_saturation: number;
  magenta_luminance: number;
  magenta_hue: number;

  [key: string]: unknown; // Index signature for Record compatibility
}

export interface ColorBalanceProcessingContext {
  width: number;
  height: number;
  channels: number;
}

export class ColorBalanceModule {
  private params: ColorBalanceParams = {
    // Traditional color balance - all neutral
    shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
    midtones: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
    highlights: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },

    // Global color controls - all neutral
    red_saturation: 0, red_luminance: 0, red_hue: 0,
    orange_saturation: 0, orange_luminance: 0, orange_hue: 0,
    yellow_saturation: 0, yellow_luminance: 0, yellow_hue: 0,
    green_saturation: 0, green_luminance: 0, green_hue: 0,
    cyan_saturation: 0, cyan_luminance: 0, cyan_hue: 0,
    blue_saturation: 0, blue_luminance: 0, blue_hue: 0,
    purple_saturation: 0, purple_luminance: 0, purple_hue: 0,
    magenta_saturation: 0, magenta_luminance: 0, magenta_hue: 0
  };

  getId(): string {
    return 'colorbalance';
  }

  getName(): string {
    return 'Color Balance';
  }

  getParams(): ColorBalanceParams {
    return { ...this.params };
  }

  setParams(params: Partial<ColorBalanceParams>): void {
    this.params = { ...this.params, ...params };
    logger.debug(`ColorBalance params updated:`, this.params);
  }

  resetParams(): void {
    this.params = {
      shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      midtones: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      highlights: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      red_saturation: 0, red_luminance: 0, red_hue: 0,
      orange_saturation: 0, orange_luminance: 0, orange_hue: 0,
      yellow_saturation: 0, yellow_luminance: 0, yellow_hue: 0,
      green_saturation: 0, green_luminance: 0, green_hue: 0,
      cyan_saturation: 0, cyan_luminance: 0, cyan_hue: 0,
      blue_saturation: 0, blue_luminance: 0, blue_hue: 0,
      purple_saturation: 0, purple_luminance: 0, purple_hue: 0,
      magenta_saturation: 0, magenta_luminance: 0, magenta_hue: 0
    };
    logger.debug('ColorBalance params reset to defaults');
  }

  private rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    const sum = max + min;

    let h = 0;
    const l = sum / 2;
    let s = 0;

    if (diff !== 0) {
      s = l > 0.5 ? diff / (2 - sum) : diff / sum;

      switch (max) {
        case r:
          h = (g - b) / diff + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / diff + 2;
          break;
        case b:
          h = (r - g) / diff + 4;
          break;
      }
      h /= 6;
    }

    return [h * 360, s * 100, l * 100];
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    h = (h % 360 + 360) % 360; // Normalize hue
    s = Math.max(0, Math.min(100, s)) / 100; // Clamp and normalize saturation
    l = Math.max(0, Math.min(100, l)) / 100; // Clamp and normalize lightness

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

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

  private calculateLuminance(r: number, g: number, b: number): number {
    // Calculate relative luminance using standard weights
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  private getTonalWeight(luminance: number, range: 'shadows' | 'midtones' | 'highlights'): number {
    // Calculate how much a pixel belongs to each tonal range
    switch (range) {
      case 'shadows':
        return luminance < 0.33 ? 1.0 : Math.max(0, (0.66 - luminance) / 0.33);
      case 'midtones':
        return luminance >= 0.33 && luminance <= 0.66 ? 1.0 :
               luminance < 0.33 ? Math.max(0, luminance / 0.33) :
               Math.max(0, (1.0 - luminance) / 0.34);
      case 'highlights':
        return luminance > 0.66 ? 1.0 : Math.max(0, (luminance - 0.33) / 0.33);
      default:
        return 0;
    }
  }

  private calculateColorWeight(pixelHue: number, targetRange: string): number {
    // Calculate how much a pixel's hue belongs to a color range
    const ranges = {
      red: [345, 360, 0, 15],
      orange: [15, 45],
      yellow: [45, 75],
      green: [75, 165],
      cyan: [165, 195],
      blue: [195, 255],
      purple: [255, 285],
      magenta: [285, 345]
    };

    const range = ranges[targetRange as keyof typeof ranges];
    if (!range) return 0;

    if (range.length === 4) {
      // Handle red range that wraps around 0
      const [start1, end1, start2, end2] = range;
      if ((pixelHue >= start1 && pixelHue <= end1) || (pixelHue >= start2 && pixelHue <= end2)) {
        return 1.0;
      }
      // Calculate distance for wraparound
      const dist1 = Math.min(Math.abs(pixelHue - start1), Math.abs(pixelHue - end1));
      const dist2 = Math.min(Math.abs(pixelHue - start2), Math.abs(pixelHue - end2));
      const minDist = Math.min(dist1, dist2);
      return Math.max(0, 1 - minDist / 30); // 30-degree falloff
    } else {
      // Normal range
      const [start, end] = range;
      if (pixelHue >= start && pixelHue <= end) {
        return 1.0;
      }
      // Calculate distance
      const dist = Math.min(Math.abs(pixelHue - start), Math.abs(pixelHue - end));
      return Math.max(0, 1 - dist / 30); // 30-degree falloff
    }
  }

  process(input: Float32Array, context: ColorBalanceProcessingContext): Float32Array {
    const { width, height, channels } = context;
    const output = new Float32Array(input.length);
    output.set(input);

    logger.debug(`Processing ColorBalance: ${width}x${height} with traditional + global controls`);

    // Process each pixel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;

        let r = output[pixelIndex];
        let g = output[pixelIndex + 1];
        let b = output[pixelIndex + 2];

        // 1. Apply traditional 3-range color balance first
        const luminance = this.calculateLuminance(r, g, b);

        for (const rangeName of ['shadows', 'midtones', 'highlights'] as const) {
          const weight = this.getTonalWeight(luminance, rangeName);

          if (weight > 0.01) {
            const range = this.params[rangeName];

            // Apply color balance adjustments
            r += range.cyan_red * weight * 0.1;
            g += range.magenta_green * weight * 0.1;
            b += range.yellow_blue * weight * 0.1;
          }
        }

        // Clamp after traditional color balance
        r = Math.max(0.0, Math.min(1.0, r));
        g = Math.max(0.0, Math.min(1.0, g));
        b = Math.max(0.0, Math.min(1.0, b));

        // 2. Apply global color controls (HSL-based)
        const [h, s, l] = this.rgbToHsl(r, g, b);

        let newH = h;
        let newS = s;
        let newL = l;

        // Apply color-specific adjustments
        const colorRanges = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];

        for (const colorRange of colorRanges) {
          const weight = this.calculateColorWeight(h, colorRange);

          if (weight > 0.01) { // Only apply if there's significant weight
            const satKey = `${colorRange}_saturation` as keyof ColorBalanceParams;
            const lumKey = `${colorRange}_luminance` as keyof ColorBalanceParams;
            const hueKey = `${colorRange}_hue` as keyof ColorBalanceParams;

            const satAdjust = (this.params[satKey] as number) || 0;
            const lumAdjust = (this.params[lumKey] as number) || 0;
            const hueAdjust = (this.params[hueKey] as number) || 0;

            // Apply weighted adjustments
            newH += (hueAdjust * weight);
            newS += (satAdjust * weight);
            newL += (lumAdjust * weight);
          }
        }

        // Clamp values
        newH = (newH % 360 + 360) % 360;
        newS = Math.max(0, Math.min(100, newS));
        newL = Math.max(0, Math.min(100, newL));

        // Convert back to RGB
        const [newR, newG, newB] = this.hslToRgb(newH, newS, newL);

        // Update pixel
        output[pixelIndex] = Math.max(0.0, Math.min(1.0, newR));
        output[pixelIndex + 1] = Math.max(0.0, Math.min(1.0, newG));
        output[pixelIndex + 2] = Math.max(0.0, Math.min(1.0, newB));
      }
    }

    logger.debug('ColorBalance processing completed with both traditional and global controls');
    return output;
  }
}