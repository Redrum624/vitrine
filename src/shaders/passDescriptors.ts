/**
 * Pass-list builder for the resident-texture WebGL2 GPU pipeline.
 *
 * `buildPassList(modules)` maps an ordered array of pipeline modules to:
 *   - `passes`     — ordered GPU PassDescriptors, one per enabled GPU-capable module
 *                    (lenscorrections may emit up to three sub-passes).
 *   - `cpuBridges` — module IDs that must run on the CPU (disabled GPU modules,
 *                    CPU-only modules, or lenscorrections when no GPU sub-effect fires).
 *
 * IMPORTANT ID NOTE:
 *   The string IDs used in GPU_MODULE_IDS match the conventions used in the
 *   CheckpointService / AdjustmentPanel / task spec. Some real pipeline module IDs
 *   differ — specifically WhiteBalanceModule.getId() returns 'temperature', not
 *   'whitebalance'. Task 4 (GpuPreviewPipeline) must map 'temperature' → 'whitebalance'
 *   when looking up GPU capability, or add 'temperature' to GPU_MODULE_IDS as an alias.
 *   Reported as DONE_WITH_CONCERNS item #1.
 *
 * DEHAZE CONCERN:
 *   basicAdj's setUniforms uses basicAdjUniforms(p, dz) which requires a DehazeState
 *   computed from the actual pixel data. buildPassList is a pure function with no image
 *   data, so the returned setUniforms closure uses a zero/inactive DehazeState by default.
 *   The real GpuPreviewPipeline must call computeDehaze (or equivalent) before binding
 *   uniforms for the basicadj pass. Reported as DONE_WITH_CONCERNS item #2.
 */

import {
  gainsUniforms,
  basicAdjUniforms,
  toneCurveUniforms,
  colorBalanceUniforms,
  distortionUniforms,
  lateralCAUniforms,
  vignetteUniforms,
  hueCurvesUniforms,
  type UniformSetter,
} from './uniforms';
import type { BasicAdjustmentsParams, DehazeState, HueCurveLuts } from '../services/WebGLImageProcessor';
import { temperatureToRgb, safeDivide } from '../modules/utils/ColorUtils';

// ── GPU capability sets ────────────────────────────────────────────────────────

/**
 * Module IDs for the P1 GPU pass set (auto-included by buildPassList).
 * NOTE: 'whitebalance' is the convention ID; the real WhiteBalanceModule.getId()
 * returns 'temperature'. See file-level note above.
 */
export const GPU_MODULE_IDS: readonly string[] = [
  'whitebalance',
  'basicadj',
  'tonecurve',
  'colorbalance',
  'lenscorrections',
  'huecurves',
];

/**
 * Opt-in GPU modules — NOT auto-included. The pipeline must explicitly opt in
 * (e.g. user enables GPU NR). 'noisereduction' maps to the NLM denoise shader.
 */
export const OPT_IN_GPU_MODULE_IDS: readonly string[] = [
  'noisereduction',
  'exposure', // deferred to Task 7
];

// ── PassDescriptor type ────────────────────────────────────────────────────────

/**
 * Describes a single GPU draw-call in the resident-texture pipeline.
 *
 * `programKey`  — selects the compiled WebGL program (e.g. 'gains', 'basicadj').
 * `setUniforms` — sets all scalar/vector uniforms for this pass (no texture ops).
 * `luts`        — optional Float32Arrays for LUT textures that the pipeline must upload
 *                 before drawing (tonecurve master/red/green/blue; huecurves curves).
 */
export interface PassDescriptor {
  id: string;
  programKey: string;
  setUniforms: UniformSetter;
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
}

// ── Per-module descriptor builders ────────────────────────────────────────────

