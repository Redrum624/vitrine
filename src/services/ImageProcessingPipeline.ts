import { logger } from '../utils/Logger';
import { LRUCache } from '../utils/LRUCache';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { ExposureModule } from '../modules/ExposureModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../modules/ShadowsHighlightsPipelineModule';
import { HighlightRecoveryPipelineModule } from '../modules/HighlightRecoveryModule';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { enhanceModule } from '../modules/EnhanceModule';
import type { WorkerModuleConfig, WorkerImageData, ProcessingResult } from './WebWorkerImageProcessor';

/**
 * Worker-pool delegate, INJECTED rather than imported.
 *
 * This module is the entry graph of pipeline.worker.ts. A value import of
 * webWorkerImageProcessor here would drag the pool manager — and its own
 * worker factory (`./pipeline.worker?worker&url`) — into the worker bundle,
 * making the worker chunk reference itself at build time. The pool registers
 * itself via setWorkerPool() at ITS module evaluation (WebWorkerImageProcessor
 * is value-imported by the renderer, e.g. AdjustmentPanel). Inside a worker no
 * registration ever happens — workerPool stays null and every pass runs on the
 * worker's own thread, exactly the intended useWebWorkers=false path.
 */
export interface WorkerPoolLike {
  shouldUseWorkers(imageData: WorkerImageData): boolean;
  processImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[]): Promise<ProcessingResult>;
}

let workerPool: WorkerPoolLike | null = null;

export function setWorkerPool(pool: WorkerPoolLike): void {
  workerPool = pool;
}

// Module-specific param interfaces for type-safe identity checks
interface CurveNode {
  x: number;
  y: number;
}

interface ToneCurveParams {
  baseCurve?: CurveNode[];
  autoLevels?: boolean;
  autoContrast?: boolean;
  exposureFusion?: number;
  rgbCurve?: {
    red?: CurveNode[];
    green?: CurveNode[];
    blue?: CurveNode[];
  };
}

interface ColorRange {
  cyan_red?: number;
  magenta_green?: number;
  yellow_blue?: number;
}

interface ColorBalanceParams {
  shadows?: ColorRange;
  midtones?: ColorRange;
  highlights?: ColorRange;
  [key: string]: unknown; // For dynamic color properties like red_saturation, etc.
}

interface WhiteBalanceParams {
  temperature?: number;
  tint?: number;
}

interface ModuleWithEnabledParams {
  enabled?: boolean;
}

export interface ProcessingContext {
  width: number;
  height: number;
  channels: number;
  /** Full-image Sobel-gradient max for the enhance edge mask, threaded ONLY on the tiled CPU
   *  worker path (WebWorkerImageProcessor → pipeline.worker PROCESS_TILE) so every tile's edgeMask
   *  normalises by the same global constant (seam-free sharpen gain). Absent on the whole-image /
   *  main-thread path — edgeMask then uses its own buffer max (byte-identical to before). */
  edgeMaskGlobalMax?: number;
  /** v1.36.0 C5 (WYSIWYG kernels): `processingLongEdge / nativeLongEdge` of this PASS, derived
   *  once at pass-build (enhanceKernelScale). Sub-native preview passes set it (<1) so the
   *  enhance sharpen kernels scale down to match what the native-resolution export produces.
   *  Absent/1 = native semantics — exports and bake develop passes never set it, keeping their
   *  output bit-identical. Threaded to workers via WorkerImageData (full-pass value, NEVER
   *  re-derived from tile dims — same out-of-band rule as edgeMaskGlobalMax). */
  kernelScale?: number;
  /** True when this pass produces an EXPORT buffer (ExportDialog / MultiExportService). Modules may
   *  use it to skip diagnostics-only work — e.g. NoiseReductionModule's logQualityMetrics runs two
   *  full-buffer O(n) loops that are pure logging; at export resolution that is measurable waste.
   *  Never changes pixel output. */
  isExport?: boolean;
}

/** Trailing options for {@link ImageProcessingPipeline.processImage}. Replaces the
 *  former `(input, context, useWebWorkers, onProgress, cacheResults)` positional tail —
 *  a call site that reads `..., false, undefined, false)` is otherwise opaque. */
export interface ProcessImageOptions {
  /** Route large images through the Web Worker pool (default true). Exports force `false`. */
  useWebWorkers?: boolean;
  /** Per-module progress callback (export path yields between modules). */
  onProgress?: (completed: number, total: number) => void;
  /** Park each module's full-resolution result in the module cache (default true).
   *  Exports pass `false` to avoid hundreds of MB of cached buffers at 24MP+. */
  cacheResults?: boolean;
}

export interface PipelineModule {
  getId(): string;
  getName(): string;
  process(input: Float32Array, context: ProcessingContext): Float32Array;
  isEnabled?: boolean;
  getParams?(): Record<string, unknown>;
  resetParams?(): void;
}

/** Adapter shape returned by getOrderedModules() — consumed by the GPU pass builder. */
export interface OrderedModuleAdapter {
  getId(): string;
  isEnabled?: boolean;
  getParams(): Record<string, unknown>;
  getGpuLuts?(): { master: Float32Array; red: Float32Array; green: Float32Array; blue: Float32Array } | null;
}

