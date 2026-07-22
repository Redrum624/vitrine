/**
 * White Balance axis orthogonality — regression for "the temperature in
 * 'White Balance' shifts the tint" (v1.36.0 calibration wave, Task C2).
 *
 * Root cause: computeWBGains derived ALL THREE channel gains as ratios of the
 * Tanner-Helland kelvin→RGB curve, whose GREEN component does not track the
 * mean of R and B (Helland's G is log on the cool side, power-law on the warm
 * side). Every temperature move therefore leaked onto the green↔magenta axis:
 * at tint=0 the old gains measured G÷avg(R,B) ≈ 1.038 at 9250K (≈ +19
 * tint-units of green) and ≈ 0.913 at 3200K (≈ −45, magenta).
 *
 * Fix under test: only the R/B ratio comes from Helland; green is pinned
 * (r = k, g = 1, b = 1/k with k = √(rRatio/bRatio)), tint stays the sole
 * green↔magenta control.
 *
 * METRIC NOTE (deviation from the task brief, documented on purpose): the
 * brief asked to assert |G÷avg(R,B) − 1| < 0.005 across the slider. With the
 * mandated gains r = k, b = 1/k that arithmetic-mean metric equals
 * 2/(k + 1/k) ≤ 1 and reaches ≈ 0.94 at 3200K purely because the arithmetic
 * mean of {k, 1/k} exceeds 1 — it measures slider spread, not a green cast,
 * so the required fix can NEVER satisfy it at <0.005 across 2000–12000K. The
 * scale-invariant green↔magenta axis measure for multiplicative gains is the
 * GEOMETRIC mean: G÷√(R·B) (log-space von-Kries decomposition; invariant
 * under the mean-normalization and under pure blue↔amber moves). The fix pins
 * it to exactly 1; the old defective gains fail it just as clearly
 * (≈ 0.971 at 3200K, ≈ 1.045 at 9250K — same defect the brief's
 * 0.913 / 1.038 figures describe). Both metrics are reported in the failure
 * output so the red run documents the brief's numbers too.
 */

import { WhiteBalanceModule, computeWBGains } from '../modules/WhiteBalanceModule';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** UI slider range is 2000–12000K (WhiteBalanceModuleComponent), 6500 = identity. */
const SLIDER_TEMPS = [2000, 2500, 3200, 4000, 5000, 5500, 6500, 7500, 9250, 10500, 12000];

/** Green↔magenta axis position of a gain triple (1 = neutral). */
const greenAxis = (g: { r: number; g: number; b: number }) => g.g / Math.sqrt(g.r * g.b);
/** The brief's arithmetic variant — reported alongside for the red-run record. */
const greenOverAvg = (g: { r: number; g: number; b: number }) => g.g / ((g.r + g.b) / 2);

