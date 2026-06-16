/**
 * Pass-list builder for the resident-texture WebGL2 GPU pipeline.
 *
 * `buildPassList(modules)` maps an ordered array of pipeline modules to:
 *   - `passes`     — ordered GPU PassDescriptors, one per enabled GPU-capable module
 *                    (lenscorrections may emit up to three sub-passes).
 *   - `cpuBridges` — module IDs that must run on the CPU (disabled GPU modules,
 *                    CPU-only modules, or lenscorrections when no GPU sub-effect fires).
 *
 * All module IDs in GPU_MODULE_IDS match the REAL values returned by each module's
 * getId() — WhiteBalanceModule.getId() returns 'temperature', not 'whitebalance'.
 *
 * `setUniforms` on every PassDescriptor has arity 3: (gl, program, rt: PassRuntime).
 * The pipeline computes a single PassRuntime per render (real width/height from the
 * framebuffer, dehaze from source pixels) and passes it into every setUniforms call.
 * This eliminates baked-in 0/0 placeholders and inactive dehaze hacks.
 */

import {
  exposureUniforms,
  gainsUniforms,
  basicAdjUniforms,
  toneCurveUniforms,
  colorBalanceUniforms,
  distortionUniforms,
  lateralCAUniforms,
  vignetteUniforms,
  shadowsHighlightsUniforms,
} from './uniforms';
import type { ShadowsHighlightsUniformParams } from './uniforms';
import type { BasicAdjustmentsParams, DehazeState } from '../services/WebGLImageProcessor';
import { computeWBGains } from '../modules/WhiteBalanceModule';

// ── GPU capability sets ────────────────────────────────────────────────────────

/**
 * Module IDs for the P1 GPU pass set (auto-included by buildPassList).
 * These are the REAL ids returned by each module's getId() method.
 * - 'temperature'    = WhiteBalanceModule (getId() returns 'temperature')
 * - 'basicadj'       = BasicAdjustmentsModule
 * - 'tonecurve'      = ToneCurvePipelineModule
 * - 'colorbalance'   = ColorBalancePipelineModule
 * - 'lenscorrections'= LensCorrectionsPipelineModule
 * - 'shadowshighlights' = ShadowsHighlightsPipelineModule (single-pass, maskBlur==0 only;
 *                         maskBlur>0 / bilateralFilter route to the CPU — see builder)
 * HueCurves is NOT included — it is a standalone singleton, never registered in the
 * live pipeline.
 */
export const GPU_MODULE_IDS: readonly string[] = [
  'temperature',
  'exposure',
  'basicadj',
  'tonecurve',
  'colorbalance',
  'lenscorrections',
  'shadowshighlights',
];

/**
 * Opt-in GPU modules — NOT auto-included. The pipeline must explicitly opt in.
 * 'noise-reduction' maps to the NLM denoise shader (GPU NR is expensive; user-triggered).
 */
export const OPT_IN_GPU_MODULE_IDS: readonly string[] = [
  'noise-reduction',
];

// ── Runtime context ────────────────────────────────────────────────────────────

/**
 * Per-render context injected at draw time.
 * The pipeline computes this once per frame and threads it through every setUniforms call.
 *
 * - `width`/`height` — actual framebuffer dimensions (needed by lens-corrections passes).
 * - `dehaze`         — pre-computed dehaze state from source pixels (needed by basicadj).
 *                      A default inactive value `{active:false,hazeStrength:0,hazeDivisor:1}`
 *                      is acceptable until Task 4 wires up the real computeDehaze.
 */
export interface PassRuntime {
  width: number;
  height: number;
  dehaze: DehazeState;
}

// ── PassDescriptor type ────────────────────────────────────────────────────────

/**
 * Describes a single GPU draw-call in the resident-texture pipeline.
 *
 * `programKey`  — selects the compiled WebGL program (e.g. 'gains', 'basicadj').
 * `setUniforms` — sets all scalar/vector uniforms for this pass. Arity 3:
 *                 `(gl, program, rt: PassRuntime) => void`.
 * `luts`        — optional Float32Arrays for LUT textures that the pipeline must upload
 *                 before drawing (tonecurve master/red/green/blue).
 */
export interface PassDescriptor {
  id: string;
  programKey: string;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, rt: PassRuntime) => void;
  luts?: Record<string, Float32Array>;
}

export interface PassList {
  passes: PassDescriptor[];
  cpuBridges: string[];
}

// ── Minimal PipelineModule interface (subset used here) ───────────────────────