export class ImageProcessingPipeline {
  private modules: Map<string, PipelineModule> = new Map();
  private processingOrder: string[] = [];
  // LRU cache with 100 entry limit and 500MB memory limit (prevents memory leaks)
  private moduleCache: LRUCache<{ params: string; result: Float32Array; context: ProcessingContext }>;

  constructor() {
    // Initialize LRU cache with smart eviction
    this.moduleCache = new LRUCache<{ params: string; result: Float32Array; context: ProcessingContext }>({
      maxSize: 100, // Maximum 100 cached results
      maxMemory: 500 * 1024 * 1024, // 500MB memory limit
      onEvict: (key, value) => {
        const cachedValue = value as { params: string; result: Float32Array; context: ProcessingContext };
        logger.debug(`Pipeline cache evicted: ${key} (size: ${cachedValue.result.byteLength} bytes)`);
      }
    });

    this.initializeModules();
    logger.info('ImageProcessingPipeline initialized with LRU cache (max: 100 entries, 500MB)');
  }

  private initializeModules(): void {
    // Initialize modules in processing order
    // Geometric operations MUST come first before color/tone adjustments
    const cropModule = new CropPipelineModule();
    const lensCorrectionsModule = new LensCorrectionsPipelineModule();
    const exposureModule = new ExposureModule();
    const highlightRecoveryModule = new HighlightRecoveryPipelineModule();
    const whiteBalanceModule = new WhiteBalanceModule();
    const basicAdjModule = new BasicAdjustmentsModule();
    const toneCurveModule = new ToneCurvePipelineModule();
    const colorBalanceModule = new ColorBalancePipelineModule();
    const shadowsHighlightsModule = new ShadowsHighlightsPipelineModule();
    const localAdjustmentsModule = new LocalAdjustmentsPipelineModule();
    const noiseReductionModule = new NoiseReductionModule();
    // Pipeline order: Geometric → Color/Tone → Denoise → Enhance → Tone Recovery → Local
    // Note: Transform (rotate/flip) is now integrated into CropModule
    this.addModule(cropModule, 0); // First - crop/transform (unified)
    this.addModule(lensCorrectionsModule, 1); // Second - lens corrections (geometric)
    this.addModule(exposureModule, 2); // Third - exposure correction
    this.addModule(highlightRecoveryModule, 3); // Fourth - highlight reconstruction (M1, near-decode, before tone)
    this.addModule(whiteBalanceModule, 4); // Fifth - white balance
    this.addModule(basicAdjModule, 5); // Sixth - basic adjustments
    this.addModule(toneCurveModule, 6); // Seventh - tone curve
    this.addModule(colorBalanceModule, 7); // Eighth - color balance
    this.addModule(noiseReductionModule, 8); // Ninth - noise reduction (before enhance so it isn't amplified)
    this.addModule(enhanceModule, 9); // Tenth - enhance (sharpen/deblur, after denoise)
    this.addModule(shadowsHighlightsModule, 10); // Eleventh - shadows/highlights recovery
    this.addModule(localAdjustmentsModule, 11); // Twelfth - local adjustments

    logger.info('Image processing pipeline initialized with 12 modules:', this.processingOrder);
  }

  addModule(module: PipelineModule, position?: number): void {
    const moduleId = module.getId();
    this.modules.set(moduleId, module);

    if (position !== undefined && position >= 0 && position <= this.processingOrder.length) {
      this.processingOrder.splice(position, 0, moduleId);
    } else {
      this.processingOrder.push(moduleId);
    }

    logger.debug(`Module added: ${module.getName()} (${moduleId}) at position ${position ?? this.processingOrder.length - 1}`);
  }

  removeModule(moduleId: string): boolean {
    const removed = this.modules.delete(moduleId);
    if (removed) {
      const index = this.processingOrder.indexOf(moduleId);
      if (index > -1) {
        this.processingOrder.splice(index, 1);
      }
      logger.debug(`Module removed: ${moduleId}`);
    }
    return removed;
  }

  getModule<T extends PipelineModule>(moduleId: string): T | undefined {
    return this.modules.get(moduleId) as T;
  }

  getModules(): Map<string, PipelineModule> {
    return new Map(this.modules);
  }

  getProcessingOrder(): string[] {
    return [...this.processingOrder];
  }

