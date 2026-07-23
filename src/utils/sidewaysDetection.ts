/**
 * sidewaysDetection — the dual-signal "photo may be sideways?" heuristic
 * (v1.37.0 R2 Part C).
 *
 * Powers a NON-DESTRUCTIVE suggestion badge only. Silent content-based
 * rotation was ruled out by the D4 feasibility pass: single-signal heuristics
 * coin-flip on portraits and architecture, and EXIF orientation is already
 * honored everywhere — so anything that still LOOKS sideways deserves a
 * suggestion, never an automatic write.
 *
 * Two independent signals, combined with an AND gate:
 *
 *   Signal 1 — vertical-edge dominance. A sideways landscape's horizon (and
 *   its tree trunks, buildings, walls) runs VERTICALLY, so the Sobel
 *   x-gradient energy |gx| dominates |gy| by ≥ EDGE_DOMINANCE_RATIO. Upright
 *   architecture ALSO fires this one — that is exactly why it cannot act
 *   alone.
 *
 *   Signal 2 — sky-side detection. In a sideways outdoor shot the bright sky
 *   sits on the LEFT or RIGHT: the lateral (left↔right) luminance delta
 *   exceeds the vertical (top↔bottom) delta by ≥ LATERAL_DOMINANCE_RATIO and
 *   clears an absolute floor (MIN_LATERAL_DELTA) so symmetric or flat frames
 *   can never fire on ratio noise.
 *
 * Direction: rotate so the brighter lateral side becomes the top. A 90° CW
 * quarter-turn brings the LEFT edge to the top; 270° brings the RIGHT edge up.
 *
 * Deterministic (no RNG) and cheap: the buffer is nearest-sampled onto a
 * ≤ GRID_LONG_EDGE luminance grid before any math runs, so full-preview
 * buffers cost the same as thumbnails.
 */

export interface SidewaysHit {
  /** Lossless quarter-turn (clockwise degrees) that would bring the bright side up. */
  rotate: 90 | 270;
}

/** Signal 1: vertical-vs-horizontal edge-energy dominance threshold. */
export const EDGE_DOMINANCE_RATIO = 2.5;
/** Signal 2: lateral-vs-vertical luminance-delta dominance threshold. */
export const LATERAL_DOMINANCE_RATIO = 1.5;
/** Signal 2: absolute lateral-delta floor — below it the frame is treated as laterally symmetric. */
export const MIN_LATERAL_DELTA = 0.08;
/** Signal 1: absolute mean-gradient floor — below it the frame is treated as featureless. */
const MIN_EDGE_ENERGY = 0.005;
/** Long edge of the downsampled analysis grid. */
const GRID_LONG_EDGE = 64;

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

/** Raw signal measurements — exposed so callers can LOG reality (the thresholds
 *  were calibrated against these values measured on in-app preview buffers,
 *  which carry the full module chain incl. sharpening — see the R2 report). */
export interface SidewaysSignals {
  /** Sobel |gx| / |gy| energy ratio (vertical-edge dominance). */
  edgeRatio: number;
  /** Mean-luminance delta, left half − right half. */
  lateralDelta: number;
  /** Mean-luminance delta, top half − bottom half. */
  verticalDelta: number;
  /** Mean per-cell gradient energy (featureless-frame floor input). */
  meanEdgeEnergy: number;
}

/**
 * Measure the raw signals on a pixel buffer (3 or 4 channels, 0..1 floats).
 * Returns null for degenerate inputs (tiny frames, wrong channel counts).
 */
export function measureSidewaysSignals(
  data: Float32Array,
  width: number,
  height: number,
  channels: number,
): SidewaysSignals | null {
  if (width < 8 || height < 8 || (channels !== 3 && channels !== 4)) return null;
  if (data.length < width * height * channels) return null;

  // ── Downsample to a luminance grid (nearest sampling, aspect preserved) ──
  const scale = GRID_LONG_EDGE / Math.max(width, height);
  const gw = Math.max(8, Math.round(width * Math.min(1, scale)));
  const gh = Math.max(8, Math.round(height * Math.min(1, scale)));
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const sy = Math.min(height - 1, Math.floor((gy + 0.5) * height / gh));
    for (let gx = 0; gx < gw; gx++) {
      const sx = Math.min(width - 1, Math.floor((gx + 0.5) * width / gw));
      const i = (sy * width + sx) * channels;
      grid[gy * gw + gx] = luminance(data[i], data[i + 1], data[i + 2]);
    }
  }

  // ── Signal 1: Sobel edge-energy orientation ──────────────────────────────
  let sumGx = 0;
  let sumGy = 0;
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const tl = grid[(y - 1) * gw + (x - 1)], tc = grid[(y - 1) * gw + x], tr = grid[(y - 1) * gw + (x + 1)];
      const ml = grid[y * gw + (x - 1)], mr = grid[y * gw + (x + 1)];
      const bl = grid[(y + 1) * gw + (x - 1)], bc = grid[(y + 1) * gw + x], br = grid[(y + 1) * gw + (x + 1)];
      // Sobel x (vertical-edge response) and Sobel y (horizontal-edge response).
      sumGx += Math.abs((tr + 2 * mr + br) - (tl + 2 * ml + bl));
      sumGy += Math.abs((bl + 2 * bc + br) - (tl + 2 * tc + tr));
    }
  }
  const interior = (gw - 2) * (gh - 2);
  if (interior <= 0) return null;
  const meanEdgeEnergy = (sumGx + sumGy) / interior;
  const edgeRatio = sumGx / Math.max(1e-9, sumGy);

  // ── Signal 2: lateral luminance gradient (sky-side detection) ────────────
  const halfW = Math.floor(gw / 2);
  const halfH = Math.floor(gh / 2);
  let leftSum = 0, leftN = 0, rightSum = 0, rightN = 0;
  let topSum = 0, topN = 0, bottomSum = 0, bottomN = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const v = grid[y * gw + x];
      if (x < halfW) { leftSum += v; leftN++; } else if (x >= gw - halfW) { rightSum += v; rightN++; }
      if (y < halfH) { topSum += v; topN++; } else if (y >= gh - halfH) { bottomSum += v; bottomN++; }
    }
  }
  const lateralDelta = leftSum / Math.max(1, leftN) - rightSum / Math.max(1, rightN);
  const verticalDelta = topSum / Math.max(1, topN) - bottomSum / Math.max(1, bottomN);

  return { edgeRatio, lateralDelta, verticalDelta, meanEdgeEnergy };
}

/**
 * Analyse a pixel buffer (3 or 4 channels, 0..1 floats) and report whether it
 * looks sideways, and in which direction to rotate. Returns null when either
 * signal declines — the badge shows only on a dual-signal hit.
 */
export function detectSideways(
  data: Float32Array,
  width: number,
  height: number,
  channels: number,
): SidewaysHit | null {
  const s = measureSidewaysSignals(data, width, height, channels);
  if (!s) return null;

  const verticalEdgesDominate =
    s.meanEdgeEnergy >= MIN_EDGE_ENERGY && s.edgeRatio >= EDGE_DOMINANCE_RATIO;
  if (!verticalEdgesDominate) return null;

  const lateralDominates =
    Math.abs(s.lateralDelta) >= MIN_LATERAL_DELTA &&
    Math.abs(s.lateralDelta) >= LATERAL_DOMINANCE_RATIO * Math.abs(s.verticalDelta);
  if (!lateralDominates) return null;

  // Brighter LEFT side → 90° CW puts it on top; brighter RIGHT side → 270°.
  return { rotate: s.lateralDelta > 0 ? 90 : 270 };
}
