import { logger } from '../utils/Logger';

export interface CropParams {
  enabled: boolean;
  // Crop rectangle in normalized coordinates (0.0 to 1.0)
  x: number;      // Left edge (0.0 = left, 1.0 = right)
  y: number;      // Top edge (0.0 = top, 1.0 = bottom)
  width: number;  // Width (0.0 to 1.0)
  height: number; // Height (0.0 to 1.0)

  // Aspect ratio constraint
  aspectRatio: AspectRatio;
  customAspectWidth: number;  // For 'custom' ratio
  customAspectHeight: number; // For 'custom' ratio

  // Transform options (merged from TransformModule)
  angle: number;  // Rotation angle in degrees (-45.0 to +45.0)
  flipHorizontal: boolean;
  flipVertical: boolean;
  expandCanvas: boolean;  // true = expand canvas to fit rotation, false = crop to original size
  fillColor: [number, number, number, number];  // RGBA fill color for expanded areas (0-1 range)

  // Processing options
  resampleMethod: 'nearest' | 'bilinear' | 'bicubic';

  [key: string]: unknown; // Index signature for Record compatibility
}

export type AspectRatio =
  | 'free'      // No constraint
  | 'original'  // Use original image aspect ratio
  | '1:1'       // Square
  | '4:3'       // Standard
  | '3:2'       // Classic 35mm
  | '16:9'      // Widescreen
  | '9:16'      // Portrait phone
  | '3:4'       // Portrait standard
  | '2:3'       // Portrait 35mm
  | 'custom';   // Custom ratio

export const ASPECT_RATIO_VALUES: Record<Exclude<AspectRatio, 'free' | 'original' | 'custom'>, number> = {
  '1:1': 1.0,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '2:3': 2 / 3
};

export interface CropProcessingContext {
  width: number;
  height: number;
  channels: number;
}

export class CropModule {
  private params: CropParams = {
    enabled: false,
    x: 0.0,
    y: 0.0,
    width: 1.0,
    height: 1.0,
    aspectRatio: 'free',
    customAspectWidth: 1,
    customAspectHeight: 1,
    angle: 0.0,
    flipHorizontal: false,
    flipVertical: false,
    expandCanvas: true,
    fillColor: [0, 0, 0, 1],
    resampleMethod: 'bicubic'
  };

  // Original image dimensions (for 'original' aspect ratio)
  private originalWidth: number = 0;
  private originalHeight: number = 0;

  getId(): string {
    return 'crop';
  }

  getName(): string {
    return 'Crop';
  }

  getParams(): CropParams {
    return { ...this.params };
  }

  setParams(params: Partial<CropParams>): void {
    this.params = { ...this.params, ...params };

    // Ensure crop region is within bounds
    this.params.x = Math.max(0.0, Math.min(1.0 - this.params.width, this.params.x));
    this.params.y = Math.max(0.0, Math.min(1.0 - this.params.height, this.params.y));
    this.params.width = Math.max(0.01, Math.min(1.0 - this.params.x, this.params.width));
    this.params.height = Math.max(0.01, Math.min(1.0 - this.params.y, this.params.height));

    logger.debug(`Crop params updated:`, this.params);
  }

  resetParams(): void {
    this.params = {
      enabled: false,
      x: 0.0,
      y: 0.0,
      width: 1.0,
      height: 1.0,
      aspectRatio: 'free',
      customAspectWidth: 1,
      customAspectHeight: 1,
      angle: 0.0,
      flipHorizontal: false,
      flipVertical: false,
      expandCanvas: true,
      fillColor: [0, 0, 0, 1],
      resampleMethod: 'bicubic'
    };
    logger.debug('Crop params reset to defaults');
  }

  // Set original image dimensions (call when loading new image)
  setOriginalDimensions(width: number, height: number): void {
    this.originalWidth = width;
    this.originalHeight = height;
    logger.debug(`Original dimensions set: ${width}x${height}`);
  }

  // Get original image dimensions
  getOriginalDimensions(): { width: number; height: number } {
    return {
      width: this.originalWidth,
      height: this.originalHeight
    };
  }

  // Check if currently cropped
  isCropped(): boolean {
    return this.params.enabled &&
           (this.params.x !== 0.0 ||
            this.params.y !== 0.0 ||
            this.params.width !== 1.0 ||
            this.params.height !== 1.0);
  }

  // Uncrop - reset to full original image
  uncrop(): void {
    this.setParams({
      x: 0.0,
      y: 0.0,
      width: 1.0,
      height: 1.0,
      enabled: false
    });
    logger.info('Uncrop: Reset to original full image');
  }

  // Get aspect ratio value for current setting
  getAspectRatioValue(): number | null {
    switch (this.params.aspectRatio) {
      case 'free':
        return null;
      case 'original':
        return this.originalWidth > 0 ? this.originalWidth / this.originalHeight : null;
      case 'custom':
        return this.params.customAspectWidth / this.params.customAspectHeight;
      default:
        return ASPECT_RATIO_VALUES[this.params.aspectRatio];
    }
  }

