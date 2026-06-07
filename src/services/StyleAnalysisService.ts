/**
 * StyleAnalysisService
 *
 * "Copy Style"  — captures a style fingerprint from the current image + its
 *                 pipeline state (histogram shape, luminance, contrast,
 *                 saturation, colour temperature, tonal zones).
 *
 * "Paste Style" — given a fingerprint and a *different* target image, computes
 *                 the per-module parameter deltas that will make the target
 *                 look like the source in *style* (not a blind parameter copy).
 */

import { logger } from '../utils/Logger';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { imageService } from './ImageService';
import { useAppStore } from '../stores/appStore';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-zone (shadows / midtones / highlights) statistics. */
interface ZoneStats {
  meanLuminance: number;   // 0-1
  meanR: number;
  meanG: number;
  meanB: number;
  pixelCount: number;
}

/** Full style fingerprint captured by "Copy Style". */
export interface StyleFingerprint {
  // Global statistics of the *processed* image (what the user sees)
  meanLuminance: number;
  stdLuminance: number;     // contrast proxy
  meanSaturation: number;
  meanR: number;
  meanG: number;
  meanB: number;

  // Zone-split stats (shadows <0.25, midtones 0.25-0.75, highlights >0.75)
  shadows: ZoneStats;
  midtones: ZoneStats;
  highlights: ZoneStats;

  // Histogram percentiles (of luminance)
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;

  // Per-channel cumulative distributions (256 bins, normalized 0..1) of the
  // processed image. These are the basis for exact, general histogram matching
  // in Paste Style — they let us remap any target raw to wear this image's grade.
  cdfR: number[];
  cdfG: number[];
  cdfB: number[];

  // Estimated colour temperature / tint from channel ratios
  estimatedTemp: number;   // Kelvin-ish
  estimatedTint: number;   // green/magenta

  // Snapshot of module params at capture time — used as a reference
  moduleParams: Record<string, Record<string, unknown>>;