interface MinimalModule {
  getId(): string;
  isEnabled?: boolean;
  getParams?(): Record<string, unknown>;
  /** Optional: returns pre-built LUT arrays for the GPU tone-curve pass. */
  getGpuLuts?(): { master: Float32Array; red: Float32Array; green: Float32Array; blue: Float32Array } | null;
}

// ── Re-export computeWBGains for test access ──────────────────────────────────
// The function lives in WhiteBalanceModule.ts (single source of truth) and is
// re-exported from here so the test suite can import it alongside buildPassList.
export { computeWBGains };

// ── Shared defaults ───────────────────────────────────────────────────────────

const NEUTRAL_TONE = { cyan_red: 0, magenta_green: 0, yellow_blue: 0 } as const;

// ── Per-module descriptor builders ────────────────────────────────────────────

function buildExposurePass(params: Record<string, unknown>): PassDescriptor {
  // ExposureModule.getParams() returns { mode, black, exposure, deflicker_percentile,
  // deflicker_target_level, compensate_exposure_bias }. Only 'exposure' (stops) and
  // 'black' drive processWithContext() — all other params are for the deflicker UI.
  const stops = typeof params.exposure === 'number' ? params.exposure : 0;
  const black = typeof params.black === 'number' ? params.black : 0;
  const gain = Math.pow(2, stops);
  return {
    id: 'exposure',
    programKey: 'exposure',
    // exposure does not depend on rt (no dimension/dehaze needed)
    setUniforms: (_gl, _prog, _rt) => exposureUniforms(gain, black)(_gl, _prog),
  };
}

function buildWBPass(params: Record<string, unknown>): PassDescriptor {
  const temperature = typeof params.temperature === 'number' ? params.temperature : 6500;
  const tint = typeof params.tint === 'number' ? params.tint : 0;
  const { r, g, b } = computeWBGains(temperature, tint);
  return {
    id: 'temperature',
    programKey: 'gains',
    // gains do not depend on rt (no dimension/dehaze needed)
    setUniforms: (_gl, _prog, _rt) => gainsUniforms(r, g, b)(_gl, _prog),
  };
}

function buildBasicAdjPass(params: Record<string, unknown>): PassDescriptor {
  const p = params as unknown as BasicAdjustmentsParams;
  return {
    id: 'basicadj',
    programKey: 'basicadj',
    // dehaze is injected from rt at draw time — no baked-in placeholder
    setUniforms: (gl, prog, rt) => basicAdjUniforms(p, rt.dehaze)(gl, prog),
  };
}

function buildToneCurvePass(module: MinimalModule, params: Record<string, unknown>): PassDescriptor {
  const preserveColors = typeof params.preserveColors === 'number' ? params.preserveColors : 0;

  // Prefer getGpuLuts() on the real module (single-source: same arrays used in process()).
  // Fall back to reading lookupTable / rgbLookupTables from params for fake/test modules
  // that bake LUTs directly into the params record.
  let master: Float32Array | undefined;
  let red: Float32Array | undefined;
  let green: Float32Array | undefined;
  let blue: Float32Array | undefined;

  if (typeof module.getGpuLuts === 'function') {
    const gpuLuts = module.getGpuLuts();
    if (gpuLuts !== null) {
      master = gpuLuts.master;
      red = gpuLuts.red;
      green = gpuLuts.green;
      blue = gpuLuts.blue;
    }
  } else {
    // Fallback: read from params (covers fake modules in tests that inject LUTs via params)
    master = params.lookupTable instanceof Float32Array ? params.lookupTable : undefined;
    const rgbTables = params.rgbLookupTables as { red?: Float32Array; green?: Float32Array; blue?: Float32Array } | undefined;
    red = rgbTables?.red instanceof Float32Array ? rgbTables.red : undefined;
    green = rgbTables?.green instanceof Float32Array ? rgbTables.green : undefined;
    blue = rgbTables?.blue instanceof Float32Array ? rgbTables.blue : undefined;
  }

  const luts: Record<string, Float32Array> = {};
  if (master) luts.master = master;
  if (red) luts.red = red;
  if (green) luts.green = green;
  if (blue) luts.blue = blue;

  return {
    id: 'tonecurve',
    programKey: 'tonecurve',
    // tonecurve does not need rt (no dimension/dehaze)
    setUniforms: (gl, prog, _rt) => toneCurveUniforms(preserveColors)(gl, prog),
    luts: Object.keys(luts).length > 0 ? luts : undefined,
  };
}

