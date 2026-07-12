import { TransformModule, TransformParams } from './TransformModule';
import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Pipeline adapter for TransformModule
 * Handles rotation, flipping, and straightening in the processing pipeline
 *
 * IMPORTANT: Transform can change output dimensions (when expandCanvas is true),
 * so all subsequent modules must work with the new dimensions
 */
export class TransformPipelineModule implements PipelineModule {
  private transformModule: TransformModule;
  public isEnabled = false; // Disabled by default

  constructor() {
    this.transformModule = new TransformModule();
    logger.debug('TransformPipelineModule initialized');
  }

  getId(): string {
    return 'transform';
  }

  getName(): string {
    return 'Transform';
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled || !this.transformModule.getParams().enabled) {
      return input;
    }

    const startTime = performance.now();

    // Create processing context for the transform module
    const transformContext = {
      width: context.width,
      height: context.height,
      channels: context.channels
    };

    // Process using the transform module
    const output = this.transformModule.process(input, transformContext);

    // IMPORTANT: Update context dimensions if canvas was expanded
    const params = this.transformModule.getParams();
    if (params.expandCanvas && Math.abs(params.angle) > 0.01) {
      const newDimensions = this.transformModule.getRotatedDimensions(
        context.width,
        context.height,
        params.angle
      );
      context.width = newDimensions.width;
      context.height = newDimensions.height;
    }

    const processTime = performance.now() - startTime;
    logger.debug(`Transform pipeline processing: ${processTime.toFixed(2)}ms, dimensions: ${context.width}x${context.height}`);

    return output;
  }

  // Expose the underlying module for UI access
  getTransformModule(): TransformModule {
    return this.transformModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.debug(`Transform module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return this.transformModule.getParams();
  }

  // Reset module to defaults
  reset(): void {
    this.transformModule.resetParams();
    this.isEnabled = false;
    logger.info('Transform module reset to defaults');
  }

  // Set rotation angle
  setRotation(angleDeg: number): void {
    this.transformModule.setParams({ angle: angleDeg, enabled: true });
    if (!this.isEnabled) {
      this.setEnabled(true);
    }
  }

  // Clear rotation (reset to 0°)
  clearRotation(): void {
    this.transformModule.setParams({ angle: 0.0, enabled: false });
    if (this.transformModule.getParams().flipHorizontal === false &&
        this.transformModule.getParams().flipVertical === false) {
      this.setEnabled(false);
    }
  }

  // Flip horizontal
  flipHorizontal(): void {
    const currentValue = this.transformModule.getParams().flipHorizontal;
    this.transformModule.setParams({
      flipHorizontal: !currentValue,
      enabled: true
    });
    if (!this.isEnabled) {
      this.setEnabled(true);
    }
  }

  // Flip vertical
  flipVertical(): void {
    const currentValue = this.transformModule.getParams().flipVertical;
    this.transformModule.setParams({
      flipVertical: !currentValue,
      enabled: true
    });
    if (!this.isEnabled) {
      this.setEnabled(true);
    }
  }

  // Auto-straighten based on horizon detection
  autoStraighten(input: Float32Array, context: ProcessingContext): boolean {
    const transformContext = {
      width: context.width,
      height: context.height,
      channels: context.channels
    };

    const success = this.transformModule.autoStraighten(input, transformContext);

    if (success && !this.isEnabled) {
      this.setEnabled(true);
    }

    return success;
  }

  // Set interpolation method
  setInterpolation(method: TransformParams['interpolation']): void {
    this.transformModule.setParams({ interpolation: method });
  }

  // Set canvas expansion mode
  setExpandCanvas(expand: boolean): void {
    this.transformModule.setParams({ expandCanvas: expand });
  }

  // Get output dimensions after transformation
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    if (!this.isEnabled || !this.transformModule.getParams().enabled) {
      return { width: inputWidth, height: inputHeight };
    }

    const params = this.transformModule.getParams();

    if (Math.abs(params.angle) < 0.01) {
      return { width: inputWidth, height: inputHeight };
    }

    return this.transformModule.getRotatedDimensions(inputWidth, inputHeight, params.angle);
  }

  // Check if any transformations are active
  hasActiveTransforms(): boolean {
    const params = this.transformModule.getParams();
    return this.isEnabled && (
      Math.abs(params.angle) > 0.01 ||
      params.flipHorizontal ||
      params.flipVertical
    );
  }

  // Get rotation angle
  getRotationAngle(): number {
    return this.transformModule.getRotationAngle();
  }

  // Calculate auto-crop for current rotation
  // This should be called by the crop module to automatically crop out black borders
  calculateAutoCropForRotation(width: number, height: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const angle = this.getRotationAngle();
    if (Math.abs(angle) < 0.01) {
      return null; // No rotation, no auto-crop needed
    }

    return this.transformModule.calculateAutoCropForRotation(width, height, angle);
  }
}

// Export singleton instance
export const transformPipelineModule = new TransformPipelineModule();
