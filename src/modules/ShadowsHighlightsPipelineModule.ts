import { ShadowsHighlightsModule, ShadowsHighlightsParams } from './ShadowsHighlightsModule';
import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Pipeline adapter for ShadowsHighlightsModule
 * Bridges the gap between the darktable-style module and the pipeline interface
 */
export class ShadowsHighlightsPipelineModule implements PipelineModule {
  private shadowsHighlightsModule: ShadowsHighlightsModule;
  public isEnabled = true;

  constructor() {
    this.shadowsHighlightsModule = new ShadowsHighlightsModule();
    logger.debug('ShadowsHighlightsPipelineModule initialized');
  }

  getId(): string {
    return 'shadowshighlights';
  }

  getName(): string {
    return 'Shadows & Highlights';
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled) {
      return input;
    }

    try {
      // Convert Float32Array to ImageData format expected by the module
      const imageData = {
        width: context.width,
        height: context.height,
        data: input,
        channels: context.channels
      };

      // Process with the shadows/highlights module
      const result = this.shadowsHighlightsModule.process(imageData);

      logger.debug(`ShadowsHighlights processing completed for ${context.width}x${context.height} image`);

      return result.data;

    } catch (error) {
      logger.error('Error in ShadowsHighlightsPipelineModule processing:', error);
      return input; // Return original data on error
    }
  }

  // Expose the underlying module for UI components
  getShadowsHighlightsModule(): ShadowsHighlightsModule {
    return this.shadowsHighlightsModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.shadowsHighlightsModule.setParams({ enabled });
    logger.debug(`ShadowsHighlights module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Reset module to defaults
  reset(): void {
    this.shadowsHighlightsModule.resetParams();
    logger.info('ShadowsHighlights module reset to defaults');
  }

  /**
   * Returns true when the module is at neutral (identity) state — i.e. process()
   * would leave the image unchanged.  Delegates to ShadowsHighlightsModule.isNoOp()
   * so the condition is defined in a single place.
   */
  isNoOp(): boolean {
    return this.shadowsHighlightsModule.isNoOp();
  }

  // Get current parameters (for Web Worker processing)
  getParams() {
    return this.shadowsHighlightsModule.getParams();
  }

  // Set parameters (for Web Worker processing)
  setParams(params: Partial<ShadowsHighlightsParams>) {
    this.shadowsHighlightsModule.setParams(params);
  }
}

export default ShadowsHighlightsPipelineModule;