// Test-side replica of the module's private solvers (same binary search over the
// SAME exported gain model) — the pattern WhiteBalanceModule.test.ts already uses.
const solveTemp = (mR: number, mB: number): number => {
  let lo = 2000, hi = 12000;
  const f = (t: number) => { const g = computeWBGains(t, 0); return g.r * mR - g.b * mB; };
  const flo = f(lo), fhi = f(hi);
  if (flo > 0 && fhi > 0) return lo;
  if (flo < 0 && fhi < 0) return hi;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
};
const solveTintAt = (temperature: number, mR: number, mG: number, mB: number): number => {
  let lo = -100, hi = 100;
  const h = (t: number) => { const g = computeWBGains(temperature, t); return g.g * mG - (g.r * mR + g.b * mB) / 2; };
  const hlo = h(lo), hhi = h(hi);
  if (hlo > 0 && hhi > 0) return lo;
  if (hlo < 0 && hhi < 0) return hi;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    if (h(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
};

const grayImage = (w: number, h: number, r: number, g: number, b: number) => {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 1; }
  return d;
};
const channelMeans = (d: Float32Array) => {
  let r = 0, g = 0, b = 0;
  const n = d.length / 4;
  for (let i = 0; i < n; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  return { r: r / n, g: g / n, b: b / n };
};

describe('WB axis orthogonality: temperature = blue↔amber ONLY, tint = green↔magenta ONLY', () => {
  it('temperature moves at tint=0 stay off the green↔magenta axis across the whole slider', () => {
    const violations: string[] = [];
    for (const t of SLIDER_TEMPS) {
      const g = computeWBGains(t, 0);
      const geo = greenAxis(g);
      if (Math.abs(geo - 1) >= 0.005) {
        violations.push(`${t}K: G÷√(R·B)=${geo.toFixed(4)}  [brief's G÷avg(R,B)=${greenOverAvg(g).toFixed(4)}]`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('6500K / tint 0 is an exact identity (r=g=b=1)', () => {
    const g = computeWBGains(6500, 0);
    expect(g.r).toBeCloseTo(1, 12);
    expect(g.g).toBeCloseTo(1, 12);
    expect(g.b).toBeCloseTo(1, 12);
  });

  it('temperature is monotonic on the blue↔amber axis (R/B strictly increases with kelvin)', () => {
    let prev = -Infinity;
    for (const t of SLIDER_TEMPS) {
      const g = computeWBGains(t, 0);
      const rb = g.r / g.b;
      expect(rb).toBeGreaterThan(prev);
      prev = rb;
    }
  });

  it('tint-only moves leave the R/B (blue↔amber) ratio untouched at every temperature', () => {
    for (const t of [3200, 5500, 6500, 9250, 12000]) {
      const rbAtZero = (() => { const g = computeWBGains(t, 0); return g.r / g.b; })();
      let prevGreen = -Infinity;
      for (const tint of [-100, -50, -10, 0, 10, 50, 100]) {
        const g = computeWBGains(t, tint);
        expect(g.r / g.b).toBeCloseTo(rbAtZero, 10);
        // …while the green axis moves strictly with tint (tint stays effective).
        const green = greenAxis(g);
        expect(green).toBeGreaterThan(prevGreen);
        prevGreen = green;
      }
    }
  });

  it('solveTemperature round-trips: a cast that computeWBGains(T) exactly corrects solves back to T', () => {
    for (const t of [2000, 2100, 3200, 5000, 6500, 9250, 11800, 12000]) {
      const g = computeWBGains(t, 0);
      // Gray card under a T-kelvin illuminant = inverse of the correcting gains.
      const solved = solveTemp(1 / g.r, 1 / g.b);
      expect(Math.abs(solved - t) / t).toBeLessThan(0.005);
    }
  });

  it('solveTint round-trips at fixed temperature (solvers still converge at the extremes)', () => {
    for (const [t, tint] of [[3200, -40], [5000, 25], [6500, 60], [9250, -75], [2000, 90], [12000, -90]] as const) {
      const g = computeWBGains(t, tint);
      const solved = solveTintAt(t, 1 / g.r, 1 / g.g, 1 / g.b);
      expect(solved).toBeCloseTo(tint, 1);
    }
  });
});

describe('WB visual sanity — real process() pixel path on a neutral image', () => {
  const W = 32, H = 32;
  const ctx = { width: W, height: H, channels: 4 };

  it.each([
    [5500, 'cool-side move (adds blue)'],
    [7500, 'warm-side move (adds amber)'],
  ] as const)('moderate slider move to %iK: green mean shifts < 0.5%%, R and B move > 2%% in opposite directions', (temp, _label) => {
    const mod = new WhiteBalanceModule();
    mod.setParams({ temperature: temp, tint: 0 });
    const out = mod.process(grayImage(W, H, 0.5, 0.5, 0.5), ctx);
    const m = channelMeans(out);
    expect(Math.abs(m.g / 0.5 - 1)).toBeLessThan(0.005);      // green mean pinned
    const dR = m.r / 0.5 - 1, dB = m.b / 0.5 - 1;
    expect(Math.abs(dR)).toBeGreaterThan(0.02);               // R moved
    expect(Math.abs(dB)).toBeGreaterThan(0.02);               // B moved
    expect(Math.sign(dR)).toBe(-Math.sign(dB));               // in opposite directions
    if (temp < 6500) expect(dB).toBeGreaterThan(0);           // cooler kelvin → adds blue
    else expect(dR).toBeGreaterThan(0);                       // warmer kelvin → adds amber
  });

  it('strong warm correction (3200K) keeps the pixel green↔magenta cast neutral', () => {
    // At strong corrections the green MEAN must dip slightly (mean-normalization
    // conserves (R+G+B)/3 while R/B spread), but the green↔magenta CAST — G
    // relative to √(R·B) — must stay exactly neutral. The old gains rendered a
    // ≈ −2.9% magenta cast here (the user-visible bug).
    const mod = new WhiteBalanceModule();
    mod.setParams({ temperature: 3200, tint: 0 });
    const out = mod.process(grayImage(W, H, 0.5, 0.5, 0.5), ctx);
    const m = channelMeans(out);
    expect(Math.abs(m.g / Math.sqrt(m.r * m.b) - 1)).toBeLessThan(0.005);
  });
});

describe('Auto-WB gray card after the axis decoupling', () => {
  it('neutralizes a pure warm cast without introducing a green/magenta cast', () => {
    // Gray card shot under ~3000K light: the exact cast computeWBGains(3000)
    // corrects. Auto-WB solves it, damps to 6500·(3000/6500)^0.7 ≈ 3783K, and
    // applies. The output must be (a) much less warm and (b) STILL green-neutral
    // — under the old coupled gains the damped temperature correction left a
    // ≈ +5.3% green residual on this image (temperature shifting tint).
    const W = 24, H = 24;
    const ctx = { width: W, height: H, channels: 4 };
    const cast = computeWBGains(3000, 0);
    const img = grayImage(W, H, 0.5 / cast.r, 0.5 / cast.g, 0.5 / cast.b);
    const inMeans = channelMeans(img);
    expect(inMeans.g / Math.sqrt(inMeans.r * inMeans.b)).toBeCloseTo(1, 3); // fixture: pure temp cast

    const mod = new WhiteBalanceModule();
    mod.autoDetectWhiteBalance(img, ctx);
    const params = mod.getParams();
    expect(params.auto).toBe(true);
    expect(params.temperature).toBeLessThan(6500);   // correct direction
    expect(params.temperature).toBeGreaterThan(3000); // damped, not full
    expect(Math.abs(params.tint)).toBeLessThan(1);   // pure temp cast solves ZERO tint

    const out = mod.process(img, ctx);
    const m = channelMeans(out);
    // (a) warm excess reduced by well over half (0.7 damping in log-ratio space)…
    const inExcess = inMeans.r / inMeans.b - 1;
    const outExcess = m.r / m.b - 1;
    expect(outExcess).toBeGreaterThan(0);            // warmth retained by design
    expect(outExcess).toBeLessThan(inExcess * 0.5);
    // (b) …with NO cast leaking onto the green↔magenta axis.
    expect(Math.abs(m.g / Math.sqrt(m.r * m.b) - 1)).toBeLessThan(0.005);
  });
});
