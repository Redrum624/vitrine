export interface PyramidLevel {
  level: number;
  width: number;
  height: number;
  scale: number;
  data: Float32Array;
  timestamp: number;
}

export interface PyramidOptions {
  maxLevels: number;
  scaleFactor: number; // 0.5 = half size each level
  minDimension: number; // minimum width/height before stopping
  interpolation: 'linear' | 'cubic' | 'lanczos';
  cacheEnabled: boolean;
  precomputeLevels: number; // how many levels to precompute
}

export interface ProgressiveResult {
  data: Float32Array;
  level: number;
  width: number;
  height: number;
  isComplete: boolean;
  processingTime: number;
}

export interface PyramidCache {
  originalHash: string;
  levels: Map<number, PyramidLevel>;
  lastAccessed: number;
  memoryUsage: number;
}

class PyramidProcessingService {
  private static instance: PyramidProcessingService;
  private pyramidCache: Map<string, PyramidCache> = new Map();
  private maxCacheSize = 1024 * 1024 * 1024; // 1GB cache limit
  private currentCacheSize = 0;
  private processingQueue: Map<string, Promise<PyramidLevel[]>> = new Map();

  private constructor() {
    this.startCacheCleanup();
  }

  static getInstance(): PyramidProcessingService {
    if (!PyramidProcessingService.instance) {
      PyramidProcessingService.instance = new PyramidProcessingService();
    }
    return PyramidProcessingService.instance;
  }

  createDefaultOptions(): PyramidOptions {
    return {
      maxLevels: 8,
      scaleFactor: 0.5,
      minDimension: 64,
      interpolation: 'linear',
      cacheEnabled: true,
      precomputeLevels: 3
    };
  }

  async buildPyramid(
    imageData: Float32Array,
    width: number,
    height: number,
    options: Partial<PyramidOptions> = {}
  ): Promise<PyramidLevel[]> {
    const opts = { ...this.createDefaultOptions(), ...options };
    const imageHash = this.calculateImageHash(imageData, width, height);

    // Check cache first
    if (opts.cacheEnabled) {
      const cached = this.pyramidCache.get(imageHash);
      if (cached) {
        cached.lastAccessed = Date.now();
        return Array.from(cached.levels.values()).sort((a, b) => a.level - b.level);
      }
    }

    // Check if already processing
    const existingProcess = this.processingQueue.get(imageHash);
    if (existingProcess) {
      return existingProcess;
    }

    // Start new pyramid build
    const buildPromise = this.buildPyramidInternal(imageData, width, height, opts, imageHash);
    this.processingQueue.set(imageHash, buildPromise);

    try {
      const pyramid = await buildPromise;
      return pyramid;
    } finally {
      this.processingQueue.delete(imageHash);
    }
  }

  private async buildPyramidInternal(
    imageData: Float32Array,
    width: number,
    height: number,
    options: PyramidOptions,
    imageHash: string
  ): Promise<PyramidLevel[]> {
    const levels: PyramidLevel[] = [];
    let currentData = imageData;
    let currentWidth = width;
    let currentHeight = height;

    // Level 0 (original)
    levels.push({
      level: 0,
      width: currentWidth,
      height: currentHeight,
      scale: 1.0,
      data: currentData.slice(),
      timestamp: Date.now()
    });

    // Generate pyramid levels
    for (let level = 1; level < options.maxLevels; level++) {
      const newWidth = Math.floor(currentWidth * options.scaleFactor);
      const newHeight = Math.floor(currentHeight * options.scaleFactor);

      if (newWidth < options.minDimension || newHeight < options.minDimension) {
        break;
      }

      const scaledData = await this.resizeImage(
        currentData,
        currentWidth,
        currentHeight,
        newWidth,
        newHeight,
        options.interpolation
      );

      levels.push({
        level,
        width: newWidth,
        height: newHeight,
        scale: Math.pow(options.scaleFactor, level),
        data: scaledData,
        timestamp: Date.now()
      });

      currentData = scaledData;
      currentWidth = newWidth;
      currentHeight = newHeight;
    }

    // Cache the pyramid
    if (options.cacheEnabled) {
      this.cachePyramid(imageHash, levels);
    }

    return levels;
  }