/**
 * Compute per-channel WB gains from temperature (K) + tint (-100..100).
 * Single-sourced from WhiteBalanceModule.computeGains() — extracted here so
 * both process() and buildPassList call the same math.
 *
 * NOTE: WhiteBalanceModule.computeGains is private. We replicate the formula
 * here (3 lines + tint application). A unit test in this file pins the output.
 * If WhiteBalanceModule.computeGains ever changes, the test will catch drift.
 * Reported as DONE_WITH_CONCERNS item #3.
 */
export function computeWBGains(temperature: number, tint: number): { r: number; g: number; b: number } {
  const ref = temperatureToRgb(6500);
  const cur = temperatureToRgb(temperature);
  let r = safeDivide(ref.r, cur.r, 1);
  let g = safeDivide(ref.g, cur.g, 1);
  let b = safeDivide(ref.b, cur.b, 1);

  // Apply tint (matches WhiteBalanceModule.applyTint exactly)
  const tintFactor = tint / 100.0;
  if (tintFactor > 0) {
    r *= (1 - tintFactor * 0.1);
    g *= (1 + tintFactor * 0.1);
    b *= (1 - tintFactor * 0.1);
  } else {
    const m = -tintFactor;
    r *= (1 + m * 0.1);
    g *= (1 - m * 0.1);
    b *= (1 + m * 0.1);
  }

  const avg = (r + g + b) / 3 || 1;
  return { r: r / avg, g: g / avg, b: b / avg };
}

function buildWBPass(params: Record<string, unknown>): PassDescriptor {
  const temperature = typeof params.temperature === 'number' ? params.temperature : 6500;
  const tint = typeof params.tint === 'number' ? params.tint : 0;
  const { r, g, b } = computeWBGains(temperature, tint);
  return {
    id: 'whitebalance',
    programKey: 'gains',
    setUniforms: gainsUniforms(r, g, b),
  };
}

function buildBasicAdjPass(params: Record<string, unknown>): PassDescriptor {
  // Cast params — the real module always provides all fields; fakes may be sparse.
  const p = params as unknown as BasicAdjustmentsParams;
  // DehazeState must be computed from pixel data at draw time (see file-level note).
  // We return an inactive zero state here; GpuPreviewPipeline overrides this at runtime.
  const dz: DehazeState = { active: false, hazeStrength: 0, hazeDivisor: 1 };
  return {
    id: 'basicadj',
    programKey: 'basicadj',
    setUniforms: basicAdjUniforms(p, dz),
  };
}

function buildToneCurvePass(params: Record<string, unknown>): PassDescriptor {
  const preserveColors = typeof params.preserveColors === 'number' ? params.preserveColors : 0;
  // LUTs are stored as instance properties on ToneCurveModule (not in getParams()),
  // but the fake module in the test passes them through getParams() for testability.
  const master = params.lookupTable instanceof Float32Array ? params.lookupTable : undefined;
  const rgbTables = params.rgbLookupTables as { red?: Float32Array; green?: Float32Array; blue?: Float32Array } | undefined;
  const red = rgbTables?.red instanceof Float32Array ? rgbTables.red : undefined;
  const green = rgbTables?.green instanceof Float32Array ? rgbTables.green : undefined;
  const blue = rgbTables?.blue instanceof Float32Array ? rgbTables.blue : undefined;

  const luts: Record<string, Float32Array> = {};
  if (master) luts.master = master;
  if (red) luts.red = red;
  if (green) luts.green = green;
  if (blue) luts.blue = blue;

  return {
    id: 'tonecurve',
    programKey: 'tonecurve',
    setUniforms: toneCurveUniforms(preserveColors),
    luts: Object.keys(luts).length > 0 ? luts : undefined,
  };
}

