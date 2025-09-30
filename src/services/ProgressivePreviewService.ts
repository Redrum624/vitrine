import { logger } from '../utils/Logger';

export interface PreviewLevel {
  width: number;
  height: number;
  data: Float32Array;
  scaleFactor: number;
  quality: 'fast' | 'balanced' | 'high';
}

export interface ProgressivePreviewOptions {
  maxLevels?: number;
  minSize?: number;
  maxSize?: number;
  qualityProgression?: boolean;
}

export interface PreviewRequest {
  id: string;
  timestamp: number;
  cancelled: boolean;
  onProgress?: (level: PreviewLevel) => void;
  onComplete?: (levels: PreviewLevel[]) => void;
}

export class ProgressivePreviewService {
  private static instance: ProgressivePreviewService;
  private activeRequests = new Map<string, PreviewRequest>();
  private previewCache = new Map<string, PreviewLevel[]>();
  private requestCounter = 0;

  static getInstance(): ProgressivePreviewService {
    if (!ProgressivePreviewService.instance) {
      ProgressivePreviewService.instance = new ProgressivePreviewService();
    }
    return ProgressivePreviewService.instance;
  }

  // Generate cache key for image and parameters
  private getCacheKey(imageData: { width: number; height: number; data: Float32Array }, params: Record<string, unknown> | ProgressivePreviewOptions): string {
    const imageHash = `${imageData.width}x${imageData.height}_${imageData.data.length}`;
    const paramsHash = JSON.stringify(params);
    return `${imageHash}_${paramsHash}`;
  }

  // Calculate optimal preview levels based on image size and options
  private calculatePreviewLevels(
    originalWidth: number,
    originalHeight: number,
    options: ProgressivePreviewOptions = {}
  ): Array<{ width: number; height: number; scaleFactor: number; quality: 'fast' | 'balanced' | 'high' }> {
    const {
      maxLevels = 4,
      minSize = 128,
      maxSize = 1024
    } = options;

    const levels: Array<{ width: number; height: number; scaleFactor: number; quality: 'fast' | 'balanced' | 'high' }> = [];

    // Start with smallest size for immediate feedback
    let currentWidth = Math.max(minSize, Math.min(maxSize, originalWidth / 8));
    let currentHeight = Math.max(minSize, Math.min(maxSize, originalHeight / 8));

    // Ensure aspect ratio is maintained
    const aspectRatio = originalWidth / originalHeight;
    if (currentWidth / currentHeight > aspectRatio) {
      currentWidth = currentHeight * aspectRatio;
    } else {
      currentHeight = currentWidth / aspectRatio;
    }

    // Generate progressive levels
    for (let i = 0; i < maxLevels && (currentWidth < originalWidth || currentHeight < originalHeight); i++) {
      const scaleFactor = currentWidth / originalWidth;

      // Determine quality level based on size
      let quality: 'fast' | 'balanced' | 'high';
      if (scaleFactor < 0.25) {
        quality = 'fast';
      } else if (scaleFactor < 0.5) {
        quality = 'balanced';
      } else {
        quality = 'high';
      }

      levels.push({
        width: Math.round(currentWidth),
        height: Math.round(currentHeight),
        scaleFactor,
        quality
      });

      // Double size for next level
      currentWidth = Math.min(originalWidth, currentWidth * 2);
      currentHeight = Math.min(originalHeight, currentHeight * 2);

      // Maintain aspect ratio
      if (currentWidth / currentHeight > aspectRatio) {
        currentWidth = currentHeight * aspectRatio;
      } else {
        currentHeight = currentWidth / aspectRatio;
      }
    }

    return levels;
  }

