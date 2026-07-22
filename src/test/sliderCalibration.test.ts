/**
 * C1 (v1.36.0) — slider-calibration recalibration pins.
 *
 * F1 — Noise-reduction strength. The old GPU NLM curve `h = 0.015 + (s/100)·0.12` put a full
 * low-ISO denoise at s=0 (base offset) and crossed the detail-smear threshold (h≈0.021) at s=5
 * (user report: "needs to be put at 5 to be usable"). The new shared curve
 * `h = 0.002 + (s/100)^1.2 · 0.045` maps new-50 ≈ old-5 and new-100 ≈ old-27, is used by the GPU
 * pass (denoiseUniforms → preview + tiled export) AND the CPU NLM fallback (previously a
 * mismatched `(s/100)·0.1`), and NoiseReductionModule.autoAdjust is re-tuned so the EFFECTIVE h
 * of its buckets is preserved (clamped to the new ceiling where the old value is unreachable).
 *
 * F2 — CAS sharpen strength. Old `peak = -(0.125 + 0.075·s)` applied 62.5% of max sharpening at
 * s=0 and squashed the range into 1.6×. New `peak = -0.2·s` (same max at s=1, zero means OFF),
 * and the CAS pass is skipped entirely at s≤0 on BOTH the deterministic and AI routes (the GPU
 * parity port is pinned by enhanceGpuChain.test.ts).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { nrStrengthToH, nrHToStrength, legacyNrStrengthToH } from '../utils/nrCurve';
import { denoiseUniforms } from '../shaders/uniforms';
import * as enhanceOps from '../utils/enhanceOps';
import { casPeak, cas } from '../utils/enhanceOps';
import { enhanceImage, enhanceAiUpscaled, DEFAULT_ENHANCE_PARAMS, type EnhanceParams } from '../utils/enhanceChain';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── F1: the NR strength → h curve ────────────────────────────────────────────

describe('nrStrengthToH — new NR curve pins (0/5/25/50/100)', () => {
  it('pins the curve values', () => {
    expect(nrStrengthToH(0)).toBeCloseTo(0.002, 10);      // zero = near-off (no base-offset denoise)
    expect(nrStrengthToH(5)).toBeCloseTo(0.003236, 6);
    expect(nrStrengthToH(25)).toBeCloseTo(0.010526, 6);
    expect(nrStrengthToH(50)).toBeCloseTo(0.021587, 6);
    expect(nrStrengthToH(100)).toBeCloseTo(0.047, 10);
  });

  it('anchors: new 50 ≈ old 5, new 100 ≈ old 27, and the old destructive base offset is gone', () => {
    expect(Math.abs(nrStrengthToH(50) - legacyNrStrengthToH(5))).toBeLessThan(6e-4);   // 0.0216 vs 0.021
    expect(Math.abs(nrStrengthToH(100) - legacyNrStrengthToH(27))).toBeLessThan(5e-4); // 0.047 vs 0.0474
    // Old s=0 was already h=0.015 — a full low-ISO denoise. New s=0 is far below it.
    expect(nrStrengthToH(0)).toBeLessThan(legacyNrStrengthToH(0) / 5);
  });

  it('is monotonically increasing and clamps input to 0..100', () => {
    let prev = -Infinity;
    for (let s = 0; s <= 100; s += 5) { const h = nrStrengthToH(s); expect(h).toBeGreaterThan(prev); prev = h; }
    expect(nrStrengthToH(-10)).toBe(nrStrengthToH(0));
    expect(nrStrengthToH(140)).toBe(nrStrengthToH(100));
  });

  it('nrHToStrength inverts the curve and clamps outside the representable range', () => {
    for (const s of [0, 5, 25, 50, 100]) expect(nrHToStrength(nrStrengthToH(s))).toBeCloseTo(s, 6);
    expect(nrHToStrength(0.075)).toBe(100); // old auto "moderate" h — above the new ceiling
    expect(nrHToStrength(0.117)).toBe(100); // old auto "very high" h
    expect(nrHToStrength(0.001)).toBe(0);   // below the new floor
  });
});

describe('denoiseUniforms — GPU NLM pass uses the new curve (u_h2 = h²·27)', () => {
  const capturedH2 = (strength: number): number => {
    const calls: Record<string, number> = {};
    const gl = {
      getUniformLocation: (_p: unknown, name: string) => name,
      uniform1f: (name: string, v: number) => { calls[name] = v; },
      uniform2f: () => { /* u_texel — not asserted */ },
    } as unknown as WebGL2RenderingContext;
    denoiseUniforms(100, 100, strength)(gl, {} as WebGLProgram);
    return calls['u_h2'];
  };

  it.each([0, 5, 25, 50, 100])('strength %i → u_h2 matches nrStrengthToH', (s) => {
    const h = nrStrengthToH(s);
    expect(capturedH2(s)).toBeCloseTo(h * h * 27.0, 10);
  });
});

describe('CPU NLM fallback — unified with the GPU curve', () => {
  it('AdvancedDenoisingService NLM derives h from nrStrengthToH (was a mismatched (s/100)·0.1)', () => {
    const src = readFileSync(join(__dirname, '..', 'services', 'AdvancedDenoisingService.ts'), 'utf8');
    expect(src).toContain('nrStrengthToH(params.strength)');
    expect(src).not.toContain("(params.strength / 100) * 0.1");
  });
});

