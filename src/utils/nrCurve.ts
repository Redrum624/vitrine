/**
 * Noise-reduction strength (0-100) → NLM filtering parameter `h` — THE single curve shared by
 * the GPU NLM pass (shaders/uniforms.ts denoiseUniforms → preview AND the tiled export path) and
 * the CPU NLM fallback (AdvancedDenoisingService.denoiseNLMeansSync, previously a mismatched
 * `(s/100)·0.1`).
 *
 * v1.36.0 C1/F1 recalibration: the old GPU curve `h = 0.015 + (s/100)·0.12` had a base offset
 * that was already a full low-ISO denoise at strength 0, crossed the detail-smear threshold
 * (h ≈ 0.021) at strength 5, and left ~95% of the slider destructive (user report: "needs to be
 * put at 5 to be usable"). The new curve anchors: new 50 ≈ old 5, new 100 ≈ old 27 — everything
 * the old slider produced above ~27 smeared detail and is deliberately unreachable now.
 *
 * Saved edits/presets store the raw 0-100 strength and are NOT migrated — they deliberately
 * reinterpret gentler under the new curve.
 */
export function nrStrengthToH(strength: number): number {
  const s = Math.max(0, Math.min(100, strength)) / 100;
  return 0.002 + Math.pow(s, 1.2) * 0.045;
}

/** Inverse of nrStrengthToH, clamped to the representable strength range [0, 100]. */
export function nrHToStrength(h: number): number {
  const t = (h - 0.002) / 0.045;
  if (t <= 0) return 0;
  return Math.min(100, 100 * Math.pow(t, 1 / 1.2));
}

/**
 * The pre-v1.36.0 GPU curve — kept ONLY so NoiseReductionModule.autoAdjust can translate its
 * bucket strengths (tuned against this curve) into the same EFFECTIVE h through the new curve.
 * Never feed this to a denoise pass.
 */
export function legacyNrStrengthToH(strength: number): number {
  const s = Math.max(0, Math.min(100, strength)) / 100;
  return 0.015 + s * 0.12;
}
