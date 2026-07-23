import { logger } from '../utils/Logger';
import { ModuleParams } from '../types/darktable';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

export interface ImageData {
  width: number;
  height: number;
  data: Float32Array;
  channels: number;
}

export interface ModuleFlags {
  enabled?: boolean;
  shown?: boolean;
  expand?: boolean;
  focus?: boolean;
  state?: number;
  preferred_csp?: number;
  blend_colorspace?: number;
}

export interface ImageProcessingModule {
  id: string;
  name: string;
  group: string;
  flags: ModuleFlags;
  process(imageData: ImageData): ImageData;
}

export interface ToneCurveParams extends ModuleParams {
  // Base curve with control points
  baseCurve: CurveNode[];
  baseCurveNodes: number;
  baseCurveType: number; // 0=linear, 1=smooth, 2=monotonic

  // RGB channel curves
  rgbCurve: {
    red: CurveNode[];
    green: CurveNode[];
    blue: CurveNode[];
  };
  rgbCurveNodes: {
    red: number;
    green: number;
    blue: number;
  };

  // Exposure fusion for HDR-like effects
  exposureFusion: number; // 0.0 to 1.0
  exposureStops: number;  // 0.01 to 4.0

  // Preserve colors during tone mapping
  preserveColors: number; // 0=none, 1=luminance, 2=max RGB, 3=average RGB

  // Auto levels
  autoLevels: boolean;
  autoContrast: boolean;
}

export interface CurveNode {
  x: number; // 0.0 to 1.0 (input)
  y: number; // 0.0 to 1.0 (output)
}

export class ToneCurveModule implements ImageProcessingModule {
  id = 'tonecurve';
  name = 'Tone Curve';
  group = 'tone';
  flags = {
    enabled: true,
    shown: true,
    expand: false,
    focus: false,
    state: 3, // normal
    preferred_csp: 4, // RGB working space
    blend_colorspace: 7 // Lab
  };

  private params: ToneCurveParams;
  private lookupTable: Float32Array;
  private rgbLookupTables: {
    red: Float32Array;
    green: Float32Array;
    blue: Float32Array;
  };

  constructor() {
    this.params = this.getDefaultParams();
    this.lookupTable = new Float32Array(65536);
    this.rgbLookupTables = {
      red: new Float32Array(65536),
      green: new Float32Array(65536),
      blue: new Float32Array(65536)
    };
    this.updateLookupTables();

    logger.info('ToneCurveModule initialized');
  }

