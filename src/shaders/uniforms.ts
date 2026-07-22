/**
 * Pure uniform-setter factories for WebGL2 shader passes.
 *
 * Each exported function takes a pass's parameters and returns a
 * `(gl, program) => void` callback that performs ONLY the `gl.uniformX`
 * calls for that pass. No GL resource creation, no texture uploads,
 * no drawing — pure uniform state.
 *
 * These factories are shared between WebGLImageProcessor and the future
 * GpuPreviewPipeline so both always set identical uniforms.
 */

import type { BasicAdjustmentsParams, DehazeState, HueCurveLuts } from '../services/WebGLImageProcessor';
import { nrStrengthToH } from '../utils/nrCurve';

/** Setter type used by WebGLImageProcessor.runPass. */
export type UniformSetter = (gl: WebGL2RenderingContext, prog: WebGLProgram) => void;

// ── Exposure pass ────────────────────────────────────────────────────────────

/**
 * @param gain   Linear gain (caller must pre-compute `Math.pow(2, stops)`).
 * @param black  Black-level offset to subtract before applying gain (default 0).
 *               Matches ExposureModule.processWithContext: max(0, v-black)*gain, clamp.
 */
export function exposureUniforms(gain: number, black = 0): UniformSetter {
  return (gl, prog) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_gain'), gain);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_black'), black);
  };
}

// ── Per-channel gains (white balance) ────────────────────────────────────────

export function gainsUniforms(gr: number, gg: number, gb: number): UniformSetter {
  return (gl, prog) => {
    gl.uniform3f(gl.getUniformLocation(prog, 'u_gains'), gr, gg, gb);
  };
}

// ── Basic adjustments pass ───────────────────────────────────────────────────

/**
 * @param p   BasicAdjustmentsParams (raw, not yet clamped — factory clamps internally
 *            to match WebGLImageProcessor.runBasicAdjGPU exactly).
 * @param dz  Pre-computed dehaze state (caller must run computeDehaze first).
 */
export function basicAdjUniforms(p: BasicAdjustmentsParams, dz: DehazeState): UniformSetter {
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  const hlActive = Math.abs(clamp1(p.highlights)) > 0.001;
  const shActive = Math.abs(clamp1(p.shadows)) > 0.001;
  return (gl, prog) => {
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1f(u('u_exposure'), p.exposure);
    gl.uniform1f(u('u_blackPoint'), p.black_point);
    gl.uniform1f(u('u_brightness'), p.brightness);
    gl.uniform1f(u('u_contrast'), p.contrast);
    gl.uniform1f(u('u_dehazeActive'), dz.active ? 1 : 0);
    gl.uniform1f(u('u_dehaze'), clamp1(p.dehaze));
    gl.uniform1f(u('u_hazeStrength'), dz.hazeStrength);
    gl.uniform1f(u('u_hazeDivisor'), dz.hazeDivisor);
    gl.uniform1f(u('u_hlActive'), hlActive ? 1 : 0);
    gl.uniform1f(u('u_shActive'), shActive ? 1 : 0);
    gl.uniform1f(u('u_highlights'), clamp1(p.highlights));
    gl.uniform1f(u('u_shadows'), clamp1(p.shadows));
    gl.uniform1f(u('u_saturation'), p.saturation);
    gl.uniform1f(u('u_vibrance'), p.vibrance);
  };
}

// ── Color balance pass ───────────────────────────────────────────────────────

export function colorBalanceUniforms(
  shadows: number[], mid: number[], high: number[],
  sat: number[], lum: number[], hue: number[]
): UniformSetter {
  return (gl, prog) => {
    gl.uniform3f(gl.getUniformLocation(prog, 'u_shadows'), shadows[0], shadows[1], shadows[2]);
    gl.uniform3f(gl.getUniformLocation(prog, 'u_mid'), mid[0], mid[1], mid[2]);
    gl.uniform3f(gl.getUniformLocation(prog, 'u_high'), high[0], high[1], high[2]);
    gl.uniform1fv(gl.getUniformLocation(prog, 'u_sat'), sat);
    gl.uniform1fv(gl.getUniformLocation(prog, 'u_lum'), lum);
    gl.uniform1fv(gl.getUniformLocation(prog, 'u_hue'), hue);
  };
}

// ── Tone curve pass (scalar/sampler-index uniforms only) ─────────────────────
// NOTE: The 4 LUT textures (master/red/green/blue) are created, uploaded, and
// bound in runToneCurveGPU — NOT here. This factory emits only the scalar
// u_preserveColors uniform and the sampler-index u_image/u_master/u_red/u_green/u_blue
// uniforms that point at already-bound texture units.

export function toneCurveUniforms(preserveColors: number): UniformSetter {
  return (gl, prog) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_preserveColors'), preserveColors);
    // Sampler indices: unit 0 = u_image, 1..4 = u_master/red/green/blue.
    // These are set by runToneCurveGPU directly alongside the texture binds.
  };
}

// ── Vignette pass ────────────────────────────────────────────────────────────

export function vignetteUniforms(
  width: number, height: number,
  strength: number, midpoint: number, roundness: number, feather: number
): UniformSetter {
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), width, height);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_strength'), strength);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_midpoint'), midpoint);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_roundness'), roundness);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_feather'), feather);
  };
}

// ── Distortion pass ──────────────────────────────────────────────────────────

export function distortionUniforms(
  width: number, height: number,
  barrel: number, scale: number, perspH: number, perspV: number
): UniformSetter {
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), width, height);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_barrel'), barrel);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_scale'), scale);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_perspH'), perspH);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_perspV'), perspV);
  };
}

