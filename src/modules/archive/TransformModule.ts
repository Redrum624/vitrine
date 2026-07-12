import { logger } from '../utils/Logger';

export interface TransformParams {
  enabled: boolean;

  // Rotation
  angle: number;  // Rotation angle in degrees (-45.0 to +45.0)

  // Canvas expansion options
  expandCanvas: boolean;  // true = expand canvas to fit, false = crop to original size
  fillColor: [number, number, number, number];  // RGBA fill color for expanded areas (0-1 range)

  // Interpolation method
  interpolation: 'nearest' | 'bilinear' | 'bicubic';

  // Flip/Mirror
  flipHorizontal: boolean;
  flipVertical: boolean;

  [key: string]: unknown; // Index signature for Record compatibility
}

export interface TransformProcessingContext {
  width: number;
  height: number;
  channels: number;
}

export interface HorizonLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;  // 0.0 to 1.0
  angle: number;       // Angle in degrees from horizontal
}

export class TransformModule {
  private params: TransformParams = {
    enabled: false,
    angle: 0.0,
    expandCanvas: true,
    fillColor: [0, 0, 0, 1],  // Black fill
    interpolation: 'bicubic',
    flipHorizontal: false,
    flipVertical: false
  };

  getId(): string {
    return 'transform';
  }

  getName(): string {
    return 'Transform';
  }

  getParams(): TransformParams {
    return { ...this.params };
  }

  setParams(params: Partial<TransformParams>): void {
    this.params = { ...this.params, ...params };

    // Clamp angle to reasonable range
    this.params.angle = Math.max(-45, Math.min(45, this.params.angle));

    logger.debug(`Transform params updated:`, this.params);
  }

  resetParams(): void {
    this.params = {
      enabled: false,
      angle: 0.0,
      expandCanvas: true,
      fillColor: [0, 0, 0, 1],
      interpolation: 'bicubic',
      flipHorizontal: false,
      flipVertical: false
    };
    logger.debug('Transform params reset to defaults');
  }