  // Dimensions (for information only)
  width: number;
  height: number;
  timestamp: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function saturationHSL(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max + min === 0 || max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
}

/** Approximate colour temperature from R/B ratio (rough but usable). */
function estimateColorTemp(avgR: number, avgG: number, avgB: number): { temp: number; tint: number } {
  // Higher R/B → warmer (lower K), higher B/R → cooler (higher K)
  const rb = avgB > 0.001 ? avgR / avgB : 1;
  // Map ratio ~0.6-1.8 to ~8000K-3000K
  const temp = Math.max(2000, Math.min(12000, 5500 / Math.pow(rb, 0.6)));
  // Tint from green deviation
  const expectedG = (avgR + avgB) / 2;
  const tint = (avgG - expectedG) * 200; // -100..+100 ish
  return { temp, tint };
}

function percentile(sorted: Float32Array, p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

// ─── Service ─────────────────────────────────────────────────────────────────

class StyleAnalysisService {
  private clipboard: StyleFingerprint | null = null;

  /** Returns the currently stored fingerprint (or null). */
  getClipboard(): StyleFingerprint | null {
    return this.clipboard;
  }

  hasStyle(): boolean {
    return this.clipboard !== null;
  }

  // ── Copy Style ───────────────────────────────────────────────────────────

  /**
   * Analyse the current *processed* image and capture a style fingerprint.
   * This is what "Copy Style" does.
   */
  copyStyle(): StyleFingerprint | null {
    // Get the image data the user is currently seeing
    const store = useAppStore.getState();
    const processed = store.processedImageData;
    const current = imageService.getCurrentImage();

    if (!current) {
      logger.warn('StyleAnalysis: no image loaded');
      return null;
    }

    let data: Float32Array;
    let width: number;
    let height: number;

    if (processed && typeof processed === 'object' && 'data' in processed) {
      const pd = processed as { data: Float32Array; width: number; height: number };
      data = pd.data;
      width = pd.width;
      height = pd.height;
    } else if (processed instanceof Float32Array) {
      data = processed;
      width = current.width;
      height = current.height;
    } else {
      data = current.data;
      width = current.width;
      height = current.height;
    }

    const fp = this.analyseImageData(data, width, height);

    // Capture current module params
    fp.moduleParams = this.snapshotModuleParams();

    this.clipboard = fp;
    logger.info(`StyleAnalysis: style copied — lum=${fp.meanLuminance.toFixed(3)}, sat=${fp.meanSaturation.toFixed(3)}, temp≈${fp.estimatedTemp.toFixed(0)}K`);
    return fp;
  }

  // ── Paste Style ──────────────────────────────────────────────────────────

  /**
   * Apply the stored style to the current (different) image.
   * Instead of blindly copying params we:
   *  1. Analyse the new image's *raw* characteristics
   *  2. Compute the delta between source-raw and source-styled
   *  3. Apply that delta relative to the new image
   */
  pasteStyle(): boolean {
    if (!this.clipboard) {
      logger.warn('StyleAnalysis: no style in clipboard');
      return false;
    }

    const current = imageService.getCurrentImage();
    if (!current) {
      logger.warn('StyleAnalysis: no target image loaded');
      return false;
    }

    const target = this.analyseImageData(current.data, current.width, current.height);
    const source = this.clipboard;

    // Per-channel histogram matching: remap the target's R/G/B distributions to
    // equal the source's, so the target wears the source's exact colour grade.
    // This is fully general — it works for any (reference, target) pair.
    const params = this.computeHistogramMatchParams(source, target);

    // Apply to pipeline modules
    this.applyParams(params);

    logger.info('StyleAnalysis: style pasted via per-channel histogram matching');
    return true;
  }

  // ── Image Analysis ───────────────────────────────────────────────────────

  private analyseImageData(data: Float32Array, width: number, height: number): StyleFingerprint {
    const channels = 4;
    const pixelCount = width * height;

    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, sumSat = 0;
    const lumValues = new Float32Array(pixelCount);

    // Per-channel 256-bin histograms (for exact histogram matching)
    const histR = new Float64Array(256);
    const histG = new Float64Array(256);
    const histB = new Float64Array(256);
    const bin = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

    const shadows: ZoneStats = { meanLuminance: 0, meanR: 0, meanG: 0, meanB: 0, pixelCount: 0 };
    const midtones: ZoneStats = { meanLuminance: 0, meanR: 0, meanG: 0, meanB: 0, pixelCount: 0 };
    const highlights: ZoneStats = { meanLuminance: 0, meanR: 0, meanG: 0, meanB: 0, pixelCount: 0 };

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = luminance(r, g, b);
      const sat = saturationHSL(r, g, b);

      sumR += r; sumG += g; sumB += b;
      sumLum += lum;
      sumSat += sat;
      lumValues[i] = lum;
      histR[bin(r)]++; histG[bin(g)]++; histB[bin(b)]++;

      // Zone classification
      let zone: ZoneStats;
      if (lum < 0.25) zone = shadows;
      else if (lum < 0.75) zone = midtones;
      else zone = highlights;

      zone.meanLuminance += lum;
      zone.meanR += r;
      zone.meanG += g;
      zone.meanB += b;
      zone.pixelCount++;
    }

    // Normalize zones
    for (const zone of [shadows, midtones, highlights]) {
      if (zone.pixelCount > 0) {
        zone.meanLuminance /= zone.pixelCount;
        zone.meanR /= zone.pixelCount;
        zone.meanG /= zone.pixelCount;
        zone.meanB /= zone.pixelCount;
      }
    }

    const meanLum = sumLum / pixelCount;
    const meanR = sumR / pixelCount;
    const meanG = sumG / pixelCount;
    const meanB = sumB / pixelCount;

    // Std dev of luminance (contrast proxy)
    let sumSqDiff = 0;
    for (let i = 0; i < pixelCount; i++) {
      const d = lumValues[i] - meanLum;
      sumSqDiff += d * d;
    }
    const stdLum = Math.sqrt(sumSqDiff / pixelCount);

    // Percentiles
    lumValues.sort();
    const p5 = percentile(lumValues, 0.05);
    const p25 = percentile(lumValues, 0.25);
    const p50 = percentile(lumValues, 0.50);
    const p75 = percentile(lumValues, 0.75);
    const p95 = percentile(lumValues, 0.95);

    const { temp, tint } = estimateColorTemp(meanR, meanG, meanB);

    // Normalize histograms into cumulative distributions (0..1).
    const toCdf = (h: Float64Array): number[] => {
      const cdf = new Array<number>(256);
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += h[v]; cdf[v] = acc / pixelCount; }
      return cdf;
    };

    return {
      meanLuminance: meanLum,
      stdLuminance: stdLum,
      meanSaturation: sumSat / pixelCount,
      meanR, meanG, meanB,
      shadows, midtones, highlights,
      p5, p25, p50, p75, p95,
      cdfR: toCdf(histR), cdfG: toCdf(histG), cdfB: toCdf(histB),
      estimatedTemp: temp,
      estimatedTint: tint,
      moduleParams: {},
      width, height,
      timestamp: Date.now(),
    };
  }

