/**
 * Auto All strength scaling (camera-matched base softening) — v1.37.0 R2 bundle.
 *
 * D4 re-baselined Auto All: the bundle is now the standalone Basic-Adjustments
 * bundle (exposure toward neutral, highlights/shadows recovery, black_point
 * clip-lift) — no separate ExposureModule / ShadowsHighlights / whiteBalance
 * keys. On a camera-matched base Auto All runs at CAMERA_MATCHED_AUTO_STRENGTH
 * so it nudges instead of double-grading: every key lerps toward its 0-neutral.
 */
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from '../services/AutoAdjustService';

/** Synthetic RGBA image engineered so EVERY scalable key is non-zero at full
 *  strength: dark-ish midtones (exposure lift), a blown sky band (highlights),
 *  crushed near-black shadows with p1 < 0.005 (shadows lift + black_point),
 *  gray pixels (saturation/vibrance pull), flat contrast. */
function syntheticImage(): { data: Float32Array; width: number; height: number } {
  const width = 64;
  const height = 60;
  const data = new Float32Array(width * height * 4);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    let v: number;
    if (frac < 0.15) v = 0.001 + 0.002 * (frac / 0.15);          // crushed blacks
    else if (frac < 0.75) v = 0.25 + 0.08 * ((frac - 0.15) / 0.6); // dark midtones
    else v = 0.96 + 0.04 * ((frac - 0.75) / 0.25);                // blown sky
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 1;
  }
  return { data, width, height };
}

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const SCALED_KEYS = [
  'exposure', 'contrast', 'brightness', 'saturation', 'vibrance',
  'highlights', 'shadows', 'black_point',
] as const;

describe('autoAll strength scaling (v1.37.0 standalone bundle)', () => {
  const { data, width, height } = syntheticImage();
  const full = autoAdjustService.autoAll(data, width, height);
  const half = autoAdjustService.autoAll(data, width, height, { strength: 0.5 });
  const zero = autoAdjustService.autoAll(data, width, height, { strength: 0 });

  it('exports the camera-matched strength constant used by the Auto All flow', () => {
    expect(CAMERA_MATCHED_AUTO_STRENGTH).toBeGreaterThan(0);
    expect(CAMERA_MATCHED_AUTO_STRENGTH).toBeLessThan(1);
  });

  it('bundle is the standalone Basic-Adj bundle ONLY — no exposure/S-H/WB module keys', () => {
    for (const bundle of [full, half, zero] as unknown as Array<Record<string, unknown>>) {
      expect('exposure' in bundle).toBe(false);
      expect('shadowsHighlights' in bundle).toBe(false);
      expect('whiteBalance' in bundle).toBe(false);
      expect(bundle.basicAdj).toBeDefined();
      expect(bundle.bucket).toBeDefined();
      expect(bundle.stats).toBeDefined();
    }
  });

  it('full-strength basicAdj IS autoBasicAdj(stats, {standalone:true}) — one shared bundle (D4)', () => {
    expect(full.basicAdj).toEqual(autoAdjustService.autoBasicAdj(full.stats, { standalone: true }));
  });

  it('the synthetic actually exercises every scaled key (guards the scaling assertions)', () => {
    const ba = full.basicAdj as unknown as Record<string, number>;
    expect(ba.exposure).toBeGreaterThan(0);      // dark midtones → lift
    expect(ba.highlights).toBeLessThan(0);       // blown sky → recover
    expect(ba.shadows).toBeGreaterThan(0);       // crushed shadows → lift
    expect(ba.black_point).toBeGreaterThan(0);   // p1 < 0.005 → clip-lift port
    expect(Math.abs(ba.contrast)).toBeGreaterThan(0);
    expect(Math.abs(ba.saturation)).toBeGreaterThan(0);
  });

  it('default strength (1) is byte-identical to the unscaled bundle', () => {
    const explicit = autoAdjustService.autoAll(data, width, height, { strength: 1 });
    expect(explicit.basicAdj).toEqual(full.basicAdj);
  });

  it('halves EVERY numeric delta — incl. highlights/shadows/black_point (0-neutral)', () => {
    const f = full.basicAdj as unknown as Record<string, number>;
    const h = half.basicAdj as unknown as Record<string, number>;
    for (const k of SCALED_KEYS) {
      expect({ key: k, ok: close(h[k], f[k] * 0.5) }).toEqual({ key: k, ok: true });
    }
  });

  it('strength 0 is a no-op grade (all deltas 0)', () => {
    const z = zero.basicAdj as unknown as Record<string, number>;
    for (const k of SCALED_KEYS) {
      expect({ key: k, ok: close(z[k], 0) }).toEqual({ key: k, ok: true });
    }
  });

  it('the scaled bundle carries NO toneCurve / colorBalance keys (v1.37.0 D1/D2)', () => {
    for (const bundle of [half, zero] as unknown as Array<Record<string, unknown>>) {
      expect('toneCurve' in bundle).toBe(false);
      expect('colorBalance' in bundle).toBe(false);
    }
  });
});
