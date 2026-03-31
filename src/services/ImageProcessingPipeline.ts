import { logger } from '../utils/Logger';
import { LRUCache } from '../utils/LRUCache';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { ExposureModule } from '../modules/ExposureModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../modules/ShadowsHighlightsPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { webWorkerImageProcessor, WorkerModuleConfig } from './WebWorkerImageProcessor';

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

interface ShadowsHighlightsParams {
  shadows?: number;
  highlights?: number;
  whitePoint?: number;
  blackPoint?: number;
  compress?: number;
}

interface ModuleWithEnabledParams {
  enabled?: boolean;
}

export interface ProcessingContext {
  width: number;
  height: number;
  channels: number;
}

export interface PipelineModule {
  getId(): string;
  getName(): string;
  process(input: Float32Array, context: ProcessingContext): Float32Array;
  isEnabled?: boolean;
  getParams?(): Record<string, unknown>;
  resetParams?(): void;
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
    const whiteBalanceModule = new WhiteBalanceModule();
    const basicAdjModule = new BasicAdjustmentsModule();
    const toneCurveModule = new ToneCurvePipelineModule();
    const colorBalanceModule = new ColorBalancePipelineModule();
    const shadowsHighlightsModule = new ShadowsHighlightsPipelineModule();
    const localAdjustmentsModule = new LocalAdjustmentsPipelineModule();
    const noiseReductionModule = new NoiseReductionModule();

    // Pipeline order: Geometric → Color/Tone → Denoise → Tone Recovery → Local
    // Note: Transform (rotate/flip) is now integrated into CropModule
    this.addModule(cropModule, 0); // First - crop/transform (unified)
    this.addModule(lensCorrectionsModule, 1); // Second - lens corrections (geometric)
    this.addModule(exposureModule, 2); // Third - exposure correction
    this.addModule(whiteBalanceModule, 3); // Fourth - white balance
    this.addModule(basicAdjModule, 4); // Fifth - basic adjustments
    this.addModule(toneCurveModule, 5); // Sixth - tone curve
    this.addModule(colorBalanceModule, 6); // Seventh - color balance
    this.addModule(noiseReductionModule, 7); // Eighth - noise reduction (before SH to avoid amplifying noise)
    this.addModule(shadowsHighlightsModule, 8); // Ninth - shadows/highlights recovery
    this.addModule(localAdjustmentsModule, 9); // Tenth - local adjustments

    logger.info('Image processing pipeline initialized with 10 modules:', this.processingOrder);
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

  setModuleEnabled(moduleId: string, enabled: boolean): void {
    const module = this.modules.get(moduleId);
    if (module) {
      module.isEnabled = enabled;
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

        case 'basicadj': {
          // All numeric parameters should be 0 for identity
          return Object.entries(params).every(([key, val]) => {
            if (key === 'enabled' || typeof val !== 'number') return true;
            return Math.abs(val as number) < 0.001;
          });
        }

        case 'shadowshighlights': {
          // Check main effect parameters only
          const sh = params as ShadowsHighlightsParams;
          return (sh.shadows === undefined || sh.shadows === 0) &&
                 (sh.highlights === undefined || sh.highlights === 0) &&
                 (sh.whitePoint === undefined || sh.whitePoint === 0) &&
                 (sh.blackPoint === undefined || sh.blackPoint === 0) &&
                 (sh.compress === undefined || sh.compress === 0);
        }

        case 'crop':
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

  // Helper method to check if a curve array represents a linear (identity) transformation
  private isCurveLinear(curve: CurveNode[] | undefined): boolean {
    if (!curve || curve.length < 2) return true;
    return curve.every((node: CurveNode) =>
      node && typeof node.x === 'number' && typeof node.y === 'number' &&
      Math.abs(node.x - node.y) < 0.01
    );
  }

  // Generate cache key for module parameters (disabled for debugging)
  // @ts-ignore - temporarily unused during debugging
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

  async processImage(input: Float32Array, context: ProcessingContext, useWebWorkers = true): Promise<Float32Array> {
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
    if (useWebWorkers && !isSmallPreview && webWorkerImageProcessor.shouldUseWorkers(imageData)) {
      return this.processWithWebWorkers(input, context);
    } else {
      return this.processOnMainThread(input, context);
    }
  }

  private async processWithWebWorkers(input: Float32Array, context: ProcessingContext): Promise<Float32Array> {

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
        channels: context.channels
      };

      const result = await webWorkerImageProcessor.processImage(imageData, pipeline);

      if (!result.success) {
        logger.warn('Web Worker processing failed, falling back to main thread');
        return this.processOnMainThread(input, context);
      }

      return result.data;

    } catch (error) {
      logger.error('Web Worker processing error, falling back to main thread:', error);
      return this.processOnMainThread(input, context);
    }
  }

  private async processOnMainThread(input: Float32Array, context: ProcessingContext): Promise<Float32Array> {
    let currentData: Float32Array = new Float32Array(input);

    // Track processing statistics
    let modulesProcessed = 0;

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
            cached.result.length === currentData.length) {
          // Use cached result
          logger.debug(`Module ${module.getName()} used cached result`);
          currentData = new Float32Array(cached.result);
          continue;
        }

        try {
          logger.info(`Processing module: ${module.getName()}`);
          currentData = module.process(currentData, context);
          modulesProcessed++;

          // CRITICAL DEBUG: Track data after each module
          const moduleStats = { min: Infinity, max: -Infinity, nonZero: 0 };
          for (let i = 0; i < currentData.length; i += 4) {
            const r = currentData[i], g = currentData[i + 1], b = currentData[i + 2];
            moduleStats.min = Math.min(moduleStats.min, r, g, b);
            moduleStats.max = Math.max(moduleStats.max, r, g, b);
            if (r > 0.001 || g > 0.001 || b > 0.001) moduleStats.nonZero++;
          }
          logger.info(`${module.getName()} OUTPUT: range=${moduleStats.min.toFixed(4)}-${moduleStats.max.toFixed(4)}, nonZero=${moduleStats.nonZero}/${currentData.length/4}`);

          // Cache the result for future use with size tracking
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

          logger.info(`✅ Module ${module.getName()} processed successfully`);

        } catch (error) {
          logger.error(`Error in module ${module.getName()}:`, error);
          // Continue with previous data on error
        }
      }

      // Only log if there were issues
      if (modulesProcessed === 0) {
        logger.warn('No modules were processed - image unchanged');
      }

      // Critical debugging: Track final pipeline output
      const finalStats = { min: Infinity, max: -Infinity, nonZero: 0 };
      for (let i = 0; i < currentData.length; i += 4) {
        const r = currentData[i], g = currentData[i + 1], b = currentData[i + 2];
        finalStats.min = Math.min(finalStats.min, r, g, b);
        finalStats.max = Math.max(finalStats.max, r, g, b);
        if (r > 0.001 || g > 0.001 || b > 0.001) finalStats.nonZero++;
      }
      logger.info(`Pipeline: FINAL OUTPUT - range=${finalStats.min.toFixed(4)}-${finalStats.max.toFixed(4)}, nonZero=${finalStats.nonZero}/${currentData.length/4}`);

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