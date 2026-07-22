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
import { userStyleProfile, selectBucket, type StyleProfile, type BucketName } from './UserStyleProfile';

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

  // ── Profile selection ──────────────────────────────────────────────────────

  /** Pick the user-style bucket + profile that best matches the current image. */
  private pickProfile(stats: ImageStats): { name: BucketName; profile: StyleProfile } {
    const name = selectBucket({ mean_lum: stats.meanLum, rb_ratio: stats.meanR / Math.max(0.001, stats.meanB) });
    return { name, profile: userStyleProfile[name] };
  }

  // ── Exposure ─────────────────────────────────────────────────────────────

  autoExposure(stats: ImageStats): { exposure: number; black: number; mode: 'manual' | 'automatic' } {
    const { name, profile } = this.pickProfile(stats);
    // Target: the user's median luminance for this bucket (was a hardcoded 0.45)
    const targetMedian = profile.targetMedianLum;
    const medianDelta = targetMedian - stats.p50;

    // Only correct if clearly off — dead zone around target to avoid touching well-exposed images
    const deadZone = 0.05; // ±5% of target = no correction
    const effectiveDelta = Math.abs(medianDelta) > deadZone
      ? (medianDelta > 0 ? medianDelta - deadZone : medianDelta + deadZone)
      : 0;
    const exposure = clamp(effectiveDelta * 1.0, -0.6, 0.6);

    // Black level: lift only if deepest shadows are severely clipped
    const black = clamp(stats.p1 < 0.005 ? 0.003 : 0, 0, 0.01);

    logger.info(`AutoExposure[${name}]: median=${stats.p50.toFixed(3)}, target=${targetMedian.toFixed(3)}, delta=${medianDelta.toFixed(3)} → exposure=${exposure.toFixed(3)}, black=${black.toFixed(4)}`);
    return { exposure, black, mode: 'manual' };
  }

  // ── Basic Adjustments ────────────────────────────────────────────────────

  /**
   * @param opts.standalone TRUE when invoked by the Basic Adjustments card's
   * own ⚡ Auto (v1.33.0, user: "changes are too small"). Standalone mode
   * corrects EXPOSURE here (in Auto All the ExposureModule owns it — but the
   * card's Auto never touches that module, so images stayed under/over-exposed)
   * and uses stronger gains/clamps. Auto All keeps the original gentler
   * numbers untouched — its composed look (incl. the camera-match softening)
   * was tuned as a whole in v1.27.0.
   */
  autoBasicAdj(stats: ImageStats, opts: { standalone?: boolean } = {}): {
    black_point: number; exposure: number; contrast: number;
    brightness: number; saturation: number; vibrance: number;
    highlights?: number; shadows?: number;
  } {
    const { name, profile } = this.pickProfile(stats);
    const s = !!opts.standalone;

    // Exposure (standalone only): correct the median toward NEUTRAL — not the
    // style bucket. The bucket medians are post-edit PORTFOLIO statistics (the
    // dark bucket sits at ~0.07): targeting them here pulled a well-exposed
    // kitchen shot down −0.5 stops (user report, histogram receipts). Style
    // grading belongs to Auto All; this ⚡ is an exposure CORRECTOR. Asymmetric
    // clamp: strong lifts for dark shots (the original "too small" complaint),
    // cautious darkening for bright ones. Composed mode stays zero — the
    // ExposureModule owns exposure inside Auto All.
    let exposure = 0;
    if (s) {
      const NEUTRAL_TARGET_MEDIAN = 0.40;
      const medianDelta = NEUTRAL_TARGET_MEDIAN - stats.p50;
      const deadZone = 0.05;
      const effectiveDelta = Math.abs(medianDelta) > deadZone
        ? (medianDelta > 0 ? medianDelta - deadZone : medianDelta + deadZone)
        : 0;
      exposure = clamp(effectiveDelta * 1.6, -0.35, 0.7);
    }

    // Contrast: pull toward the user's contrast (std luminance) for this bucket
    const contrast = clamp((profile.targetStdLum - stats.stdLum) * (s ? 2.5 : 1.5), s ? -0.3 : -0.2, s ? 0.6 : 0.3);

    // Brightness: fine-tune toward the user's mean luminance (complements the
    // exposure move in standalone mode; stays a whisper in composed mode)
    const brightness = clamp((profile.targetMeanLum - stats.meanLum) * (s ? 0.6 : 0.15), s ? -0.35 : -0.1, s ? 0.35 : 0.1);

    // Saturation: pull toward the user's saturation for this bucket
    const saturation = clamp((profile.targetMeanSat - stats.meanSat) * (s ? 0.8 : 0.5), s ? -0.25 : -0.2, s ? 0.35 : 0.2);

    // Vibrance: proportional to saturation correction
    const vibrance = clamp(saturation * (s ? 0.6 : 0.4), s ? -0.15 : -0.1, s ? 0.25 : 0.15);

    // Black point: minimal
    const black_point = 0;

    const base = { black_point, exposure, contrast, brightness, saturation, vibrance };

    // Composed mode: NO highlights/shadows keys — Auto All folds its own
    // autoShadowsHighlights() into these sliders (App.tsx, ×0.6) and its look
    // is frozen; other composed callers (Auto Contrast) do partial setParams
    // merges that must not clobber user-set sliders with zeros.
    if (!s) {
      logger.info(`AutoBasicAdj[${name}]: lum=${stats.meanLum.toFixed(3)}, std=${stats.stdLum.toFixed(3)}, sat=${stats.meanSat.toFixed(3)} → exp=${exposure.toFixed(2)}, cont=${contrast.toFixed(2)}, sat=${saturation.toFixed(2)}`);
      return base;
    }

    // Highlights / Shadows (standalone only, v1.36.0): the card's ⚡ is the
    // ONLY module running, so nothing else recovers a blown top end (user:
    // "Auto doesn't touch exposure of highlights") — and its exposure can push
    // +0.7 with nothing pulling the top back. Same neutral philosophy as the
    // v1.34.1 exposure fix: a well-exposed frame stays near zero; only a
    // genuinely bright/blown top end (p95 past T_HL) or genuinely crushed
    // shadows (mean below T_SH, scaled by how much of the frame is dark) move.
    // NOTE (task #29): the v1.37 Auto All rework adopts this bundle wholesale —
    // these formulas become Auto All's S/H source, keep them here.
    const T_HL = 0.87; // p95 above this = the top end needs pulling down
    const K1 = 2.4;    // strength per unit of p95 excess (dominant term)
    const K2 = 0.15;   // small area term: more hot pixels = a bit more recovery
    // The K2 area term only counts once the top end is genuinely past T_HL:
    // snow, high-key portraits and overcast skies put 40-80% of the frame
    // above 0.75 lum with NOTHING blown (p95 ≤ T_HL) — bright-but-healthy is
    // a look, not a defect, and must stay at exactly zero.
    const hlExcess = Math.max(0, stats.p95 - T_HL);
    const hlAmount = clamp(
      hlExcess * K1 + (hlExcess > 0 ? stats.highlightPixelRatio * K2 : 0),
      0, 0.5
    );
    const highlights = hlAmount > 0 ? -hlAmount : 0; // avoid -0

    const T_SH = 0.10; // shadow-region mean below this = crushed
    const K3 = 10;     // strength per unit of deficit, scaled by dark-area share
    const shadows = clamp(
      Math.max(0, T_SH - stats.shadowMeanLum) * K3 * stats.shadowPixelRatio,
      0, 0.4
    );

    logger.info(`AutoBasicAdj[${name}, standalone]: lum=${stats.meanLum.toFixed(3)}, std=${stats.stdLum.toFixed(3)}, sat=${stats.meanSat.toFixed(3)} → exp=${exposure.toFixed(2)}, cont=${contrast.toFixed(2)}, sat=${saturation.toFixed(2)}, hl=${highlights.toFixed(2)}, sh=${shadows.toFixed(2)}`);
    return { ...base, highlights, shadows };
  }

  // ── Shadows & Highlights ─────────────────────────────────────────────────

  autoShadowsHighlights(stats: ImageStats): Record<string, unknown> {
    const { name, profile } = this.pickProfile(stats);

    // Shadow adjustment: 50 = neutral, >50 = lift shadows. Trigger from the
    // user's acceptable shadow level for this bucket (was hardcoded 0.06).
    const shadowTrigger = profile.acceptableShadowMeanLum;
    const shadowDeficit = shadowTrigger - stats.shadowMeanLum;
    const shadowDelta = clamp(shadowDeficit > 0 ? shadowDeficit * 80 * stats.shadowPixelRatio : 0, 0, 10);
    const shadows = 50 + shadowDelta;

    // Highlight adjustment: 50 = neutral, >50 = recover highlights. Trigger from
    // the user's acceptable highlight level for this bucket (was hardcoded 0.92).
    const highlightTrigger = profile.acceptableHighlightMeanLum;
    const highlightExcess = stats.highlightMeanLum - highlightTrigger;
    const highlightDelta = clamp(highlightExcess > 0 ? highlightExcess * 80 * stats.highlightPixelRatio : 0, 0, 10);
    const highlights = 50 + highlightDelta;

    // Only set Shadows/Highlights amounts — leave Advanced Settings untouched
    logger.info(`AutoSH[${name}]: shadow=${shadows.toFixed(1)}, highlight=${highlights.toFixed(1)}`);
    return {
      shadows,
      highlights,
      enabled: true,
    };
  }

  // ── Tone Curve ───────────────────────────────────────────────────────────

  autoToneCurve(stats: ImageStats): Record<string, unknown> {
    const { name, profile } = this.pickProfile(stats);
    const tonalSpan = stats.p95 - stats.p5;

    // For narrow-range images (uniform dark/bright), return identity curve — no modification.
    if (tonalSpan < 0.15) {
      logger.info(`AutoToneCurve[${name}]: narrow span=${tonalSpan.toFixed(3)}, returning identity`);
      return {
        baseCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        baseCurveNodes: 2,
        baseCurveType: 1,
        autoLevels: false,
        autoContrast: false,
      };
    }

    // Apply the user's bucket tone-curve shape directly (clone the points so the
    // profile constant is never mutated downstream).
    const baseCurve = profile.toneCurveShape.map(pt => ({ ...pt }));
    logger.info(`AutoToneCurve[${name}]: applied profile curve (${baseCurve.length} nodes)`);
    return {
      baseCurve,
      baseCurveNodes: baseCurve.length,
      baseCurveType: 0,
      autoLevels: false,
      autoContrast: false,
    };
  }

  // ── Color Balance ────────────────────────────────────────────────────────

  autoColorBalance(stats: ImageStats): Record<string, unknown> {
    // Goal: bias colour balance toward the user's TARGET RGB balance for this
    // bucket (not absolute neutral). A "cast" is now the deviation from that
    // target, so e.g. the warm bucket's intentional warmth is preserved.
    const { name, profile } = this.pickProfile(stats);

    const avgAll = (stats.meanR + stats.meanG + stats.meanB) / 3;
    const { r: tgtR, g: tgtG, b: tgtB } = profile.rgbBalance;
    const castR = (stats.meanR - avgAll) - (tgtR - 1) * avgAll;
    const castG = (stats.meanG - avgAll) - (tgtG - 1) * avgAll;
    const castB = (stats.meanB - avgAll) - (tgtB - 1) * avgAll;

    // Apply stronger correction to midtones, lighter to shadows/highlights.
    // Strengths and clamps are divided by 3: the Color Balance traditional-tab
    // damping factor went 0.1 -> 0.3, so 1/3 the params keeps Auto results
    // visually identical to what these strengths were originally tuned for.
    const midStrength = 0.8 / 3;
    const sideStrength = 0.4 / 3;
    const lim = 0.5 / 3;

    const shadows = {
      cyan_red: clamp(-castR * sideStrength * 2, -lim, lim),
      magenta_green: clamp(-castG * sideStrength * 2, -lim, lim),
      yellow_blue: clamp(-castB * sideStrength * 2, -lim, lim),
    };
    const midtones = {
      cyan_red: clamp(-castR * midStrength * 2, -lim, lim),
      magenta_green: clamp(-castG * midStrength * 2, -lim, lim),
      yellow_blue: clamp(-castB * midStrength * 2, -lim, lim),
    };
    const highlights = {
      cyan_red: clamp(-castR * sideStrength * 2, -lim, lim),
      magenta_green: clamp(-castG * sideStrength * 2, -lim, lim),
      yellow_blue: clamp(-castB * sideStrength * 2, -lim, lim),
    };

    logger.info(`AutoColorBalance[${name}]: bias R=${castR.toFixed(3)}, G=${castG.toFixed(3)}, B=${castB.toFixed(3)}`);
    return { shadows, midtones, highlights };
  }

  // ── White Balance ────────────────────────────────────────────────────────

  autoWhiteBalance(stats: ImageStats): { temperature: number; tint: number } {
    const { name, profile } = this.pickProfile(stats);
    const rb = stats.meanB > 0.001 ? stats.meanR / stats.meanB : 1;
    const targetRb = profile.rbRatio;   // the user's R/B for this bucket (was implicitly 1.0)

    // Map R/B toward the user's target ratio (not neutral). Power 0.3 keeps it
    // gentle; if the image already matches targetRb, temperature stays at 6500K.
    const temperature = clamp(Math.round(6500 * Math.pow(targetRb / rb, 0.3)), 2000, 12000);

    // Tint: pull toward NEUTRAL by removing the image's green excess relative to the
    // non-green channels (R+B)/2. Ratio-based and negative (negative tint removes green),
    // so it actually neutralises the demosaic green cast — the previous absolute-diff × -80
    // under-corrected and left auto white balance looking too green.
    const expectedG = (stats.meanR + stats.meanB) / 2;
    const gExcess = expectedG > 0.001 ? (stats.meanG - expectedG) / expectedG : 0;
    const tint = clamp(Math.round(-gExcess * 400), -80, 80);

    logger.info(`AutoWB[${name}]: R/B=${rb.toFixed(3)}, targetR/B=${targetRb.toFixed(3)} → temp=${temperature}K, tint=${tint}`);
    return { temperature, tint };
  }

  // ── Auto All (coordinator) ─────────────────────────────────────────────────

  /**
   * Run every auto adjustment in pipeline order and return the bundle of params
   * the UI should dispatch into each module. Caller decides whether to apply
   * them as a single transaction (preferred) or piecewise.
   *
   * `strength` (0..1, default 1) scales every adjustment toward its neutral
   * value. The style profile's targets are ABSOLUTE (e.g. the warm bucket's
   * median-luminance target is 0.33), which is correct on Vitrine's neutral
   * decode but double-grades a camera-matched base — the camera already applied
   * its own tone mapping, so a full-strength pull to the portfolio look crushes
   * bright scenes (verified live: a camera-matched garden portrait rendered
   * dark-muddy under the full warm bucket). Callers pass
   * CAMERA_MATCHED_AUTO_STRENGTH when the base is camera-matched.
   */
  autoAll(data: Float32Array, width: number, height: number, opts?: { strength?: number }): {
    bucket: BucketName;
    stats: ImageStats;
    exposure: ReturnType<AutoAdjustService['autoExposure']>;
    basicAdj: ReturnType<AutoAdjustService['autoBasicAdj']>;
    shadowsHighlights: ReturnType<AutoAdjustService['autoShadowsHighlights']>;
    toneCurve: ReturnType<AutoAdjustService['autoToneCurve']>;
    colorBalance: ReturnType<AutoAdjustService['autoColorBalance']>;
    whiteBalance: ReturnType<AutoAdjustService['autoWhiteBalance']>;
  } {
    const stats = this.analyse(data, width, height);
    const { name: bucket } = this.pickProfile(stats);
    const strength = clamp(opts?.strength ?? 1, 0, 1);
    logger.info(`AutoAll: bucket=${bucket}, samples=${userStyleProfile[bucket].sampleCount}, strength=${strength}`);
    const full = {
      bucket,
      stats,
      exposure: this.autoExposure(stats),
      basicAdj: this.autoBasicAdj(stats),
      shadowsHighlights: this.autoShadowsHighlights(stats),
      toneCurve: this.autoToneCurve(stats),
      colorBalance: this.autoColorBalance(stats),
      whiteBalance: this.autoWhiteBalance(stats),
    };
    return strength >= 1 ? full : this.scaleTowardNeutral(full, strength);
  }

  /**
   * Lerp an autoAll bundle toward neutral by `s`: numeric deltas scale by s
   * (their neutral is 0), Shadows/Highlights lerp around their 50 midpoint,
   * and tone-curve points lerp toward the identity diagonal y=x. WhiteBalance
   * is returned unscaled — the camera-matched caller skips auto-WB entirely
   * (the matched base already carries the camera's WB intent).
   */
  private scaleTowardNeutral(
    full: ReturnType<AutoAdjustService['autoAll']>,
    s: number,
  ): ReturnType<AutoAdjustService['autoAll']> {
    const scaleObj = <T extends Record<string, unknown>>(o: T, keys: string[]): T => {
      const out: Record<string, unknown> = { ...o };
      for (const k of keys) if (typeof out[k] === 'number') out[k] = (out[k] as number) * s;
      return out as T;
    };
    const cbSide = (o: Record<string, unknown>) =>
      scaleObj(o, ['cyan_red', 'magenta_green', 'yellow_blue']);
    const sh = { ...(full.shadowsHighlights as Record<string, unknown>) };
    for (const k of ['shadows', 'highlights']) {
      if (typeof sh[k] === 'number') sh[k] = 50 + ((sh[k] as number) - 50) * s;
    }
    const tc = { ...(full.toneCurve as Record<string, unknown>) };
    if (Array.isArray(tc.baseCurve)) {
      tc.baseCurve = (tc.baseCurve as Array<{ x: number; y: number }>).map((pt) => ({
        x: pt.x,
        y: pt.x + (pt.y - pt.x) * s,
      }));
    }
    const cb = full.colorBalance as Record<string, Record<string, unknown>>;
    return {
      ...full,
      exposure: scaleObj(full.exposure as unknown as Record<string, unknown>, ['exposure', 'black']) as unknown as ReturnType<AutoAdjustService['autoExposure']>,
      basicAdj: scaleObj(full.basicAdj as unknown as Record<string, unknown>, ['black_point', 'exposure', 'contrast', 'brightness', 'saturation', 'vibrance']) as unknown as ReturnType<AutoAdjustService['autoBasicAdj']>,
      shadowsHighlights: sh,
      toneCurve: tc,
      colorBalance: { ...cb, shadows: cbSide(cb.shadows), midtones: cbSide(cb.midtones), highlights: cbSide(cb.highlights) },
    };
  }
}

/**
 * Auto All strength used when the current base is camera-matched. Half strength
 * keeps Auto All meaningful (a perceptible nudge toward the user's style) while
 * letting the camera's own tone mapping remain the dominant voice — the full
 * profile on top of a matched base double-grades and crushes bright scenes.
 */
export const CAMERA_MATCHED_AUTO_STRENGTH = 0.5;

// Singleton
export const autoAdjustService = new AutoAdjustService();