  /**
   * Ordered, GPU-pass-list-ready view of the pipeline modules (in processing order).
   *
   * Returned for the resident-texture GPU preview path: `buildPassList()` consumes an
   * array of `{ getId, isEnabled, getParams, getGpuLuts? }`. We return lightweight
   * adapters (NOT the raw modules) so this method can normalise per-module param
   * shapes WITHOUT leaking pipeline internals or reaching into private fields:
   *
   *  - `lenscorrections`: its own `getParams()` nests the sub-effect objects under a
   *    `lensCorrections` key, but `buildLensCorrectionsSubPasses()` reads
   *    `params.distortion / .chromaticAberration / .vignetting` at the top level.
   *    The adapter lifts the nested object to the top so the GPU builder sees the
   *    right shape (and the builder's own tests, which use the flat shape, stay valid).
   *  - every other module forwards `getParams()` unchanged.
   *  - `getGpuLuts` is forwarded when present (tone curve) so the builder can attach LUTs.
   *
   * Identity ("nothing to do") modules are NOT filtered here — `buildPassList()` already
   * skips disabled modules and emits no passes for identity sub-effects; an enabled but
   * neutral module simply produces an identity pass (cheap) or a cpuBridge entry.
   */
  getOrderedModules(): OrderedModuleAdapter[] {
    const adapters: OrderedModuleAdapter[] = [];

    for (const moduleId of this.processingOrder) {
      const module = this.modules.get(moduleId);
      if (!module) continue;

      const moduleWithLuts = module as PipelineModule & {
        getGpuLuts?(): { master: Float32Array; red: Float32Array; green: Float32Array; blue: Float32Array } | null;
      };

      adapters.push({
        getId: () => moduleId,
        get isEnabled() { return module.isEnabled; },
        getParams: () => {
          const params = this.getModuleParams(module, moduleId);
          // Lift lenscorrections' nested sub-effects to the top level for the builder.
          if (moduleId === 'lenscorrections' && params.lensCorrections && typeof params.lensCorrections === 'object') {
            return { ...(params.lensCorrections as Record<string, unknown>), enabled: params.enabled };
          }
          return params;
        },
        getGpuLuts: typeof moduleWithLuts.getGpuLuts === 'function'
          ? () => moduleWithLuts.getGpuLuts!()
          : undefined,
      });
    }

    return adapters;
  }

  /**
   * Public predicate: does this module actually change pixels in the current state?
   *
   * "Active" = registered, enabled (isEnabled !== false), AND non-identity (its params
   * are not at the neutral/default no-op values). Mirrors the exact gate the CPU
   * `processImage` loop uses to decide whether to run a module, so callers outside the
   * pipeline (the GPU routing in AdjustmentPanel) can make the SAME enabled+non-identity
   * decision the plan specifies — WITHOUT reaching into private fields.
   *
   * This is the load-bearing fix for the GPU live path: `buildPassList()` maps every
   * CPU-only module id (crop, exposure, enhance, shadowshighlights, localadjustments,
   * noise-reduction) to `cpuBridges` purely by id, even when that module is at its
   * default/identity state. With all 11 modules registered, `cpuBridges` would never be
   * empty and the GPU path would never fire. AdjustmentPanel filters the cpuBridges
   * through this predicate so only modules that are genuinely doing CPU-only work block
   * the GPU path — an inactive (identity) crop/enhance/etc. does not.
   *
   * Unknown module id → false (not active).
   */
  isModuleActive(moduleId: string): boolean {
    const module = this.modules.get(moduleId);
    if (!module) return false;
    if (module.isEnabled === false) return false;
    return !this.isModuleIdentity(module);
  }

  setModuleEnabled(moduleId: string, enabled: boolean): void {
    const module = this.modules.get(moduleId);
    if (module) {
      // setEnabled-first ladder with a guarded assignment fallback (mirrors applyWorkerConfig).
      // lenscorrections/localadjustments expose `isEnabled` as a GETTER-ONLY accessor (derived
      // from their params) — a bare `module.isEnabled = enabled` throws a TypeError in strict mode,
      // which callers like PresetService swallow, aborting the whole module apply BEFORE its
      // params are set. The try/catch keeps enablement side-effect-free for those modules (their
      // setParams/setParameters restores the real derived-enabled state).
      const withEnable = module as PipelineModule & { setEnabled?(b: boolean): void };
      if (typeof withEnable.setEnabled === 'function') {
        withEnable.setEnabled(enabled);
      } else {
        try { module.isEnabled = enabled; } catch { /* getter-only isEnabled */ }
      }
      // Clear cache for this module and all subsequent modules
      this.invalidateCacheFromModule(moduleId);
      logger.debug(`Module ${moduleId} ${enabled ? 'enabled' : 'disabled'} - cache invalidated`);
    }
  }

  // Public method to invalidate cache when parameters change externally
  invalidateModuleCache(moduleId: string): void {
    logger.info(`🗑️ MANUAL CACHE INVALIDATION for module: ${moduleId}`);
    const sizeBefore = this.moduleCache.size();
    this.invalidateCacheFromModule(moduleId);
    const sizeAfter = this.moduleCache.size();
    logger.debug(`  Cache size: ${sizeBefore} → ${sizeAfter} (cleared ${sizeBefore - sizeAfter} entries)`);
  }

