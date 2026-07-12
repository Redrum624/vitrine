/**
 * ObjectPoolService - Float32Array Memory Pool Management
 *
 * Provides efficient memory allocation for image processing operations
 * by pooling and reusing Float32Array instances. This eliminates garbage
 * collection overhead for large array allocations during processing.
 *
 * Features:
 * - Size-bucketed pools for efficient memory reuse
 * - Automatic cleanup of unused arrays
 * - Thread-safe design for Web Worker compatibility
 * - Memory usage tracking and statistics
 */

import { logger } from '../utils/Logger';

/**
 * Configuration for a pooled array
 */
interface PooledArray {
  array: Float32Array;
  size: number;
  inUse: boolean;
  lastUsed: number;
  bucket: number;
}

/**
 * Pool statistics
 */
interface PoolStats {
  totalArrays: number;
  inUseArrays: number;
  availableArrays: number;
  totalMemoryBytes: number;
  inUseMemoryBytes: number;
  bucketsStats: Map<number, { total: number; inUse: number }>;
}

/**
 * Configuration for the object pool
 */
interface ObjectPoolConfig {
  /** Initial number of arrays per bucket */
  initialPoolSize: number;
  /** Maximum number of arrays per bucket */
  maxPoolSize: number;
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs: number;
  /** Size buckets in elements (not bytes) */
  sizeBuckets: number[];
  /** Maximum age before cleanup (ms) */
  maxIdleTimeMs: number;
}

const DEFAULT_CONFIG: ObjectPoolConfig = {
  initialPoolSize: 2,
  maxPoolSize: 10,
  cleanupIntervalMs: 30000, // 30 seconds
  // Common image sizes: 64KB, 256KB, 1MB, 4MB, 16MB, 48MB (in Float32 elements)
  sizeBuckets: [
    16384,    // 64KB (64x64 RGBA)
    65536,    // 256KB (128x128 RGBA)
    262144,   // 1MB (256x256 RGBA)
    1048576,  // 4MB (512x512 RGBA)
    4194304,  // 16MB (1024x1024 RGBA)
    12000000, // ~48MB (2000x1500 RGBA - common photo size)
    48000000, // ~192MB (4000x3000 RGBA - 12MP)
  ],
  maxIdleTimeMs: 60000, // 1 minute
};

/**
 * Object Pool Service for Float32Array management
 */
class ObjectPoolServiceImpl {
  private pools: Map<number, PooledArray[]>;
  private config: ObjectPoolConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private allocationCount = 0;
  private reuseCount = 0;

  constructor(config: Partial<ObjectPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pools = new Map();

    // Initialize empty pools for each bucket
    for (const bucketSize of this.config.sizeBuckets) {
      this.pools.set(bucketSize, []);
    }

    // Start cleanup timer
    this.startCleanupTimer();

    logger.debug('ObjectPoolService initialized', {
      buckets: this.config.sizeBuckets,
      maxPoolSize: this.config.maxPoolSize,
    });
  }

  /**
   * Find the appropriate bucket size for a requested size
   */
  private findBucket(requestedSize: number): number {
    for (const bucketSize of this.config.sizeBuckets) {
      if (bucketSize >= requestedSize) {
        return bucketSize;
      }
    }
    // If no bucket is large enough, return the requested size (no pooling)
    return requestedSize;
  }

  /**
   * Acquire a Float32Array from the pool
   * @param size Minimum required size in elements
   * @returns Float32Array of at least the requested size
   */
  acquire(size: number): Float32Array {
    const bucketSize = this.findBucket(size);
    const pool = this.pools.get(bucketSize);

    if (pool) {
      // Try to find an available array in the pool
      for (const pooled of pool) {
        if (!pooled.inUse) {
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          this.reuseCount++;

          // Zero out the array for clean state
          pooled.array.fill(0);

          logger.debug('ObjectPool: Reused array from pool', {
            bucket: bucketSize,
            requested: size,
          });

          return pooled.array;
        }
      }

      // No available array, create new one if under limit
      if (pool.length < this.config.maxPoolSize) {
        const newArray = new Float32Array(bucketSize);
        const pooled: PooledArray = {
          array: newArray,
          size: bucketSize,
          inUse: true,
          lastUsed: Date.now(),
          bucket: bucketSize,
        };
        pool.push(pooled);
        this.allocationCount++;

        logger.debug('ObjectPool: Created new pooled array', {
          bucket: bucketSize,
          poolSize: pool.length,
        });

        return newArray;
      }
    }

    // Pool is full or no matching bucket - allocate without pooling
    this.allocationCount++;
    logger.debug('ObjectPool: Allocated unpooled array', { size });
    return new Float32Array(size);
  }