  // ── Histogram matching (exact style transfer) ────────────────────────────

  /**
   * Build per-channel histogram-match curves that map the target's R/G/B
   * distribution onto the source's, then express them as ToneCurve RGB curves.
   * Result: the target renders with the source's exact tonal + colour grade.
   * General — no per-image tuning, works for any reference/target pair.
   */
  private computeHistogramMatchParams(
    source: StyleFingerprint,
    target: StyleFingerprint,
  ): Record<string, Record<string, unknown>> {
    // For each target level v, find the source level w whose cumulative
    // probability first reaches the target's — classic CDF histogram matching.
    const matchCurve = (srcCdf: number[], tgtCdf: number[]): { x: number; y: number }[] => {
      const lut = new Uint8Array(256);
      let w = 0;
      for (let v = 0; v < 256; v++) {
        while (w < 255 && srcCdf[w] < tgtCdf[v]) w++;
        lut[v] = w;
      }
      // Sample to a dense curve (every 4 levels => 65 nodes). With linear
      // interpolation (baseCurveType 0) this reproduces the LUT faithfully.
      const nodes: { x: number; y: number }[] = [];
      for (let v = 0; v <= 255; v += 4) nodes.push({ x: v / 255, y: lut[v] / 255 });
      if (nodes[nodes.length - 1].x < 1) nodes.push({ x: 1, y: lut[255] / 255 });
      return nodes;
    };

    return {
      tonecurve: {
        rgbCurve: {
          red: matchCurve(source.cdfR, target.cdfR),
          green: matchCurve(source.cdfG, target.cdfG),
          blue: matchCurve(source.cdfB, target.cdfB),
        },
        baseCurveType: 0, // linear interpolation between dense nodes
      },
      // Clear basic adjustments so the match curves are the sole transform.
      basicadj: { exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, black_point: 0 },
    };
  }


  // ── Apply computed params to pipeline ────────────────────────────────────

  private applyParams(params: Record<string, Record<string, unknown>>): void {
    for (const [moduleId, moduleParams] of Object.entries(params)) {
      const mod = imageProcessingPipeline.getModule(moduleId);
      if (!mod) {
        logger.warn(`StyleAnalysis: module '${moduleId}' not found in pipeline`);
        continue;
      }

      // Some modules are adapters — reach through to the inner module
      const inner = this.getInnerModule(mod, moduleId);
      if (inner && typeof (inner as unknown as { setParams?: (p: Record<string, unknown>) => void }).setParams === 'function') {
        (inner as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(moduleParams);
      } else if (typeof (mod as unknown as { setParams?: (p: Record<string, unknown>) => void }).setParams === 'function') {
        (mod as unknown as { setParams: (p: Record<string, unknown>) => void }).setParams(moduleParams);
      } else {
        logger.warn(`StyleAnalysis: module '${moduleId}' has no setParams`);
        continue;
      }

      imageProcessingPipeline.invalidateModuleCache(moduleId);
      logger.debug(`StyleAnalysis: set ${moduleId} →`, moduleParams);
    }

    // Refresh the open module panel's sliders (so they re-read the new
    // module.getParams()), then reprocess the image.
    const store = useAppStore.getState();
    store.notifyExternalParamsChange();
    store.triggerReprocessing();
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private getInnerModule(mod: any, moduleId: string): any {
    switch (moduleId) {
      case 'tonecurve': return mod.getToneCurveModule?.() ?? mod;
      case 'colorbalance': return mod.getColorBalanceModule?.() ?? mod;
      case 'shadowshighlights': return mod.getShadowsHighlightsModule?.() ?? mod;
      default: return mod;
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── Snapshot current module params ───────────────────────────────────────

  private snapshotModuleParams(): Record<string, Record<string, unknown>> {
    const snap: Record<string, Record<string, unknown>> = {};
    const modules = imageProcessingPipeline.getModules();
    for (const [id, mod] of modules) {
      if (typeof mod.getParams === 'function') {
        snap[id] = { ...mod.getParams() };
      }
    }
    return snap;
  }
}

// Singleton
export const styleAnalysisService = new StyleAnalysisService();
