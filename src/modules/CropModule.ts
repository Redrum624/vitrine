import { logger } from '../utils/Logger';

export interface HorizonLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;  // 0.0 to 1.0
  angle: number;       // Angle in degrees from horizontal
}

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
  /** Lossless orthogonal rotation (0 | 90 | 180 | 270, clockwise), applied
   *  FIRST — before flips, fine rotation, and the crop rect. 90/270 swap the
   *  output dimensions. Absent in pre-v1.34 saved edits ⇒ treated as 0. */
  orientation?: number;
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
    enabled: true,
    x: 0.0,
    y: 0.0,
    width: 1.0,
    height: 1.0,
    aspectRatio: 'original',  // Default to original aspect ratio
    customAspectWidth: 1,
    customAspectHeight: 1,
    angle: 0.0,
    orientation: 0,
    flipHorizontal: false,
    flipVertical: false,
    expandCanvas: true,  // true = expand canvas during rotation, use crop to remove black borders
    fillColor: [0, 0, 0, 1],
    resampleMethod: 'bicubic'
  };

  // Preview mode state
  private isPreviewMode: boolean = false;
  private appliedParams: CropParams | null = null; // Last applied state

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
      aspectRatio: 'original',  // Default to original aspect ratio
      customAspectWidth: 1,
      customAspectHeight: 1,
      angle: 0.0,
      orientation: 0,
      flipHorizontal: false,
      flipVertical: false,
      expandCanvas: true,  // true = expand canvas during rotation
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
      case 'original': {
        if (this.originalWidth <= 0) return null;
        // 'Original' means the aspect of the frame BEING cropped: under a
        // 90°/270° orientation that frame is the rotated one. Without the swap
        // an e-drag on a rotated photo locked the rect to the UNROTATED ratio
        // and produced a landscape crop inside a portrait frame (v1.34.2).
        const swapped = this.normalizedOrientation() === 90 || this.normalizedOrientation() === 270;
        return swapped
          ? this.originalHeight / this.originalWidth
          : this.originalWidth / this.originalHeight;
      }
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

  // Process image with transform and crop
  process(input: Float32Array, context: CropProcessingContext): Float32Array {
    if (!this.params.enabled) {
      return input;
    }

    const startTime = performance.now();
    let output = input;
    let currentWidth = context.width;
    let currentHeight = context.height;
    const { channels } = context;

    // Step 1: Apply transforms first (orientation/flip/rotate)
    const orientation = this.normalizedOrientation();
    const hasTransforms = orientation !== 0 || this.params.flipHorizontal || this.params.flipVertical || Math.abs(this.params.angle) > 0.01;

    logger.debug(`CropModule.process: hasTransforms=${hasTransforms}, orientation=${orientation}, angle=${this.params.angle}, flipH=${this.params.flipHorizontal}, flipV=${this.params.flipVertical}`);

    if (hasTransforms) {
      // Lossless 90°-step rotation FIRST (pure pixel remap, no resampling).
      if (orientation !== 0) {
        output = this.rotateOrthogonal(output, currentWidth, currentHeight, channels, orientation);
        if (orientation === 90 || orientation === 270) {
          const t = currentWidth; currentWidth = currentHeight; currentHeight = t;
        }
      }

      // Apply flip/mirror first (fastest operations)
      if (this.params.flipHorizontal) {
        output = this.flipHorizontalInternal(output, currentWidth, currentHeight, channels);
      }

      if (this.params.flipVertical) {
        output = this.flipVerticalInternal(output, currentWidth, currentHeight, channels);
      }

      // Apply rotation if angle is significant
      if (Math.abs(this.params.angle) > 0.01) {
        output = this.rotate(output, currentWidth, currentHeight, channels, this.params.angle);

        // Update dimensions if canvas expanded
        if (this.params.expandCanvas) {
          const newDims = this.getRotatedDimensions(currentWidth, currentHeight, this.params.angle);
          currentWidth = newDims.width;
          currentHeight = newDims.height;
        }
      }
    }

    // Step 2: Apply crop
    const needsCrop = this.params.x !== 0.0 || this.params.y !== 0.0 ||
                      this.params.width !== 1.0 || this.params.height !== 1.0;

    logger.debug(`CropModule.process: needsCrop=${needsCrop}, x=${this.params.x}, y=${this.params.y}, w=${this.params.width}, h=${this.params.height}`);

    if (needsCrop) {
      // Calculate pixel coordinates
      const cropX = Math.floor(this.params.x * currentWidth);
      const cropY = Math.floor(this.params.y * currentHeight);
      const cropWidth = Math.max(1, Math.floor(this.params.width * currentWidth));
      const cropHeight = Math.max(1, Math.floor(this.params.height * currentHeight));

      // Ensure we don't go out of bounds
      const actualCropWidth = Math.min(cropWidth, currentWidth - cropX);
      const actualCropHeight = Math.min(cropHeight, currentHeight - cropY);

      logger.info(`Cropping: ${currentWidth}x${currentHeight} → ${actualCropWidth}x${actualCropHeight} at (${cropX}, ${cropY})`);

      // Create output array for cropped image
      const croppedOutput = new Float32Array(actualCropWidth * actualCropHeight * channels);

      // Copy cropped region
      for (let y = 0; y < actualCropHeight; y++) {
        for (let x = 0; x < actualCropWidth; x++) {
          const srcIndex = ((cropY + y) * currentWidth + (cropX + x)) * channels;
          const dstIndex = (y * actualCropWidth + x) * channels;

          for (let c = 0; c < channels; c++) {
            croppedOutput[dstIndex + c] = output[srcIndex + c];
          }
        }
      }

      output = croppedOutput;
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Crop & Transform processing completed in ${processingTime.toFixed(2)}ms`);

    return output;
  }

  // Get output dimensions after crop and rotation
  getOutputDimensions(inputWidth: number, inputHeight: number): { width: number; height: number } {
    if (!this.params.enabled) {
      return { width: inputWidth, height: inputHeight };
    }

    let currentWidth = inputWidth;
    let currentHeight = inputHeight;

    // Step 0: 90°-step orientation swaps the frame for 90/270.
    const orientation = this.normalizedOrientation();
    if (orientation === 90 || orientation === 270) {
      const t = currentWidth; currentWidth = currentHeight; currentHeight = t;
    }

    // Step 1: Apply rotation dimensions first (rotation happens before crop in process())
    if (Math.abs(this.params.angle) > 0.01 && this.params.expandCanvas) {
      const rotatedDims = this.getRotatedDimensions(currentWidth, currentHeight, this.params.angle);
      currentWidth = rotatedDims.width;
      currentHeight = rotatedDims.height;
    }

    // Step 2: Apply crop dimensions
    const cropWidth = Math.max(1, Math.floor(this.params.width * currentWidth));
    const cropHeight = Math.max(1, Math.floor(this.params.height * currentHeight));

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
      this.setParams({ x: offsetX, y: 0, width: targetWidth, height: 1.0, enabled: true });
    } else {
      // Image is taller than target - crop height
      const targetHeight = currentAspectRatio / targetAspectRatio;
      const offsetY = (1.0 - targetHeight) / 2;
      this.setParams({ x: 0, y: offsetY, width: 1.0, height: targetHeight, enabled: true });
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

  // ========== TRANSFORM METHODS (merged from TransformModule) ==========

  /** Orientation normalized into {0, 90, 180, 270} (absent/invalid ⇒ 0). */
  normalizedOrientation(): 0 | 90 | 180 | 270 {
    const raw = Number(this.params.orientation ?? 0);
    if (!Number.isFinite(raw)) return 0;
    const o = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
    return (o === 90 || o === 180 || o === 270) ? o : 0;
  }

  /** Lossless orthogonal rotation (clockwise degrees ∈ {90, 180, 270}).
   *  90/270 swap the output dimensions; pure index remap — no resampling. */
  private rotateOrthogonal(input: Float32Array, width: number, height: number, channels: number, orientation: 90 | 180 | 270): Float32Array {
    const outW = orientation === 180 ? width : height;
    const outH = orientation === 180 ? height : width;
    const output = new Float32Array(outW * outH * channels);
    for (let yd = 0; yd < outH; yd++) {
      for (let xd = 0; xd < outW; xd++) {
        let xs: number; let ys: number;
        if (orientation === 90) {        // CW: src(x,y) → dst(H-1-y, x)
          xs = yd; ys = height - 1 - xd;
        } else if (orientation === 180) {
          xs = width - 1 - xd; ys = height - 1 - yd;
        } else {                          // 270 CW (= 90 CCW): src(x,y) → dst(y, W-1-x)
          xs = width - 1 - yd; ys = xd;
        }
        const src = (ys * width + xs) * channels;
        const dst = (yd * outW + xd) * channels;
        for (let c = 0; c < channels; c++) output[dst + c] = input[src + c];
      }
    }
    return output;
  }

  // Rotate image by angle (in degrees)
  private rotate(input: Float32Array, width: number, height: number, channels: number, angleDeg: number): Float32Array {
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosAngle = Math.cos(angleRad);
    const sinAngle = Math.sin(angleRad);

    const centerX = width / 2;
    const centerY = height / 2;

    // Calculate output dimensions
    let outWidth = width;
    let outHeight = height;
    let offsetX = 0;
    let offsetY = 0;

    if (this.params.expandCanvas) {
      // Expand canvas to fit rotated image
      const corners = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: 0, y: height },
        { x: width, y: height }
      ];

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      for (const corner of corners) {
        const dx = corner.x - centerX;
        const dy = corner.y - centerY;
        const rotX = dx * cosAngle - dy * sinAngle;
        const rotY = dx * sinAngle + dy * cosAngle;

        minX = Math.min(minX, rotX);
        maxX = Math.max(maxX, rotX);
        minY = Math.min(minY, rotY);
        maxY = Math.max(maxY, rotY);
      }

      outWidth = Math.ceil(maxX - minX);
      outHeight = Math.ceil(maxY - minY);
      offsetX = -minX;
      offsetY = -minY;
    }

    logger.debug(`Rotating by ${angleDeg.toFixed(2)}°: ${width}x${height} → ${outWidth}x${outHeight}`);

    const output = new Float32Array(outWidth * outHeight * channels);

    // Fill with background color
    for (let i = 0; i < output.length; i += channels) {
      output[i] = this.params.fillColor[0];
      output[i + 1] = this.params.fillColor[1];
      output[i + 2] = this.params.fillColor[2];
      if (channels === 4) {
        output[i + 3] = this.params.fillColor[3];
      }
    }

    // Perform inverse rotation for each output pixel
    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        // Convert output coordinates to centered coordinates
        const outDx = x - offsetX;
        const outDy = y - offsetY;

        // Inverse rotation to find source coordinates
        const srcDx = outDx * cosAngle + outDy * sinAngle;
        const srcDy = -outDx * sinAngle + outDy * cosAngle;
        const srcX = srcDx + centerX;
        const srcY = srcDy + centerY;

        // Sample from source image
        this.samplePixel(input, width, height, channels, srcX, srcY, output, (y * outWidth + x) * channels);
      }
    }

    return output;
  }

  // Sample pixel with interpolation
  private samplePixel(
    input: Float32Array,
    width: number,
    height: number,
    channels: number,
    x: number,
    y: number,
    output: Float32Array,
    outIndex: number
  ): void {
    // Check bounds
    if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) {
      return; // Keep fill color
    }

    switch (this.params.resampleMethod) {
      case 'nearest':
        this.sampleNearest(input, width, height, channels, x, y, output, outIndex);
        break;
      case 'bilinear':
        this.sampleBilinear(input, width, height, channels, x, y, output, outIndex);
        break;
      case 'bicubic':
        this.sampleBicubic(input, width, height, channels, x, y, output, outIndex);
        break;
    }
  }

  // Nearest neighbor interpolation
  private sampleNearest(
    input: Float32Array,
    width: number,
    _height: number,
    channels: number,
    x: number,
    y: number,
    output: Float32Array,
    outIndex: number
  ): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const inIndex = (iy * width + ix) * channels;

    for (let c = 0; c < channels; c++) {
      output[outIndex + c] = input[inIndex + c];
    }
  }

  // Bilinear interpolation
  private sampleBilinear(
    input: Float32Array,
    width: number,
    _height: number,
    channels: number,
    x: number,
    y: number,
    output: Float32Array,
    outIndex: number
  ): void {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const wx = x - x0;
    const wy = y - y0;

    const idx00 = (y0 * width + x0) * channels;
    const idx01 = (y0 * width + x1) * channels;
    const idx10 = (y1 * width + x0) * channels;
    const idx11 = (y1 * width + x1) * channels;

    for (let c = 0; c < channels; c++) {
      const v00 = input[idx00 + c];
      const v01 = input[idx01 + c];
      const v10 = input[idx10 + c];
      const v11 = input[idx11 + c];

      const v0 = v00 * (1 - wx) + v01 * wx;
      const v1 = v10 * (1 - wx) + v11 * wx;

      output[outIndex + c] = v0 * (1 - wy) + v1 * wy;
    }
  }

  // Bicubic interpolation (Catmull-Rom spline)
  private sampleBicubic(
    input: Float32Array,
    width: number,
    height: number,
    channels: number,
    x: number,
    y: number,
    output: Float32Array,
    outIndex: number
  ): void {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;

    for (let c = 0; c < channels; c++) {
      let value = 0;

      // Bicubic kernel (4x4 neighborhood)
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          const sx = Math.max(0, Math.min(width - 1, x0 + dx));
          const sy = Math.max(0, Math.min(height - 1, y0 + dy));
          const idx = (sy * width + sx) * channels + c;

          const wx = this.cubicWeight(fx - dx);
          const wy = this.cubicWeight(fy - dy);

          value += input[idx] * wx * wy;
        }
      }

      output[outIndex + c] = Math.max(0, Math.min(1, value));
    }
  }

  // Cubic interpolation weight function (Catmull-Rom)
  private cubicWeight(t: number): number {
    const absT = Math.abs(t);
    if (absT <= 1) {
      return 1.5 * absT * absT * absT - 2.5 * absT * absT + 1;
    } else if (absT < 2) {
      return -0.5 * absT * absT * absT + 2.5 * absT * absT - 4 * absT + 2;
    }
    return 0;
  }

  // Flip image horizontally
  private flipHorizontalInternal(input: Float32Array, width: number, height: number, channels: number): Float32Array {
    const output = new Float32Array(input.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels;
        const dstIdx = (y * width + (width - 1 - x)) * channels;

        for (let c = 0; c < channels; c++) {
          output[dstIdx + c] = input[srcIdx + c];
        }
      }
    }

    return output;
  }

  // Flip image vertically
  private flipVerticalInternal(input: Float32Array, width: number, height: number, channels: number): Float32Array {
    const output = new Float32Array(input.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * channels;
        const dstIdx = ((height - 1 - y) * width + x) * channels;

        for (let c = 0; c < channels; c++) {
          output[dstIdx + c] = input[srcIdx + c];
        }
      }
    }

    return output;
  }

  // Get output dimensions after rotation
  getRotatedDimensions(width: number, height: number, angleDeg: number): { width: number; height: number } {
    if (!this.params.expandCanvas) {
      return { width, height };
    }

    const angleRad = (angleDeg * Math.PI) / 180;
    const cosAngle = Math.cos(angleRad);
    const sinAngle = Math.sin(angleRad);

    const centerX = width / 2;
    const centerY = height / 2;

    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height }
    ];

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const corner of corners) {
      const dx = corner.x - centerX;
      const dy = corner.y - centerY;
      const rotX = dx * cosAngle - dy * sinAngle;
      const rotY = dx * sinAngle + dy * cosAngle;

      minX = Math.min(minX, rotX);
      maxX = Math.max(maxX, rotX);
      minY = Math.min(minY, rotY);
      maxY = Math.max(maxY, rotY);
    }

    return {
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY)
    };
  }

  // Auto-straighten image using 6-line analysis (3 vertical + 3 horizontal)
  autoStraighten(input: Float32Array, context: CropProcessingContext): boolean {
    const { width, height, channels } = context;

    logger.info('Auto-straighten: Analyzing image with 6-line method...');

    const corrections: number[] = [];

    // Define scan line positions (25%, 50%, 75% - avoiding edges)
    const verticalPositions = [0.25, 0.5, 0.75];  // X positions for vertical line detection
    const horizontalPositions = [0.25, 0.5, 0.75]; // Y positions for horizontal line detection

    // Analyze 3 vertical scan lines (detect deviation from true vertical)
    for (const xRatio of verticalPositions) {
      const angle = this.detectLineAngleAtPosition(input, width, height, channels, xRatio, 'vertical');
      if (angle !== null) {
        corrections.push(angle);
        logger.debug(`Vertical line at ${(xRatio * 100).toFixed(0)}%: ${angle.toFixed(2)}°`);
      }
    }

    // Analyze 3 horizontal scan lines (detect deviation from true horizontal)
    for (const yRatio of horizontalPositions) {
      const angle = this.detectLineAngleAtPosition(input, width, height, channels, yRatio, 'horizontal');
      if (angle !== null) {
        corrections.push(angle);
        logger.debug(`Horizontal line at ${(yRatio * 100).toFixed(0)}%: ${angle.toFixed(2)}°`);
      }
    }

    if (corrections.length === 0) {
      logger.warn('Auto-straighten: No reliable lines detected');
      return false;
    }

    // Calculate average correction, filtering outliers
    const sortedCorrections = [...corrections].sort((a, b) => a - b);

    // Remove extreme outliers (if we have enough samples)
    let filteredCorrections = sortedCorrections;
    if (sortedCorrections.length >= 4) {
      // Remove top and bottom values
      filteredCorrections = sortedCorrections.slice(1, -1);
    }

    const avgCorrection = filteredCorrections.reduce((sum, c) => sum + c, 0) / filteredCorrections.length;

    // Clamp to -5 to +5 range (straightening range)
    const clampedCorrection = Math.max(-5, Math.min(5, avgCorrection));

    if (Math.abs(clampedCorrection) < 0.1) {
      logger.info('Auto-straighten: Image is already straight');
      return false;
    }

    // Check if user has an existing crop (not the full image)
    const hasExistingCrop = this.params.x !== 0 || this.params.y !== 0 ||
                            this.params.width !== 1.0 || this.params.height !== 1.0;

    // Apply the correction - preserve existing crop if user has one
    if (hasExistingCrop) {
      // User has a custom crop, just update the rotation angle
      this.setParams({
        angle: clampedCorrection,
        enabled: true,
        expandCanvas: true
        // Don't overwrite x, y, width, height - preserve user's crop
      });
      logger.info(`Auto-straighten applied: ${clampedCorrection.toFixed(2)}° correction (preserving existing crop)`);
    } else {
      // No custom crop, apply auto-crop to remove black borders
      const autoCrop = this.calculateAutoCropForRotation(width, height, clampedCorrection);
      this.setParams({
        angle: clampedCorrection,
        enabled: true,
        expandCanvas: true,
        ...autoCrop
      });
      logger.info(`Auto-straighten applied: ${clampedCorrection.toFixed(2)}° correction with auto-crop`);
    }

    return true;
  }

  // Detect the dominant line angle at a specific position
  private detectLineAngleAtPosition(
    input: Float32Array,
    width: number,
    height: number,
    channels: number,
    position: number,
    orientation: 'vertical' | 'horizontal'
  ): number | null {
    const stripWidth = Math.floor(Math.min(width, height) * 0.1); // 10% of smaller dimension
    const halfStrip = Math.floor(stripWidth / 2);

    // Accumulate gradient angles along the scan line
    const angleVotes: Map<number, number> = new Map();
    let totalWeight = 0;

    if (orientation === 'vertical') {
      // Scan a vertical strip at x position
      const centerX = Math.floor(width * position);
      const startX = Math.max(1, centerX - halfStrip);
      const endX = Math.min(width - 2, centerX + halfStrip);

      for (let y = Math.floor(height * 0.1); y < Math.floor(height * 0.9); y++) {
        for (let x = startX; x <= endX; x++) {
          const gradient = this.getGradientAt(input, x, y, width, height, channels);
          if (gradient.magnitude > 0.05) { // Threshold for significant edges
            // For vertical lines, we want edges that are roughly vertical (gradient pointing horizontally)
            // Angle 0 = horizontal gradient = vertical edge
            const angleFromVertical = gradient.angle; // Deviation from vertical
            const roundedAngle = Math.round(angleFromVertical * 10) / 10; // 0.1° precision

            if (Math.abs(roundedAngle) <= 15) { // Only consider near-vertical edges
              const currentVotes = angleVotes.get(roundedAngle) || 0;
              angleVotes.set(roundedAngle, currentVotes + gradient.magnitude);
              totalWeight += gradient.magnitude;
            }
          }
        }
      }
    } else {
      // Scan a horizontal strip at y position
      const centerY = Math.floor(height * position);
      const startY = Math.max(1, centerY - halfStrip);
      const endY = Math.min(height - 2, centerY + halfStrip);

      for (let x = Math.floor(width * 0.1); x < Math.floor(width * 0.9); x++) {
        for (let y = startY; y <= endY; y++) {
          const gradient = this.getGradientAt(input, x, y, width, height, channels);
          if (gradient.magnitude > 0.05) {
            // For horizontal lines, we want edges that are roughly horizontal (gradient pointing vertically)
            // Convert to deviation from horizontal
            let angleFromHorizontal = gradient.angle - 90;
            if (angleFromHorizontal > 90) angleFromHorizontal -= 180;
            if (angleFromHorizontal < -90) angleFromHorizontal += 180;

            const roundedAngle = Math.round(angleFromHorizontal * 10) / 10;

            if (Math.abs(roundedAngle) <= 15) { // Only consider near-horizontal edges
              const currentVotes = angleVotes.get(roundedAngle) || 0;
              angleVotes.set(roundedAngle, currentVotes + gradient.magnitude);
              totalWeight += gradient.magnitude;
            }
          }
        }
      }
    }

    if (totalWeight < 1) {
      return null; // Not enough edge data
    }

    // Find the dominant angle (weighted average)
    let weightedSum = 0;
    for (const [angle, weight] of angleVotes) {
      weightedSum += angle * weight;
    }

    const dominantAngle = weightedSum / totalWeight;

    // Return the correction needed (negative of the detected deviation)
    return -dominantAngle;
  }

  // Calculate gradient at a pixel using Sobel operator
  private getGradientAt(
    input: Float32Array,
    x: number,
    y: number,
    width: number,
    height: number,
    channels: number
  ): { angle: number; magnitude: number } {
    if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) {
      return { angle: 0, magnitude: 0 };
    }

    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    let gx = 0, gy = 0;

    for (let ky = -1; ky <= 1; ky++) {
      for (let kx = -1; kx <= 1; kx++) {
        const idx = ((y + ky) * width + (x + kx)) * channels;
        const luminance = 0.299 * input[idx] + 0.587 * input[idx + 1] + 0.114 * input[idx + 2];

        gx += luminance * sobelX[ky + 1][kx + 1];
        gy += luminance * sobelY[ky + 1][kx + 1];
      }
    }

    const magnitude = Math.sqrt(gx * gx + gy * gy);

    // Angle in degrees: 0° = horizontal gradient (vertical edge), 90° = vertical gradient (horizontal edge)
    const angle = Math.atan2(gy, gx) * (180 / Math.PI);

    return { angle, magnitude };
  }

  // Legacy method for compatibility - now just calls autoStraighten
  detectHorizon(input: Float32Array, context: CropProcessingContext): HorizonLine | null {
    // Run auto-straighten and return a synthetic horizon line for compatibility
    const { width, height, channels } = context;

    // Detect using the new method
    const corrections: number[] = [];
    const positions = [0.25, 0.5, 0.75];

    for (const pos of positions) {
      const vAngle = this.detectLineAngleAtPosition(input, width, height, channels, pos, 'vertical');
      const hAngle = this.detectLineAngleAtPosition(input, width, height, channels, pos, 'horizontal');
      if (vAngle !== null) corrections.push(vAngle);
      if (hAngle !== null) corrections.push(hAngle);
    }

    if (corrections.length === 0) return null;

    const avgAngle = corrections.reduce((sum, c) => sum + c, 0) / corrections.length;

    return {
      x1: 0,
      y1: height / 2,
      x2: width,
      y2: height / 2 + width * Math.tan(avgAngle * Math.PI / 180),
      angle: avgAngle,
      confidence: corrections.length / 6
    };
  }

  // Calculate the largest crop rectangle that fits inside a rotated image
  // This removes black borders created by rotation
  // IMPORTANT: Returns normalized coordinates (0-1) relative to the EXPANDED canvas
  calculateAutoCropForRotation(originalWidth: number, originalHeight: number, angleDeg: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (Math.abs(angleDeg) < 0.01) {
      // No rotation, no crop needed
      return { x: 0, y: 0, width: 1.0, height: 1.0 };
    }

    const angleRad = Math.abs(angleDeg * Math.PI / 180);
    const sin = Math.sin(angleRad);
    const cos = Math.cos(angleRad);

    // Get the expanded canvas dimensions after rotation
    const rotatedDims = this.getRotatedDimensions(originalWidth, originalHeight, angleDeg);
    const rotatedW = rotatedDims.width;
    const rotatedH = rotatedDims.height;

    // For a rectangle W×H rotated by θ, the largest inscribed axis-aligned rectangle
    // (with same aspect ratio) that fits entirely within the original bounds has:
    // scale = cos(θ) + sin(θ) * (shorter_side / longer_side)
    const aspectRatio = originalWidth / originalHeight;
    let scale: number;

    if (aspectRatio >= 1) {
      // Landscape or square
      scale = cos + sin * (originalHeight / originalWidth);
    } else {
      // Portrait
      scale = cos + sin * (originalWidth / originalHeight);
    }

    // The inscribed rectangle dimensions in original image pixels
    const inscribedW = originalWidth / scale;
    const inscribedH = originalHeight / scale;

    // Convert to normalized coordinates relative to expanded canvas
    const cropWidth = Math.min(1.0, inscribedW / rotatedW);
    const cropHeight = Math.min(1.0, inscribedH / rotatedH);

    // Center the crop on the expanded canvas
    const cropX = (1.0 - cropWidth) / 2;
    const cropY = (1.0 - cropHeight) / 2;

    logger.debug(`Auto-crop for ${angleDeg.toFixed(2)}° rotation: inscribed ${inscribedW.toFixed(0)}×${inscribedH.toFixed(0)} in rotated ${rotatedW}×${rotatedH} = ${(cropWidth * 100).toFixed(1)}% × ${(cropHeight * 100).toFixed(1)}%`);

    return {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight
    };
  }

  // ========== PREVIEW MODE METHODS ==========

  isInPreviewMode(): boolean {
    return this.isPreviewMode;
  }

  enterPreviewMode(): void {
    if (!this.isPreviewMode) {
      // Save current state as the applied state
      this.appliedParams = { ...this.params };
      this.isPreviewMode = true;
      logger.info('Entered preview mode');
    }
  }

  applyChanges(): void {
    if (this.isPreviewMode) {
      // Commit preview params as applied state
      this.appliedParams = { ...this.params };
      this.isPreviewMode = false;
      logger.info('Applied crop/transform changes');
    }
  }

  /**
   * After changes are committed and processed, reset to identity params.
   * This should be called AFTER the image has been fully processed and
   * the processed result becomes the new base image.
   */
  resetAfterApply(): void {
    this.params = {
      ...this.params,
      x: 0.0,
      y: 0.0,
      width: 1.0,
      height: 1.0,
      angle: 0.0,
      flipHorizontal: false,
      flipVertical: false
    };
    this.appliedParams = { ...this.params };
    logger.info('Reset crop/transform params after apply');
  }

  cancelChanges(): void {
    if (this.isPreviewMode && this.appliedParams) {
      // Revert to applied state
      this.params = { ...this.appliedParams };
      this.isPreviewMode = false;
      logger.info('Cancelled crop/transform changes');
    }
  }

  getAppliedParams(): CropParams | null {
    return this.appliedParams ? { ...this.appliedParams } : null;
  }
}
