import { logger } from '../utils/Logger';
import { ExposureModule } from '../modules/ExposureModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../modules/ShadowsHighlightsPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import { webWorkerImageProcessor, WorkerModuleConfig } from './WebWorkerImageProcessor';

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

  constructor() {
    this.initializeModules();
  }

  private initializeModules(): void {
    // Initialize modules in darktable processing order
    const exposureModule = new ExposureModule();
    const whiteBalanceModule = new WhiteBalanceModule();
    const basicAdjModule = new BasicAdjustmentsModule();
    const toneCurveModule = new ToneCurvePipelineModule();
    const colorBalanceModule = new ColorBalancePipelineModule();
    const shadowsHighlightsModule = new ShadowsHighlightsPipelineModule();
    const localAdjustmentsModule = new LocalAdjustmentsPipelineModule();
    const lensCorrectionsModule = new LensCorrectionsPipelineModule();

    this.addModule(lensCorrectionsModule, 0); // First - lens corrections (geometric)
    this.addModule(exposureModule, 1); // Second - exposure correction
    this.addModule(whiteBalanceModule, 2); // Third - white balance
    this.addModule(basicAdjModule, 3); // Fourth - basic adjustments
    this.addModule(toneCurveModule, 4); // Fifth - tone curve
    this.addModule(colorBalanceModule, 5); // Sixth - color balance
    this.addModule(shadowsHighlightsModule, 6); // Seventh - shadows/highlights recovery
    this.addModule(localAdjustmentsModule, 7); // Eighth - local adjustments

    logger.info('Image processing pipeline initialized with modules:', this.processingOrder);
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
      logger.debug(`Module ${moduleId} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

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
    logger.info(`Processing with Web Workers: ${context.width}x${context.height} (${this.processingOrder.length} modules)`);
    const startTime = performance.now();

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

      const totalTime = performance.now() - startTime;
      logger.info(`Web Worker processing completed in ${totalTime.toFixed(2)}ms (worker: ${result.processingTime?.toFixed(2)}ms)`);

      return result.data;

    } catch (error) {
      logger.error('Web Worker processing error, falling back to main thread:', error);
      return this.processOnMainThread(input, context);
    }
  }

  private async processOnMainThread(input: Float32Array, context: ProcessingContext): Promise<Float32Array> {
    let currentData: Float32Array = new Float32Array(input);

    // Debug logging removed - issue resolved

    logger.info(`Processing on main thread: ${context.width}x${context.height} (${this.processingOrder.length} modules)`);
    const startTime = performance.now();

    try {
      for (const moduleId of this.processingOrder) {
        const module = this.modules.get(moduleId);

        if (!module) {
          logger.warn(`Module not found: ${moduleId}`);
          continue;
        }

        // Check if module is enabled (default to true if not specified)
        const isEnabled = module.isEnabled !== false;
        if (!isEnabled) {
          logger.debug(`Skipping disabled module: ${module.getName()}`);
          continue;
        }

        const moduleStartTime = performance.now();

        try {
          logger.debug(`Processing module: ${module.getName()} (${moduleId})`);
          currentData = module.process(currentData, context);

          // Debug logging removed - issue resolved

          const moduleTime = performance.now() - moduleStartTime;
          logger.debug(`Module ${module.getName()} completed in ${moduleTime.toFixed(2)}ms`);

        } catch (error) {
          logger.error(`Error in module ${module.getName()}:`, error);
          // Continue with previous data on error
        }
      }

      const totalTime = performance.now() - startTime;
      logger.info(`Main thread processing completed in ${totalTime.toFixed(2)}ms`);

      // Debug logging removed - issue resolved

      return currentData;

    } catch (error) {
      logger.error('Fatal error in image processing pipeline:', error);
      return input; // Return original on fatal error
    }
  }

  private getModuleParams(module: PipelineModule, _moduleId: string): Record<string, unknown> {
    // Extract parameters from different module types
    try {
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
        return moduleWithGetter.getExposureModule().getParams();
      }
      if (moduleWithGetter.getWhiteBalanceModule) {
        return moduleWithGetter.getWhiteBalanceModule().getParams();
      }
      if (moduleWithGetter.getBasicAdjustmentsModule) {
        return moduleWithGetter.getBasicAdjustmentsModule().getParams();
      }
      if (moduleWithGetter.getToneCurveModule) {
        return moduleWithGetter.getToneCurveModule().getParams();
      }
      if (moduleWithGetter.getColorBalanceModule) {
        return moduleWithGetter.getColorBalanceModule().getParams();
      }
      if (moduleWithGetter.getShadowsHighlightsModule) {
        return moduleWithGetter.getShadowsHighlightsModule().getParams();
      }
      if (moduleWithGetter.getParameters) {
        return moduleWithGetter.getParameters();
      }

      // Handle direct module types
      if (module.getParams) {
        return module.getParams();
      }

      // Default empty params
      return {};

    } catch (error) {
      logger.warn(`Failed to get params for module ${_moduleId}:`, error);
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

  // Reset all modules to default parameters
  resetAllModules(): void {
    logger.info('Resetting all modules to default parameters');

    for (const module of this.modules.values()) {
      if (module.resetParams) {
        module.resetParams();
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