  // Check if module parameters have default/identity values
  private isModuleIdentity(module: PipelineModule): boolean {
    try {
      const params = this.getModuleParams(module, module.getId());
      const moduleId = module.getId();

      // Module-specific identity checks with correct defaults
      switch (moduleId) {
        case 'tonecurve': {
          const tc = params as ToneCurveParams;
          // Check if curve is linear (identity transformation)
          if (!tc.baseCurve || tc.baseCurve.length < 2) return false;

          // For a truly linear curve, ALL points must lie on y=x line
          const isLinear = tc.baseCurve.every((node: CurveNode) => {
            if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return false;
            // Check if point lies on y=x line (with small tolerance)
            return Math.abs(node.x - node.y) < 0.01;
          });

          const noAuto = !tc.autoLevels && !tc.autoContrast;
          const noFusion = !tc.exposureFusion || tc.exposureFusion === 0;

          // Also check RGB curves are linear
          const rgbLinear = (!tc.rgbCurve ||
            (this.isCurveLinear(tc.rgbCurve.red) &&
             this.isCurveLinear(tc.rgbCurve.green) &&
             this.isCurveLinear(tc.rgbCurve.blue)));

          return isLinear && rgbLinear && noAuto && noFusion;
        }

        case 'colorbalance': {
          const cb = params as ColorBalanceParams;
          // Check all color ranges are at 0
          const checkRange = (range: ColorRange | undefined) => {
            if (!range) return true;
            return (range.cyan_red === 0 || range.cyan_red === undefined) &&
                   (range.magenta_green === 0 || range.magenta_green === undefined) &&
                   (range.yellow_blue === 0 || range.yellow_blue === undefined);
          };
          const shadowsNeutral = checkRange(cb.shadows);
          const midtonesNeutral = checkRange(cb.midtones);
          const highlightsNeutral = checkRange(cb.highlights);

          // Check global color controls if they exist
          const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
          const globalNeutral = colors.every(c => {
            const sat = cb[`${c}_saturation`];
            const lum = cb[`${c}_luminance`];
            const hue = cb[`${c}_hue`];
            return (sat === undefined || sat === 0) &&
                   (lum === undefined || lum === 0) &&
                   (hue === undefined || hue === 0);
          });

          return shadowsNeutral && midtonesNeutral && highlightsNeutral && globalNeutral;
        }

        case 'temperature': {
          const wb = params as WhiteBalanceParams;
          // 6500K is D65 reference (identity / no correction), tint 0 is neutral
          const tempNeutral = Math.abs((wb.temperature ?? 6500) - 6500) < 10;
          const tintNeutral = Math.abs(wb.tint ?? 0) < 0.1;
          return tempNeutral && tintNeutral;
        }

        case 'exposure': {
          // ExposureModule.process() applies ONLY `exposure` (2^ev multiplier) and `black`
          // (level subtraction); the deflicker_* params are inert on the pipeline path
          // (processWithAutoDeflicker is a separate API). The generic all-zero fallback wrongly
          // marked the DEFAULT state non-identity (deflicker_percentile 50, target level -4), so
          // every unedited preview/export ran a full-buffer no-op exposure pass — and the
          // zero-active-modules identity fast path below could never fire (R5, 2026-07-20).
          const p = params as { exposure?: number; black?: number };
          if (Math.abs(p.exposure ?? 0) >= 0.001 || Math.abs(p.black ?? 0) >= 0.001) return false;
          // The default-params pass is still LOAD-BEARING when lens vignetting is active
          // (W3 fix round 1, finding M1): pipeline order is crop(0) → lens(1) → exposure(2),
          // and pre-W3 the always-run exposure pass clamped every pixel to [0,1] here.
          // Vignetting correction is the pipeline's ONLY upstream producer of >1 values (its
          // multiplicative factor is unclamped, up to 1 + 9·strength at the corners; film grain
          // clamps its own output, resampling is convex, everything else runs after exposure).
          // Skipping the pass would leak >1 values into every downstream module and change
          // pre-W3 output bytes. Clamping inside the vignetting module instead would alter
          // behaviour when exposure is NOT at defaults and require a matching GPU-shader
          // change — wrong altitude; keep the clamp where it always lived.
          return !this.lensVignettingActive();
        }

        case 'basicadj': {
          // All numeric parameters should be 0 for identity
          return Object.entries(params).every(([key, val]) => {
            if (key === 'enabled' || typeof val !== 'number') return true;
            return Math.abs(val as number) < 0.001;
          });
        }

        case 'shadowshighlights': {
          // Delegate to ShadowsHighlightsPipelineModule.isNoOp() so the neutral
          // condition is single-sourced (mirrors the pass-through check in process()).
          // NOTE: neutral means shadows=50, highlights=50, all offsets=0.
          // maskBlur/strength/iterations are NOT identity criteria on their own —
          // blurring a zero-effect mask still yields zero net change.
          const shPipeline = module as ShadowsHighlightsPipelineModule;
          return shPipeline.isNoOp();
        }

        case 'highlightrecovery': {
          // Highlight reconstruction is opt-in (default strength 0). Delegate to isNoOp()
          // so strength 0 / disabled short-circuits to a byte-identical passthrough. The
          // generic default check would ALSO work (strength is the only numeric), but the
          // explicit case single-sources the neutral condition with the module.
          const hrModule = module as unknown as { isNoOp(): boolean };
          return hrModule.isNoOp();
        }

        case 'noise-reduction': {
          // Noise Reduction is opt-in (default enabled:false) and only runs after the
          // explicit "Apply" button. When not enabled it MUST be skipped — otherwise
          // it runs on every unedited export, and its full-resolution GPU pass
          // corrupts (the "export is just noise" bug). Its numeric defaults are
          // non-zero, so the generic all-zero check below would wrongly run it.
          return (params as ModuleWithEnabledParams).enabled === false
            || (params as ModuleWithEnabledParams).enabled === undefined;
        }

        case 'enhance': return enhanceModule.isIdentity();

        case 'crop': {
          // A crop is identity when the rect is full-frame AND there is no rotation/flip.
          // Delegate to CropPipelineModule.isNoOp() so the condition is single-sourced.
          const cropPipeline = module as CropPipelineModule;
          return cropPipeline.isNoOp();
        }

        case 'transform':
        case 'lenscorrections':
        case 'localadjustments': {
          // For new modules with enabled parameter
          const moduleParams = params as ModuleWithEnabledParams;
          // If explicitly disabled or enabled property is false, treat as identity
          if (moduleParams.enabled === false) return true;
          // If enabled is true, module should process (not identity)
          return false;
        }

        default:
          // For unknown modules, check if all numeric params are 0
          return Object.entries(params).every(([key, val]) => {
            if (key === 'enabled' || typeof val !== 'number') return true;
            return Math.abs(val as number) < 0.001;
          });
      }
    } catch (error) {
      logger.warn(`Identity check failed for module ${module.getId()}:`, error);
      return false; // Process on error
    }
  }

