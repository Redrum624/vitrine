/**
 * Auto All strength scaling (camera-matched base softening).
 * The style profile's targets are absolute; on a camera-matched base Auto All
 * runs at CAMERA_MATCHED_AUTO_STRENGTH so it nudges instead of double-grading.
 * These tests prove the scaling contract: every adjustment lerps toward its
 * neutral value by the strength factor.
 */
import { autoAdjustService, CAMERA_MATCHED_AUTO_STRENGTH } from '../services/AutoAdjustService';

/** Synthetic RGBA image: warm-ish, mid-dark, full tonal span — reliably picks a
 *  bucket and produces non-zero adjustments at full strength. */
function syntheticImage(): { data: Float32Array; width: number; height: number } {
  const width = 64;
  const height = 48;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = (x / (width - 1)) * 0.9 + 0.05;
      data[i] = Math.min(1, t * 1.2);      // warm: R above G/B
      data[i + 1] = t * 0.95;
      data[i + 2] = t * 0.75;
      data[i + 3] = 1;
    }
  }
  return { data, width, height };
}

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('autoAll strength scaling', () => {
  const { data, width, height } = syntheticImage();
  const full = autoAdjustService.autoAll(data, width, height);
  const half = autoAdjustService.autoAll(data, width, height, { strength: 0.5 });
  const zero = autoAdjustService.autoAll(data, width, height, { strength: 0 });

  it('exports the camera-matched strength constant used by App', () => {
    expect(CAMERA_MATCHED_AUTO_STRENGTH).toBeGreaterThan(0);
    expect(CAMERA_MATCHED_AUTO_STRENGTH).toBeLessThan(1);
  });

  it('default strength (1) is byte-identical to the unscaled bundle', () => {
    const explicit = autoAdjustService.autoAll(data, width, height, { strength: 1 });
    expect(explicit.exposure).toEqual(full.exposure);
    expect(explicit.toneCurve).toEqual(full.toneCurve);
    expect(explicit.colorBalance).toEqual(full.colorBalance);
  });

  it('halves the numeric deltas (exposure, basic adjustments, color balance)', () => {
    expect(close(half.exposure.exposure, full.exposure.exposure * 0.5)).toBe(true);
    expect(close(half.basicAdj.contrast, full.basicAdj.contrast * 0.5)).toBe(true);
    expect(close(half.basicAdj.saturation, full.basicAdj.saturation * 0.5)).toBe(true);
    const fullMid = (full.colorBalance as Record<string, Record<string, number>>).midtones;
    const halfMid = (half.colorBalance as Record<string, Record<string, number>>).midtones;
    for (const k of ['cyan_red', 'magenta_green', 'yellow_blue']) {
      expect(close(halfMid[k], fullMid[k] * 0.5)).toBe(true);
    }
  });

  it('lerps Shadows/Highlights around their 50 midpoint', () => {
    const f = full.shadowsHighlights as { shadows: number; highlights: number };
    const h = half.shadowsHighlights as { shadows: number; highlights: number };
    expect(close(h.shadows, 50 + (f.shadows - 50) * 0.5)).toBe(true);
    expect(close(h.highlights, 50 + (f.highlights - 50) * 0.5)).toBe(true);
  });

  it('lerps the tone curve toward the identity diagonal', () => {
    const fc = (full.toneCurve as { baseCurve: Array<{ x: number; y: number }> }).baseCurve;
    const hc = (half.toneCurve as { baseCurve: Array<{ x: number; y: number }> }).baseCurve;
    // The synthetic image spans the full range, so the bucket curve (non-identity) applies.
    expect(fc.some((pt) => Math.abs(pt.y - pt.x) > 0.01)).toBe(true);
    for (let i = 0; i < fc.length; i++) {
      expect(close(hc[i].y, fc[i].x + (fc[i].y - fc[i].x) * 0.5)).toBe(true);
    }
  });

  it('strength 0 is a no-op grade (identity curve, zero deltas, neutral S/H)', () => {
    expect(close(zero.exposure.exposure, 0)).toBe(true);
    expect(close(zero.basicAdj.contrast, 0)).toBe(true);
    const zc = (zero.toneCurve as { baseCurve: Array<{ x: number; y: number }> }).baseCurve;
    for (const pt of zc) expect(close(pt.y, pt.x)).toBe(true);
    const zsh = zero.shadowsHighlights as { shadows: number; highlights: number };
    expect(close(zsh.shadows, 50)).toBe(true);
    expect(close(zsh.highlights, 50)).toBe(true);
  });
});
