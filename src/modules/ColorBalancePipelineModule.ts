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

    // Create processing context for the color balance module
    const colorBalanceContext = {
      width: context.width,
      height: context.height,
      channels: context.channels
    };

    // Process using the color balance module
    const output = this.colorBalanceModule.process(input, colorBalanceContext);

    const processTime = performance.now() - startTime;
    logger.debug(`ColorBalance pipeline processing: ${processTime.toFixed(2)}ms`);

    return output;
  }

  // Expose the underlying module for UI access
  getColorBalanceModule(): ColorBalanceModule {
    return this.colorBalanceModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.debug(`ColorBalance module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return this.colorBalanceModule.getParams();
  }

  // Set parameters (required by EditPersistenceService.restore / applyWorkerConfig).
  // Delegates to the inner ColorBalanceModule (getParams' inverse) so persisted grades restore.
  setParams(params: Record<string, unknown>): void {
    this.colorBalanceModule.setParams(params);
  }

  // Reset module to defaults
  reset(): void {
    this.colorBalanceModule.resetParams();
    logger.info('ColorBalance module reset to defaults');
  }
}