  async getProgressiveResult(
    imageData: Float32Array,
    width: number,
    height: number,
    targetLevel: number = 0,
    options: Partial<PyramidOptions> = {}
  ): Promise<ProgressiveResult> {
    const startTime = performance.now();
    const opts = { ...this.createDefaultOptions(), ...options };

    // Build pyramid or get from cache
    const pyramid = await this.buildPyramid(imageData, width, height, opts);

    // Find best available level (may be higher resolution than requested)
    let bestLevel = pyramid.find(level => level.level <= targetLevel);
    if (!bestLevel) {
      bestLevel = pyramid[pyramid.length - 1]; // Use smallest if target too small
    }

    const isComplete = bestLevel.level === 0; // Complete when we have original resolution

    return {
      data: bestLevel.data,
      level: bestLevel.level,
      width: bestLevel.width,
      height: bestLevel.height,
      isComplete,
      processingTime: performance.now() - startTime
    };
  }

  async processAtLevel(
    imageData: Float32Array,
    width: number,
    height: number,
    level: number,
    processor: (data: Float32Array, w: number, h: number) => Float32Array | Promise<Float32Array>,
    options: Partial<PyramidOptions> = {}
  ): Promise<Float32Array> {
    const pyramid = await this.buildPyramid(imageData, width, height, options);

    // Find the requested level
    const pyramidLevel = pyramid.find(p => p.level === level);
    if (!pyramidLevel) {
      throw new Error(`Pyramid level ${level} not found`);
    }

    // Process at the pyramid level
    const processedData = await processor(pyramidLevel.data, pyramidLevel.width, pyramidLevel.height);

    // If processing at original level, return directly
    if (level === 0) {
      return processedData;
    }

    // Otherwise, upscale back to original resolution
    return this.resizeImage(
      processedData,
      pyramidLevel.width,
      pyramidLevel.height,
      width,
      height,
      'cubic'
    );
  }

  async resizeImage(
    imageData: Float32Array,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    interpolation: 'linear' | 'cubic' | 'lanczos' = 'linear'
  ): Promise<Float32Array> {
    const result = new Float32Array(dstWidth * dstHeight * 4);

    const scaleX = srcWidth / dstWidth;
    const scaleY = srcHeight / dstHeight;

    switch (interpolation) {
      case 'linear':
        return this.resizeBilinear(imageData, srcWidth, srcHeight, result, dstWidth, dstHeight, scaleX, scaleY);
      case 'cubic':
        return this.resizeBicubic(imageData, srcWidth, srcHeight, result, dstWidth, dstHeight, scaleX, scaleY);
      case 'lanczos':
        return this.resizeLanczos(imageData, srcWidth, srcHeight, result, dstWidth, dstHeight, scaleX, scaleY);
      default:
        return this.resizeBilinear(imageData, srcWidth, srcHeight, result, dstWidth, dstHeight, scaleX, scaleY);
    }
  }

  private resizeBilinear(
    src: Float32Array,
    srcWidth: number,
    srcHeight: number,
    dst: Float32Array,
    dstWidth: number,
    dstHeight: number,
    scaleX: number,
    scaleY: number
  ): Float32Array {
    for (let dstY = 0; dstY < dstHeight; dstY++) {
      for (let dstX = 0; dstX < dstWidth; dstX++) {
        const srcXf = dstX * scaleX;
        const srcYf = dstY * scaleY;

        const srcX = Math.floor(srcXf);
        const srcY = Math.floor(srcYf);

        const fracX = srcXf - srcX;
        const fracY = srcYf - srcY;

        const x1 = Math.min(srcX + 1, srcWidth - 1);
        const y1 = Math.min(srcY + 1, srcHeight - 1);

        const dstIdx = (dstY * dstWidth + dstX) * 4;

        for (let c = 0; c < 4; c++) {
          const p00 = src[(srcY * srcWidth + srcX) * 4 + c] || 0;
          const p10 = src[(srcY * srcWidth + x1) * 4 + c] || 0;
          const p01 = src[(y1 * srcWidth + srcX) * 4 + c] || 0;
          const p11 = src[(y1 * srcWidth + x1) * 4 + c] || 0;

          const top = p00 * (1 - fracX) + p10 * fracX;
          const bottom = p01 * (1 - fracX) + p11 * fracX;

          dst[dstIdx + c] = top * (1 - fracY) + bottom * fracY;
        }
      }
    }

    return dst;
  }

