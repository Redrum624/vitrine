import { CropModule, CropParams } from './CropModule';
import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Pipeline adapter for CropModule
 * Handles non-destructive cropping in the processing pipeline
 *
 * IMPORTANT: Crop changes the output dimensions, so all subsequent modules
 * must work with the cropped dimensions
 */
export class CropPipelineModule implements PipelineModule {
  private cropModule: CropModule;
  public isEnabled = true; // Enabled by default

  constructor() {
    this.cropModule = new CropModule();
    logger.debug('CropPipelineModule initialized');
  }

  getId(): string {
    return 'crop';
  }

  getName(): string {
    return 'Crop';
  }

  process(input: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled || !this.cropModule.getParams().enabled) {
      return input;
    }

    const startTime = performance.now();

    // Create processing context for the crop module
    const cropContext = {
      width: context.width,
      height: context.height,
      channels: context.channels
    };

    // Process using the crop module
    const output = this.cropModule.process(input, cropContext);

    // IMPORTANT: Update context dimensions for subsequent modules
    const newDimensions = this.cropModule.getOutputDimensions(context.width, context.height);
    context.width = newDimensions.width;
    context.height = newDimensions.height;

    const processTime = performance.now() - startTime;
    logger.debug(`Crop pipeline processing: ${processTime.toFixed(2)}ms, new dimensions: ${context.width}x${context.height}`);

    return output;
  }

  // Expose the underlying module for UI access
  getCropModule(): CropModule {
    return this.cropModule;
  }

  // Enable/disable the module
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    logger.debug(`Crop module ${enabled ? 'enabled' : 'disabled'}`);
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return this.cropModule.getParams();
  }

  // Set parameters (required by EditPersistenceService.restore / applyWorkerConfig).
  // Delegates to the inner CropModule, then MIRRORS the restored `enabled` flag onto the
  // adapter-level `isEnabled` — process() gates on BOTH (`!this.isEnabled || !inner.enabled`),
  // and restore() runs on a reset pipeline where the adapter isEnabled was cleared to false, so
  // without this sync a persisted crop would round-trip its rect but render as a no-op.
  setParams(params: Record<string, unknown>): void {
    this.cropModule.setParams(params as Partial<CropParams>);
    if (typeof (params as { enabled?: unknown }).enabled === 'boolean') {
      this.isEnabled = (params as { enabled: boolean }).enabled;
    }
  }

  // Reset module to defaults
  reset(): void {
    this.cropModule.resetParams();
    this.isEnabled = false;
    logger.info('Crop module reset to defaults');
  }

  // Set crop region (normalized coordinates 0-1)
  setCropRegion(x: number, y: number, width: number, height: number): void {
    this.cropModule.setParams({ x, y, width, height, enabled: true });
    if (!this.isEnabled) {
      this.setEnabled(true);
    }
  }

  // Set aspect ratio
  setAspectRatio(aspectRatio: CropParams['aspectRatio'], customWidth?: number, customHeight?: number): void {
    const params: Partial<CropParams> = { aspectRatio };

    if (aspectRatio === 'custom' && customWidth !== undefined && customHeight !== undefined) {
      params.customAspectWidth = customWidth;
      params.customAspectHeight = customHeight;
    }

    this.cropModule.setParams(params);
  }

  // Apply centered crop for given aspect ratio
  centerCrop(targetAspectRatio: number, imageWidth: number, imageHeight: number): void {
    this.cropModule.centerCrop(targetAspectRatio, imageWidth, imageHeight);
    this.cropModule.setParams({ enabled: true });
    if (!this.isEnabled) {
      this.setEnabled(true);
    }
  }

  // Auto-detect and crop borders
  autoCrop(input: Float32Array, context: ProcessingContext, threshold?: number): void {
    const cropContext = {
      width: context.width,
      height: context.height,
      channels: context.channels
    };

    this.cropModule.autoCrop(input, cropContext, threshold);

    if (!this.isEnabled && this.cropModule.getParams().enabled) {
      this.setEnabled(true);
    }
  }

  // Clear crop (reset to full image)
  clearCrop(): void {
    this.cropModule.setParams({
      x: 0,
      y: 0,
      width: 1.0,
      height: 1.0,
      enabled: false
    });
    this.setEnabled(false);
  }

  // Get output dimensions after crop
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    if (!this.isEnabled || !this.cropModule.getParams().enabled) {
      return { width: inputWidth, height: inputHeight };
    }
    return this.cropModule.getOutputDimensions(inputWidth, inputHeight);
  }

  // Uncrop - reset to full original image
  uncrop(): void {
    this.cropModule.uncrop();
    this.setEnabled(false);
    logger.info('Uncropped to original image');
  }

  // Check if currently cropped
  isCropped(): boolean {
    return this.isEnabled && this.cropModule.isCropped();
  }

  /**
   * Returns true when this module is a geometric no-op — i.e. the crop rect covers
   * the full image AND there is no rotation, flip, or straighten transform applied.
   * Used by ImageProcessingPipeline.isModuleIdentity() so a fresh/default crop does
   * not block the GPU path.
   */
  isNoOp(): boolean {
    const p = this.cropModule.getParams();
    const rectIsFullFrame =
      p.x === 0.0 && p.y === 0.0 && p.width === 1.0 && p.height === 1.0;
    const transformIsIdentity =
      p.angle === 0.0 && !p.flipHorizontal && !p.flipVertical &&
      this.cropModule.normalizedOrientation() === 0;
    return rectIsFullFrame && transformIsIdentity;
  }

  // Set original dimensions (should be called when loading new image)
  setOriginalDimensions(width: number, height: number): void {
    this.cropModule.setOriginalDimensions(width, height);
  }

  // Get original dimensions
  getOriginalDimensions(): { width: number; height: number } {
    return this.cropModule.getOriginalDimensions();
  }

  // Apply auto-crop based on rotation angle to remove black borders
  // This should be called when rotation changes in the Transform module
  applyAutoCropForRotation(rotationCrop: { x: number; y: number; width: number; height: number }): void {
    this.setCropRegion(rotationCrop.x, rotationCrop.y, rotationCrop.width, rotationCrop.height);
    logger.info(`Auto-crop applied for rotation: ${(rotationCrop.width * 100).toFixed(1)}% × ${(rotationCrop.height * 100).toFixed(1)}%`);
  }
}

// Export singleton instance
export const cropPipelineModule = new CropPipelineModule();
