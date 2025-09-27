import { logger } from '../utils/Logger';

export interface HistogramData {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  channels: {
    red: { min: number; max: number; mean: number; median: number };
    green: { min: number; max: number; mean: number; median: number };
    blue: { min: number; max: number; mean: number; median: number };
    luminance: { min: number; max: number; mean: number; median: number };
  };
  clipping: {
    shadows: { red: number; green: number; blue: number; total: number };
    highlights: { red: number; green: number; blue: number; total: number };
  };
  exposure: {
    underexposed: number;
    overexposed: number;
    wellExposed: number;
  };
}

export interface HistogramOptions {
  bins: number;
  bitDepth: 8 | 16;
  shadowThreshold: number;
  highlightThreshold: number;
  enableClippingAnalysis: boolean;
}

/**
 * RAW Histogram Service for professional exposure and clipping analysis
 * Provides true RAW histogram with clipping indicators and exposure statistics
 */
export class RawHistogramService {
  private static instance: RawHistogramService;

  static getInstance(): RawHistogramService {
    if (!RawHistogramService.instance) {
      RawHistogramService.instance = new RawHistogramService();
    }
    return RawHistogramService.instance;
  }

  /**
   * Generate histogram from RAW image data
   */
  generateHistogram(
    imageData: Float32Array,
    width: number,
    height: number,
    options: Partial<HistogramOptions> = {}
  ): HistogramData {
    const startTime = performance.now();

    const {
      bins = 256,
      bitDepth = 16,
      shadowThreshold = 0.02,
      highlightThreshold = 0.98,
      enableClippingAnalysis = true
    } = options;

    logger.info(`Generating RAW histogram for ${width}x${height} image`, {
      bins,
      bitDepth,
      shadowThreshold,
      highlightThreshold
    });

    // Initialize histogram arrays
    const red = new Array(bins).fill(0);
    const green = new Array(bins).fill(0);
    const blue = new Array(bins).fill(0);
    const luminance = new Array(bins).fill(0);

    // Statistics tracking
    const stats = {
      red: { values: [] as number[], sum: 0, min: Infinity, max: -Infinity },
      green: { values: [] as number[], sum: 0, min: Infinity, max: -Infinity },
      blue: { values: [] as number[], sum: 0, min: Infinity, max: -Infinity },
      luminance: { values: [] as number[], sum: 0, min: Infinity, max: -Infinity }
    };

    // Clipping analysis
    const shadowClips = { red: 0, green: 0, blue: 0, total: 0 };
    const highlightClips = { red: 0, green: 0, blue: 0, total: 0 };
    const exposureAnalysis = { underexposed: 0, overexposed: 0, wellExposed: 0 };

    const totalPixels = width * height;
    const maxValue = bitDepth === 16 ? 65535 : 255;

    // Process each pixel
    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Convert to appropriate bit depth
      const rVal = Math.min(maxValue, Math.max(0, Math.round(r * maxValue)));
      const gVal = Math.min(maxValue, Math.max(0, Math.round(g * maxValue)));
      const bVal = Math.min(maxValue, Math.max(0, Math.round(b * maxValue)));

      // Calculate luminance (ITU-R BT.709)
      const luma = Math.round(0.2126 * rVal + 0.7152 * gVal + 0.0722 * bVal);

      // Calculate bin indices
      const rBin = Math.min(bins - 1, Math.floor((rVal / maxValue) * bins));
      const gBin = Math.min(bins - 1, Math.floor((gVal / maxValue) * bins));
      const bBin = Math.min(bins - 1, Math.floor((bVal / maxValue) * bins));
      const lBin = Math.min(bins - 1, Math.floor((luma / maxValue) * bins));

      // Update histograms
      red[rBin]++;
      green[gBin]++;
      blue[bBin]++;
      luminance[lBin]++;

      // Update statistics
      stats.red.sum += r;
      stats.green.sum += g;
      stats.blue.sum += b;
      stats.luminance.sum += luma / maxValue;

      stats.red.min = Math.min(stats.red.min, r);
      stats.red.max = Math.max(stats.red.max, r);
      stats.green.min = Math.min(stats.green.min, g);
      stats.green.max = Math.max(stats.green.max, g);
      stats.blue.min = Math.min(stats.blue.min, b);
      stats.blue.max = Math.max(stats.blue.max, b);
      stats.luminance.min = Math.min(stats.luminance.min, luma / maxValue);
      stats.luminance.max = Math.max(stats.luminance.max, luma / maxValue);

      // Store values for median calculation
      stats.red.values.push(r);
      stats.green.values.push(g);
      stats.blue.values.push(b);
      stats.luminance.values.push(luma / maxValue);

      // Clipping analysis
      if (enableClippingAnalysis) {
        // Shadow clipping
        if (r <= shadowThreshold) shadowClips.red++;
        if (g <= shadowThreshold) shadowClips.green++;
        if (b <= shadowThreshold) shadowClips.blue++;
        if (r <= shadowThreshold || g <= shadowThreshold || b <= shadowThreshold) {
          shadowClips.total++;
        }

        // Highlight clipping
        if (r >= highlightThreshold) highlightClips.red++;
        if (g >= highlightThreshold) highlightClips.green++;
        if (b >= highlightThreshold) highlightClips.blue++;
        if (r >= highlightThreshold || g >= highlightThreshold || b >= highlightThreshold) {
          highlightClips.total++;
        }

        // Exposure analysis
        const avgChannel = (r + g + b) / 3;
        if (avgChannel <= shadowThreshold) {
          exposureAnalysis.underexposed++;
        } else if (avgChannel >= highlightThreshold) {
          exposureAnalysis.overexposed++;
        } else {
          exposureAnalysis.wellExposed++;
        }
      }
    }