// ── Lateral chromatic aberration pass ────────────────────────────────────────

export function lateralCAUniforms(
  width: number, height: number,
  redShift: number, blueShift: number
): UniformSetter {
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), width, height);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_redShift'), redShift);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_blueShift'), blueShift);
  };
}

// ── Hue curves pass (scalar/flag uniforms + 256-entry LUT arrays) ─────────────
// NOTE: The HueCurves shader passes the 256-entry LUTs as uniform float arrays
// (u_hh / u_hs / u_hl / u_ss / u_ls), not as textures, so they ARE safe to
// include in the factory. The companion flag uniforms (u_onHH etc.) are also here.

export function hueCurvesUniforms(luts: HueCurveLuts, blend: number): UniformSetter {
  return (gl, prog) => {
    const set = (arr: Float32Array | null, name: string, flag: string) => {
      gl.uniform1f(gl.getUniformLocation(prog, flag), arr ? 1 : 0);
      if (arr) gl.uniform1fv(gl.getUniformLocation(prog, name), arr);
    };
    set(luts.hueVsHue, 'u_hh', 'u_onHH');
    set(luts.hueVsSat, 'u_hs', 'u_onHS');
    set(luts.hueVsLum, 'u_hl', 'u_onHL');
    set(luts.satVsSat, 'u_ss', 'u_onSS');
    set(luts.lumVsSat, 'u_ls', 'u_onLS');
    gl.uniform1f(gl.getUniformLocation(prog, 'u_blend'), blend);
  };
}

// ── Shadows / Highlights pass ────────────────────────────────────────────────

/**
 * Parameters consumed by the Shadows/Highlights GPU pass. Field names match
 * ShadowsHighlightsModule.getParams() EXACTLY (verified against the module) so there
 * is no silent-zero name mismatch.
 *
 * Only the fields that affect `process()` pixel math are read here. `maskBlur`,
 * `bilateralFilter`, `enabled` are handled by buildShadowsHighlightsPass (which routes
 * maskBlur>0 / bilateralFilter / disabled to the CPU), not by this setter.
 */
export interface ShadowsHighlightsUniformParams {
  shadows: number;
  highlights: number;
  shadowsRadius: number;
  highlightsRadius: number;
  shadowsColorTransfer: number;
  highlightsColorTransfer: number;
  whitePoint: number;
  blackPoint: number;
  compress: number;
  shadowsColorCorrection: number;
  highlightsColorCorrection: number;
  maskFalloff: number;
  strength: number;
  preserveColor: boolean;
  iterations: number;
}

export function shadowsHighlightsUniforms(p: ShadowsHighlightsUniformParams): UniformSetter {
  return (gl, prog) => {
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1f(u('u_shadows'), p.shadows);
    gl.uniform1f(u('u_highlights'), p.highlights);
    gl.uniform1f(u('u_shadowsRadius'), p.shadowsRadius);
    gl.uniform1f(u('u_highlightsRadius'), p.highlightsRadius);
    gl.uniform1f(u('u_shadowsColorTransfer'), p.shadowsColorTransfer);
    gl.uniform1f(u('u_highlightsColorTransfer'), p.highlightsColorTransfer);
    gl.uniform1f(u('u_whitePoint'), p.whitePoint);
    gl.uniform1f(u('u_blackPoint'), p.blackPoint);
    gl.uniform1f(u('u_compress'), p.compress);
    gl.uniform1f(u('u_shadowsColorCorrection'), p.shadowsColorCorrection);
    gl.uniform1f(u('u_highlightsColorCorrection'), p.highlightsColorCorrection);
    gl.uniform1f(u('u_maskFalloff'), p.maskFalloff);
    gl.uniform1f(u('u_strength'), p.strength);
    gl.uniform1f(u('u_preserveColor'), p.preserveColor ? 1 : 0);
    gl.uniform1f(u('u_iterations'), p.iterations);
  };
}

// ── Highlight reconstruction pass (M1) ───────────────────────────────────────

/** Params for the highlight-recovery GPU pass. Field name matches HighlightRecoveryModule. */
export interface HighlightRecoveryUniformParams {
  strength: number; // 0..100
}

export function highlightRecoveryUniforms(p: HighlightRecoveryUniformParams): UniformSetter {
  return (gl, prog) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_strength'), p.strength);
  };
}

// ── Local-adjustment layer blend pass (Task 10) ──────────────────────────────

/**
 * Uniform setter for the per-layer mask blend (FRAG_LAYER_BLEND).
 * @param opacity  The layer opacity (0..1). Combined with the mask in-shader as
 *                 `w = mask * opacity`, matching applyBasicAdjLayer's `mask[i]*op`.
 * NOTE: the three samplers (u_base unit 0, u_adjusted unit 1, u_mask unit 2) are bound
 * to texture units by the pipeline's sub-pass runner — this setter only sets the scalar.
 */
export function layerBlendUniforms(opacity: number): UniformSetter {
  return (gl, prog) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_opacity'), opacity);
  };
}

// ── Denoise pass ─────────────────────────────────────────────────────────────

export function denoiseUniforms(width: number, height: number, strength: number): UniformSetter {
  // v1.36.0 C1/F1: strength → h goes through the SHARED recalibrated curve (nrCurve.ts) — the
  // old inline `0.015 + s·0.12` was a full low-ISO denoise at s=0 and destructive from s≈5.
  // The tiled export path calls this same factory, so it inherits the curve automatically.
  const h = nrStrengthToH(strength);
  const h2 = h * h * 27.0;
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_texel'), 1 / width, 1 / height);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_h2'), h2);
  };
}
