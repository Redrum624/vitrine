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
  highlightRecoveryUniforms,
  layerBlendUniforms,
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
  'highlightrecovery',
];

/**
 * Opt-in GPU modules — NOT auto-included. The pipeline must explicitly opt in.
 * 'noise-reduction' maps to the NLM denoise shader (GPU NR is expensive; user-triggered).
 */
export const OPT_IN_GPU_MODULE_IDS: readonly string[] = [
  'noise-reduction',
];

// ── GPU self-test gating ─────────────────────────────────────────────────────────
// Module IDs whose GPU shader FAILED its runtime self-test (output didn't match the CPU
// reference within tolerance). Populated once at startup from GpuPreviewPipeline.selfTest()
// via setGpuUnsafeModuleIds(). buildPassList routes these to cpuBridges so a broken GPU
// shader falls back to the proven CPU path instead of corrupting the preview (e.g. the
// tonecurve LUT pass rendering an image red). Empty until the self-test runs.
let gpuUnsafeModuleIds: ReadonlySet<string> = new Set();

/** Register the module IDs whose GPU self-test failed (called once after selfTest()). */
export function setGpuUnsafeModuleIds(ids: Iterable<string>): void {
  gpuUnsafeModuleIds = new Set(ids);
}

/** The currently-registered GPU-unsafe module IDs (mainly for tests/diagnostics). */
export function getGpuUnsafeModuleIds(): ReadonlySet<string> {
  return gpuUnsafeModuleIds;
}

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
  /**
   * Selects the compiled WebGL program for single-pass descriptors.
   * Ignored when `subPasses` is present — the pipeline executes sub-passes directly
   * without ever resolving this key.
   */
  programKey: string;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, rt: PassRuntime) => void;
  luts?: Record<string, Float32Array>;
  /**
   * Optional ordered list of sub-passes that together form ONE logical module step
   * (multi-pass module).
   *
   * When present, the pipeline executes the sub-passes instead of the top-level
   * programKey/setUniforms (those are ignored for sub-passed descriptors). The
   * module's NET output (the last sub-pass's output) becomes the chain texture for
   * the next module, preserving ping-pong correctness.
   *
   * A descriptor WITHOUT subPasses behaves exactly as before (single draw call).
   */
  subPasses?: SubPass[];
}

/**
 * A single draw within a multi-pass module step.
 *
 * Multi-INPUT binding (the load-bearing part for enhance unsharp + T10 masks):
 *   `bindings` is an ordered array of `{ texture, sampler }` pairs, one per texture unit
 *   starting at TEXTURE0. Each `texture` is either a logical name the pipeline resolves
 *   per-frame, or an already-uploaded WebGLTexture bound directly:
 *     - 'chainInput' — the chain texture AS IT ENTERED this module step (the module's
 *                      input / "original"). Preserved across all sub-passes so the final
 *                      combine can sample it (unsharp reads chainInput + the blurred scratch).
 *     - 'prev'       — the output of the immediately preceding sub-pass (or chainInput for
 *                      the first sub-pass). This is the normal ping-pong "previous texture".
 *     - 'scratch'    — the dedicated scratch texture (an extra FBO+texture the pipeline keeps
 *                      for intermediate results, e.g. the H-blur result read by the V-blur, or
 *                      the V-blur result read by the unsharp combine). Reserved for T10 mask use.
 *     - WebGLTexture — an externally-owned texture bound directly (e.g. a mask texture uploaded
 *                      by a T10 local-adjustments pass). The pipeline binds it as-is with no
 *                      ownership transfer.
 *   `sampler` gives the GLSL uniform name for that binding's texture unit.
 *   Default when omitted: a single binding `{ texture: 'prev', sampler: 'u_image' }` —
 *   the classic single-input pass.
 *
 *   `target` selects where this sub-pass writes:
 *     - 'pingpong' (default) — write to the active ping-pong FBO (advances the chain).
 *     - 'scratch'            — write to the scratch FBO (intermediate not yet the chain output).
 *
 */