  // Advanced downsampling with different quality levels
  private downsampleImage(
    sourceData: Float32Array,
    sourceWidth: number,
    sourceHeight: number,
    sourceChannels: number,
    targetWidth: number,
    targetHeight: number,
    quality: 'fast' | 'balanced' | 'high'
  ): Float32Array {
    const targetData = new Float32Array(targetWidth * targetHeight * 4); // Always output RGBA
    const scaleX = sourceWidth / targetWidth;
    const scaleY = sourceHeight / targetHeight;

    if (quality === 'fast') {
      // Nearest neighbor for fastest preview
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);
          const srcIdx = (srcY * sourceWidth + srcX) * sourceChannels;
          const dstIdx = (y * targetWidth + x) * 4;

          // Copy RGB channels
          targetData[dstIdx] = sourceData[srcIdx] || 0;
          targetData[dstIdx + 1] = sourceData[srcIdx + 1] || 0;
          targetData[dstIdx + 2] = sourceData[srcIdx + 2] || 0;
          targetData[dstIdx + 3] = sourceChannels === 4 ? (sourceData[srcIdx + 3] || 1.0) : 1.0;
        }
      }
    } else if (quality === 'balanced') {
      // Bilinear interpolation for balanced quality/speed
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const srcX = x * scaleX;
          const srcY = y * scaleY;
          const x1 = Math.floor(srcX);
          const y1 = Math.floor(srcY);
          const x2 = Math.min(x1 + 1, sourceWidth - 1);
          const y2 = Math.min(y1 + 1, sourceHeight - 1);
          const dx = srcX - x1;
          const dy = srcY - y1;

          const dstIdx = (y * targetWidth + x) * 4;

          for (let c = 0; c < Math.min(sourceChannels, 3); c++) {
            const tl = sourceData[(y1 * sourceWidth + x1) * sourceChannels + c] || 0;
            const tr = sourceData[(y1 * sourceWidth + x2) * sourceChannels + c] || 0;
            const bl = sourceData[(y2 * sourceWidth + x1) * sourceChannels + c] || 0;
            const br = sourceData[(y2 * sourceWidth + x2) * sourceChannels + c] || 0;

            const top = tl * (1 - dx) + tr * dx;
            const bottom = bl * (1 - dx) + br * dx;
            targetData[dstIdx + c] = top * (1 - dy) + bottom * dy;
          }

          // Alpha channel
          if (sourceChannels === 4) {
            const tl = sourceData[(y1 * sourceWidth + x1) * sourceChannels + 3] || 1.0;
            const tr = sourceData[(y1 * sourceWidth + x2) * sourceChannels + 3] || 1.0;
            const bl = sourceData[(y2 * sourceWidth + x1) * sourceChannels + 3] || 1.0;
            const br = sourceData[(y2 * sourceWidth + x2) * sourceChannels + 3] || 1.0;

            const top = tl * (1 - dx) + tr * dx;
            const bottom = bl * (1 - dx) + br * dx;
            targetData[dstIdx + 3] = top * (1 - dy) + bottom * dy;
          } else {
            targetData[dstIdx + 3] = 1.0;
          }
        }
      }
    } else {
      // High quality area sampling for final preview
      const kernelSize = Math.max(1, Math.floor(Math.min(scaleX, scaleY)));

      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const centerX = x * scaleX;
          const centerY = y * scaleY;
          const dstIdx = (y * targetWidth + x) * 4;

          let r = 0, g = 0, b = 0, a = 0;
          let weight = 0;

          // Sample area around center point
          for (let ky = -kernelSize; ky <= kernelSize; ky++) {
            for (let kx = -kernelSize; kx <= kernelSize; kx++) {
              const sampleX = Math.round(centerX + kx);
              const sampleY = Math.round(centerY + ky);

              if (sampleX >= 0 && sampleX < sourceWidth && sampleY >= 0 && sampleY < sourceHeight) {
                const srcIdx = (sampleY * sourceWidth + sampleX) * sourceChannels;
                const w = 1.0; // Could use Gaussian weights here

                r += (sourceData[srcIdx] || 0) * w;
                g += (sourceData[srcIdx + 1] || 0) * w;
                b += (sourceData[srcIdx + 2] || 0) * w;
                a += (sourceChannels === 4 ? (sourceData[srcIdx + 3] || 1.0) : 1.0) * w;
                weight += w;
              }
            }
          }

          if (weight > 0) {
            targetData[dstIdx] = r / weight;
            targetData[dstIdx + 1] = g / weight;
            targetData[dstIdx + 2] = b / weight;
            targetData[dstIdx + 3] = a / weight;
          }
        }
      }
    }

    return targetData;
  }

  // Create progressive preview with immediate and progressive results
  async createProgressivePreview(
    imageData: { width: number; height: number; data: Float32Array },
    sourceChannels: number,
    options: ProgressivePreviewOptions = {},
    onProgress?: (level: PreviewLevel) => void
  ): Promise<PreviewLevel[]> {
    const requestId = `preview_${++this.requestCounter}`;
    const request: PreviewRequest = {
      id: requestId,
      timestamp: Date.now(),
      cancelled: false,
      onProgress,
    };

    this.activeRequests.set(requestId, request);

    try {
      // Check cache first
      const cacheKey = this.getCacheKey(imageData, options);
      const cached = this.previewCache.get(cacheKey);
      if (cached) {
        logger.debug('Using cached progressive preview');
        return cached;
      }

      const levels = this.calculatePreviewLevels(imageData.width, imageData.height, options);
      const results: PreviewLevel[] = [];

      logger.debug(`Generating ${levels.length} progressive preview levels`);

      for (const levelSpec of levels) {
        // Check if request was cancelled
        if (request.cancelled) {
          logger.debug('Progressive preview cancelled');
          break;
        }

        const startTime = performance.now();

        const levelData = this.downsampleImage(
          imageData.data,
          imageData.width,
          imageData.height,
          sourceChannels,
          levelSpec.width,
          levelSpec.height,
          levelSpec.quality
        );

        const level: PreviewLevel = {
          width: levelSpec.width,
          height: levelSpec.height,
          data: levelData,
          scaleFactor: levelSpec.scaleFactor,
          quality: levelSpec.quality
        };

        results.push(level);

        const processingTime = performance.now() - startTime;
        logger.debug(`Preview level ${levelSpec.width}x${levelSpec.height} (${levelSpec.quality}) generated in ${processingTime.toFixed(2)}ms`);

        // Immediate feedback for each level
        if (onProgress && !request.cancelled) {
          // Use setTimeout to ensure UI updates
          setTimeout(() => onProgress(level), 0);
        }

        // Yield control to prevent blocking UI
        if (processingTime > 5) { // Only yield if processing took more than 5ms
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Cache the complete set of levels
      if (!request.cancelled && results.length > 0) {
        this.previewCache.set(cacheKey, results);

        // Limit cache size to prevent memory issues
        if (this.previewCache.size > 50) {
          const oldestKey = this.previewCache.keys().next().value;
          if (oldestKey) {
            this.previewCache.delete(oldestKey);
          }
        }
      }

      return results;

    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  // Cancel active preview generation
  cancelActiveRequests(): void {
    for (const request of this.activeRequests.values()) {
      request.cancelled = true;
    }
    this.activeRequests.clear();
  }

  // Clear preview cache
  clearCache(): void {
    this.previewCache.clear();
    logger.debug('Progressive preview cache cleared');
  }

  // Get cache statistics
  getCacheStats(): { size: number; entries: number } {
    let totalSize = 0;
    for (const levels of this.previewCache.values()) {
      for (const level of levels) {
        totalSize += level.data.length * 4; // Float32Array bytes
      }
    }
    return {
      size: totalSize,
      entries: this.previewCache.size
    };
  }
}

export const progressivePreviewService = ProgressivePreviewService.getInstance();