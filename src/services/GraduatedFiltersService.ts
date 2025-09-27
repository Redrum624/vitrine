export interface GradientStop {
  position: number; // 0-1
  color: { r: number; g: number; b: number; a: number };
  opacity: number; // 0-1
}

export interface GradientSettings {
  type: 'linear' | 'radial' | 'angular' | 'reflected';
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  stops: GradientStop[];
  falloff: 'linear' | 'smooth' | 'sharp' | 'exponential';
  rotation: number; // degrees
  scale: number; // multiplier
  centerPoint?: { x: number; y: number }; // for radial/angular
  feather: number; // edge softness
  reverse: boolean;
}

export interface FilterAdjustment {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  clarity: number;
  dehaze: number;
  hue: number;
  luminance: number;
}

export interface GraduatedFilter {
  id: string;
  name: string;
  enabled: boolean;
  gradient: GradientSettings;
  adjustments: FilterAdjustment;
  blendMode: string;
  opacity: number;
  maskInvert: boolean;
}

export interface FilterPreset {
  name: string;
  description: string;
  gradient: Partial<GradientSettings>;
  adjustments: Partial<FilterAdjustment>;
}

class GraduatedFiltersService {
  private static instance: GraduatedFiltersService;
  private presets: FilterPreset[] = [];

  private constructor() {
    this.initializePresets();
  }

  static getInstance(): GraduatedFiltersService {
    if (!GraduatedFiltersService.instance) {
      GraduatedFiltersService.instance = new GraduatedFiltersService();
    }
    return GraduatedFiltersService.instance;
  }

  private initializePresets(): void {
    this.presets = [
      {
        name: 'Sky Enhancement',
        description: 'Enhance sky contrast and saturation',
        gradient: {
          type: 'linear',
          falloff: 'smooth',
          feather: 20
        },
        adjustments: {
          contrast: 0.3,
          vibrance: 0.4,
          saturation: 0.2,
          clarity: 0.2,
          temperature: -200
        }
      },
      {
        name: 'Foreground Brighten',
        description: 'Brighten foreground while preserving sky',
        gradient: {
          type: 'linear',
          falloff: 'smooth',
          feather: 25,
          reverse: true
        },
        adjustments: {
          exposure: 0.5,
          shadows: 0.3,
          blacks: 0.2,
          clarity: 0.1
        }
      },
      {
        name: 'Sunset Warmth',
        description: 'Add warm glow to sunset scenes',
        gradient: {
          type: 'radial',
          falloff: 'exponential',
          feather: 30
        },
        adjustments: {
          temperature: 800,
          tint: 10,
          exposure: 0.2,
          vibrance: 0.3,
          saturation: 0.1
        }
      },
      {
        name: 'Vignette Dark',
        description: 'Dark vignette effect',
        gradient: {
          type: 'radial',
          falloff: 'exponential',
          feather: 40,
          reverse: true
        },
        adjustments: {
          exposure: -0.8,
          contrast: 0.2,
          saturation: 0.1
        }
      },
      {
        name: 'Spotlight',
        description: 'Dramatic spotlight effect',
        gradient: {
          type: 'radial',
          falloff: 'sharp',
          feather: 15
        },
        adjustments: {
          exposure: 1.0,
          contrast: 0.4,
          clarity: 0.3,
          whites: 0.2
        }
      },
      {
        name: 'Color Temperature Gradient',
        description: 'Smooth temperature transition',
        gradient: {
          type: 'linear',
          falloff: 'linear',
          feather: 20
        },
        adjustments: {
          temperature: 1000,
          tint: 5
        }
      }
    ];
  }