/**
 * A CPU-side mask to upload+cache as an R32F texture at render time.
 *
 * The pass builder (buildLocalAdjustmentsPass) has no GL context, so it cannot create
 * the WebGLTexture itself. Instead it carries the baked Float32 mask + a stable cache
 * key + the dimensions it was baked at; GpuPreviewPipeline.render() uploads it once and
 * caches it (keyed by `key`), re-uploading only when the key changes (geometry/dims).
 *
 * `width`/`height` are the resolution the mask was baked at. The pipeline verifies they
 * match the render dimensions; a mismatch means the pass builder must rebuild the layer
 * mask (it does, via setLayerGeometry) before emitting the pass.
 */
export interface MaskUpload {
  kind: 'mask';
  /** baked per-layer mask uploaded to a GPU texture at render time; memory ∝ image size */
  data: Float32Array;
  /** Stable identity for the mask cache (e.g. `${layerId}:${w}x${h}:${geomHash}`). */
  key: string;
  width: number;
  height: number;
}

/**
 * Named logical texture, an already-uploaded WebGLTexture for direct binding, or a
 * MaskUpload the pipeline uploads+caches at render time (Task 10 local-adjustment masks).
 */
export type SubPassTexture = 'chainInput' | 'prev' | 'scratch' | WebGLTexture | MaskUpload;

export interface SubPass {
  id: string;
  programKey: string;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, rt: PassRuntime) => void;
  /**
   * Ordered texture bindings, one per unit from TEXTURE0.
   * Default (when absent): `[{ texture: 'prev', sampler: 'u_image' }]`.
   */
  bindings?: { texture: SubPassTexture; sampler: string }[];
  /** Where this sub-pass writes. Default 'pingpong'. */
  target?: 'pingpong' | 'scratch';
}

export interface PassList {
  passes: PassDescriptor[];
  cpuBridges: string[];
}

/**
 * Optional render-time context for buildPassList. Required only by the local-adjustments
 * pass (Task 10), which bakes masks at the render resolution. When omitted, an active
 * localadjustments module is treated as a cpuBridge (the routing-decision call sites that
 * don't render — e.g. tests — don't need GPU masks).
 *
 * - width/height : the render (preview) resolution masks must match.
 * - rebuildMask  : reuses the module's setLayerGeometry to rebuild a layer mask at
 *                  (w,h) when its baked length != w*h (preview vs export). Returns the
 *                  new mask or null if it has no geometry to rebuild from.
 */
