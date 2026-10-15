/**
 * Creative vignette falloff (v1.40.0). SINGLE SOURCE for the CPU paths
 * (LensCorrectionsModule.correctVignetting and WebGLImageProcessor.vignettingCPU - the reference of the
 * GPU self-checks). The GLSL in FRAG_VIGNETTE (shaders/sources.ts) is a line-for-line mirror - change
 * both together or the vignette GPU self-tests mark the GPU path unsafe.
 *
 * + strength DARKENS the edges, - brightens them. `nd` is the normalised distance from the centre
 * (1 at the corner for roundness 0). The mask is 1 up to fs = mid*0.5 and falls to 0 at fe = mid, so
 * the effect reaches well into the frame. factor = 1 - strength * (1 - mask) = 1 - strength * ff, which
 * lies in [0, 2] for any strength in [-1, 1] regardless of midpoint.
 */
export const VIGNETTE_MIDPOINT_MIN = 0.5;
export const VIGNETTE_MIDPOINT_MAX = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** strength: amount/100 (-1..1); featherNorm: feather/100 (0..1). */
export function vignetteFactor(nd: number, strength: number, midpoint: number, featherNorm: number): number {
  if (!Number.isFinite(nd) || !Number.isFinite(strength)) return 1;
  const mid = clamp(Number.isFinite(midpoint) ? midpoint : 1, VIGNETTE_MIDPOINT_MIN, VIGNETTE_MIDPOINT_MAX);
  const feather = clamp(Number.isFinite(featherNorm) ? featherNorm : 0.5, 0, 1);
  const s = clamp(strength, -1, 1);
  const fs = mid * 0.5, fe = mid;
  const fp = clamp((nd - fs) / (fe - fs), 0, 1);
  const sf = fp * fp * (3 - 2 * fp);
  const ff = fp * (1 - feather) + sf * feather;
  return 1 - s * ff;
}