  // Process image with transformations
  process(input: Float32Array, context: TransformProcessingContext): Float32Array {
    if (!this.params.enabled) {
      return input;
    }

    const startTime = performance.now();
    let output = input;
    let currentWidth = context.width;
    let currentHeight = context.height;

    // Apply flip/mirror first (fastest operations)
    if (this.params.flipHorizontal) {
      output = this.flipHorizontalInternal(output, currentWidth, currentHeight, context.channels);
    }

    if (this.params.flipVertical) {
      output = this.flipVerticalInternal(output, currentWidth, currentHeight, context.channels);
    }

    // Apply rotation if angle is significant
    if (Math.abs(this.params.angle) > 0.01) {
      output = this.rotate(output, currentWidth, currentHeight, context.channels, this.params.angle);

      // Update dimensions if canvas expanded
      if (this.params.expandCanvas) {
        const newDims = this.getRotatedDimensions(currentWidth, currentHeight, this.params.angle);
        currentWidth = newDims.width;
        currentHeight = newDims.height;
      }
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Transform processing completed in ${processingTime.toFixed(2)}ms`);

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

    switch (this.params.interpolation) {
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

  // Auto-detect horizon/level and straighten image
  detectHorizon(input: Float32Array, context: TransformProcessingContext): HorizonLine | null {
    const { width, height, channels } = context;

    logger.info('Detecting horizon for auto-straighten...');

    // Edge detection using Sobel operator
    const edges = this.detectEdges(input, width, height, channels);

    // Hough transform to detect lines
    const lines = this.houghLineDetection(edges, width, height);

    if (lines.length === 0) {
      logger.warn('No horizon line detected');
      return null;
    }

    // Find most horizontal line (closest to 0 or 180 degrees)
    lines.sort((a, b) => {
      const aDeviation = Math.min(Math.abs(a.angle), Math.abs(a.angle - 180));
      const bDeviation = Math.min(Math.abs(b.angle), Math.abs(b.angle - 180));
      return aDeviation - bDeviation;
    });

    const horizon = lines[0];
    logger.info(`Horizon detected: angle=${horizon.angle.toFixed(2)}°, confidence=${horizon.confidence.toFixed(2)}`);

    return horizon;
  }

  // Simple edge detection (Sobel)
  private detectEdges(input: Float32Array, width: number, height: number, channels: number): Float32Array {
    const edges = new Float32Array(width * height);

    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
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
        edges[y * width + x] = magnitude;
      }
    }

    return edges;
  }

  // Simplified Hough line detection
  private houghLineDetection(edges: Float32Array, width: number, height: number): HorizonLine[] {
    const threshold = 0.3; // Edge magnitude threshold
    const angleResolution = 1; // 1 degree resolution
    const distanceResolution = 1;

    const maxDistance = Math.sqrt(width * width + height * height);
    const numAngles = 180 / angleResolution;
    const numDistances = Math.ceil(maxDistance / distanceResolution);

    const accumulator = new Array(numAngles * numDistances).fill(0);

    // Vote for lines
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] < threshold) continue;

        for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
          const angleDeg = angleIdx * angleResolution;
          const angleRad = (angleDeg * Math.PI) / 180;

          const distance = x * Math.cos(angleRad) + y * Math.sin(angleRad);
          const distanceIdx = Math.floor(distance / distanceResolution);

          if (distanceIdx >= 0 && distanceIdx < numDistances) {
            accumulator[angleIdx * numDistances + distanceIdx]++;
          }
        }
      }
    }

    // Find peaks in accumulator
    const lines: HorizonLine[] = [];
    const minVotes = width * 0.3; // At least 30% of width

    for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
      for (let distanceIdx = 0; distanceIdx < numDistances; distanceIdx++) {
        const votes = accumulator[angleIdx * numDistances + distanceIdx];

        if (votes > minVotes) {
          const angleDeg = angleIdx * angleResolution;
          const distance = distanceIdx * distanceResolution;
          const angleRad = (angleDeg * Math.PI) / 180;

          // Convert to line endpoints
          const x1 = distance * Math.cos(angleRad);
          const y1 = distance * Math.sin(angleRad);
          const x2 = x1 + width * Math.sin(angleRad);
          const y2 = y1 - width * Math.cos(angleRad);

          lines.push({
            x1,
            y1,
            x2,
            y2,
            angle: angleDeg,
            confidence: votes / (width * height)
          });
        }
      }
    }

    return lines.slice(0, 5); // Return top 5 lines
  }

  // Auto-straighten image based on detected horizon
  autoStraighten(input: Float32Array, context: TransformProcessingContext): boolean {
    const horizon = this.detectHorizon(input, context);

    if (!horizon) {
      return false;
    }

    // Calculate angle deviation from horizontal
    let correctionAngle = horizon.angle;

    // Normalize to -45 to +45 range
    if (correctionAngle > 45) {
      correctionAngle -= 90;
    } else if (correctionAngle < -45) {
      correctionAngle += 90;
    }

    // Apply negative angle to straighten
    this.setParams({ angle: -correctionAngle, enabled: true });

    logger.info(`Auto-straighten applied: ${-correctionAngle.toFixed(2)}° correction`);
    return true;
  }

  // Calculate the largest crop rectangle that fits inside a rotated image
  // This removes black borders created by rotation
  calculateAutoCropForRotation(width: number, height: number, angleDeg: number): {
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

    // Calculate the largest inscribed rectangle after rotation
    // Based on the formula for maximum rectangle in rotated rectangle
    const w = width;
    const h = height;

    // Calculate new width and height that avoids black borders
    const newW = (w * cos - h * sin * sin) / (cos * cos - sin * sin);
    const newH = (h * cos - w * sin * sin) / (cos * cos - sin * sin);

    // Ensure we have valid dimensions
    const cropWidth = Math.max(0.1, Math.min(1.0, newW / w));
    const cropHeight = Math.max(0.1, Math.min(1.0, newH / h));

    // Center the crop
    const cropX = (1.0 - cropWidth) / 2;
    const cropY = (1.0 - cropHeight) / 2;

    logger.debug(`Auto-crop for ${angleDeg.toFixed(2)}° rotation: ${(cropWidth * 100).toFixed(1)}% × ${(cropHeight * 100).toFixed(1)}%`);

    return {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight
    };
  }

  // Get the rotation angle
  getRotationAngle(): number {
    return this.params.angle;
  }
}