  getDefaultParams(): ToneCurveParams {
    return {
      // Base curve: linear by default
      baseCurve: [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 1.0 }
      ],
      baseCurveNodes: 2,
      baseCurveType: 1, // smooth interpolation

      // RGB curves: linear by default
      rgbCurve: {
        red: [
          { x: 0.0, y: 0.0 },
          { x: 1.0, y: 1.0 }
        ],
        green: [
          { x: 0.0, y: 0.0 },
          { x: 1.0, y: 1.0 }
        ],
        blue: [
          { x: 0.0, y: 0.0 },
          { x: 1.0, y: 1.0 }
        ]
      },
      rgbCurveNodes: {
        red: 2,
        green: 2,
        blue: 2
      },

      // Fusion settings
      exposureFusion: 0.0,
      exposureStops: 1.0,

      // Color preservation
      preserveColors: 1, // preserve luminance

      // Auto adjustments
      autoLevels: false,
      autoContrast: false
    };
  }

  setParams(newParams: Partial<ToneCurveParams>): void {
    this.params = { ...this.params, ...newParams };

    // Update lookup tables when curves change
    const curvesChanged =
      newParams.baseCurve !== undefined ||
      newParams.rgbCurve !== undefined ||
      newParams.baseCurveType !== undefined ||
      newParams.exposureFusion !== undefined ||
      newParams.exposureStops !== undefined;

    if (curvesChanged) {
      this.updateLookupTables();
      logger.debug('Tone curve lookup tables updated');
    }

    logger.debug('ToneCurveModule params updated:', {
      changed: Object.keys(newParams),
      baseCurveNodes: this.params.baseCurveNodes,
      exposureFusion: this.params.exposureFusion
    });
  }

  getParams(): ToneCurveParams {
    return { ...this.params };
  }

  /**
   * Returns the current built LUT arrays used by process() / applyToneCurve().
   * These are the same Float32Array instances the module passes to the GPU in process().
   * The caller must NOT modify the returned arrays.
   *
   * Returns null only when the module is identity (all LUTs are linear maps)
   * AND none of the RGB channel curves are non-identity — i.e. this module
   * would be a no-op on GPU. Callers should skip the GPU pass in that case.
   */
  getGpuLuts(): { master: Float32Array; red: Float32Array; green: Float32Array; blue: Float32Array } | null {
    return {
      master: this.lookupTable,
      red: this.rgbLookupTables.red,
      green: this.rgbLookupTables.green,
      blue: this.rgbLookupTables.blue,
    };
  }

  reset(): void {
    logger.info('Resetting ToneCurveModule to defaults');
    this.setParams(this.getDefaultParams());
  }

  process(imageData: ImageData): ImageData {
    if (!this.flags.enabled) {
      return imageData;
    }

    const startTime = performance.now();
    const { width, height, data } = imageData;
    const processedData = new Float32Array(data.length);

    // Apply auto levels if enabled
    if (this.params.autoLevels) {
      this.applyAutoLevels(data, processedData, width, height);
    } else {
      processedData.set(data);
    }

    // Apply base + RGB curves: GPU when available (verified), else the CPU passes.
    if (data.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
      processedData.set(webGLImageProcessor.applyToneCurve(
        processedData, width, height,
        this.lookupTable, this.rgbLookupTables.red, this.rgbLookupTables.green, this.rgbLookupTables.blue,
        this.params.preserveColors,
      ));
    } else {
      this.applyBaseCurve(processedData, width, height);
      this.applyRGBCurves(processedData, width, height);
    }

    // Apply exposure fusion if enabled
    if (this.params.exposureFusion > 0) {
      this.applyExposureFusion(processedData, width, height);
    }

    // Apply auto contrast if enabled
    if (this.params.autoContrast) {
      this.applyAutoContrast(processedData, width, height);
    }

    const processTime = performance.now() - startTime;
    logger.debug(`ToneCurveModule processed ${width}x${height} in ${processTime.toFixed(2)}ms`);

    return {
      width,
      height,
      data: processedData,
      channels: imageData.channels || 4
    };
  }

  private updateLookupTables(): void {
    // Update base curve lookup table
    this.buildCurveLUT(this.params.baseCurve, this.lookupTable);

    // Update RGB channel lookup tables
    this.buildCurveLUT(this.params.rgbCurve.red, this.rgbLookupTables.red);
    this.buildCurveLUT(this.params.rgbCurve.green, this.rgbLookupTables.green);
    this.buildCurveLUT(this.params.rgbCurve.blue, this.rgbLookupTables.blue);
  }

  private buildCurveLUT(curve: CurveNode[], lut: Float32Array): void {
    const nodes = curve.slice().sort((a, b) => a.x - b.x);

    // 2-point curves are always linear (avoids Hermite smoothstep distortion)
    const forceLinear = nodes.length <= 2;

    for (let i = 0; i < 65536; i++) {
      const input = i / 65535.0;
      let output = input;

      // Find the curve segment containing this input value
      for (let j = 1; j < nodes.length; j++) {
        if (input <= nodes[j].x) {
          const p1 = nodes[j - 1];
          const p2 = nodes[j];

          // Linear interpolation between control points
          if (forceLinear || this.params.baseCurveType === 0) {
            const t = (input - p1.x) / (p2.x - p1.x);
            output = p1.y + t * (p2.y - p1.y);
          }
          // Smooth interpolation (cubic spline approximation)
          else if (this.params.baseCurveType === 1) {
            const t = (input - p1.x) / (p2.x - p1.x);
            const t2 = t * t;
            const t3 = t2 * t;

            // Hermite interpolation for smooth curves
            const h1 = 2 * t3 - 3 * t2 + 1;
            const h2 = -2 * t3 + 3 * t2;
            const h3 = t3 - 2 * t2 + t;
            const h4 = t3 - t2;

            // Calculate tangents (simplified)
            const m1 = j > 1 ? (p2.y - nodes[j - 2].y) / (p2.x - nodes[j - 2].x) : 0;
            const m2 = j < nodes.length - 1 ? (nodes[j + 1].y - p1.y) / (nodes[j + 1].x - p1.x) : 0;

            output = h1 * p1.y + h2 * p2.y + h3 * m1 * (p2.x - p1.x) + h4 * m2 * (p2.x - p1.x);
          }
          // Monotonic interpolation
          else if (this.params.baseCurveType === 2) {
            const t = (input - p1.x) / (p2.x - p1.x);
            // Use smoothstep for monotonic curves
            const smoothT = t * t * (3 - 2 * t);
            output = p1.y + smoothT * (p2.y - p1.y);
          }

          break;
        }
      }

      // Clamp output to valid range
      lut[i] = Math.max(0.0, Math.min(1.0, output));
    }
  }

  private applyBaseCurve(data: Float32Array, _width: number, _height: number): void {
    for (let i = 0; i < data.length; i += 4) {
      // Convert to luminance for tone curve application
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (this.params.preserveColors === 1) {
        // Preserve luminance - apply curve to luminance, then scale RGB
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const lutIndex = Math.floor(luminance * 65535);
        const newLuminance = this.lookupTable[Math.min(65535, lutIndex)];

        if (luminance > 0) {
          const scale = newLuminance / luminance;
          data[i] = Math.max(0, Math.min(1, r * scale));
          data[i + 1] = Math.max(0, Math.min(1, g * scale));
          data[i + 2] = Math.max(0, Math.min(1, b * scale));
        }
      } else {
        // Apply curve to each channel independently
        const rIndex = Math.floor(r * 65535);
        const gIndex = Math.floor(g * 65535);
        const bIndex = Math.floor(b * 65535);

        data[i] = this.lookupTable[Math.min(65535, rIndex)];
        data[i + 1] = this.lookupTable[Math.min(65535, gIndex)];
        data[i + 2] = this.lookupTable[Math.min(65535, bIndex)];
      }
    }
  }

  private applyRGBCurves(data: Float32Array, _width: number, _height: number): void {
    for (let i = 0; i < data.length; i += 4) {
      const rIndex = Math.floor(data[i] * 65535);
      const gIndex = Math.floor(data[i + 1] * 65535);
      const bIndex = Math.floor(data[i + 2] * 65535);

      data[i] = this.rgbLookupTables.red[Math.min(65535, rIndex)];
      data[i + 1] = this.rgbLookupTables.green[Math.min(65535, gIndex)];
      data[i + 2] = this.rgbLookupTables.blue[Math.min(65535, bIndex)];
    }
  }

  private applyExposureFusion(data: Float32Array, _width: number, _height: number): void {
    const fusion = this.params.exposureFusion;
    const stops = this.params.exposureStops;

    if (fusion <= 0) return;

    // Create multiple exposure versions
    const numExposures = Math.ceil(stops * 2) + 1;
    const exposures: Float32Array[] = [];

    for (let exp = 0; exp < numExposures; exp++) {
      const exposureOffset = (exp - numExposures / 2) * stops / numExposures;
      const scale = Math.pow(2, exposureOffset);

      const exposureData = new Float32Array(data.length);
      for (let i = 0; i < data.length; i += 4) {
        exposureData[i] = Math.max(0, Math.min(1, data[i] * scale));
        exposureData[i + 1] = Math.max(0, Math.min(1, data[i + 1] * scale));
        exposureData[i + 2] = Math.max(0, Math.min(1, data[i + 2] * scale));
        exposureData[i + 3] = data[i + 3];
      }
      exposures.push(exposureData);
    }

    // Blend exposures based on quality metrics
    for (let i = 0; i < data.length; i += 4) {
      let totalWeight = 0;
      let blendedR = 0, blendedG = 0, blendedB = 0;

      for (let exp = 0; exp < exposures.length; exp++) {
        const r = exposures[exp][i];
        const g = exposures[exp][i + 1];
        const b = exposures[exp][i + 2];

        // Calculate quality weight (contrast, saturation, well-exposedness)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const contrast = Math.abs(luminance - 0.5);
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        const wellExposed = Math.exp(-12.5 * Math.pow(luminance - 0.5, 2));

        const weight = Math.pow(contrast * saturation * wellExposed, fusion);

        totalWeight += weight;
        blendedR += r * weight;
        blendedG += g * weight;
        blendedB += b * weight;
      }

      if (totalWeight > 0) {
        const originalWeight = 1 - fusion;
        data[i] = originalWeight * data[i] + fusion * (blendedR / totalWeight);
        data[i + 1] = originalWeight * data[i + 1] + fusion * (blendedG / totalWeight);
        data[i + 2] = originalWeight * data[i + 2] + fusion * (blendedB / totalWeight);
      }
    }
  }

  private applyAutoLevels(input: Float32Array, output: Float32Array, _width: number, _height: number): void {
    // Calculate histogram
    const histogram = new Array(256).fill(0);
    const totalPixels = _width * _height;

    for (let i = 0; i < input.length; i += 4) {
      const luminance = 0.2126 * input[i] + 0.7152 * input[i + 1] + 0.0722 * input[i + 2];
      const bin = Math.floor(luminance * 255);
      histogram[Math.min(255, bin)]++;
    }

    // Find 1% and 99% percentiles
    let lowCount = 0, highCount = 0;
    const lowThreshold = totalPixels * 0.01;
    const highThreshold = totalPixels * 0.99;

    let blackPoint = 0, whitePoint = 1;

    for (let i = 0; i < 256; i++) {
      lowCount += histogram[i];
      if (lowCount >= lowThreshold && blackPoint === 0) {
        blackPoint = i / 255.0;
      }
    }

    for (let i = 255; i >= 0; i--) {
      highCount += histogram[i];
      if (highCount >= (totalPixels - highThreshold) && whitePoint === 1) {
        whitePoint = i / 255.0;
        break;
      }
    }

    // Apply levels adjustment
    const range = whitePoint - blackPoint;
    if (range > 0) {
      for (let i = 0; i < input.length; i += 4) {
        // Apply levels to RGB channels only, preserve alpha
        output[i] = Math.max(0, Math.min(1, (input[i] - blackPoint) / range));     // R
        output[i + 1] = Math.max(0, Math.min(1, (input[i + 1] - blackPoint) / range)); // G
        output[i + 2] = Math.max(0, Math.min(1, (input[i + 2] - blackPoint) / range)); // B
        output[i + 3] = input[i + 3]; // Preserve alpha channel
      }
    } else {
      output.set(input);
    }

    logger.debug('Auto levels applied:', { blackPoint, whitePoint, range });
  }

  private applyAutoContrast(data: Float32Array, width: number, height: number): void {
    // Calculate mean luminance
    let totalLuminance = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      totalLuminance += luminance;
    }

    const meanLuminance = totalLuminance / totalPixels;
    const contrastFactor = 1.2; // Subtle contrast boost

    // Apply contrast around mean
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const deviation = data[i + c] - meanLuminance;
        data[i + c] = Math.max(0, Math.min(1, meanLuminance + deviation * contrastFactor));
      }
    }

    logger.debug('Auto contrast applied:', { meanLuminance, contrastFactor });
  }

  // Utility methods for UI interaction
  addControlPoint(x: number, y: number, channel: 'base' | 'red' | 'green' | 'blue' = 'base'): void {
    if (channel === 'base') {
      const curve = [...this.params.baseCurve, { x, y }];
      curve.sort((a, b) => a.x - b.x);
      this.setParams({ baseCurve: curve, baseCurveNodes: curve.length });
    } else {
      const curve = [...this.params.rgbCurve[channel], { x, y }];
      curve.sort((a, b) => a.x - b.x);
      this.setParams({
        rgbCurve: {
          ...this.params.rgbCurve,
          [channel]: curve
        },
        rgbCurveNodes: {
          ...this.params.rgbCurveNodes,
          [channel]: curve.length
        }
      });
    }
  }

  removeControlPoint(index: number, channel: 'base' | 'red' | 'green' | 'blue' = 'base'): void {
    if (channel === 'base') {
      if (this.params.baseCurve.length > 2) {
        const curve = this.params.baseCurve.filter((_, i) => i !== index);
        this.setParams({ baseCurve: curve, baseCurveNodes: curve.length });
      }
    } else {
      if (this.params.rgbCurve[channel].length > 2) {
        const curve = this.params.rgbCurve[channel].filter((_, i) => i !== index);
        this.setParams({
          rgbCurve: {
            ...this.params.rgbCurve,
            [channel]: curve
          },
          rgbCurveNodes: {
            ...this.params.rgbCurveNodes,
            [channel]: curve.length
          }
        });
      }
    }
  }

  updateControlPoint(index: number, x: number, y: number, channel: 'base' | 'red' | 'green' | 'blue' = 'base'): void {
    if (channel === 'base') {
      const curve = [...this.params.baseCurve];
      if (index >= 0 && index < curve.length) {
        curve[index] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
        curve.sort((a, b) => a.x - b.x);
        this.setParams({ baseCurve: curve });
      }
    } else {
      const curve = [...this.params.rgbCurve[channel]];
      if (index >= 0 && index < curve.length) {
        curve[index] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
        curve.sort((a, b) => a.x - b.x);
        this.setParams({
          rgbCurve: {
            ...this.params.rgbCurve,
            [channel]: curve
          }
        });
      }
    }
  }

  // Preset curves
  loadPreset(preset: 'linear' | 'contrast' | 'film' | 'vintage' | 'dramatic'): void {
    const presets = {
      linear: [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 1.0 }
      ],
      contrast: [
        { x: 0.0, y: 0.0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1.0, y: 1.0 }
      ],
      film: [
        { x: 0.0, y: 0.05 },
        { x: 0.3, y: 0.35 },
        { x: 0.7, y: 0.8 },
        { x: 1.0, y: 0.98 }
      ],
      vintage: [
        { x: 0.0, y: 0.1 },
        { x: 0.2, y: 0.25 },
        { x: 0.6, y: 0.75 },
        { x: 1.0, y: 0.95 }
      ],
      dramatic: [
        { x: 0.0, y: 0.0 },
        { x: 0.1, y: 0.0 },
        { x: 0.4, y: 0.6 },
        { x: 0.9, y: 1.0 },
        { x: 1.0, y: 1.0 }
      ]
    };

    this.setParams({
      baseCurve: presets[preset],
      baseCurveNodes: presets[preset].length
    });

    logger.info(`Loaded tone curve preset: ${preset}`);
  }
}