export interface BuildPassOpts {
  width: number;
  height: number;
  rebuildMask?: (layerId: string, w: number, h: number) => Float32Array | null;
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
 * HighlightRecovery (M1) is a pure pointwise pass — always GPU-representable (no cross-pixel
 * gather, no dimension/dehaze). At strength 0 the shader computes identity, matching the CPU
 * module's no-op, so we build the pass unconditionally (mirrors exposure/basicadj).
 */
function buildHighlightRecoveryPass(params: Record<string, unknown>): PassDescriptor {
  const strength = typeof params.strength === 'number' && Number.isFinite(params.strength)
    ? params.strength
    : 0;
  return {
    id: 'highlightrecovery',
    programKey: 'highlightrecovery',
    setUniforms: (gl, prog, _rt) => highlightRecoveryUniforms({ strength })(gl, prog),
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

// ── Local Adjustments (Task 10 — masks on GPU) ───────────────────────────────

/**
 * Minimal view of a LocalAdjustmentLayer as it appears in the LA module's getParams().
 * Only the fields the GPU pass needs are typed; the rest are ignored.
 */
interface LayerView {
  id?: string;
  enabled?: boolean;
  opacity?: number;
  basicAdj?: BasicAdjustmentsParams;
  mask?: Float32Array;
  geometry?: { type?: string; [k: string]: unknown };
}

/**
 * Whether a layer is GPU-representable in the resident-texture pipeline.
 *
 * The CPU `process()` runs ONE of two paths per layer:
 *   - applyBasicAdjLayer  — when `layer.basicAdj` is set: runs BasicAdjustmentsModule
 *                           (the EXACT FRAG_BASICADJ shader, via the GPU fast-path) on the
 *                           running image then blends by mask*opacity. THIS is GPU-ported.
 *   - applyLayerToImage   — the legacy `parameters` path (exposure/temp/contrast/blend
 *                           modes). NOT ported to a shader → such a layer forces CPU.
 *
 * Additionally, per-layer dehaze (`basicAdj.dehaze != 0`) is NOT GPU-representable here:
 * the shared PassRuntime.dehaze is computed once from the SOURCE pixels with the main
 * basicadj's param, but a layer's dehaze must be estimated from that layer's RUNNING input
 * — a per-layer statistic the build-time pass list can't carry. So a dehaze layer → CPU.
 */
function isLayerGpuRepresentable(layer: LayerView): boolean {
  if (!layer.basicAdj) return false;                 // legacy parameters path → CPU
  if (!(layer.mask instanceof Float32Array)) return false; // no baked mask → can't upload
  if (typeof layer.basicAdj.dehaze === 'number' && Math.abs(layer.basicAdj.dehaze) > 0.001) {
    return false;                                    // per-layer dehaze → CPU
  }
  return true;
}

/** A layer is "active" (non-identity) when its basicAdj has any non-neutral value AND
 *  opacity > 0 AND it is enabled — mirroring applyBasicAdjLayer's skip conditions
 *  (disabled / opacity 0 / all-neutral basicAdj are no-ops on the CPU too). */
function isLayerActive(layer: LayerView): boolean {
  if (layer.enabled === false) return false;
  if (layer.opacity === 0) return false;
  const adj = layer.basicAdj;
  if (!adj) return false;
  return Object.values(adj).some((v) => typeof v === 'number' && Math.abs(v) > 1e-6);
}

/** Stable cache key for a layer's mask: id + dims + a hash of the baked values.
 *  The mask is rebuilt (and its reference replaced) whenever geometry/dims change, so a
 *  cheap strided sample hash is enough to detect a re-bake without scanning every pixel. */
function maskCacheKey(layer: LayerView, width: number, height: number): string {
  const m = layer.mask!;
  let h = 0;
  const step = Math.max(1, Math.floor(m.length / 64));
  for (let i = 0; i < m.length; i += step) {
    h = (h * 31 + Math.round(m[i] * 1000)) | 0;
  }
  return `${layer.id ?? 'layer'}:${width}x${height}:${m.length}:${h}`;
}

/**
 * Build a PassDescriptor for the Local Adjustments module: per ENABLED+ACTIVE layer,
 * two sub-passes that reproduce applyBasicAdjLayer's `mix(running, basicAdj(running), mask*op)`:
 *
 *   1. basicadj sub-pass — FRAG_BASICADJ on the running image (`prev`) → SCRATCH.
 *      This is the layer's "adjusted" version. Writing to scratch keeps the running
 *      image (`prev`) intact for the blend.
 *   2. blend sub-pass    — FRAG_LAYER_BLEND, bindings:
 *        u_base     ← 'prev'   (the running image, untouched by step 1)
 *        u_adjusted ← 'scratch'(step 1's output)
 *        u_mask     ← MaskUpload (the layer's baked Float32 mask, uploaded+cached by render)
 *      → PINGPONG (advances the chain). The NEXT layer's step-1 `prev` is THIS blend output,
 *      giving the exact CPU sequential semantics (layer N sees layer N-1's result).
 *
 * Returns null when no layer is GPU-representable+active (caller routes to cpuBridges).
 * If SOME layers are active but ANY active layer is not GPU-representable, also returns
 * null (whole module → CPU) so the GPU path never silently drops a layer's effect.
 *
 * @param rebuildMask  Optional callback to rebuild a layer's mask at (width,height) when its
 *                     baked length != width*height — reuses the module's setLayerGeometry
 *                     (no geometry→mask reimplementation). Returns the (possibly new) mask,
 *                     or null if it couldn't rebuild (no geometry).
 */
export function buildLocalAdjustmentsPass(
  params: Record<string, unknown>,
  width: number,
  height: number,
  rebuildMask?: (layerId: string, w: number, h: number) => Float32Array | null,
): PassDescriptor | null {
  const layers = (params.layers as LayerView[] | undefined) ?? [];
  const active = layers.filter(isLayerActive);
  if (active.length === 0) return null; // identity — nothing for GPU to do

  // If ANY active layer can't be expressed on the GPU, the whole module falls back to CPU
  // (dropping just one layer's effect would diverge silently — worse than CPU).
  if (!active.every(isLayerGpuRepresentable)) return null;

  const subPasses: SubPass[] = [];
  for (const layer of active) {
    let mask = layer.mask!;
    // Rebuild the mask at the render resolution if it was baked at a different size
    // (preview vs export) — mirrors LocalAdjustmentsModule.processImage. Uses the module's
    // own setLayerGeometry via the callback; we do NOT reimplement geometry→mask here.
    if (mask.length !== width * height && rebuildMask && layer.id) {
      const rebuilt = rebuildMask(layer.id, width, height);
      if (!(rebuilt instanceof Float32Array) || rebuilt.length !== width * height) {
        return null; // couldn't get a matching-resolution mask → CPU (don't misalign)
      }
      mask = rebuilt;
    }
    if (mask.length !== width * height) return null; // no rebuilder + mismatch → CPU

    const adj = layer.basicAdj!;
    const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1;
    const maskUpload: MaskUpload = {
      kind: 'mask', data: mask, key: maskCacheKey(layer, width, height), width, height,
    };

    // dehaze is INACTIVE for GPU-representable layers (dehaze!=0 routes to CPU above), so
    // the shared inactive dehaze state is exact. We pass it via rt.dehaze in the closure.
    subPasses.push({
      id: `localadjustments:${layer.id ?? 'layer'}:basicadj`,
      programKey: 'basicadj',
      bindings: [{ texture: 'prev', sampler: 'u_image' }],
      target: 'scratch',
      // Force an inactive dehaze state regardless of rt — a GPU layer never has dehaze.
      setUniforms: (gl, prog) => basicAdjUniforms(adj, { active: false, hazeStrength: 0, hazeDivisor: 1 })(gl, prog),
    });
    subPasses.push({
      id: `localadjustments:${layer.id ?? 'layer'}:blend`,
      programKey: 'layerblend',
      bindings: [
        { texture: 'prev',       sampler: 'u_base'     },
        { texture: 'scratch',    sampler: 'u_adjusted' },
        { texture: maskUpload,   sampler: 'u_mask'     },
      ],
      target: 'pingpong',
      setUniforms: (gl, prog) => layerBlendUniforms(opacity)(gl, prog),
    });
  }

  return {
    id: 'localadjustments',
    programKey: 'localadjustments:multi', // ignored — subPasses present
    setUniforms: () => undefined,
    subPasses,
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
export function buildPassList(modules: MinimalModule[], opts?: BuildPassOpts): PassList {
  const passes: PassDescriptor[] = [];
  const cpuBridges: string[] = [];

  for (const module of modules) {
    const id = module.getId();
    const enabled = module.isEnabled !== false; // treat missing isEnabled as true

    if (!enabled) {
      cpuBridges.push(id);
      continue;
    }

    // GPU self-test failed for this module's shader → run it on the CPU instead of
    // drawing a broken result. When this module is actually active, the CPU-bridge makes
    // choosePreviewPath fall the whole frame back to the proven CPU pipeline.
    if (gpuUnsafeModuleIds.has(id)) {
      cpuBridges.push(id);
      continue;
    }

    const params: Record<string, unknown> = module.getParams?.() ?? {};

    if (id === 'localadjustments') {
      // GPU only when render dims are known (opts) AND every active layer is
      // GPU-representable (has basicAdj, a baked mask, no per-layer dehaze). Otherwise
      // the whole module runs on the CPU so no layer's effect is silently dropped.
      const laPass = opts
        ? buildLocalAdjustmentsPass(params, opts.width, opts.height, opts.rebuildMask)
        : null;
      if (laPass) passes.push(laPass);
      else cpuBridges.push(id);
      continue;
    }

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
      case 'highlightrecovery':
        passes.push(buildHighlightRecoveryPass(params));
        break;
      default:
        // Future GPU modules in GPU_MODULE_IDS without a dedicated builder yet.
        cpuBridges.push(id);
    }
  }

  return { passes, cpuBridges };
}