  // Apply aspect ratio constraint to crop region
  applyCropAspectRatio(newX: number, newY: number, newWidth: number, newHeight: number, fixedEdge?: 'left' | 'right' | 'top' | 'bottom'): { x: number; y: number; width: number; height: number } {
    const targetRatio = this.getAspectRatioValue();

    if (targetRatio === null) {
      // Free aspect ratio - no constraint
      return { x: newX, y: newY, width: newWidth, height: newHeight };
    }

    // Apply aspect ratio constraint
    if (fixedEdge === 'left' || fixedEdge === 'right') {
      // Width changed, adjust height
      newHeight = newWidth / targetRatio;
    } else {
      // Height changed (or both), adjust width
      newWidth = newHeight * targetRatio;
    }

    // Ensure crop stays within bounds
    if (newX + newWidth > 1.0) {
      newWidth = 1.0 - newX;
      newHeight = newWidth / targetRatio;
    }
    if (newY + newHeight > 1.0) {
      newHeight = 1.0 - newY;
      newWidth = newHeight * targetRatio;
    }

    return { x: newX, y: newY, width: newWidth, height: newHeight };
  }

  // Process image with crop
  process(input: Float32Array, context: CropProcessingContext): Float32Array {
    if (!this.params.enabled) {
      return input;
    }

    // Check if crop is effectively full image (no actual crop)
    if (this.params.x === 0.0 && this.params.y === 0.0 &&
        this.params.width === 1.0 && this.params.height === 1.0) {
      logger.debug('Crop: No actual crop needed, passing through');
      return input;
    }

    const startTime = performance.now();
    const { width, height, channels } = context;

    // Calculate pixel coordinates
    const cropX = Math.floor(this.params.x * width);
    const cropY = Math.floor(this.params.y * height);
    const cropWidth = Math.max(1, Math.floor(this.params.width * width));
    const cropHeight = Math.max(1, Math.floor(this.params.height * height));

    // Ensure we don't go out of bounds
    const actualCropWidth = Math.min(cropWidth, width - cropX);
    const actualCropHeight = Math.min(cropHeight, height - cropY);

    logger.info(`Cropping: ${width}x${height} → ${actualCropWidth}x${actualCropHeight} at (${cropX}, ${cropY})`);

    // Create output array for cropped image
    const output = new Float32Array(actualCropWidth * actualCropHeight * channels);

    // Copy cropped region
    for (let y = 0; y < actualCropHeight; y++) {
      for (let x = 0; x < actualCropWidth; x++) {
        const srcIndex = ((cropY + y) * width + (cropX + x)) * channels;
        const dstIndex = (y * actualCropWidth + x) * channels;

        for (let c = 0; c < channels; c++) {
          output[dstIndex + c] = input[srcIndex + c];
        }
      }
    }

    const processingTime = performance.now() - startTime;
    logger.debug(`Crop processing completed in ${processingTime.toFixed(2)}ms`);

    return output;
  }

  // Get output dimensions after crop
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    if (!this.params.enabled) {
      return { width: inputWidth, height: inputHeight };
    }

    const cropWidth = Math.max(1, Math.floor(this.params.width * inputWidth));
    const cropHeight = Math.max(1, Math.floor(this.params.height * inputHeight));

    return {
      width: cropWidth,
      height: cropHeight
    };
  }

  // Helper: Center crop to given dimensions while maintaining aspect ratio
  centerCrop(targetAspectRatio: number, imageWidth: number, imageHeight: number): void {
    const currentAspectRatio = imageWidth / imageHeight;

    if (Math.abs(currentAspectRatio - targetAspectRatio) < 0.001) {
      // Already at target aspect ratio
      this.setParams({ x: 0, y: 0, width: 1.0, height: 1.0 });
      return;
    }

    if (currentAspectRatio > targetAspectRatio) {
      // Image is wider than target - crop width
      const targetWidth = targetAspectRatio / currentAspectRatio;
      const offsetX = (1.0 - targetWidth) / 2;
      this.setParams({ x: offsetX, y: 0, width: targetWidth, height: 1.0 });
    } else {
      // Image is taller than target - crop height
      const targetHeight = currentAspectRatio / targetAspectRatio;
      const offsetY = (1.0 - targetHeight) / 2;
      this.setParams({ x: 0, y: offsetY, width: 1.0, height: targetHeight });
    }

    logger.info(`Center crop applied for aspect ratio ${targetAspectRatio.toFixed(3)}`);
  }

  // Helper: Auto-crop to remove borders
  autoCrop(input: Float32Array, context: CropProcessingContext, threshold: number = 0.02): void {
    const { width, height, channels } = context;

    // Find actual content boundaries by detecting near-black/white borders
    let minX = width, maxX = 0;
    let minY = height, maxY = 0;
    let foundContent = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;
        const r = input[pixelIndex];
        const g = input[pixelIndex + 1];
        const b = input[pixelIndex + 2];

        // Check if pixel is not a border (not too dark or too bright)
        if ((r > threshold && r < 1 - threshold) ||
            (g > threshold && g < 1 - threshold) ||
            (b > threshold && b < 1 - threshold)) {
          foundContent = true;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!foundContent || minX >= maxX || minY >= maxY) {
      logger.warn('Auto-crop: No valid content boundaries found');
      return;
    }

    // Convert to normalized coordinates
    const normalizedX = minX / width;
    const normalizedY = minY / height;
    const normalizedWidth = (maxX - minX + 1) / width;
    const normalizedHeight = (maxY - minY + 1) / height;

    this.setParams({
      x: normalizedX,
      y: normalizedY,
      width: normalizedWidth,
      height: normalizedHeight,
      enabled: true
    });

    logger.info(`Auto-crop detected: (${minX}, ${minY}) to (${maxX}, ${maxY})`);
  }
}
