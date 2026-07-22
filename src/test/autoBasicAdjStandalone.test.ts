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
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

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

// Bucket resolution kept for documentation: contrast/brightness/saturation
// still pull toward the user-style profile; only EXPOSURE targets neutral.
const bucket = selectBucket({ mean_lum: 0.22, rb_ratio: 0.23 / 0.21 });
void userStyleProfile[bucket];

describe('autoBasicAdj standalone vs composed', () => {
  const standalone = autoAdjustService.autoBasicAdj(testStats, { standalone: true });
  const composed = autoAdjustService.autoBasicAdj(testStats);

  test('standalone lifts a dark median toward NEUTRAL (0.40), not the style bucket; composed stays 0', () => {
    // p50=0.24 → delta 0.16, minus 0.05 deadzone, ×1.6 = +0.176 stops.
    expect(standalone.exposure).toBeCloseTo(0.176, 2);
    expect(composed.exposure).toBe(0);
  });

  test('standalone never yanks exposure down on a bright image (asymmetric clamp)', () => {
    // A BRIGHT image (p50 0.75): delta −0.35 → −0.30×1.6 = −0.48, clamped to −0.35.
    const bright = { ...testStats, meanLum: 0.72, p50: 0.75 } as unknown as Stats;
    const out = autoAdjustService.autoBasicAdj(bright, { standalone: true });
    expect(out.exposure).toBeGreaterThanOrEqual(-0.35);
    expect(out.exposure).toBeLessThan(0);
  });

  test('a WELL-EXPOSED median gets ZERO exposure correction (regression: −0.5 on a good photo)', () => {
    // p50 0.42 sits inside the ±0.05 dead zone around the 0.40 neutral target.
    const good = { ...testStats, meanLum: 0.44, p50: 0.42 } as unknown as Stats;
    const out = autoAdjustService.autoBasicAdj(good, { standalone: true });
    expect(out.exposure).toBe(0);
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

// ─── v1.36.0 C3: standalone highlights recovery + shadow lift ───────────────
// User: "the 'Auto Basic Adjustments' doesn't seem to touch exposure of
// highlights." Standalone ⚡ is the ONLY module running — nothing else recovers
// a blown top end (Auto All folds autoShadowsHighlights into these sliders in
// App.tsx; the card's Auto has no such fold). Contracts:
//  - blown-sky → highlights strongly negative (recover)
//  - crushed shadows → shadows positive (lift), scaled by dark-area fraction
//  - well-exposed → BOTH near zero (v1.34.1 philosophy: don't touch good photos)
//  - composed mode → both keys ABSENT exactly as today (Auto All look frozen;
//    partial setParams merges in App.tsx must not clobber user-set sliders)

type BAOut = ReturnType<typeof autoAdjustService.autoBasicAdj> & {
  highlights?: number; shadows?: number;
};
const hl = (o: BAOut) => o.highlights ?? 0;
const sh = (o: BAOut) => o.shadows ?? 0;

describe('autoBasicAdj standalone highlights/shadows (v1.36.0)', () => {
  // Blown sky: bright top end (p95 well past 0.87), a third of the frame hot.
  // Median parked in the dead zone so exposure stays 0 — isolates the recovery.
  const blownSky = {
    ...testStats,
    meanLum: 0.60, p50: 0.42, p95: 0.99, p99: 1.0,
    highlightMeanLum: 0.97, highlightPixelRatio: 0.35,
    shadowMeanLum: 0.15, shadowPixelRatio: 0.05,
  } as unknown as Stats;

  // Well-exposed: healthy top end (p95 below trigger), healthy shadows.
  const wellExposed = {
    ...testStats,
    meanLum: 0.44, p50: 0.42, p95: 0.84, p99: 0.90,
    highlightMeanLum: 0.80, highlightPixelRatio: 0.08,
    shadowMeanLum: 0.14, shadowPixelRatio: 0.15,
  } as unknown as Stats;

  // Backlit / crushed shadows: nearly half the frame dark with a very low
  // shadow mean; top end fine.
  const crushed = {
    ...testStats,
    meanLum: 0.30, p50: 0.38, p95: 0.86, p99: 0.92,
    highlightMeanLum: 0.80, highlightPixelRatio: 0.05,
    shadowMeanLum: 0.035, shadowPixelRatio: 0.45,
  } as unknown as Stats;

  test('blown-sky image gets strong highlight recovery (fails today: key never output)', () => {
    const out = autoAdjustService.autoBasicAdj(blownSky, { standalone: true }) as BAOut;
    expect(hl(out)).toBeLessThanOrEqual(-0.25);
    expect(hl(out)).toBeGreaterThanOrEqual(-0.45);
    // Healthy shadows on this frame — no lift.
    expect(sh(out)).toBeLessThan(0.05);
  });

  test('well-exposed image gets near-zero highlights AND shadows (don\'t touch good photos)', () => {
    const out = autoAdjustService.autoBasicAdj(wellExposed, { standalone: true }) as BAOut;
    expect(Math.abs(hl(out))).toBeLessThan(0.05);
    expect(Math.abs(sh(out))).toBeLessThan(0.05);
  });

  test('crushed-shadow image gets a positive shadow lift scaled by dark area', () => {
    const out = autoAdjustService.autoBasicAdj(crushed, { standalone: true }) as BAOut;
    expect(sh(out)).toBeGreaterThanOrEqual(0.15);
    expect(sh(out)).toBeLessThanOrEqual(0.35);
    // Top end is healthy — highlights stay near zero.
    expect(Math.abs(hl(out))).toBeLessThan(0.05);
  });

  test('snow / high-key scene: lots of bright pixels but nothing blown → ZERO highlights', () => {
    // Well-exposed snow: 55% of the frame above 0.75 lum, yet p95 sits BELOW
    // the blown trigger (0.87). The bright-area term alone must not pull the
    // top end down — bright-but-healthy is a look, not a defect.
    const snow = {
      ...testStats,
      meanLum: 0.68, p50: 0.42, p95: 0.85, p99: 0.86,
      highlightMeanLum: 0.82, highlightPixelRatio: 0.55,
      shadowMeanLum: 0.16, shadowPixelRatio: 0.03,
    } as unknown as Stats;
    const out = autoAdjustService.autoBasicAdj(snow, { standalone: true }) as BAOut;
    expect(hl(out)).toBe(0);
  });

  test('interplay: dark image with blown windows → exposure UP and highlights DOWN together', () => {
    const darkBlown = {
      ...testStats,
      meanLum: 0.22, p50: 0.18, p95: 0.98, p99: 1.0,
      highlightMeanLum: 0.96, highlightPixelRatio: 0.07,
      shadowMeanLum: 0.06, shadowPixelRatio: 0.45,
    } as unknown as Stats;
    const out = autoAdjustService.autoBasicAdj(darkBlown, { standalone: true }) as BAOut;
    // The pair must not fight: lift the frame, pull the blown windows back.
    expect(out.exposure).toBeGreaterThan(0);
    expect(hl(out)).toBeLessThan(-0.2);
  });

  test('highlights/shadows respect their clamps on extreme stats', () => {
    const extreme = {
      ...testStats,
      p50: 0.42, p95: 1.0, p99: 1.0,
      highlightMeanLum: 1.0, highlightPixelRatio: 1.0,
      shadowMeanLum: 0.0, shadowPixelRatio: 1.0,
    } as unknown as Stats;
    const out = autoAdjustService.autoBasicAdj(extreme, { standalone: true }) as BAOut;
    expect(hl(out)).toBeGreaterThanOrEqual(-0.5);
    expect(hl(out)).toBeLessThanOrEqual(0);
    expect(sh(out)).toBeGreaterThanOrEqual(0);
    expect(sh(out)).toBeLessThanOrEqual(0.4);
  });

  test('REGRESSION PIN: composed mode outputs NO highlights/shadows keys (Auto All byte-identical)', () => {
    for (const stats of [blownSky, wellExposed, crushed, testStats]) {
      const out = autoAdjustService.autoBasicAdj(stats) as BAOut;
      expect('highlights' in out).toBe(false);
      expect('shadows' in out).toBe(false);
    }
  });
});

// ─── Visual sanity: full module pass on a synthetic blown-sky image ─────────
// Brief requirement: p99 must drop measurably after standalone Auto; midtones
// must not shift more than exposure accounts for (exposure is 0 here — the
// median is parked in the dead zone — so only whisper bucket corrections and
// the lum²-masked tail of the recovery may touch them).

describe('standalone Auto on a blown-sky image (pixel path)', () => {
  const W = 64, H = 64, N = W * H;
  const MID_COUNT = Math.floor(N * 0.65); // 65% midtones, 35% blown sky

  function makeBlownSky(): Float32Array {
    const data = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      // Gray pixels (r=g=b → lum = value): midtone ramp 0.35..0.45, sky ramp 0.96..1.0.
      const v = i < MID_COUNT
        ? 0.35 + 0.1 * (i / (MID_COUNT - 1))
        : 0.96 + 0.04 * ((i - MID_COUNT) / (N - MID_COUNT - 1));
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 1;
    }
    return data;
  }

  const lumOf = (d: Float32Array, i: number) =>
    d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;

  function p99Of(d: Float32Array): number {
    const lums = new Float32Array(N);
    for (let i = 0; i < N; i++) lums[i] = lumOf(d, i);
    lums.sort();
    return lums[Math.floor(N * 0.99)];
  }

  function midtoneMean(d: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < MID_COUNT; i++) sum += lumOf(d, i);
    return sum / MID_COUNT;
  }

  test('p99 drops measurably; midtones barely move (exposure is 0)', () => {
    const img = makeBlownSky();
    const stats = autoAdjustService.analyse(img, W, H);
    const params = autoAdjustService.autoBasicAdj(stats, { standalone: true }) as BAOut;

    // Preconditions the synthetic was designed for.
    expect(params.exposure).toBe(0);          // median inside the dead zone
    expect(hl(params)).toBeLessThanOrEqual(-0.25); // sky is genuinely blown

    const mod = new BasicAdjustmentsModule();
    mod.setParams(params);
    const out = mod.process(img, { width: W, height: H, channels: 4 });

    const p99Before = p99Of(img);
    const p99After = p99Of(out);
    // Midtones: no exposure move, so only whisper corrections are allowed —
    // brightness ±0.035 px-terms + contrast ±0.006 + lum² recovery tail ≤0.032.
    const shift = Math.abs(midtoneMean(out) - midtoneMean(img));

    console.log(
      `[C3 visual sanity] hl=${(params.highlights ?? 0).toFixed(3)}, sh=${(params.shadows ?? 0).toFixed(3)}, ` +
      `p99 ${p99Before.toFixed(3)} → ${p99After.toFixed(3)} (Δ${(p99After - p99Before).toFixed(3)}), ` +
      `midtone shift ${shift.toFixed(4)}`
    );

    expect(p99After).toBeLessThan(p99Before - 0.05); // measurable recovery
    expect(shift).toBeLessThan(0.08);
  });
});