    // Calculate means
    const means = {
      red: stats.red.sum / totalPixels,
      green: stats.green.sum / totalPixels,
      blue: stats.blue.sum / totalPixels,
      luminance: stats.luminance.sum / totalPixels
    };

    // Calculate medians
    const medians = {
      red: this.calculateMedian(stats.red.values),
      green: this.calculateMedian(stats.green.values),
      blue: this.calculateMedian(stats.blue.values),
      luminance: this.calculateMedian(stats.luminance.values)
    };

    const histogramData: HistogramData = {
      red,
      green,
      blue,
      luminance,
      channels: {
        red: {
          min: stats.red.min,
          max: stats.red.max,
          mean: means.red,
          median: medians.red
        },
        green: {
          min: stats.green.min,
          max: stats.green.max,
          mean: means.green,
          median: medians.green
        },
        blue: {
          min: stats.blue.min,
          max: stats.blue.max,
          mean: means.blue,
          median: medians.blue
        },
        luminance: {
          min: stats.luminance.min,
          max: stats.luminance.max,
          mean: means.luminance,
          median: medians.luminance
        }
      },
      clipping: {
        shadows: shadowClips,
        highlights: highlightClips
      },
      exposure: exposureAnalysis
    };

    const processingTime = performance.now() - startTime;
    logger.info(`RAW histogram generated in ${processingTime.toFixed(2)}ms`, {
      shadowClipping: shadowClips.total,
      highlightClipping: highlightClips.total,
      exposureBalance: `${exposureAnalysis.wellExposed}/${totalPixels} well exposed`
    });

