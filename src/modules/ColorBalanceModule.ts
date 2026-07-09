import { logger } from '../utils/Logger';
import { validateInputDimensions, rgbToHsl, hslToRgb } from './utils/ColorUtils';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

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

  /**
   * Safely get a numeric parameter value with type checking.
   * @param key The parameter key
   * @returns The numeric value or 0 if not a valid number
   */
  private getNumericParam(key: string): number {
    const value = this.params[key as keyof ColorBalanceParams];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 0;
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

    // Validate input dimensions
    validateInputDimensions(input, width, height, channels, 'ColorBalanceModule');
    const output = new Float32Array(input.length);
    output.set(input);

    logger.debug(`Processing ColorBalance: ${width}x${height} with traditional + global controls`);

    // GPU fast-path (RGBA only); falls back to the CPU loop below.
    if (channels === 4 && webGLImageProcessor.isAvailable()) {
      const sh = this.params.shadows, md = this.params.midtones, hl = this.params.highlights;
      const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
      const sat = colors.map(c => this.getNumericParam(`${c}_saturation`));
      const lum = colors.map(c => this.getNumericParam(`${c}_luminance`));
      const hue = colors.map(c => this.getNumericParam(`${c}_hue`));
      return webGLImageProcessor.applyColorBalance(
        output, width, height,
        [sh.cyan_red, sh.magenta_green, sh.yellow_blue],
        [md.cyan_red, md.magenta_green, md.yellow_blue],
        [hl.cyan_red, hl.magenta_green, hl.yellow_blue],
        sat, lum, hue,
      );
    }

    // Precompute per-band slider values once (sat/lum as -1..+1 factors, hue in degrees).
    const colorRanges = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
    const satP = colorRanges.map(c => this.getNumericParam(`${c}_saturation`) / 100);
    const lumP = colorRanges.map(c => this.getNumericParam(`${c}_luminance`) / 100);
    const hueP = colorRanges.map(c => this.getNumericParam(`${c}_hue`));
    const bandW = [0, 0, 0, 0, 0, 0, 0, 0];

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

            // Apply color balance adjustments (0.3 damping = max channel shift
            // at full deflection; mirrored in colorBalanceCPU + FRAG_COLORBALANCE)
            r += range.cyan_red * weight * 0.3;
            g += range.magenta_green * weight * 0.3;
            b += range.yellow_blue * weight * 0.3;
          }
        }

        // Clamp after traditional color balance
        r = Math.max(0.0, Math.min(1.0, r));
        g = Math.max(0.0, Math.min(1.0, g));
        b = Math.max(0.0, Math.min(1.0, b));

        // 2. Apply global color controls (HSL-based).
        // CALIBRATION — MUST stay formula-identical with the two mirrors
        // (WebGLImageProcessor.colorBalanceCPU and sources.ts FRAG_COLORBALANCE);
        // the runtime GPU self-check compares them and permanently falls back to
        // CPU on any drift. The formula:
        //  - band weights normalised so their sum never exceeds 1 (no double
        //    effect where adjacent hue bands overlap)
        //  - chroma gate min(1, S/20) keeps neutral pixels untouched (grays get
        //    h=0 from rgbToHsl, which would otherwise land in the red band)
        //  - saturation is proportional: -100 => grayscale, +100 => 2x chroma
        //  - luminance maps the remaining headroom: +100 => L=100, -100 => L=0
        const [h, s, l] = rgbToHsl(r, g, b);

        let wSum = 0;
        for (let i = 0; i < 8; i++) {
          bandW[i] = this.calculateColorWeight(h, colorRanges[i]);
          wSum += bandW[i];
        }
        const scale = Math.min(1, s / 20) / Math.max(1, wSum);

        let hueShift = 0;
        let satAdj = 0;
        let lumAdj = 0;
        for (let i = 0; i < 8; i++) {
          const w = bandW[i] * scale;
          hueShift += hueP[i] * w;
          satAdj += satP[i] * w;
          lumAdj += lumP[i] * w;
        }

        const newH = ((h + hueShift) % 360 + 360) % 360;
        const newS = Math.max(0, Math.min(100, s * (1 + satAdj)));
        const newL = Math.max(0, Math.min(100,
          lumAdj >= 0 ? l + (100 - l) * lumAdj : l + l * lumAdj));

        // Convert back to RGB
        const [newR, newG, newB] = hslToRgb(newH, newS, newL);

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