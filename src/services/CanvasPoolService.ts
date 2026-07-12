import { logger } from '../utils/Logger';

export interface CanvasPoolEntry {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  inUse: boolean;
  lastUsed: number;
  createdAt: number;
}

/**
 * Canvas pool service to prevent memory leaks from temporary canvas creation
 */
export class CanvasPoolService {
  private static instance: CanvasPoolService;
  private pool = new Map<string, CanvasPoolEntry>();
  private maxPoolSize = 20;
  private maxIdleTime = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL = 60 * 1000; // 1 minute

  constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): CanvasPoolService {
    if (!CanvasPoolService.instance) {
      CanvasPoolService.instance = new CanvasPoolService();
    }
    return CanvasPoolService.instance;
  }

  /**
   * Get or create a canvas with specified dimensions
   */
  getCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; releaseCanvas: () => void } {
    const key = this.getKey(width, height);
    let entry = this.pool.get(key);

    if (entry && !entry.inUse) {
      // Reuse existing canvas
      entry.inUse = true;
      entry.lastUsed = Date.now();

      // Clear the canvas
      entry.context.clearRect(0, 0, width, height);

      logger.debug(`Canvas Pool: Reused canvas ${width}x${height}`);
    } else {
      // Create new canvas
      entry = this.createCanvas(width, height);
      this.pool.set(key, entry);

      logger.debug(`Canvas Pool: Created new canvas ${width}x${height}`);
    }

    // Return canvas with release function
    return {
      canvas: entry.canvas,
      context: entry.context,
      releaseCanvas: () => this.releaseCanvas(width, height)
    };
  }

  /**
   * Create a new canvas entry
   */
  private createCanvas(width: number, height: number): CanvasPoolEntry {
    // Check pool size limit
    if (this.pool.size >= this.maxPoolSize) {
      this.cleanupOldestCanvas();
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get 2D rendering context');
    }

    canvas.width = width;
    canvas.height = height;

    // Optimize canvas for performance
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const entry: CanvasPoolEntry = {
      canvas,
      context,
      width,
      height,
      inUse: true,
      lastUsed: Date.now(),
      createdAt: Date.now()
    };

    return entry;
  }

  /**
   * Release canvas back to pool
   */
  private releaseCanvas(width: number, height: number): void {
    const key = this.getKey(width, height);
    const entry = this.pool.get(key);

    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();

      logger.debug(`Canvas Pool: Released canvas ${width}x${height}`);
    }
  }

  /**
   * Generate key for canvas dimensions
   */
  private getKey(width: number, height: number): string {
    return `${width}x${height}`;
  }

  /**
   * Clean up oldest canvas when pool is full
   */
  private cleanupOldestCanvas(): void {
    let oldestEntry: CanvasPoolEntry | null = null;
    let oldestKey: string | null = null;

    for (const [key, entry] of this.pool.entries()) {
      if (!entry.inUse && (!oldestEntry || entry.lastUsed < oldestEntry.lastUsed)) {
        oldestEntry = entry;
        oldestKey = key;
      }
    }

    if (oldestKey && oldestEntry) {
      this.pool.delete(oldestKey);
      logger.debug(`Canvas Pool: Cleaned up canvas ${oldestEntry.width}x${oldestEntry.height}`);
    }
  }

  /**
   * Start cleanup timer for idle canvases
   */
  private startCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleCanvases();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Clean up canvases that have been idle too long
   */
  private cleanupIdleCanvases(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.pool.entries()) {
      if (!entry.inUse && (now - entry.lastUsed) > this.maxIdleTime) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.pool.get(key);
      this.pool.delete(key);

      if (entry) {
        logger.debug(`Canvas Pool: Cleaned up idle canvas ${entry.width}x${entry.height}`);
      }
    }

    if (keysToDelete.length > 0) {
      logger.info(`Canvas Pool: Cleaned up ${keysToDelete.length} idle canvases`);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalCanvases: number;
    inUseCanvases: number;
    availableCanvases: number;
    oldestCanvas?: { width: number; height: number; age: number };
    memoryEstimate: string;
  } {
    let inUse = 0;
    let oldestCanvas: { width: number; height: number; age: number } | undefined;
    let totalMemory = 0;
    const now = Date.now();

    for (const entry of this.pool.values()) {
      if (entry.inUse) {
        inUse++;
      }

      const age = now - entry.createdAt;
      if (!oldestCanvas || age > oldestCanvas.age) {
        oldestCanvas = { width: entry.width, height: entry.height, age };
      }

      // Estimate memory usage (4 bytes per pixel for RGBA)
      totalMemory += entry.width * entry.height * 4;
    }

    return {
      totalCanvases: this.pool.size,
      inUseCanvases: inUse,
      availableCanvases: this.pool.size - inUse,
      oldestCanvas,
      memoryEstimate: this.formatBytes(totalMemory)
    };
  }

  /**
   * Clear all canvases from pool
   */
  clearPool(): void {
    const stats = this.getStats();
    this.pool.clear();

    logger.info(`Canvas Pool: Cleared ${stats.totalCanvases} canvases, freed ~${stats.memoryEstimate}`);
  }

  /**
   * Set pool configuration
   */
  setConfig(maxPoolSize: number, maxIdleTimeMs: number): void {
    this.maxPoolSize = maxPoolSize;
    this.maxIdleTime = maxIdleTimeMs;

    // Clean up excess canvases if pool is now too large
    while (this.pool.size > this.maxPoolSize) {
      this.cleanupOldestCanvas();
    }

    logger.info(`Canvas Pool: Updated config - maxSize: ${maxPoolSize}, maxIdle: ${maxIdleTimeMs}ms`);
  }

  /**
   * Create temporary canvas (not pooled, for one-time use)
   */
  createTemporaryCanvas(width: number, height: number): {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    cleanup: () => void;
  } {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Failed to get 2D rendering context');
    }

    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    logger.debug(`Canvas Pool: Created temporary canvas ${width}x${height}`);

    return {
      canvas,
      context,
      cleanup: () => {
        // Canvas cleanup is handled by garbage collection
        // but we can clear it to help
        try {
          canvas.width = 0;
          canvas.height = 0;
        } catch {
          // Ignore cleanup errors
        }
        logger.debug(`Canvas Pool: Cleaned up temporary canvas ${width}x${height}`);
      }
    };
  }

  /**
   * Get canvas with automatic cleanup after use
   */
  withCanvas<T>(
    width: number,
    height: number,
    operation: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => T
  ): T {
    const { canvas, context, releaseCanvas } = this.getCanvas(width, height);

    try {
      return operation(canvas, context);
    } finally {
      releaseCanvas();
    }
  }

  /**
   * Get canvas with automatic cleanup for async operations
   */
  async withCanvasAsync<T>(
    width: number,
    height: number,
    operation: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => Promise<T>
  ): Promise<T> {
    const { canvas, context, releaseCanvas } = this.getCanvas(width, height);

    try {
      return await operation(canvas, context);
    } finally {
      releaseCanvas();
    }
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.clearPool();
    logger.info('Canvas Pool: Service destroyed');
  }
}

export const canvasPoolService = CanvasPoolService.getInstance();