  /**
   * Release a Float32Array back to the pool
   * @param array The array to release
   */
  release(array: Float32Array): void {
    const size = array.length;
    const bucketSize = this.findBucket(size);
    const pool = this.pools.get(bucketSize);

    if (pool) {
      // Find the pooled array entry
      for (const pooled of pool) {
        if (pooled.array === array) {
          pooled.inUse = false;
          pooled.lastUsed = Date.now();

          logger.debug('ObjectPool: Released array to pool', {
            bucket: bucketSize,
          });

          return;
        }
      }
    }

    // Array wasn't from this pool - let GC handle it
    logger.debug('ObjectPool: Array not from pool, releasing to GC', { size });
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    let totalArrays = 0;
    let inUseArrays = 0;
    let totalMemoryBytes = 0;
    let inUseMemoryBytes = 0;
    const bucketsStats = new Map<number, { total: number; inUse: number }>();

    for (const [bucketSize, pool] of this.pools) {
      let bucketTotal = 0;
      let bucketInUse = 0;

      for (const pooled of pool) {
        bucketTotal++;
        totalArrays++;
        const memorySize = pooled.size * 4; // Float32 = 4 bytes
        totalMemoryBytes += memorySize;

        if (pooled.inUse) {
          bucketInUse++;
          inUseArrays++;
          inUseMemoryBytes += memorySize;
        }
      }

      bucketsStats.set(bucketSize, { total: bucketTotal, inUse: bucketInUse });
    }

    return {
      totalArrays,
      inUseArrays,
      availableArrays: totalArrays - inUseArrays,
      totalMemoryBytes,
      inUseMemoryBytes,
      bucketsStats,
    };
  }

  /**
   * Get allocation statistics
   */
  getAllocationStats(): { allocations: number; reuses: number; reuseRate: number } {
    const total = this.allocationCount + this.reuseCount;
    return {
      allocations: this.allocationCount,
      reuses: this.reuseCount,
      reuseRate: total > 0 ? this.reuseCount / total : 0,
    };
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up old unused arrays
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [_bucketSize, pool] of this.pools) {
      // Remove old, unused arrays (keep at least initialPoolSize)
      const minKeep = this.config.initialPoolSize;
      let available = pool.filter((p) => !p.inUse).length;

      for (let i = pool.length - 1; i >= 0 && available > minKeep; i--) {
        const pooled = pool[i];
        if (!pooled.inUse && now - pooled.lastUsed > this.config.maxIdleTimeMs) {
          pool.splice(i, 1);
          available--;
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.debug('ObjectPool: Cleaned up idle arrays', { cleaned });
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      pool.length = 0;
    }

    this.allocationCount = 0;
    this.reuseCount = 0;

    logger.debug('ObjectPool: All pools cleared');
  }

  /**
   * Destroy the pool service
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.clear();
    logger.debug('ObjectPoolService destroyed');
  }

  /**
   * Pre-warm the pool with initial allocations
   */
  prewarm(): void {
    for (const bucketSize of this.config.sizeBuckets) {
      const pool = this.pools.get(bucketSize);
      if (pool && pool.length < this.config.initialPoolSize) {
        const toCreate = this.config.initialPoolSize - pool.length;
        for (let i = 0; i < toCreate; i++) {
          const array = new Float32Array(bucketSize);
          pool.push({
            array,
            size: bucketSize,
            inUse: false,
            lastUsed: Date.now(),
            bucket: bucketSize,
          });
        }
      }
    }

    logger.debug('ObjectPool: Pre-warmed pools', {
      buckets: this.config.sizeBuckets.length,
    });
  }
}

// Export singleton instance
export const objectPoolService = new ObjectPoolServiceImpl();

// Export class for testing or custom instances
export { ObjectPoolServiceImpl };
export type { ObjectPoolConfig, PoolStats };