function buildColorBalancePass(params: Record<string, unknown>): PassDescriptor {
  const shadows = (params.shadows as Record<string, number> | undefined) ?? NEUTRAL_TONE;
  const midtones = (params.midtones as Record<string, number> | undefined) ?? NEUTRAL_TONE;
  const highlights = (params.highlights as Record<string, number> | undefined) ?? NEUTRAL_TONE;

  const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
  const getNum = (key: string): number => {
    const v = params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const sat = colors.map(c => getNum(`${c}_saturation`));
  const lum = colors.map(c => getNum(`${c}_luminance`));
  const hue = colors.map(c => getNum(`${c}_hue`));

  return {
    id: 'colorbalance',
    programKey: 'colorbalance',
    // colorbalance does not need rt
    setUniforms: (gl, prog, _rt) => colorBalanceUniforms(
      [shadows.cyan_red, shadows.magenta_green, shadows.yellow_blue],
      [midtones.cyan_red, midtones.magenta_green, midtones.yellow_blue],
      [highlights.cyan_red, highlights.magenta_green, highlights.yellow_blue],
      sat, lum, hue,
    )(gl, prog),
  };
}

/**
 * Shadows/Highlights → a single GPU pass, but ONLY when it can match the CPU exactly.
 *
 * The CPU module box-blurs the shadow/highlight tone masks across neighbouring pixels
 * (blurMask) whenever `maskBlur > 0`, and optionally runs a bilateral pre-filter. Neither
 * cross-pixel gather can be reproduced in the analytic single-pass shader, so those modes
 * MUST run on the CPU. Returns `null` in that case so buildPassList routes the module to
 * cpuBridges. The module default `maskBlur` is 1.0, so by default S/H falls back to CPU;
 * the GPU pass engages only when the user sets maskBlur to 0 (and bilateralFilter off).
 *
 * Param field names are read straight from ShadowsHighlightsModule.getParams() — verified
 * against the module, so no silent-zero name mismatch.
 */
function buildShadowsHighlightsPass(params: Record<string, unknown>): PassDescriptor | null {
  const num = (k: string, dflt: number): number => {
    const v = params[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  const maskBlur = num('maskBlur', 1.0);
  const bilateralFilter = params.bilateralFilter === true;
  // maskBlur>0 or bilateral → cross-pixel ops the analytic shader can't match → CPU.
  if (maskBlur > 0 || bilateralFilter) return null;

  const p: ShadowsHighlightsUniformParams = {
    shadows: num('shadows', 50),
    highlights: num('highlights', 50),
    shadowsRadius: num('shadowsRadius', 50),
    highlightsRadius: num('highlightsRadius', 50),
    shadowsColorTransfer: num('shadowsColorTransfer', 0),
    highlightsColorTransfer: num('highlightsColorTransfer', 0),
    whitePoint: num('whitePoint', 0),
    blackPoint: num('blackPoint', 0),
    compress: num('compress', 0),
    shadowsColorCorrection: num('shadowsColorCorrection', 0),
    highlightsColorCorrection: num('highlightsColorCorrection', 0),
    maskFalloff: num('maskFalloff', 2.0),
    strength: num('strength', 1.0),
    preserveColor: params.preserveColor !== false,
    iterations: num('iterations', 1),
  };

  return {
    id: 'shadowshighlights',
    programKey: 'shadowshighlights',
    // does not depend on rt (per-pixel analytic, no dimension/dehaze)
    setUniforms: (gl, prog, _rt) => shadowsHighlightsUniforms(p)(gl, prog),
  };
}

/**
 * LensCorrections maps to up to three sub-passes (distortion, lateralCA, vignette).
 * Each setUniforms reads width/height from rt — no baked-in 0,0 placeholders.
 * Returns an empty array when all sub-effects are identity/disabled.
 */
function buildLensCorrectionsSubPasses(params: Record<string, unknown>): PassDescriptor[] {
  const passes: PassDescriptor[] = [];

  // ── Distortion ──────────────────────────────────────────────────────────────
  const dist = params.distortion as {
    enabled?: boolean;
    barrel?: number;
    perspective?: { horizontal?: number; vertical?: number };
    scale?: number;
  } | undefined;

  if (dist?.enabled) {
    const barrel = dist.barrel ?? 0;
    const perspH = dist.perspective?.horizontal ?? 0;
    const perspV = dist.perspective?.vertical ?? 0;
    const scale = dist.scale ?? 1.0;
    const isIdentity = barrel === 0 && perspH === 0 && perspV === 0 && scale === 1.0;
    if (!isIdentity) {
      const barrelN = barrel / 100;
      const perspHRad = perspH * Math.PI / 180;
      const perspVRad = perspV * Math.PI / 180;
      passes.push({
        id: 'lenscorrections:distortion',
        programKey: 'distortion',
        // width/height come from rt at draw time
        setUniforms: (gl, prog, rt) => distortionUniforms(rt.width, rt.height, barrelN, scale, perspHRad, perspVRad)(gl, prog),
      });
    }
  }

  // ── Lateral chromatic aberration ─────────────────────────────────────────────
  const ca = params.chromaticAberration as {
    enabled?: boolean;
    redCyan?: number;
    blueMagenta?: number;
  } | undefined;

  if (ca?.enabled) {
    const redCyan = ca.redCyan ?? 0;
    const blueMagenta = ca.blueMagenta ?? 0;
    if (redCyan !== 0 || blueMagenta !== 0) {
      passes.push({
        id: 'lenscorrections:lateralca',
        programKey: 'lateralca',
        setUniforms: (gl, prog, rt) => lateralCAUniforms(rt.width, rt.height, redCyan, blueMagenta)(gl, prog),
      });
    }
  }

  // ── Vignetting ───────────────────────────────────────────────────────────────
  const vig = params.vignetting as {
    enabled?: boolean;
    amount?: number;
    midpoint?: number;
    roundness?: number;
    feather?: number;
  } | undefined;

  if (vig?.enabled) {
    const amount = vig.amount ?? 0;
    if (amount !== 0) {
      const midpoint = vig.midpoint ?? 0.5;
      const roundness = vig.roundness ?? 0;
      const feather = vig.feather ?? 0.5;
      const amountN = amount / 100;
      const roundnessN = roundness / 100;
      const featherN = feather / 100;
      passes.push({
        id: 'lenscorrections:vignette',
        programKey: 'vignette',
        setUniforms: (gl, prog, rt) => vignetteUniforms(rt.width, rt.height, amountN, midpoint, roundnessN, featherN)(gl, prog),
      });
    }
  }

  return passes;
}

// ── buildPassList ──────────────────────────────────────────────────────────────

/**
 * Given the pipeline's ordered module list, returns:
 *   `passes`     — PassDescriptor[] for GPU-capable, enabled modules (in input order).
 *   `cpuBridges` — string[] of module IDs that must run on CPU.
 *
 * Rules:
 * - A module with `isEnabled === false` is skipped from GPU passes and added to cpuBridges.
 * - A module whose ID is in GPU_MODULE_IDS becomes a PassDescriptor (or sub-passes for
 *   lenscorrections).
 * - All other modules are CPU-only and go to cpuBridges.
 */
export function buildPassList(modules: MinimalModule[]): PassList {
  const passes: PassDescriptor[] = [];
  const cpuBridges: string[] = [];

  for (const module of modules) {
    const id = module.getId();
    const enabled = module.isEnabled !== false; // treat missing isEnabled as true

    if (!enabled) {
      cpuBridges.push(id);
      continue;
    }

    const params: Record<string, unknown> = module.getParams?.() ?? {};

    if (id === 'lenscorrections') {
      const subPasses = buildLensCorrectionsSubPasses(params);
      if (subPasses.length > 0) {
        passes.push(...subPasses);
      } else {
        // All sub-effects are identity/disabled — nothing for GPU to do.
        cpuBridges.push(id);
      }
      continue;
    }

    if (!GPU_MODULE_IDS.includes(id)) {
      cpuBridges.push(id);
      continue;
    }

    switch (id) {
      case 'temperature':
        passes.push(buildWBPass(params));
        break;
      case 'exposure':
        passes.push(buildExposurePass(params));
        break;
      case 'basicadj':
        passes.push(buildBasicAdjPass(params));
        break;
      case 'tonecurve':
        passes.push(buildToneCurvePass(module, params));
        break;
      case 'colorbalance':
        passes.push(buildColorBalancePass(params));
        break;
      case 'shadowshighlights': {
        // null → maskBlur>0 / bilateralFilter: cross-pixel ops the shader can't match → CPU.
        const shPass = buildShadowsHighlightsPass(params);
        if (shPass) passes.push(shPass);
        else cpuBridges.push(id);
        break;
      }
      default:
        // Future GPU modules in GPU_MODULE_IDS without a dedicated builder yet.
        cpuBridges.push(id);
    }
  }

  return { passes, cpuBridges };
}