  /** True when the lens-corrections module would actually run its vignetting pass
   *  (module enabled, vignetting section enabled, amount ≠ 0) — the only module upstream of
   *  exposure that produces values > 1. Used by the exposure identity check above: the
   *  default-params exposure pass doubles as the pipeline's [0,1] clamp and must not be
   *  skipped while such values can reach it. Reads the same param shape on both the renderer
   *  pipeline and the worker pipeline (applyWorkerConfig round-trips lensCorrectionsParams),
   *  so worker/main parity holds. */
  private lensVignettingActive(): boolean {
    const lens = this.modules.get('lenscorrections');
    if (!lens || lens.isEnabled === false) return false;
    const lensParams = this.getModuleParams(lens, 'lenscorrections') as {
      enabled?: boolean;
      lensCorrectionsParams?: { vignetting?: { enabled?: boolean; amount?: number } };
    };
    if (lensParams.enabled === false) return false;
    const vignetting = lensParams.lensCorrectionsParams?.vignetting;
    return vignetting?.enabled === true && (vignetting.amount ?? 0) !== 0;
  }

  // Helper method to check if a curve array represents a linear (identity) transformation
  private isCurveLinear(curve: CurveNode[] | undefined): boolean {
    if (!curve || curve.length < 2) return true;
    return curve.every((node: CurveNode) =>
      node && typeof node.x === 'number' && typeof node.y === 'number' &&
      Math.abs(node.x - node.y) < 0.01
    );
  }

  // Generate cache key for module parameters (used by the main-thread cache check below)
  private getModuleCacheKey(module: PipelineModule): string {
    const params = this.getModuleParams(module, module.getId());
    return JSON.stringify(params);
  }

  // Invalidate cache from a specific module onwards
  private invalidateCacheFromModule(moduleId: string): void {
    const moduleIndex = this.processingOrder.indexOf(moduleId);
    if (moduleIndex === -1) {
      logger.warn(`Cannot invalidate cache: module ${moduleId} not found in processing order`);
      return;
    }

    // Clear cache for this module and all subsequent modules
    const clearedModules: string[] = [];
    for (let i = moduleIndex; i < this.processingOrder.length; i++) {
      const moduleToDelete = this.processingOrder[i];
      if (this.moduleCache.delete(moduleToDelete)) {
        clearedModules.push(moduleToDelete);
      }
    }

    if (clearedModules.length > 0) {
      logger.debug(`  Cleared cache for modules: ${clearedModules.join(', ')}`);
    }
  }

  // Context change detection method removed for now - will be re-added when needed

  async processImage(
    input: Float32Array,
    context: ProcessingContext,
    options: ProcessImageOptions = {},
  ): Promise<Float32Array> {
    const { useWebWorkers = true, onProgress, cacheResults = true } = options;
    const imageData = {
      width: context.width,
      height: context.height,
      data: input,
      channels: context.channels
    };

    // For small preview images, always use main thread to avoid worker overhead
    const imageSize = context.width * context.height;
    const isSmallPreview = imageSize < 256 * 256; // Less than 256x256 pixels

    // Check if we should use Web Workers for performance
    if (useWebWorkers && !isSmallPreview && workerPool && workerPool.shouldUseWorkers(imageData)) {
      return this.processWithWebWorkers(input, context, cacheResults);
    } else {
      return this.processOnMainThread(input, context, onProgress, cacheResults);
    }
  }