// ── F1: autoAdjust effective-h preservation ──────────────────────────────────

describe('NoiseReductionModule.autoAdjust — effective h preserved through the new curve', () => {
  const W = 64, H = 64;
  /** Deterministic gray image with uniform ±amp luma noise (mulberry32). */
  const noisyGray = (amp: number, seed = 7): Float32Array => {
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const d = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = Math.min(1, Math.max(0, 0.5 + (rand() - 0.5) * 2 * amp));
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 1;
    }
    return d;
  };

  it('low-noise bucket (old strength 20, h=0.039 — reachable): same effective h, remapped strength', () => {
    const mod = new NoiseReductionModule();
    const p = mod.autoAdjust(noisyGray(0), { width: W, height: H, channels: 4 });
    expect(p.method).toBe('wavelet'); // the low-noise bucket fired
    // The bucket's EFFECTIVE h is unchanged: new curve at the remapped strength == old curve at 20.
    expect(nrStrengthToH(p.strength)).toBeCloseTo(legacyNrStrengthToH(20), 8);
    expect(p.strength).toBeGreaterThan(80); // old raw value 20 through the new curve would be far too weak
  });

  it('moderate bucket (old strength 50, h=0.075 — above the new ceiling): clamps to 100', () => {
    const mod = new NoiseReductionModule();
    const p = mod.autoAdjust(noisyGray(0.023), { width: W, height: H, channels: 4 });
    expect(p.method).toBe('nlmeans'); // the moderate bucket fired
    expect(p.strength).toBe(100);     // old h 0.075 is deliberately unreachable (destructive range)
  });

  it('very-high bucket (old strength 85, h=0.117): clamps to 100', () => {
    const mod = new NoiseReductionModule();
    const p = mod.autoAdjust(noisyGray(0.092), { width: W, height: H, channels: 4 });
    expect(p.method).toBe('hybrid');
    expect(p.strength).toBe(100);
  });
});

// ── F2: CAS peak curve + skip-at-zero on both routes ─────────────────────────

describe('casPeak — new CAS strength curve pins (slider 0/5/25/50/100 → s 0/0.05/0.25/0.5/1)', () => {
  it('pins the curve: -0.2·s, zero means OFF, max unchanged', () => {
    expect(casPeak(0) === 0).toBe(true);            // true off (old: -0.125 = 62.5% of max at zero)
    expect(casPeak(0.05)).toBeCloseTo(-0.01, 10);
    expect(casPeak(0.25)).toBeCloseTo(-0.05, 10);
    expect(casPeak(0.5)).toBeCloseTo(-0.1, 10);
    expect(casPeak(1)).toBeCloseTo(-0.2, 10);
    expect(casPeak(1)).toBeCloseTo(-(0.125 + 0.075), 10); // full-strength look preserved
  });

  it('clamps sharpness to 0..1', () => {
    expect(casPeak(-1) === 0).toBe(true);
    expect(casPeak(2)).toBeCloseTo(-0.2, 10);
  });
});

describe('CAS at sharpness 0 is a true no-op', () => {
  const W = 8, H = 8;
  const vEdge = (): Float32Array => {
    const a = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = x < W / 2 ? 0.2 : 0.8;
    return a;
  };

  it('cas(y, 0) returns the input bit-for-bit even on a hard edge', () => {
    const y = vEdge();
    const out = cas(y, W, H, 0);
    for (let i = 0; i < y.length; i++) expect(Object.is(out[i], y[i])).toBe(true);
  });

  const rgbaEdge = (): Float32Array => {
    const d = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; const v = x < W / 2 ? 0.2 : 0.8;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 1;
    }
    return d;
  };

  it('deterministic route (enhanceImage) SKIPS the CAS pass at sharpness 0 and runs it above 0', () => {
    const base: EnhanceParams = {
      ...DEFAULT_ENHANCE_PARAMS, enabled: true, sharpen: true, upscale: false,
      denoiseStrength: 0, rlIters: 0, chromaClean: false,
    };
    const spy = jest.spyOn(enhanceOps, 'cas');
    try {
      enhanceImage(rgbaEdge(), W, H, { ...base, sharpness: 0 });
      expect(spy).not.toHaveBeenCalled();
      enhanceImage(rgbaEdge(), W, H, { ...base, sharpness: 0.4 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });

  it('AI route (enhanceAiUpscaled) SKIPS the CAS pass at sharpness 0 and runs it above 0', () => {
    const base: EnhanceParams = {
      ...DEFAULT_ENHANCE_PARAMS, enabled: true, sharpen: true, upscale: false,
      denoiseStrength: 0, rlIters: 0, alpha: 0, chromaClean: true, // chromaClean keeps it off the pass-through
    };
    const spy = jest.spyOn(enhanceOps, 'cas');
    try {
      enhanceAiUpscaled(rgbaEdge(), W, H, { ...base, sharpness: 0 });
      expect(spy).not.toHaveBeenCalled();
      enhanceAiUpscaled(rgbaEdge(), W, H, { ...base, sharpness: 0.3 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});
