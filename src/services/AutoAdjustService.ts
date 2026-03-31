/**
 * AutoAdjustService
 *
 * Analyses the current image and computes proper auto-adjustment parameters
 * for each pipeline module based on real histogram / luminance / colour data.
 *
 * Each `autoXxx()` method returns the params object that can be fed directly
 * into the corresponding module's `setParams()`.
 */

import { logger } from '../utils/Logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ImageStats {
  meanR: number;
  meanG: number;
  meanB: number;
  meanLum: number;
  stdLum: number;
  meanSat: number;
  p1: number;   // 1st percentile of luminance
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  shadowMeanLum: number;   // mean lum where lum < 0.25
  highlightMeanLum: number; // mean lum where lum > 0.75
  shadowPixelRatio: number; // fraction of pixels in shadows
  highlightPixelRatio: number;
  noiseEstimate: number;   // 0-1, rough estimate of noise level
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function saturationHSL(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function percentile(sorted: Float32Array, p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AutoAdjustService {

  /**
   * Full statistical analysis of an image.
   * This is the foundation every `autoXxx()` method relies on.
   */
  analyse(data: Float32Array, width: number, height: number): ImageStats {
    const channels = 4;
    const pixelCount = width * height;

    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, sumSat = 0;
    const lumValues = new Float32Array(pixelCount);

    let shadowLumSum = 0, shadowCount = 0;
    let highlightLumSum = 0, highlightCount = 0;

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = luminance(r, g, b);

      sumR += r; sumG += g; sumB += b;
      sumLum += lum;
      sumSat += saturationHSL(r, g, b);
      lumValues[i] = lum;

      if (lum < 0.25) { shadowLumSum += lum; shadowCount++; }
      if (lum > 0.75) { highlightLumSum += lum; highlightCount++; }
    }

    const meanLum = sumLum / pixelCount;
    let sumSqDiff = 0;
    for (let i = 0; i < pixelCount; i++) {
      const d = lumValues[i] - meanLum;
      sumSqDiff += d * d;
    }

    lumValues.sort();

    // Rough noise estimate: variance within a small sample of neighbouring pixel diffs
    let noiseSum = 0;
    const step = Math.max(1, Math.floor(pixelCount / 10000));
    let noiseSamples = 0;
    for (let i = step; i < pixelCount; i += step) {
      const idx = i * channels;
      const prevIdx = (i - 1) * channels;
      const dr = data[idx] - data[prevIdx];
      const dg = data[idx + 1] - data[prevIdx + 1];
      const db = data[idx + 2] - data[prevIdx + 2];
      noiseSum += dr * dr + dg * dg + db * db;
      noiseSamples++;
    }
    const noiseEstimate = noiseSamples > 0 ? Math.min(1, Math.sqrt(noiseSum / noiseSamples / 3) * 5) : 0;

    return {
      meanR: sumR / pixelCount,
      meanG: sumG / pixelCount,
      meanB: sumB / pixelCount,
      meanLum,
      stdLum: Math.sqrt(sumSqDiff / pixelCount),
      meanSat: sumSat / pixelCount,
      p1: percentile(lumValues, 0.01),
      p5: percentile(lumValues, 0.05),
      p25: percentile(lumValues, 0.25),
      p50: percentile(lumValues, 0.50),
      p75: percentile(lumValues, 0.75),
      p95: percentile(lumValues, 0.95),
      p99: percentile(lumValues, 0.99),
      shadowMeanLum: shadowCount > 0 ? shadowLumSum / shadowCount : 0,
      highlightMeanLum: highlightCount > 0 ? highlightLumSum / highlightCount : 1,
      shadowPixelRatio: shadowCount / pixelCount,
      highlightPixelRatio: highlightCount / pixelCount,
      noiseEstimate,
    };
  }

  // ── Exposure ─────────────────────────────────────────────────────────────

  autoExposure(stats: ImageStats): { exposure: number; black: number; mode: 'manual' | 'automatic' } {
    // Target: median luminance around 0.45 (slightly below middle-grey)
    const targetMedian = 0.45;
    const medianDelta = targetMedian - stats.p50;

    // Conservative multiplier: only push hard when image is clearly off
    const exposure = clamp(medianDelta * 1.2, -0.8, 0.8);

    // Black level: lift if deepest shadows are clipped
    const black = clamp(stats.p1 < 0.01 ? 0.005 : 0, 0, 0.05);

    logger.info(`AutoExposure: median=${stats.p50.toFixed(3)}, delta=${medianDelta.toFixed(3)} → exposure=${exposure.toFixed(3)}, black=${black.toFixed(4)}`);
    return { exposure, black, mode: 'manual' };
  }

  // ── Basic Adjustments ────────────────────────────────────────────────────

  autoBasicAdj(stats: ImageStats): {
    black_point: number; exposure: number; contrast: number;
    brightness: number; saturation: number; vibrance: number;
  } {
    // Exposure: push median towards 0.45 (gentle — ExposureModule already handles the main correction)
    const exposure = clamp((0.45 - stats.p50) * 1.0, -0.6, 0.6);

    // Contrast: gentle boost for flat images, leave contrasty images alone
    const idealStd = 0.18;
    const contrast = clamp((idealStd - stats.stdLum) * 2.5, -0.3, 0.5);

    // Brightness: very gentle fine-tune
    const brightness = clamp((0.48 - stats.meanLum) * 0.25, -0.15, 0.15);

    // Saturation: conservative boost
    const idealSat = 0.35;
    const saturation = clamp((idealSat - stats.meanSat) * 0.8, -0.3, 0.3);

    // Vibrance: proportional to saturation correction
    const vibrance = clamp(saturation * 0.5, -0.2, 0.25);

    // Black point: lower shadows floor if shadows are crushed
    const black_point = clamp(stats.p1 > 0.05 ? -(stats.p1 - 0.02) * 0.3 : 0, -0.05, 0.05);

    logger.info(`AutoBasicAdj: lum=${stats.meanLum.toFixed(3)}, std=${stats.stdLum.toFixed(3)}, sat=${stats.meanSat.toFixed(3)} → exp=${exposure.toFixed(2)}, cont=${contrast.toFixed(2)}, sat=${saturation.toFixed(2)}`);
    return { black_point, exposure, contrast, brightness, saturation, vibrance };
  }

  // ── Shadows & Highlights ─────────────────────────────────────────────────

  autoShadowsHighlights(stats: ImageStats): Record<string, unknown> {
    // Shadow adjustment: 50 = neutral, >50 = lift shadows, <50 = darken shadows
    const shadowDeficit = 0.12 - stats.shadowMeanLum; // ideal shadow mean ~0.12
    const shadowDelta = clamp(shadowDeficit > 0 ? shadowDeficit * 150 * stats.shadowPixelRatio * 2 : 0, 0, 25);
    const shadows = 50 + shadowDelta; // offset from neutral

    // Highlight adjustment: 50 = neutral, >50 = recover highlights, <50 = brighten
    const highlightExcess = stats.highlightMeanLum - 0.88;
    const highlightDelta = clamp(highlightExcess > 0 ? highlightExcess * 150 * stats.highlightPixelRatio * 2 : 0, 0, 25);
    const highlights = 50 + highlightDelta; // offset from neutral

    // White/black point: expand dynamic range if clipped
    const whitePoint = clamp(stats.p99 < 0.9 ? (0.95 - stats.p99) * 4 : 0, -2, 2);
    const blackPoint = clamp(stats.p1 > 0.05 ? -(stats.p1 - 0.02) * 4 : 0, -2, 2);

    // Compression: higher if image has extreme dynamic range
    const dynamicRange = stats.p99 - stats.p1;
    const compress = clamp(dynamicRange > 0.85 ? (dynamicRange - 0.85) * 200 : 10, 0, 60);

    const strength = 1.0;

    logger.info(`AutoSH: shadow=${shadows.toFixed(1)}, highlight=${highlights.toFixed(1)}, wp=${whitePoint.toFixed(2)}, bp=${blackPoint.toFixed(2)}, compress=${compress.toFixed(1)}`);
    return {
      shadows,
      shadowsRadius: 40,
      shadowsColorTransfer: 30,
      highlights,
      highlightsRadius: 45,
      highlightsColorTransfer: 20,
      whitePoint,
      blackPoint,
      compress,
      strength,
      enabled: true,
    };
  }

  // ── Tone Curve ───────────────────────────────────────────────────────────

  autoToneCurve(stats: ImageStats): Record<string, unknown> {
    const tonalSpan = stats.p95 - stats.p5;

    // For narrow-range images (uniform dark/bright), return identity curve — no modification.
    if (tonalSpan < 0.15) {
      logger.info(`AutoToneCurve: narrow span=${tonalSpan.toFixed(3)}, returning identity`);
      return {
        baseCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        baseCurveNodes: 2,
        baseCurveType: 1,
        autoLevels: false,
        autoContrast: false,
      };
    }

    // Build a curve that stretches the actual tonal range to fill 0-1
    // while adding a gentle S-curve for perceived contrast.
    const lo = Math.max(0, stats.p5 - 0.02);
    const hi = Math.min(1, stats.p95 + 0.02);

    // S-curve strength: stronger for flat images, scaled by tonal span
    const rawStrength = clamp(0.22 - stats.stdLum, 0, 0.12);
    const sCurveStrength = rawStrength * clamp(tonalSpan / 0.6, 0, 1);

    // Ensure minimum spacing between x-points to avoid spline overshoots.
    const minSpacing = 0.08;
    const xLo  = clamp(lo, 0.05, 0.25);
    const xP25 = Math.max(xLo + minSpacing, clamp(stats.p25, 0.15, 0.40));
    const xP50 = Math.max(xP25 + minSpacing, clamp(stats.p50, 0.35, 0.65));
    const xP75 = Math.max(xP50 + minSpacing, clamp(stats.p75, 0.60, 0.85));
    const xHi  = Math.max(xP75 + minSpacing, clamp(hi, 0.75, 0.95));

    const baseCurve = [
      { x: 0, y: 0 },
      { x: xLo,  y: xLo },  // near-identity at shadow floor
      { x: xP25, y: clamp(xP25 - sCurveStrength, 0.05, 0.40) },
      { x: xP50, y: 0.50 },
      { x: xP75, y: clamp(xP75 + sCurveStrength, 0.60, 0.95) },
      { x: xHi,  y: xHi },  // near-identity at highlight ceiling
      { x: 1, y: 1 },
    ];

    logger.info(`AutoToneCurve: range=${lo.toFixed(3)}-${hi.toFixed(3)}, sCurve=${sCurveStrength.toFixed(3)}`);
    return {
      baseCurve,
      baseCurveNodes: baseCurve.length,
      baseCurveType: 1,
      autoLevels: false,
      autoContrast: false,
    };
  }

  // ── Color Balance ────────────────────────────────────────────────────────

  autoColorBalance(stats: ImageStats): Record<string, unknown> {
    // Goal: neutralise colour casts per tonal zone.
    // A perfectly neutral image has avgR ≈ avgG ≈ avgB within each zone.
    // We compute correction as the opposite of the cast.

    const avgLum = stats.meanLum;

    // Global cast correction
    const avgAll = (stats.meanR + stats.meanG + stats.meanB) / 3;
    const castR = stats.meanR - avgAll;
    const castG = stats.meanG - avgAll;
    const castB = stats.meanB - avgAll;

    // Map into the colour balance axes:
    //   cyan_red     ← → R excess → push cyan (negative)
    //   magenta_green← → G excess → push magenta (negative)
    //   yellow_blue  ← → B excess → push yellow (negative)

    // Apply stronger correction to midtones, lighter to shadows/highlights
    const midStrength = 0.8;
    const sideStrength = 0.4;

    const shadows = {
      cyan_red: clamp(-castR * sideStrength * 2, -0.5, 0.5),
      magenta_green: clamp(-castG * sideStrength * 2, -0.5, 0.5),
      yellow_blue: clamp(-castB * sideStrength * 2, -0.5, 0.5),
    };
    const midtones = {
      cyan_red: clamp(-castR * midStrength * 2, -0.5, 0.5),
      magenta_green: clamp(-castG * midStrength * 2, -0.5, 0.5),
      yellow_blue: clamp(-castB * midStrength * 2, -0.5, 0.5),
    };
    const highlights = {
      cyan_red: clamp(-castR * sideStrength * 2, -0.5, 0.5),
      magenta_green: clamp(-castG * sideStrength * 2, -0.5, 0.5),
      yellow_blue: clamp(-castB * sideStrength * 2, -0.5, 0.5),
    };

    logger.info(`AutoColorBalance: cast R=${castR.toFixed(3)}, G=${castG.toFixed(3)}, B=${castB.toFixed(3)}, avgLum=${avgLum.toFixed(3)}`);
    return { shadows, midtones, highlights };
  }

  // ── White Balance ────────────────────────────────────────────────────────

  autoWhiteBalance(stats: ImageStats): { temperature: number; tint: number } {
    // Grey-world assumption: average colour should be neutral grey.
    // R/B ratio maps to colour temperature, G deviation maps to tint.
    const rb = stats.meanB > 0.001 ? stats.meanR / stats.meanB : 1;

    // Map R/B ratio to Kelvin.  rb=1 → 6500K (D65 reference, identity in WB process)
    // rb > 1 (warm image, excess red) → we need to cool it → lower K
    // rb < 1 (cool image, excess blue) → we need to warm it → higher K
    const temperature = clamp(Math.round(6500 * Math.pow(1 / rb, 0.55)), 2000, 12000);

    // Tint: green/magenta. Positive = more magenta needed (green cast in image)
    const expectedG = (stats.meanR + stats.meanB) / 2;
    const tint = clamp(Math.round((stats.meanG - expectedG) * -200), -100, 100);

    logger.info(`AutoWB: R/B=${rb.toFixed(3)} → temp=${temperature}K, G-deviation=${(stats.meanG - expectedG).toFixed(4)} → tint=${tint}`);
    return { temperature, tint };
  }
}

// Singleton
export const autoAdjustService = new AutoAdjustService();
