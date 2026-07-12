/**
 * Unit tests for HighlightRecoveryModule (M1 highlight reconstruction).
 *
 * Fixtures follow the Phase-1 evidence: single-channel (red) clipping over a region where
 * green/blue still carry the luminance gradient (the sunset case). The recovery must
 * reconstruct the clipped channel from the survivors, desaturate blown whites cleanly,
 * leave saturated colours and non-highlights alone, and be an EXACT no-op at strength 0.
 */

import {
  recoverHighlights,
  hrSmoothstep,
  HighlightRecoveryPipelineModule,
  HR_KNEE,
} from './HighlightRecoveryModule';
import { createTestImage, createProcessingContext, getPixel } from '../test/testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** Build a red-clipped horizontal strip: R pinned at 1.0; G,B ramp left→right (carry structure). */
function redClippedGradient(w: number): { data: Float32Array; h: number } {
  const h = 1;
  const data = new Float32Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    const f = x / (w - 1);
    const i = x * 4;
    data[i] = 1.0;                // R fully clipped, flat
    data[i + 1] = 0.78 + 0.20 * f; // G ramps 0.78 → 0.98
    data[i + 2] = 0.70 + 0.18 * f; // B ramps 0.70 → 0.88
    data[i + 3] = 1.0;
  }
  return { data, h };
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('recoverHighlights (pure pointwise pass)', () => {
  it('strength 0 is a byte-identical no-op', () => {
    const { data, h } = redClippedGradient(16);
    const before = Float32Array.from(data);
    recoverHighlights(data, 16, h, 4, 0);
    expect(data).toEqual(before);
  });

  it('leaves below-knee pixels untouched even at full strength', () => {
    // Mid-gray (0.4) is below the highlight knee — nothing to recover.
    const data = createTestImage(8, 8, 0.4, 0.4, 0.4);
    const before = Float32Array.from(data);
    recoverHighlights(data, 8, 8, 4, 100);
    expect(data).toEqual(before);
    expect(0.4).toBeLessThan(HR_KNEE);
  });

  it('keeps a fully-clipped neutral highlight white (no colour introduced)', () => {
    const data = createTestImage(4, 4, 1.0, 1.0, 1.0);
    recoverHighlights(data, 4, 4, 4, 100);
    const [r, g, b] = getPixel(data, 4, 0, 0);
    expect(r).toBeCloseTo(1.0, 6);
    expect(g).toBeCloseTo(1.0, 6);
    expect(b).toBeCloseTo(1.0, 6);
  });

  it('does NOT desaturate a genuinely saturated primary (gate protects it)', () => {
    // Bright pure red: only ONE channel is bright → not a blown white → must be left alone.
    const data = createTestImage(4, 4, 0.98, 0.05, 0.05);
    const before = Float32Array.from(data);
    recoverHighlights(data, 4, 4, 4, 100);
    expect(data).toEqual(before);
  });

  it('reconstructs the clipped red channel from surviving G/B (imprints their gradient)', () => {
    const w = 32;
    const { data, h } = redClippedGradient(w);
    // Input red is a flat plateau (variance 0) — the veil that hides detail.
    const inR = Array.from({ length: w }, (_, x) => data[x * 4]);
    expect(Math.max(...inR) - Math.min(...inR)).toBe(0);

    recoverHighlights(data, w, h, 4, 100);
    const outR = Array.from({ length: w }, (_, x) => data[x * 4]);

    // Reconstruction pulls red DOWN toward the survivors (de-casts) → red now varies.
    expect(Math.max(...outR)).toBeLessThan(1.0);
    expect(Math.max(...outR) - Math.min(...outR)).toBeGreaterThan(0.01);
    // Every recovered red stays at/below the original clip and above 0 (no inversion/blowout).
    for (const v of outR) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  it('preserves a monotonic luminance gradient (no banding/inversion)', () => {
    const w = 32;
    const { data, h } = redClippedGradient(w);
    recoverHighlights(data, w, h, 4, 100);
    let prev = -1;
    // De-casting an over-red region necessarily trims a hair of luminance there, so allow a
    // sub-perceptual dip (< half an 8-bit code value, 1/510 ≈ 2e-3) — that is NOT banding/inversion.
    const EPS = 2e-3;
    for (let x = 0; x < w; x++) {
      const i = x * 4;
      const y = lum(data[i], data[i + 1], data[i + 2]);
      expect(y).toBeGreaterThanOrEqual(prev - EPS); // effectively non-decreasing across the ramp
      prev = y;
    }
    // And it actually rises end-to-end (survivor gradient survives the pass).
    const yEnd = lum(data[(w - 1) * 4], data[(w - 1) * 4 + 1], data[(w - 1) * 4 + 2]);
    const yStart = lum(data[0], data[1], data[2]);
    expect(yEnd).toBeGreaterThan(yStart);
  });

  it('red-cast reduction is monotonic in strength', () => {
    const cast = (strength: number) => {
      const data = createTestImage(2, 2, 1.0, 0.82, 0.74);
      recoverHighlights(data, 2, 2, 4, strength);
      // remaining red excess over the mid channel = colour cast magnitude
      return data[0] - data[1];
    };
    const c0 = cast(0);
    const c50 = cast(50);
    const c100 = cast(100);
    expect(c50).toBeLessThan(c0);
    expect(c100).toBeLessThan(c50);
    expect(c100).toBeGreaterThanOrEqual(0); // never inverts past neutral
  });

  it('never produces out-of-range or NaN values', () => {
    const { data, h } = redClippedGradient(64);
    recoverHighlights(data, 64, h, 4, 73);
    for (let i = 0; i < data.length; i++) {
      expect(Number.isFinite(data[i])).toBe(true);
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('honours a 3-channel stride (no alpha) without reading past the row', () => {
    // 2 px, 3 channels, both blown-white neutral → stays white, no crash.
    const data = new Float32Array([1, 1, 1, 1, 1, 1]);
    recoverHighlights(data, 2, 1, 3, 100);
    expect(Array.from(data)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('leaves the alpha channel untouched', () => {
    const data = createTestImage(2, 2, 1.0, 0.8, 0.7, 0.42);
    recoverHighlights(data, 2, 2, 4, 100);
    const [, , , a] = getPixel(data, 2, 0, 0);
    expect(a).toBeCloseTo(0.42, 6);
  });
});

describe('hrSmoothstep', () => {
  it('clamps to [0,1] and hits the Hermite midpoint', () => {
    expect(hrSmoothstep(0, 1, -1)).toBe(0);
    expect(hrSmoothstep(0, 1, 2)).toBe(1);
    expect(hrSmoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
  it('is degenerate-safe when edges coincide', () => {
    expect(hrSmoothstep(0.5, 0.5, 0.4)).toBe(0);
    expect(hrSmoothstep(0.5, 0.5, 0.6)).toBe(1);
  });
});

describe('HighlightRecoveryPipelineModule', () => {
  let module: HighlightRecoveryPipelineModule;
  beforeEach(() => { module = new HighlightRecoveryPipelineModule(); });

  it('has the expected id/name', () => {
    expect(module.getId()).toBe('highlightrecovery');
    expect(module.getName()).toBe('Highlight Recovery');
  });

  it('defaults to strength 0 and is a no-op', () => {
    expect(module.getParams().strength).toBe(0);
    expect(module.isNoOp()).toBe(true);
  });

  it('returns the SAME buffer reference when neutral (byte-identical)', () => {
    const input = redClippedGradient(16).data;
    const ctx = createProcessingContext(16, 1, 4);
    expect(module.process(input, ctx)).toBe(input);
  });

  it('returns the SAME buffer reference when disabled even with strength set', () => {
    module.setParams({ strength: 80 });
    module.setEnabled(false);
    const input = redClippedGradient(16).data;
    const ctx = createProcessingContext(16, 1, 4);
    expect(module.process(input, ctx)).toBe(input);
  });

  it('processes into a NEW buffer when active (does not mutate the input)', () => {
    module.setParams({ strength: 100 });
    const input = redClippedGradient(16).data;
    const inputCopy = Float32Array.from(input);
    const ctx = createProcessingContext(16, 1, 4);
    const out = module.process(input, ctx);
    expect(out).not.toBe(input);
    expect(input).toEqual(inputCopy);       // input untouched
    expect(out[0]).toBeLessThan(1.0);        // red reconstructed
  });

  it('round-trips params via getParams/setParams (persistence contract)', () => {
    module.setParams({ strength: 55 });
    expect(module.getParams()).toEqual({ enabled: true, strength: 55 });
    module.resetParams();
    expect(module.getParams()).toEqual({ enabled: true, strength: 0 });
  });
});