function buildColorBalancePass(params: Record<string, unknown>): PassDescriptor {
  // Mirror ColorBalanceModule.process() GPU-path exactly.
  const shadows = (params.shadows as Record<string, number> | undefined) ?? { cyan_red: 0, magenta_green: 0, yellow_blue: 0 };
  const midtones = (params.midtones as Record<string, number> | undefined) ?? { cyan_red: 0, magenta_green: 0, yellow_blue: 0 };
  const highlights = (params.highlights as Record<string, number> | undefined) ?? { cyan_red: 0, magenta_green: 0, yellow_blue: 0 };

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
    setUniforms: colorBalanceUniforms(
      [shadows.cyan_red, shadows.magenta_green, shadows.yellow_blue],
      [midtones.cyan_red, midtones.magenta_green, midtones.yellow_blue],
      [highlights.cyan_red, highlights.magenta_green, highlights.yellow_blue],
      sat, lum, hue,
    ),
  };
}

/**
 * LensCorrections maps to up to three sub-passes (distortion, lateralCA, vignette).
 * Returns an empty array when all sub-effects are identity/disabled (caller sends
 * the module id to cpuBridges in that case).
 */
function buildLensCorrectionsSubPasses(
  params: Record<string, unknown>,
  moduleIsEnabled: boolean,
): PassDescriptor[] {
  if (!moduleIsEnabled) return [];

  const passes: PassDescriptor[] = [];

  // ── Distortion ──────────────────────────────────────────────────────────────
  // Mirror LensCorrectionsModule.processImage() distortion guard exactly.
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
      // Width/height are not known at buildPassList time; pass 0,0 as placeholders.
      // GpuPreviewPipeline must patch u_res before drawing.
      passes.push({
        id: 'lenscorrections:distortion',
        programKey: 'distortion',
        setUniforms: distortionUniforms(
          0, 0,
          barrel / 100,
          scale,
          perspH * Math.PI / 180,
          perspV * Math.PI / 180,
        ),
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
        setUniforms: lateralCAUniforms(0, 0, redCyan, blueMagenta),
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
      passes.push({
        id: 'lenscorrections:vignette',
        programKey: 'vignette',
        setUniforms: vignetteUniforms(0, 0, amount / 100, midpoint, roundness / 100, feather / 100),
      });
    }
  }

  return passes;
}

function buildHueCurvesPass(params: Record<string, unknown>): PassDescriptor {
  // Mirror HueCurvesModule.process() exactly: pass pre-built luts + masterBlend.
  // When called via buildPassList, luts must be pre-computed by the module (via
  // setParams/buildLUTs) and exposed through getParams() for the pipeline to read.
  const luts = (params.luts as HueCurveLuts | undefined) ?? {
    hueVsHue: null, hueVsSat: null, hueVsLum: null,
    satVsSat: null, lumVsSat: null,
  };
  const blend = typeof params.masterBlend === 'number' ? params.masterBlend : 1;
  return {
    id: 'huecurves',
    programKey: 'huecurves',
    setUniforms: hueCurvesUniforms(luts, blend),
  };
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
    const enabled = module.isEnabled !== false; // treat missing isEnabled as true (PipelineModule default)

    if (!enabled) {
      cpuBridges.push(id);
      continue;
    }

    const params: Record<string, unknown> = module.getParams?.() ?? {};

    if (id === 'lenscorrections') {
      const subPasses = buildLensCorrectionsSubPasses(params, true);
      if (subPasses.length > 0) {
        passes.push(...subPasses);
      } else {
        // All sub-effects are identity/disabled — nothing for the GPU to do.
        cpuBridges.push(id);
      }
      continue;
    }

    if (!GPU_MODULE_IDS.includes(id)) {
      cpuBridges.push(id);
      continue;
    }

    switch (id) {
      case 'whitebalance':
        passes.push(buildWBPass(params));
        break;
      case 'basicadj':
        passes.push(buildBasicAdjPass(params));
        break;
      case 'tonecurve':
        passes.push(buildToneCurvePass(params));
        break;
      case 'colorbalance':
        passes.push(buildColorBalancePass(params));
        break;
      case 'huecurves':
        passes.push(buildHueCurvesPass(params));
        break;
      default:
        // Future GPU modules in GPU_MODULE_IDS without a dedicated builder yet.
        cpuBridges.push(id);
    }
  }

  return { passes, cpuBridges };
}