  private resizeBicubic(
    src: Float32Array,
    srcWidth: number,
    srcHeight: number,
    dst: Float32Array,
    dstWidth: number,
    dstHeight: number,
    scaleX: number,
    scaleY: number
  ): Float32Array {
    const cubicKernel = (t: number): number => {
      const a = -0.5;
      const absT = Math.abs(t);

      if (absT <= 1) {
        return (a + 2) * absT * absT * absT - (a + 3) * absT * absT + 1;
      } else if (absT <= 2) {
        return a * absT * absT * absT - 5 * a * absT * absT + 8 * a * absT - 4 * a;
      }
      return 0;
    };

    for (let dstY = 0; dstY < dstHeight; dstY++) {
      for (let dstX = 0; dstX < dstWidth; dstX++) {
        const srcXf = dstX * scaleX;
        const srcYf = dstY * scaleY;

        const srcX = Math.floor(srcXf);
        const srcY = Math.floor(srcYf);

        const dstIdx = (dstY * dstWidth + dstX) * 4;

        for (let c = 0; c < 4; c++) {
          let value = 0;
          let weightSum = 0;

          for (let ky = -1; ky <= 2; ky++) {
            for (let kx = -1; kx <= 2; kx++) {
              const sx = srcX + kx;
              const sy = srcY + ky;

              if (sx >= 0 && sx < srcWidth && sy >= 0 && sy < srcHeight) {
                const weightX = cubicKernel(srcXf - sx);
                const weightY = cubicKernel(srcYf - sy);
                const weight = weightX * weightY;

                value += src[(sy * srcWidth + sx) * 4 + c] * weight;
                weightSum += weight;
              }
            }
          }

          dst[dstIdx + c] = weightSum > 0 ? value / weightSum : 0;
        }
      }
    }

    return dst;
  }

  private resizeLanczos(
    src: Float32Array,
    srcWidth: number,
    srcHeight: number,
    dst: Float32Array,
    dstWidth: number,
    dstHeight: number,
    scaleX: number,
    scaleY: number
  ): Float32Array {
    const lanczosKernel = (x: number, a: number = 3): number => {
      if (x === 0) return 1;
      if (Math.abs(x) >= a) return 0;

      const piX = Math.PI * x;
      return (a * Math.sin(piX) * Math.sin(piX / a)) / (piX * piX);
    };

    const support = 3;

    for (let dstY = 0; dstY < dstHeight; dstY++) {
      for (let dstX = 0; dstX < dstWidth; dstX++) {
        const srcXf = dstX * scaleX;
        const srcYf = dstY * scaleY;

        const dstIdx = (dstY * dstWidth + dstX) * 4;

        for (let c = 0; c < 4; c++) {
          let value = 0;
          let weightSum = 0;

          const xStart = Math.max(0, Math.floor(srcXf - support));
          const xEnd = Math.min(srcWidth - 1, Math.ceil(srcXf + support));
          const yStart = Math.max(0, Math.floor(srcYf - support));
          const yEnd = Math.min(srcHeight - 1, Math.ceil(srcYf + support));

          for (let sy = yStart; sy <= yEnd; sy++) {
            for (let sx = xStart; sx <= xEnd; sx++) {
              const weightX = lanczosKernel(srcXf - sx);
              const weightY = lanczosKernel(srcYf - sy);
              const weight = weightX * weightY;

              value += src[(sy * srcWidth + sx) * 4 + c] * weight;
              weightSum += weight;
            }
          }

          dst[dstIdx + c] = weightSum > 0 ? value / weightSum : 0;
        }
      }
    }

    return dst;
  }

  getPyramidInfo(imageHash: string): {
    levels: number;
    memoryUsage: number;
    lastAccessed: number;
  } | null {
    const cached = this.pyramidCache.get(imageHash);
    if (!cached) return null;

    return {
      levels: cached.levels.size,
      memoryUsage: cached.memoryUsage,
      lastAccessed: cached.lastAccessed
    };
  }