  // W4 R2: `cacheResults` is threaded through so the MAIN-THREAD FALLBACKS below honor the
  // caller's caching intent — before this, a bake/export develop pass whose worker run failed
  // fell back via processOnMainThread(input, context) and silently re-enabled caching, parking
  // full-resolution module results after all. The worker path itself never touches moduleCache.
  private async processWithWebWorkers(input: Float32Array, context: ProcessingContext, cacheResults = true): Promise<Float32Array> {
    if (!workerPool) {
      // No pool registered (worker scope, or tests) — stay on this thread.
      return this.processOnMainThread(input, context, undefined, cacheResults);
    }

    try {
      // Build pipeline configuration for workers
      const pipeline: WorkerModuleConfig[] = [];

      for (const moduleId of this.processingOrder) {
        const module = this.modules.get(moduleId);

        if (!module) {
          logger.warn(`Module not found: ${moduleId}`);
          continue;
        }

        const isEnabled = module.isEnabled !== false;
        const params = this.getModuleParams(module, moduleId);

        pipeline.push({
          moduleId,
          enabled: isEnabled,
          params
        });
      }

      // Process with Web Workers
      const imageData = {
        width: context.width,
        height: context.height,
        data: input,
        channels: context.channels,
        // C5: full-pass kernel scale rides to the worker (single/tiled) so the enhance sharpen
        // kernels compensate for a sub-native preview there too. Undefined → native semantics.
        kernelScale: context.kernelScale
      };

      const result = await workerPool.processImage(imageData, pipeline);

      if (!result.success) {
        logger.warn('Web Worker processing failed, falling back to main thread');
        return this.processOnMainThread(input, context, undefined, cacheResults);
      }

      // Mirror the main-thread contract: CropModule mutates context.width/height in place, and the
      // worker's local context mutation dies at the structured-clone boundary — the pool returns
      // the TRUE output dims instead (PROCESS_COMPLETE outputWidth/outputHeight; undefined on the
      // tiled path, which never changes dims). Write them back into the CALLER's context so export
      // callers reading `context.width/height` after processImage stay correct (the v1.30.0
      // cropped-export corruption class). Guarded by a buffer-conservation check first (v1.32.0
      // ethos): a result whose length disagrees with its claimed dims falls back to main thread.
      const outW = typeof result.width === 'number' ? result.width : context.width;
      const outH = typeof result.height === 'number' ? result.height : context.height;
      if (result.data.length !== outW * outH * context.channels) {
        logger.error(
          `Worker result length ${result.data.length} does not match claimed dims ` +
          `${outW}x${outH}x${context.channels} — falling back to main thread`,
        );
        return this.processOnMainThread(input, context, undefined, cacheResults);
      }
      context.width = outW;
      context.height = outH;
      return result.data;

    } catch (error) {
      logger.error('Web Worker processing error, falling back to main thread:', error);
      return this.processOnMainThread(input, context, undefined, cacheResults);
    }
  }

  private async processOnMainThread(
    input: Float32Array,
    context: ProcessingContext,
    onProgress?: (completed: number, total: number) => void,
    cacheResults = true,
  ): Promise<Float32Array> {
    // Pre-count the modules that will actually run (enabled AND non-identity). Two uses:
    //  - ZERO active modules → return the input as-is, skipping the defensive full-buffer copy
    //    below. Nothing runs, so nothing can mutate the buffer — an identity export of a 20MP+
    //    image no longer pays a ~320MB Float32 copy for nothing. Callers treat the result as
    //    read-only either way (they encode it or blit it).
    //  - progress reporting (export path): a meaningful done/total fraction.
    let progressTotal = 0;
    let progressDone = 0;
    for (const id of this.processingOrder) {
      const m = this.modules.get(id);
      if (m && m.isEnabled !== false && !this.isModuleIdentity(m)) progressTotal++;
    }
    if (progressTotal === 0) {
      logger.warn('No modules were processed - image unchanged');
      return input;
    }

    let currentData: Float32Array = new Float32Array(input);

    // Track processing statistics
    let modulesProcessed = 0;
    const reportProgress = async (yieldToEventLoop: boolean) => {
      if (!onProgress) return;
      progressDone++;
      onProgress(progressDone, progressTotal);
      // Only yield after real (non-cached) module work — a macrotask lets React
      // paint the bar/closed modal between heavy full-resolution passes.
      if (yieldToEventLoop) await new Promise<void>((resolve) => setTimeout(resolve));
    };

    try {
      for (const moduleId of this.processingOrder) {
        const module = this.modules.get(moduleId);

        if (!module) {
          continue;
        }

        // Check if module is enabled (default to true if not specified)
        const isEnabled = module.isEnabled !== false;
        if (!isEnabled) {
          continue;
        }

        // Smart skipping: check if module has identity parameters
        if (this.isModuleIdentity(module)) {
          continue;
        }


        // Check cache for this module
        const cacheKey = this.getModuleCacheKey(module);
        const cached = this.moduleCache.get(moduleId);

        if (cached &&
            cached.params === cacheKey &&
            cached.context.width === context.width &&
            cached.context.height === context.height &&
            cached.context.channels === context.channels &&
            // C5: a pass at the same dims but a different kernel scale (e.g. a quality-ratchet
            // native pass vs a same-size export) must not reuse a differently-sharpened result.
            cached.context.kernelScale === context.kernelScale &&
            cached.result.length === currentData.length) {
          // Use cached result
          logger.debug(`Module ${module.getName()} used cached result`);
          currentData = new Float32Array(cached.result);
          await reportProgress(false);
          continue;
        }

        try {
          logger.debug(`Processing module: ${module.getName()}`);
          // Buffer-conservation guard (v1.32.0): a module's output MUST match
          // the (possibly module-mutated, e.g. crop) context dims. A defective
          // module once returned a quarter-resolution buffer here and every
          // downstream stage — and the export encoder — trusted it, shredding
          // the output. A lying module is now skipped loudly instead.
          const preW = context.width, preH = context.height, preC = context.channels;
          const produced = module.process(currentData, context);
          const expectedLen = context.width * context.height * context.channels;
          if (produced.length !== expectedLen) {
            logger.error(
              `Module ${module.getName()} returned ${produced.length} floats but context says ` +
              `${context.width}x${context.height}x${context.channels} (${expectedLen}) — skipping its output`,
            );
            context.width = preW; context.height = preH; context.channels = preC;
          } else {
            currentData = produced;
          }
          modulesProcessed++;

          // Cache the result for future use with size tracking. Skipped on the
          // export path (cacheResults=false): a full-resolution result is a
          // ~hundreds-of-MB Float32 copy per module that would evict the
          // preview-size entries the slider-drag fast path relies on and stay
          // resident long after the export finishes.
          if (cacheResults) {
            const resultSize = currentData.byteLength;
            this.moduleCache.set(
              moduleId,
              {
                params: cacheKey,
                result: new Float32Array(currentData),
                context: { ...context }
              },
              resultSize
            );
          }

        } catch (error) {
          logger.error(`Error in module ${module.getName()}:`, error);
          // Continue with previous data on error
        }

        await reportProgress(true);
      }

      // Only log if there were issues
      if (modulesProcessed === 0) {
        logger.warn('No modules were processed - image unchanged');
      }

      return currentData;

    } catch (error) {
      logger.error('Fatal error in image processing pipeline:', error);
      return input; // Return original on fatal error
    }
  }

