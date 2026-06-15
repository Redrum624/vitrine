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

import type { BasicAdjustmentsParams } from '../services/WebGLImageProcessor';

/** Setter type used by WebGLImageProcessor.runPass. */
export type UniformSetter = (gl: WebGL2RenderingContext, prog: WebGLProgram) => void;

// ── Exposure pass ────────────────────────────────────────────────────────────

/**
 * @param gain  Linear gain (caller must pre-compute `Math.pow(2, stops)`).
 */
export function exposureUniforms(gain: number): UniformSetter {
  return (gl, prog) => {
    gl.uniform1f(gl.getUniformLocation(prog, 'u_gain'), gain);
  };
}

// ── Per-channel gains (white balance) ────────────────────────────────────────

export function gainsUniforms(gr: number, gg: number, gb: number): UniformSetter {
  return (gl, prog) => {
    gl.uniform3f(gl.getUniformLocation(prog, 'u_gains'), gr, gg, gb);
  };
}

// ── Basic adjustments pass ───────────────────────────────────────────────────

interface DehazeState {
  active: boolean;
  hazeStrength: number;
  hazeDivisor: number;
}

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

type HueCurveLuts = {
  hueVsHue: Float32Array | null;
  hueVsSat: Float32Array | null;
  hueVsLum: Float32Array | null;
  satVsSat: Float32Array | null;
  lumVsSat: Float32Array | null;
};

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

// ── Denoise pass ─────────────────────────────────────────────────────────────

export function denoiseUniforms(width: number, height: number, strength: number): UniformSetter {
  const s = Math.max(0, Math.min(100, strength)) / 100;
  const h = 0.015 + s * 0.12;
  const h2 = h * h * 27.0;
  return (gl, prog) => {
    gl.uniform2f(gl.getUniformLocation(prog, 'u_texel'), 1 / width, 1 / height);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_h2'), h2);
  };
}
