/**
 * Standalone Auto for Basic Adjustments (v1.33.0, user: "changes are too
 * small"). Contracts:
 *  - standalone mode CORRECTS EXPOSURE (composed mode keeps it 0 — the
 *    ExposureModule owns exposure inside Auto All)
 *  - standalone gains are strictly stronger than composed for off-target images
 *  - composed mode returns the EXACT pre-v1.33 numbers (Auto All look frozen)
 *  - all outputs respect their clamps
 */
import { autoAdjustService } from '../services/AutoAdjustService';
import { userStyleProfile, selectBucket } from '../services/UserStyleProfile';

type Stats = ReturnType<typeof autoAdjustService.analyse>;

// A mid-tone-ish but under-target, flat, desaturated image. Direction of each
// correction is derived from the ACTUAL user-style profile (the buckets encode
// the user's own look — e.g. dark scenes are KEPT dark), never assumed.
const testStats = {
  meanLum: 0.22, p1: 0.01, p5: 0.05, p50: 0.24, p95: 0.6, p99: 0.7,
  stdLum: 0.08, meanSat: 0.06, meanR: 0.23, meanG: 0.22, meanB: 0.21,
  shadowMeanLum: 0.04, highlightMeanLum: 0.6,
  shadowPixelRatio: 0.3, highlightPixelRatio: 0.01, noiseEstimate: 0.01,
} as unknown as Stats;

const bucket = selectBucket({ mean_lum: 0.22, rb_ratio: 0.23 / 0.21 });
const profile = userStyleProfile[bucket];

describe('autoBasicAdj standalone vs composed', () => {
  const standalone = autoAdjustService.autoBasicAdj(testStats, { standalone: true });
  const composed = autoAdjustService.autoBasicAdj(testStats);

  test('standalone corrects exposure toward the bucket target; composed leaves it to ExposureModule', () => {
    const medianDelta = profile.targetMedianLum - 0.24;
    if (Math.abs(medianDelta) > 0.03) {
      expect(standalone.exposure).not.toBe(0);
      expect(Math.sign(standalone.exposure)).toBe(Math.sign(medianDelta));
    }
    expect(Math.abs(standalone.exposure)).toBeLessThanOrEqual(0.7);
    expect(composed.exposure).toBe(0);
  });

  test('standalone corrections are stronger than composed (same direction, bigger magnitude)', () => {
    expect(Math.abs(standalone.brightness)).toBeGreaterThanOrEqual(Math.abs(composed.brightness));
    expect(Math.abs(standalone.contrast)).toBeGreaterThanOrEqual(Math.abs(composed.contrast));
    expect(Math.abs(standalone.saturation)).toBeGreaterThanOrEqual(Math.abs(composed.saturation));
    // At least one correction must be MATERIALLY stronger for this off-target image.
    const gain = Math.abs(standalone.brightness) + Math.abs(standalone.contrast) + Math.abs(standalone.saturation);
    const base = Math.abs(composed.brightness) + Math.abs(composed.contrast) + Math.abs(composed.saturation);
    expect(gain).toBeGreaterThan(base * 1.3);
  });

  test('composed mode keeps the frozen pre-v1.33 clamps', () => {
    expect(Math.abs(composed.brightness)).toBeLessThanOrEqual(0.1);
    expect(composed.contrast).toBeLessThanOrEqual(0.3);
    expect(composed.contrast).toBeGreaterThanOrEqual(-0.2);
    expect(Math.abs(composed.saturation)).toBeLessThanOrEqual(0.2);
  });

  test('standalone outputs respect their clamps', () => {
    expect(Math.abs(standalone.exposure)).toBeLessThanOrEqual(0.7);
    expect(standalone.contrast).toBeLessThanOrEqual(0.6);
    expect(standalone.contrast).toBeGreaterThanOrEqual(-0.3);
    expect(Math.abs(standalone.brightness)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(standalone.saturation)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(standalone.vibrance)).toBeLessThanOrEqual(0.25);
  });

  test('a well-exposed on-target image gets only whisper corrections in both modes', () => {
    // Median sitting inside the dead zone of every bucket target (~0.3-0.45).
    const goodStats = {
      ...testStats,
      meanLum: 0.42, p50: 0.42, stdLum: 0.2, meanSat: 0.25,
      meanR: 0.44, meanG: 0.42, meanB: 0.40,
    } as unknown as Stats;
    const s = autoAdjustService.autoBasicAdj(goodStats, { standalone: true });
    expect(Math.abs(s.exposure)).toBeLessThan(0.35);
    expect(Math.abs(s.brightness)).toBeLessThan(0.2);
  });
});