  createGraduatedFilter(settings: Partial<GraduatedFilter>): GraduatedFilter {
    const defaultGradient: GradientSettings = {
      type: 'linear',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 255 }, opacity: 1 },
        { position: 1, color: { r: 255, g: 255, b: 255, a: 255 }, opacity: 0 }
      ],
      falloff: 'smooth',
      rotation: 0,
      scale: 1,
      feather: 10,
      reverse: false
    };

    const defaultAdjustments: FilterAdjustment = {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0,
      clarity: 0,
      dehaze: 0,
      hue: 0,
      luminance: 0
    };

    return {
      id: settings.id || `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: settings.name || 'New Graduated Filter',
      enabled: settings.enabled ?? true,
      gradient: { ...defaultGradient, ...settings.gradient },
      adjustments: { ...defaultAdjustments, ...settings.adjustments },
      blendMode: settings.blendMode || 'normal',
      opacity: settings.opacity ?? 1.0,
      maskInvert: settings.maskInvert ?? false
    };
  }

  generateGradientMask(
    width: number,
    height: number,
    gradient: GradientSettings
  ): Float32Array {
    const mask = new Float32Array(width * height);
    const { startPoint, endPoint, type, falloff, rotation, scale, centerPoint, feather, reverse } = gradient;

    const center = centerPoint || { x: width / 2, y: height / 2 };
    const start = { x: startPoint.x * width, y: startPoint.y * height };
    const end = { x: endPoint.x * width, y: endPoint.y * height };

    // Convert rotation to radians
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let value = 0;

        // Apply rotation if needed
        let rx = x, ry = y;
        if (rotation !== 0) {
          const dx = x - center.x;
          const dy = y - center.y;
          rx = center.x + dx * cos - dy * sin;
          ry = center.y + dx * sin + dy * cos;
        }

        switch (type) {
          case 'linear': {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length > 0) {
              const px = rx - start.x;
              const py = ry - start.y;
              const t = (px * dx + py * dy) / (length * length);
              value = Math.max(0, Math.min(1, t * scale));
            }
            break;
          }

          case 'radial': {
            const dx = rx - center.x;
            const dy = ry - center.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const radius = Math.min(width, height) / 2;
            value = Math.max(0, Math.min(1, (distance / radius) * scale));
            break;
          }

          case 'angular': {
            const dx = rx - center.x;
            const dy = ry - center.y;
            let angle = Math.atan2(dy, dx) + Math.PI; // 0 to 2π
            angle = angle / (2 * Math.PI); // 0 to 1
            value = angle * scale;
            value = value - Math.floor(value); // wrap to 0-1
            break;
          }

          case 'reflected': {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length > 0) {
              const px = rx - start.x;
              const py = ry - start.y;
              let t = (px * dx + py * dy) / (length * length);
              t = t * scale;
              t = Math.abs(t - Math.floor(t + 0.5)) * 2; // reflect
              value = Math.max(0, Math.min(1, t));
            }
            break;
          }
        }

        // Apply falloff curve
        value = this.applyFalloff(value, falloff);

        // Apply feathering (edge softness)
        if (feather > 0) {
          const featherRadius = feather / 100;
          if (value > 0 && value < 1) {
            const edge = Math.min(value, 1 - value);
            const featherFactor = Math.min(1, edge / featherRadius);
            value = value * featherFactor + (1 - featherFactor) * 0.5;
          }
        }

        // Apply reverse if needed
        if (reverse) {
          value = 1 - value;
        }

        mask[idx] = value;
      }
    }

    return mask;
  }

  private applyFalloff(value: number, falloff: string): number {
    switch (falloff) {
      case 'linear':
        return value;

      case 'smooth':
        return value * value * (3 - 2 * value); // smoothstep

      case 'sharp':
        return value < 0.5 ? 2 * value * value : 1 - 2 * (1 - value) * (1 - value);

      case 'exponential':
        return value * value * value;

      default:
        return value;
    }
  }

  interpolateGradientStops(stops: GradientStop[], position: number): { r: number; g: number; b: number; a: number; opacity: number } {
    if (stops.length === 0) {
      return { r: 0, g: 0, b: 0, a: 255, opacity: 1 };
    }

    if (stops.length === 1) {
      return { ...stops[0].color, opacity: stops[0].opacity };
    }

    // Find the two stops to interpolate between
    let leftStop = stops[0];
    let rightStop = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
      if (position >= stops[i].position && position <= stops[i + 1].position) {
        leftStop = stops[i];
        rightStop = stops[i + 1];
        break;
      }
    }

    // Handle edge cases
    if (position <= leftStop.position) {
      return { ...leftStop.color, opacity: leftStop.opacity };
    }
    if (position >= rightStop.position) {
      return { ...rightStop.color, opacity: rightStop.opacity };
    }

    // Interpolate
    const range = rightStop.position - leftStop.position;
    const t = range > 0 ? (position - leftStop.position) / range : 0;

    return {
      r: Math.round(leftStop.color.r + (rightStop.color.r - leftStop.color.r) * t),
      g: Math.round(leftStop.color.g + (rightStop.color.g - leftStop.color.g) * t),
      b: Math.round(leftStop.color.b + (rightStop.color.b - leftStop.color.b) * t),
      a: Math.round(leftStop.color.a + (rightStop.color.a - leftStop.color.a) * t),
      opacity: leftStop.opacity + (rightStop.opacity - leftStop.opacity) * t
    };
  }

  applyGraduatedFilter(
    imageData: Float32Array,
    width: number,
    height: number,
    filter: GraduatedFilter
  ): Float32Array {
    if (!filter.enabled) {
      return imageData.slice();
    }

    const result = imageData.slice();
    const mask = this.generateGradientMask(width, height, filter.gradient);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const maskIdx = y * width + x;
        let maskValue = mask[maskIdx];

        if (filter.maskInvert) {
          maskValue = 1 - maskValue;
        }

        maskValue *= filter.opacity;

        if (maskValue > 0) {
          // Apply adjustments based on mask strength
          const r = result[idx];
          const g = result[idx + 1];
          const b = result[idx + 2];

          // Apply exposure adjustment
          let adjustedR = r;
          let adjustedG = g;
          let adjustedB = b;

          if (filter.adjustments.exposure !== 0) {
            const exposureMultiplier = Math.pow(2, filter.adjustments.exposure);
            adjustedR *= exposureMultiplier;
            adjustedG *= exposureMultiplier;
            adjustedB *= exposureMultiplier;
          }

          // Apply contrast
          if (filter.adjustments.contrast !== 0) {
            const contrast = 1 + filter.adjustments.contrast;
            adjustedR = ((adjustedR / 255 - 0.5) * contrast + 0.5) * 255;
            adjustedG = ((adjustedG / 255 - 0.5) * contrast + 0.5) * 255;
            adjustedB = ((adjustedB / 255 - 0.5) * contrast + 0.5) * 255;
          }

          // Apply temperature and tint
          if (filter.adjustments.temperature !== 0 || filter.adjustments.tint !== 0) {
            const temp = filter.adjustments.temperature / 1000;
            const tint = filter.adjustments.tint / 100;

            // Simplified temperature adjustment
            if (temp > 0) { // warmer
              adjustedR *= (1 + temp * 0.3);
              adjustedB *= (1 - temp * 0.2);
            } else { // cooler
              adjustedR *= (1 + temp * 0.2);
              adjustedB *= (1 - temp * 0.3);
            }

            // Tint adjustment
            adjustedG *= (1 + tint * 0.1);
          }

          // Apply saturation
          if (filter.adjustments.saturation !== 0) {
            const saturation = 1 + filter.adjustments.saturation;
            const gray = adjustedR * 0.299 + adjustedG * 0.587 + adjustedB * 0.114;
            adjustedR = gray + (adjustedR - gray) * saturation;
            adjustedG = gray + (adjustedG - gray) * saturation;
            adjustedB = gray + (adjustedB - gray) * saturation;
          }

          // Apply vibrance (smart saturation)
          if (filter.adjustments.vibrance !== 0) {
            const vibrance = filter.adjustments.vibrance;
            const max = Math.max(adjustedR, adjustedG, adjustedB);
            const avg = (adjustedR + adjustedG + adjustedB) / 3;
            const amt = ((Math.abs(max - avg) * 2 / 255) * vibrance) / 100;

            if (amt !== 0) {
              adjustedR += (max - adjustedR) * amt;
              adjustedG += (max - adjustedG) * amt;
              adjustedB += (max - adjustedB) * amt;
            }
          }

          // Blend with original based on mask strength
          result[idx] = r + (adjustedR - r) * maskValue;
          result[idx + 1] = g + (adjustedG - g) * maskValue;
          result[idx + 2] = b + (adjustedB - b) * maskValue;

          // Clamp values
          result[idx] = Math.max(0, Math.min(255, result[idx]));
          result[idx + 1] = Math.max(0, Math.min(255, result[idx + 1]));
          result[idx + 2] = Math.max(0, Math.min(255, result[idx + 2]));
        }
      }
    }

    return result;
  }

  createCustomGradient(stops: GradientStop[]): GradientSettings {
    return {
      type: 'linear',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
      stops: stops.sort((a, b) => a.position - b.position),
      falloff: 'smooth',
      rotation: 0,
      scale: 1,
      feather: 10,
      reverse: false
    };
  }

  duplicateFilter(filter: GraduatedFilter): GraduatedFilter {
    return {
      ...filter,
      id: `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `${filter.name} Copy`
    };
  }

  exportFilter(filter: GraduatedFilter): string {
    return JSON.stringify(filter, null, 2);
  }

  importFilter(filterJson: string): GraduatedFilter {
    try {
      const filter = JSON.parse(filterJson) as GraduatedFilter;
      // Regenerate ID to avoid conflicts
      filter.id = `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return filter;
    } catch {
      throw new Error('Invalid filter JSON format');
    }
  }

  getPresets(): FilterPreset[] {
    return [...this.presets];
  }

  createFilterFromPreset(preset: FilterPreset): GraduatedFilter {
    return this.createGraduatedFilter({
      name: preset.name,
      gradient: preset.gradient as GradientSettings,
      adjustments: preset.adjustments as FilterAdjustment
    });
  }

  analyzeImageForSuggestedFilters(
    imageData: Float32Array,
    width: number,
    height: number
  ): FilterPreset[] {
    const suggestions: FilterPreset[] = [];

    // Analyze brightness distribution
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < imageData.length; i += 4) {
      const brightness = Math.round((imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3);
      histogram[brightness]++;
    }

    const totalPixels = width * height;
    const darkPixels = histogram.slice(0, 85).reduce((sum, count) => sum + count, 0);
    const brightPixels = histogram.slice(170, 256).reduce((sum, count) => sum + count, 0);

    // Suggest based on analysis
    if (brightPixels / totalPixels > 0.3) {
      suggestions.push(this.presets.find(p => p.name === 'Sky Enhancement')!);
    }

    if (darkPixels / totalPixels > 0.4) {
      suggestions.push(this.presets.find(p => p.name === 'Foreground Brighten')!);
    }

    // Always suggest vignette as it's commonly used
    suggestions.push(this.presets.find(p => p.name === 'Vignette Dark')!);

    return suggestions;
  }
}

export default GraduatedFiltersService;