    return histogramData;
  }

  /**
   * Generate histogram for specific channel
   */
  generateChannelHistogram(
    imageData: Float32Array,
    channel: 'red' | 'green' | 'blue' | 'luminance',
    options: Partial<HistogramOptions> = {}
  ): number[] {
    const { bins = 256, bitDepth = 16 } = options;
    const histogram = new Array(bins).fill(0);
    const maxValue = bitDepth === 16 ? 65535 : 255;

    for (let i = 0; i < imageData.length; i += 4) {
      let value: number;

      switch (channel) {
        case 'red':
          value = imageData[i];
          break;
        case 'green':
          value = imageData[i + 1];
          break;
        case 'blue':
          value = imageData[i + 2];
          break;
        case 'luminance':
        default:
          // ITU-R BT.709 luminance calculation
          value = 0.2126 * imageData[i] + 0.7152 * imageData[i + 1] + 0.0722 * imageData[i + 2];
          break;
      }

      const scaledValue = Math.min(maxValue, Math.max(0, Math.round(value * maxValue)));
      const bin = Math.min(bins - 1, Math.floor((scaledValue / maxValue) * bins));
      histogram[bin]++;
    }

    return histogram;
  }

  /**
   * Analyze clipping in the image
   */
  analyzeClipping(
    imageData: Float32Array,
    shadowThreshold: number = 0.02,
    highlightThreshold: number = 0.98
  ): HistogramData['clipping'] {
    const shadowClips = { red: 0, green: 0, blue: 0, total: 0 };
    const highlightClips = { red: 0, green: 0, blue: 0, total: 0 };

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Shadow clipping
      if (r <= shadowThreshold) shadowClips.red++;
      if (g <= shadowThreshold) shadowClips.green++;
      if (b <= shadowThreshold) shadowClips.blue++;
      if (r <= shadowThreshold || g <= shadowThreshold || b <= shadowThreshold) {
        shadowClips.total++;
      }

      // Highlight clipping
      if (r >= highlightThreshold) highlightClips.red++;
      if (g >= highlightThreshold) highlightClips.green++;
      if (b >= highlightThreshold) highlightClips.blue++;
      if (r >= highlightThreshold || g >= highlightThreshold || b >= highlightThreshold) {
        highlightClips.total++;
      }
    }

    return {
      shadows: shadowClips,
      highlights: highlightClips
    };
  }

  /**
   * Get exposure statistics
   */
  analyzeExposure(
    imageData: Float32Array,
    shadowThreshold: number = 0.02,
    highlightThreshold: number = 0.98
  ): HistogramData['exposure'] {
    let underexposed = 0;
    let overexposed = 0;
    let wellExposed = 0;

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Calculate average channel value for exposure analysis
      const avgChannel = (r + g + b) / 3;

      if (avgChannel <= shadowThreshold) {
        underexposed++;
      } else if (avgChannel >= highlightThreshold) {
        overexposed++;
      } else {
        wellExposed++;
      }
    }

    return {
      underexposed,
      overexposed,
      wellExposed
    };
  }

  /**
   * Get recommended exposure adjustment based on histogram
   */
  getRecommendedExposureAdjustment(histogramData: HistogramData): {
    exposureAdjustment: number;
    shadowsAdjustment: number;
    highlightsAdjustment: number;
    reasoning: string;
  } {
    const { channels, clipping, exposure } = histogramData;
    const totalPixels = exposure.underexposed + exposure.overexposed + exposure.wellExposed;

    const underexposedRatio = exposure.underexposed / totalPixels;
    const overexposedRatio = exposure.overexposed / totalPixels;
    const shadowClipRatio = clipping.shadows.total / totalPixels;
    const highlightClipRatio = clipping.highlights.total / totalPixels;

    let exposureAdjustment = 0;
    let shadowsAdjustment = 0;
    let highlightsAdjustment = 0;
    let reasoning = '';

    // Exposure adjustment based on luminance mean
    const luminanceMean = channels.luminance.mean;

    if (luminanceMean < 0.3 && underexposedRatio > 0.3) {
      exposureAdjustment = +0.5; // Increase exposure
      reasoning = 'Image appears underexposed - increase exposure';
    } else if (luminanceMean > 0.7 && overexposedRatio > 0.3) {
      exposureAdjustment = -0.5; // Decrease exposure
      reasoning = 'Image appears overexposed - decrease exposure';
    }

    // Shadow/highlight adjustments
    if (shadowClipRatio > 0.05) {
      shadowsAdjustment = +30; // Lift shadows
      reasoning += (reasoning ? ' and lift shadows' : 'Lift shadows to recover shadow detail');
    }

    if (highlightClipRatio > 0.05) {
      highlightsAdjustment = -30; // Lower highlights
      reasoning += (reasoning ? ' and lower highlights' : 'Lower highlights to recover highlight detail');
    }

    if (!reasoning) {
      reasoning = 'Exposure looks well balanced';
    }

    return {
      exposureAdjustment,
      shadowsAdjustment,
      highlightsAdjustment,
      reasoning
    };
  }

  /**
   * Private helper methods
   */
  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }
}

export const rawHistogramService = RawHistogramService.getInstance();