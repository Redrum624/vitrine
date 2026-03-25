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

    // Compute adaptive parameters
    const params = this.computeAdaptiveParams(source, target);

    // Apply to pipeline modules
    this.applyParams(params);

    logger.info('StyleAnalysis: style pasted with adaptive adjustments');
    return true;
  }

  // ── Image Analysis ───────────────────────────────────────────────────────

  private analyseImageData(data: Float32Array, width: number, height: number): StyleFingerprint {
    const channels = 4;
    const pixelCount = width * height;

    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, sumSat = 0;
    const lumValues = new Float32Array(pixelCount);

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

    return {
      meanLuminance: meanLum,
      stdLuminance: stdLum,
      meanSaturation: sumSat / pixelCount,
      meanR, meanG, meanB,
      shadows, midtones, highlights,
      p5, p25, p50, p75, p95,
      estimatedTemp: temp,
      estimatedTint: tint,
      moduleParams: {},
      width, height,
      timestamp: Date.now(),
    };
  }

  // ── Adaptive parameter computation ───────────────────────────────────────

  private computeAdaptiveParams(source: StyleFingerprint, target: StyleFingerprint): Record<string, Record<string, unknown>> {
    const params: Record<string, Record<string, unknown>> = {};

    // Dead-zone: ignore deltas smaller than this threshold.
    // Similar photos naturally differ by 0.01-0.03 — those aren't style choices.
    const dz = (val: number, threshold: number) =>
      Math.abs(val) < threshold ? 0 : val;

    // ── Exposure / Brightness ──────────────────────────────────────────
    const lumDelta = dz(source.meanLuminance - target.meanLuminance, 0.03);
    const exposureAdj = Math.max(-0.5, Math.min(0.5, lumDelta * 0.8));
    const brightnessAdj = Math.max(-0.3, Math.min(0.3, lumDelta * 0.4));

    // ── Contrast ───────────────────────────────────────────────────────
    const contrastRatio = target.stdLuminance > 0.01
      ? source.stdLuminance / target.stdLuminance : 1;
    const contrastAdj = Math.max(-0.5, Math.min(0.5, dz(contrastRatio - 1, 0.05) * 0.8));

    // ── Saturation ─────────────────────────────────────────────────────
    const satDelta = dz(source.meanSaturation - target.meanSaturation, 0.02);
    const saturationAdj = Math.max(-0.5, Math.min(0.5, satDelta * 1.0));

    params['basicadj'] = {
      exposure: exposureAdj,
      brightness: brightnessAdj,
      contrast: contrastAdj,
      saturation: saturationAdj,
      vibrance: saturationAdj * 0.4,
      black_point: 0,
    };

    // ── White Balance ──────────────────────────────────────────────────
    const tempDelta = dz(source.estimatedTemp - target.estimatedTemp, 100);
    const targetTemp = Math.max(2000, Math.min(12000, 5500 + tempDelta * 0.15));
    const tintDelta = dz(source.estimatedTint - target.estimatedTint, 2);
    const tintAdj = Math.max(-30, Math.min(30, tintDelta * 0.2));

    params['temperature'] = {
      temperature: Math.round(targetTemp),
      tint: Math.round(tintAdj * 10) / 10,
    };

    // ── Shadows / Highlights ───────────────────────────────────────────
    const shadowLumDelta = dz(source.shadows.meanLuminance - target.shadows.meanLuminance, 0.02);
    const highlightLumDelta = dz(source.highlights.meanLuminance - target.highlights.meanLuminance, 0.02);

    const shadowRecovery = Math.max(0, Math.min(50, shadowLumDelta * 60));
    const highlightRecovery = Math.max(0, Math.min(50, -highlightLumDelta * 60));

    const blackPointAdj = Math.max(-1, Math.min(1, dz(source.p5 - target.p5, 0.02) * 2));
    const whitePointAdj = Math.max(-1, Math.min(1, dz(source.p95 - target.p95, 0.02) * 2));

    params['shadowshighlights'] = {
      shadows: shadowRecovery,
      highlights: highlightRecovery,
      whitePoint: whitePointAdj,
      blackPoint: blackPointAdj,
      enabled: shadowRecovery > 1 || highlightRecovery > 1 || Math.abs(blackPointAdj) > 0.05 || Math.abs(whitePointAdj) > 0.05,
    };

    // ── Tone Curve ─────────────────────────────────────────────────────
    // Blend between identity curve and source-mapped curve.
    // For similar photos the blend factor is low → near-identity curve.
    const curveDivergence = Math.abs(source.p50 - target.p50) + Math.abs(source.p25 - target.p25) + Math.abs(source.p75 - target.p75);
    const curveBlend = Math.min(1, curveDivergence * 3); // 0=identity, 1=full match

    const blendPt = (srcVal: number, tgtVal: number) =>
      tgtVal + (srcVal - tgtVal) * curveBlend;

    const curve = [
      { x: 0, y: 0 },
      { x: target.p25 || 0.25, y: Math.max(0, Math.min(1, blendPt(source.p25, target.p25 || 0.25))) },
      { x: target.p50 || 0.50, y: Math.max(0, Math.min(1, blendPt(source.p50, target.p50 || 0.50))) },
      { x: target.p75 || 0.75, y: Math.max(0, Math.min(1, blendPt(source.p75, target.p75 || 0.75))) },
      { x: 1, y: 1 },
    ];

    params['tonecurve'] = {
      baseCurve: curve,
      baseCurveType: 1,
    };

    // ── Color Balance ──────────────────────────────────────────────────
    const computeZoneCast = (srcZone: ZoneStats, tgtZone: ZoneStats) => {
      if (srcZone.pixelCount < 100 || tgtZone.pixelCount < 100) {
        return { cyan_red: 0, magenta_green: 0, yellow_blue: 0 };
      }
      return {
        cyan_red: Math.max(-0.2, Math.min(0.2, dz(srcZone.meanR - tgtZone.meanR, 0.01) * 0.6)),
        magenta_green: Math.max(-0.2, Math.min(0.2, dz(
          ((srcZone.meanR + srcZone.meanB) / 2 - srcZone.meanG) -
          ((tgtZone.meanR + tgtZone.meanB) / 2 - tgtZone.meanG), 0.01
        ) * 0.6)),
        yellow_blue: Math.max(-0.2, Math.min(0.2, dz(srcZone.meanB - tgtZone.meanB, 0.01) * 0.6)),
      };
    };

    params['colorbalance'] = {
      shadows: computeZoneCast(source.shadows, target.shadows),
      midtones: computeZoneCast(source.midtones, target.midtones),
      highlights: computeZoneCast(source.highlights, target.highlights),
    };

    return params;
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

    // Trigger reprocessing
    useAppStore.getState().triggerReprocessing();
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
