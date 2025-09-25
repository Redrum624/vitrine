import { ColorBalanceModule } from './ColorBalanceModule';
import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Pipeline adapter for ColorBalanceModule
 * Bridges the gap between the darktable-style module and the pipeline interface
 */
export class ColorBalancePipelineModule implements PipelineModule {
  private colorBalanceModule: ColorBalanceModule;
  public isEnabled = true;

  constructor() {
    this.colorBalanceModule = new ColorBalanceModule();
    logger.debug('ColorBalancePipelineModule initialized');
  }

  getId(): string {
    return 'colorbalance';
  }

  getName(): string {
    return 'Color Balance';
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

    // Process using the color balance module
    const processedImageData = this.colorBalanceModule.process(imageData);

    const processTime = performance.now() - startTime;
    logger.debug(`ColorBalance pipeline processing: ${processTime.toFixed(2)}ms`);

    return processedImageData.data;
  }

  // Expose the underlying module for UI access
  getColorBalanceModule(): ColorBalanceModule {
    return this.colorBalanceModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.colorBalanceModule.flags.enabled = enabled;
    logger.debug(`ColorBalance module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Reset module to defaults
  reset(): void {
    this.colorBalanceModule.reset();
    logger.info('ColorBalance module reset to defaults');
  }
}