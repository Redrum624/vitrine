/**
 * v1.37.0 R2 Part C — the dual-signal "may be sideways?" heuristic.
 *
 * Silent content-based rotation was ruled out (heuristics coin-flip on
 * portraits/architecture; EXIF is honored everywhere already) — this powers a
 * NON-DESTRUCTIVE suggestion badge only. Both signals must fire (AND gate):
 *   Signal 1 — vertical-vs-horizontal edge-energy dominance ≥ 2.5:1
 *              (a sideways landscape's horizon runs vertically → |gx| wins)
 *   Signal 2 — lateral (left↔right) luminance delta ≥ 1.5× the vertical one,
 *              above an absolute floor (sky-side detection)
 * Direction: rotate so the brighter lateral side becomes the top
 * (90° CW brings the LEFT edge to the top; 270° brings the RIGHT edge up).
 *
 * All fixtures are deterministic synthetic buffers — no RNG.
 */
import { detectSideways } from '../utils/sidewaysDetection';

const W = 120;
const H = 90;

/** RGBA gray image from a per-pixel luminance function. */
function makeImage(lum: (x: number, y: number) => number, w = W, h = H): Float32Array {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum(x, y);
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1;
    }
  }
  return data;
}

// Sideways landscape: the horizon runs VERTICALLY (sharp x-step), the sky is
// on one lateral side. Both signals fire.
const sidewaysSkyLeft = makeImage((x) => (x < W * 0.45 ? 0.85 : 0.25));
const sidewaysSkyRight = makeImage((x) => (x < W * 0.55 ? 0.25 : 0.85));

// Upright architecture: strong verticals (stripes) but laterally symmetric
// luminance — Signal 1 fires, Signal 2 must not.
const uprightArchitecture = makeImage((x) => (Math.floor(x / 8) % 2 === 0 ? 0.7 : 0.3));

// Upright landscape: horizon runs horizontally (sharp y-step) — Signal 1
// must not fire (|gy| dominates).
const uprightLandscape = makeImage((_x, y) => (y < H * 0.45 ? 0.85 : 0.25));

// Featureless frame: neither signal can fire (floors guard the 0/0 cases).
const flatGray = makeImage(() => 0.5);

describe('detectSideways (dual-signal AND gate)', () => {
  test('sideways landscape, sky on the LEFT → rotate 90° CW (left edge becomes top)', () => {
    expect(detectSideways(sidewaysSkyLeft, W, H, 4)).toEqual({ rotate: 90 });
  });

  test('sideways landscape, sky on the RIGHT → rotate 270° (right edge becomes top)', () => {
    expect(detectSideways(sidewaysSkyRight, W, H, 4)).toEqual({ rotate: 270 });
  });

  test('upright architecture (strong verticals, symmetric lateral luminance) → NO hint', () => {
    expect(detectSideways(uprightArchitecture, W, H, 4)).toBeNull();
  });

  test('upright landscape (horizontal horizon) → NO hint', () => {
    expect(detectSideways(uprightLandscape, W, H, 4)).toBeNull();
  });

  test('featureless frame → NO hint (absolute floors, no 0/0 firing)', () => {
    expect(detectSideways(flatGray, W, H, 4)).toBeNull();
  });

  test('lateral gradient WITHOUT vertical-edge dominance → NO hint (AND gate)', () => {
    // Smooth left-to-right ramp: lateral luminance delta is large, but a smooth
    // ramp spreads its gradient evenly — meanwhile a horizontal texture adds
    // matching |gy| energy, so Signal 1's 2.5:1 dominance is never reached.
    const rampWithHorizontalTexture = makeImage(
      (x, y) => 0.25 + 0.5 * (x / (W - 1)) + (Math.floor(y / 8) % 2 === 0 ? 0.1 : -0.1),
    );
    expect(detectSideways(rampWithHorizontalTexture, W, H, 4)).toBeNull();
  });

  test('handles 3-channel buffers', () => {
    const data = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = x < W * 0.45 ? 0.85 : 0.25;
        const i = (y * W + x) * 3;
        data[i] = v; data[i + 1] = v; data[i + 2] = v;
      }
    }
    expect(detectSideways(data, W, H, 3)).toEqual({ rotate: 90 });
  });

  test('is deterministic (same buffer → same answer)', () => {
    const a = detectSideways(sidewaysSkyLeft, W, H, 4);
    const b = detectSideways(sidewaysSkyLeft, W, H, 4);
    expect(a).toEqual(b);
  });
});