  private getModuleParams(module: PipelineModule, moduleId: string): Record<string, unknown> {
    // Extract parameters from different module types
    try {
      logger.debug(`Getting params for module ${moduleId}`);

      // First, try the direct getParams method (most common)
      if (typeof module.getParams === 'function') {
        const params = module.getParams();
        logger.debug(`Direct getParams for ${moduleId}:`, params);
        return params;
      }

      // Handle pipeline adapter modules (if they exist)
      const moduleWithGetter = module as PipelineModule & {
        getExposureModule?(): { getParams(): Record<string, unknown> };
        getWhiteBalanceModule?(): { getParams(): Record<string, unknown> };
        getBasicAdjustmentsModule?(): { getParams(): Record<string, unknown> };
        getToneCurveModule?(): { getParams(): Record<string, unknown> };
        getColorBalanceModule?(): { getParams(): Record<string, unknown> };
        getShadowsHighlightsModule?(): { getParams(): Record<string, unknown> };
        getParameters?(): Record<string, unknown>;
      };

      // Handle pipeline adapter modules
      if (moduleWithGetter.getExposureModule) {
        const params = moduleWithGetter.getExposureModule().getParams();
        logger.debug(`Adapter getExposureModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getWhiteBalanceModule) {
        const params = moduleWithGetter.getWhiteBalanceModule().getParams();
        logger.debug(`Adapter getWhiteBalanceModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getBasicAdjustmentsModule) {
        const params = moduleWithGetter.getBasicAdjustmentsModule().getParams();
        logger.debug(`Adapter getBasicAdjustmentsModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getToneCurveModule) {
        const params = moduleWithGetter.getToneCurveModule().getParams();
        logger.debug(`Adapter getToneCurveModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getColorBalanceModule) {
        const params = moduleWithGetter.getColorBalanceModule().getParams();
        logger.debug(`Adapter getColorBalanceModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getShadowsHighlightsModule) {
        const params = moduleWithGetter.getShadowsHighlightsModule().getParams();
        logger.debug(`Adapter getShadowsHighlightsModule for ${moduleId}:`, params);
        return params;
      }
      if (moduleWithGetter.getParameters) {
        const params = moduleWithGetter.getParameters();
        logger.debug(`Adapter getParameters for ${moduleId}:`, params);
        return params;
      }

      // No parameter getter found
      logger.warn(`No parameter getter found for module ${moduleId}`);
      return {};

    } catch (error) {
      logger.warn(`Failed to get params for module ${moduleId}:`, error);
      return {};
    }
  }

  /**
   * Apply a WorkerModuleConfig[] (the exact shape produced by processWithWebWorkers)
   * back onto this pipeline's registered modules: set each module's params + enabled
   * flag so a subsequent processImage(..., useWebWorkers=false) reproduces the
   * configured edit. This is the INVERSE of getModuleParams and is the ONLY place
   * config→module mapping lives — the pipeline.worker.ts module worker calls this so
   * it runs the REAL modules with NO duplicated pixel math.
   *
   * Setter shapes mirror getModuleParams' getter shapes:
   *  - setParams(params)        → temperature(WB), basicadj, tonecurve(adapter),
   *                               colorbalance(adapter), shadowshighlights(adapter),
   *                               noise-reduction, enhance, crop(adapter)
   *  - setCurrentParams(params) → exposure
   *  - setParameters(params)    → lenscorrections, localadjustments
   * Each module also gets its enabled flag set via setEnabled(b) when present, else
   * the public `isEnabled` field is assigned directly.
   */
  applyWorkerConfig(config: WorkerModuleConfig[]): void {
    for (const { moduleId, enabled, params } of config) {
      const module = this.modules.get(moduleId);
      if (!module) {
        logger.warn(`applyWorkerConfig: module not found: ${moduleId}`);
        continue;
      }

      // Apply enabled flag. setEnabled() when present; else assign the public field.
      // localadjustments / lenscorrections expose isEnabled as a getter-only accessor
      // (no setter) that derives enablement from their params — setParameters() below
      // restores it, so a direct assignment (which would throw in strict mode) is
      // skipped for them via the try/catch.
      const withEnable = module as PipelineModule & { setEnabled?(b: boolean): void };
      if (typeof withEnable.setEnabled === 'function') {
        withEnable.setEnabled(enabled);
      } else {
        try { module.isEnabled = enabled; } catch { /* getter-only isEnabled */ }
      }

      // Apply params via the module's own setter (heterogeneous across modules).
      const withSetters = module as PipelineModule & {
        setParams?(p: Record<string, unknown>): void;
        setParameters?(p: Record<string, unknown>): void;
        setCurrentParams?(p: Record<string, unknown>): void;
      };
      if (typeof withSetters.setParams === 'function') {
        withSetters.setParams(params);
      } else if (typeof withSetters.setParameters === 'function') {
        withSetters.setParameters(params);
      } else if (typeof withSetters.setCurrentParams === 'function') {
        withSetters.setCurrentParams(params);
      } else {
        logger.warn(`applyWorkerConfig: no param setter for module ${moduleId}`);
      }
    }
    // The config changed every module's state — drop any cached per-module results
    // so the next processOnMainThread recomputes against the new params.
    this.moduleCache.clear();
  }

  // Process image in Web Worker for better performance
  async processImageAsync(input: Float32Array, context: ProcessingContext): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      // Process image using Web Worker (WebWorkerImageProcessor.ts already implemented)
      // Web Worker processing is available via WebWorkerImageProcessor service
      this.processImage(input, context)
        .then(resolve)
        .catch(reject);
    });
  }

  // Get processing statistics
  getStats(): {
    moduleCount: number;
    enabledModules: number;
    processingOrder: string[];
    moduleNames: string[];
  } {
    const enabledCount = Array.from(this.modules.values())
      .filter(module => module.isEnabled !== false)
      .length;

    return {
      moduleCount: this.modules.size,
      enabledModules: enabledCount,
      processingOrder: [...this.processingOrder],
      moduleNames: Array.from(this.modules.values()).map(m => m.getName())
    };
  }

  // Clear all cached processing results without resetting module parameters.
  // Call this when switching images so the pipeline reprocesses with new input data.
  clearCache(): void {
    this.moduleCache.clear();
    logger.debug('Pipeline cache cleared');
  }

  // Reset all modules to default parameters
  resetAllModules(): void {
    logger.info('Resetting all modules to default parameters');

    // Clear all cached results
    this.moduleCache.clear();

    for (const module of this.modules.values()) {
      // Try resetParams() first (most modules), then reset() (adapter modules like ToneCurve)
      if (typeof module.resetParams === 'function') {
        module.resetParams();
      } else if (typeof (module as unknown as { reset?: () => void }).reset === 'function') {
        (module as unknown as { reset: () => void }).reset();
      }
    }
  }

  // Create a processing preview for a region of the image
  async processRegion(
    input: Float32Array,
    context: ProcessingContext,
    region: { x: number; y: number; width: number; height: number }
  ): Promise<Float32Array> {
    const { x, y, width: regionWidth, height: regionHeight } = region;
    const { width: fullWidth, channels } = context;

    // Extract region data
    const regionData = new Float32Array(regionWidth * regionHeight * channels);
    let regionIndex = 0;

    for (let ry = 0; ry < regionHeight; ry++) {
      for (let rx = 0; rx < regionWidth; rx++) {
        const fullIndex = ((y + ry) * fullWidth + (x + rx)) * channels;
        for (let c = 0; c < channels; c++) {
          regionData[regionIndex] = input[fullIndex + c];
          regionIndex++;
        }
      }
    }

    // Process region
    const regionContext: ProcessingContext = {
      width: regionWidth,
      height: regionHeight,
      channels
    };

    return this.processImage(regionData, regionContext);
  }
}

// Singleton instance
export const imageProcessingPipeline = new ImageProcessingPipeline();