  getOptimalLevel(targetWidth: number, targetHeight: number, originalWidth: number, originalHeight: number): number {
    const scaleX = targetWidth / originalWidth;
    const scaleY = targetHeight / originalHeight;
    const scale = Math.max(scaleX, scaleY);

    if (scale >= 1.0) return 0; // Use original

    // Find the pyramid level that's closest to but larger than the target scale
    return Math.max(0, Math.floor(-Math.log2(scale)));
  }

  async precomputePyramid(
    imageData: Float32Array,
    width: number,
    height: number,
    levels: number = 3,
    options: Partial<PyramidOptions> = {}
  ): Promise<void> {
    const opts = { ...this.createDefaultOptions(), ...options, precomputeLevels: levels };
    await this.buildPyramid(imageData, width, height, opts);
  }

  private calculateImageHash(imageData: Float32Array, width: number, height: number): string {
    // Simple hash based on image dimensions and sample pixels
    let hash = width ^ height;
    const step = Math.max(1, Math.floor(imageData.length / 100)); // Sample 100 points

    for (let i = 0; i < imageData.length; i += step) {
      hash = ((hash << 5) - hash + Math.round(imageData[i] * 255)) | 0;
    }

    return hash.toString(36);
  }

  private cachePyramid(imageHash: string, levels: PyramidLevel[]): void {
    let memoryUsage = 0;
    const levelMap = new Map<number, PyramidLevel>();

    levels.forEach(level => {
      levelMap.set(level.level, level);
      memoryUsage += level.data.byteLength;
    });

    // Check if we need to free space
    while (this.currentCacheSize + memoryUsage > this.maxCacheSize && this.pyramidCache.size > 0) {
      this.evictOldestCache();
    }

    const cache: PyramidCache = {
      originalHash: imageHash,
      levels: levelMap,
      lastAccessed: Date.now(),
      memoryUsage
    };

    this.pyramidCache.set(imageHash, cache);
    this.currentCacheSize += memoryUsage;
  }

  private evictOldestCache(): void {
    let oldestTime = Date.now();
    let oldestKey = '';

    for (const [key, cache] of this.pyramidCache.entries()) {
      if (cache.lastAccessed < oldestTime) {
        oldestTime = cache.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const cache = this.pyramidCache.get(oldestKey);
      if (cache) {
        this.currentCacheSize -= cache.memoryUsage;
        this.pyramidCache.delete(oldestKey);
      }
    }
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10 minutes

      for (const [key, cache] of this.pyramidCache.entries()) {
        if (now - cache.lastAccessed > maxAge) {
          this.currentCacheSize -= cache.memoryUsage;
          this.pyramidCache.delete(key);
        }
      }
    }, 60000); // Check every minute
  }

  getCacheStats(): {
    entries: number;
    memoryUsage: number;
    maxMemory: number;
    hitRate: number;
  } {
    return {
      entries: this.pyramidCache.size,
      memoryUsage: this.currentCacheSize,
      maxMemory: this.maxCacheSize,
      hitRate: 0 // Would need to track hits/misses for accurate calculation
    };
  }

  clearCache(): void {
    this.pyramidCache.clear();
    this.currentCacheSize = 0;
  }

  setCacheSize(sizeInBytes: number): void {
    this.maxCacheSize = sizeInBytes;

    // Evict entries if over new limit
    while (this.currentCacheSize > this.maxCacheSize && this.pyramidCache.size > 0) {
      this.evictOldestCache();
    }
  }

  async createThumbnail(
    imageData: Float32Array,
    width: number,
    height: number,
    maxDimension: number = 256
  ): Promise<{ data: Float32Array; width: number; height: number }> {
    const scale = Math.min(maxDimension / width, maxDimension / height);

    if (scale >= 1) {
      return { data: imageData.slice(), width, height };
    }

    const newWidth = Math.round(width * scale);
    const newHeight = Math.round(height * scale);

    const thumbnailData = await this.resizeImage(
      imageData, width, height, newWidth, newHeight, 'cubic'
    );

    return {
      data: thumbnailData,
      width: newWidth,
      height: newHeight
    };
  }

  dispose(): void {
    this.clearCache();
    this.processingQueue.clear();
  }
}

export default PyramidProcessingService;