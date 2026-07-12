import { ToneCurveModule } from './ToneCurveModule';
import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Pipeline adapter for ToneCurveModule
 * Bridges the gap between the darktable-style module and the pipeline interface
 */
export class ToneCurvePipelineModule implements PipelineModule {
  private toneCurveModule: ToneCurveModule;
  public isEnabled = true;

  constructor() {
    this.toneCurveModule = new ToneCurveModule();
    logger.debug('ToneCurvePipelineModule initialized');
  }

  getId(): string {
    return 'tonecurve';
  }

  getName(): string {
    return 'Tone Curve';
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled) {
      return input;
    }

    const startTime = performance.now();

    // Convert to darktable ImageData format
    const imageData = {
      width: context.width,
      height: context.height,
      data: input,
      channels: context.channels
    };

    // Process using the tone curve module
    const processedImageData = this.toneCurveModule.process(imageData);

    const processTime = performance.now() - startTime;
    logger.debug(`ToneCurve pipeline processing: ${processTime.toFixed(2)}ms`);

    return processedImageData.data;
  }

  // Expose the underlying module for UI access
  getToneCurveModule(): ToneCurveModule {
    return this.toneCurveModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.toneCurveModule.flags.enabled = enabled;
    logger.debug(`ToneCurve module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return this.toneCurveModule.getParams();
  }

  // Set parameters (required by EditPersistenceService.restore / applyWorkerConfig).
  // Delegates to the inner ToneCurveModule (getParams' inverse) so persisted curves restore.
  setParams(params: Record<string, unknown>): void {
    this.toneCurveModule.setParams(params);
  }

  /**
   * Returns the current built LUT arrays from the underlying ToneCurveModule.
   * These are the same Float32Array instances used in process() / applyToneCurve().
   * The pass builder uses these to populate descriptor.luts without re-implementing
   * the curve→LUT math.
   */
  getGpuLuts(): { master: Float32Array; red: Float32Array; green: Float32Array; blue: Float32Array } | null {
    return this.toneCurveModule.getGpuLuts();
  }

  // Reset module to defaults
  reset(): void {
    this.toneCurveModule.reset();
    logger.info('ToneCurve module reset to defaults');
  }
}