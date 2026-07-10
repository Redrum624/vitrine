import { logger } from '../utils/Logger';

export interface CacheEntry {
  id: string;
  data: Float32Array;
  width: number;
  height: number;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  size: number; // In bytes
  metadata?: Record<string, unknown>;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  mostAccessed: string[];
  oldestEntry?: string;
}

/**
 * LRU Cache for processed images and thumbnails
 */
export class ImageCacheService {
  private static instance: ImageCacheService;
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private maxEntries: number;
  private currentSize = 0;
  private hitCount = 0;
  private missCount = 0;

  // Cache configuration
  private readonly DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500MB
  private readonly DEFAULT_MAX_ENTRIES = 100;
  private readonly CLEANUP_THRESHOLD = 0.9; // Start cleanup at 90% capacity

  constructor(maxSize?: number, maxEntries?: number) {
    this.maxSize = maxSize || this.DEFAULT_MAX_SIZE;
    this.maxEntries = maxEntries || this.DEFAULT_MAX_ENTRIES;
  }

  static getInstance(): ImageCacheService {
    if (!ImageCacheService.instance) {
      ImageCacheService.instance = new ImageCacheService();
    }
    return ImageCacheService.instance;
  }

  /**
   * Generate cache key from image parameters
   */
  private generateKey(
    filePath: string,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>
  ): string {
    const paramsHash = processingParams
      ? JSON.stringify(processingParams)
      : '';

    return `${filePath}_${width}x${height}_${this.hashCode(paramsHash)}`;
  }

  /**
   * Canonical, size- AND options-agnostic key for an image's decoded BASE pixels
   * (the result of the initial LibRaw/regular decode or a RAW re-decode). Distinct
   * namespace from generateKey()'s sized keys, so a base entry can never collide with
   * a sized/thumbnail entry. The REAL width/height live in the CacheEntry payload, not
   * the key — that's what lets a reopen look the base up without knowing its dimensions.
   */
  private generateBaseKey(filePath: string): string {
    return `${filePath}__BASE__`;
  }

  /**
   * Simple hash function for cache keys
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Store image in cache
   */
  set(
    filePath: string,
    imageData: Float32Array,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): void {
    this.setWithKey(this.generateKey(filePath, width, height, processingParams), imageData, width, height, metadata);
  }

  /**
   * Store an image's decoded BASE pixels (initial decode or RAW re-decode) under the
   * size- and options-agnostic base key, so a later reopen of the same path serves these
   * pixels via getBase() instead of running a full (multi-second) decode again.
   *
   * Coherence: this cache is in-memory only (it does not survive the session), and every
   * base write for a given path targets the SAME key — a RAW re-decode with new options
   * OVERWRITES the prior entry rather than leaving a stale one behind. There is therefore at
   * most one base entry per path and it always reflects the most recent decode. The REAL
   * width/height are kept in the entry payload so getBase() reconstructs correct dimensions.
   *
   * Practical bound: the total budget is DEFAULT_MAX_SIZE (500MB), and a single entry larger
   * than that is refused outright rather than evicting the whole cache to make room (see
   * setWithKey). In practice this comfortably holds ONE large RAW base (e.g. a 40MP+ Float32
   * RGBA decode); switching between several such large RAWs in the same session may still
   * re-decode more than once. Accepted design limit, not a bug.
   */
  setBase(
    filePath: string,
    imageData: Float32Array,
    width: number,
    height: number,
    metadata?: Record<string, unknown>
  ): void {
    this.setWithKey(this.generateBaseKey(filePath), imageData, width, height, metadata);
  }

  private setWithKey(
    key: string,
    imageData: Float32Array,
    width: number,
    height: number,
    metadata?: Record<string, unknown>
  ): void {
    const size = imageData.byteLength;
    const now = Date.now();

    // An entry larger than the entire cache budget can never be satisfied by cleanup()'s
    // eviction loop (its break condition — current size at/under target — is unreachable
    // when the incoming entry alone exceeds maxSize), so it would evict every other entry
    // and still get stored. Refuse it instead: the caller (typically a RAW reopen) simply
    // decodes fresh, and every other cached entry survives untouched.
    if (size > this.maxSize) {
      logger.debug(`Cache: Refusing oversized entry ${key} (${this.formatBytes(size)} > ${this.formatBytes(this.maxSize)} max) — not cached`);
      return;
    }

    // Check if we need to make space
    if (this.shouldCleanup(size)) {
      this.cleanup(size);
    }

    // Create cache entry
    const entry: CacheEntry = {
      id: key,
      data: new Float32Array(imageData), // Create a copy
      width,
      height,
      timestamp: now,
      accessCount: 0,
      lastAccessed: now,
      size,
      metadata
    };

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existingEntry = this.cache.get(key)!;
      this.currentSize -= existingEntry.size;
    }

    // Add new entry
    this.cache.set(key, entry);
    this.currentSize += size;

    logger.debug(`Cache: Stored image ${key} (${this.formatBytes(size)})`);
    this.logCacheStats();
  }

  /**
   * Retrieve image from cache
   */
  get(
    filePath: string,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>
  ): CacheEntry | null {
    return this.getWithKey(this.generateKey(filePath, width, height, processingParams));
  }

  /**
   * Retrieve an image's decoded BASE pixels for a path (see setBase). Size-agnostic:
   * the caller does not need to know the image's dimensions to hit this entry.
   */
  getBase(filePath: string): CacheEntry | null {
    return this.getWithKey(this.generateBaseKey(filePath));
  }

  private getWithKey(key: string): CacheEntry | null {
    const entry = this.cache.get(key);

    if (entry) {
      // Update access statistics
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.hitCount++;

      // Move to end of map (LRU behavior)
      this.cache.delete(key);
      this.cache.set(key, entry);

      logger.debug(`Cache: Hit for ${key} (accessed ${entry.accessCount} times)`);
      return entry;
    }

    this.missCount++;
    logger.debug(`Cache: Miss for ${key}`);
    return null;
  }

  /**
   * Check if image exists in cache
   */
  has(
    filePath: string,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>
  ): boolean {
    const key = this.generateKey(filePath, width, height, processingParams);
    return this.cache.has(key);
  }

  /**
   * Remove specific entry from cache
   */
  delete(
    filePath: string,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>
  ): boolean {
    const key = this.generateKey(filePath, width, height, processingParams);
    const entry = this.cache.get(key);

    if (entry) {
      this.cache.delete(key);
      this.currentSize -= entry.size;
      logger.debug(`Cache: Removed ${key} (${this.formatBytes(entry.size)})`);
      return true;
    }

    return false;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const entriesCount = this.cache.size;
    const sizeFreed = this.currentSize;

    this.cache.clear();
    this.currentSize = 0;
    this.hitCount = 0;
    this.missCount = 0;

    logger.info(`Cache: Cleared ${entriesCount} entries, freed ${this.formatBytes(sizeFreed)}`);
  }

  /**
   * Check if cleanup is needed
   */
  private shouldCleanup(incomingSize: number): boolean {
    const wouldExceedSize = (this.currentSize + incomingSize) > (this.maxSize * this.CLEANUP_THRESHOLD);
    const wouldExceedEntries = this.cache.size >= this.maxEntries;

    return wouldExceedSize || wouldExceedEntries;
  }

  /**
   * Cleanup old or least used entries
   */
  private cleanup(incomingSize: number): void {
    const targetSize = this.maxSize * 0.7; // Clean to 70% capacity
    const targetEntries = Math.floor(this.maxEntries * 0.8); // Clean to 80% capacity

    // Convert to array and sort by LRU criteria
    const entries = Array.from(this.cache.entries());

    // Sort by: last accessed (ascending) and access count (ascending)
    entries.sort(([, a], [, b]) => {
      const scoreDiff = this.calculateLRUScore(a) - this.calculateLRUScore(b);
      return scoreDiff !== 0 ? scoreDiff : a.lastAccessed - b.lastAccessed;
    });

    let removedCount = 0;
    let removedSize = 0;

    for (const [key, entry] of entries) {
      if (this.currentSize - removedSize <= targetSize &&
          this.cache.size - removedCount <= targetEntries) {
        break;
      }

      if (this.currentSize - removedSize + incomingSize <= this.maxSize) {
        break;
      }

      this.cache.delete(key);
      removedCount++;
      removedSize += entry.size;
    }

    this.currentSize -= removedSize;

    logger.info(`Cache: Cleaned up ${removedCount} entries, freed ${this.formatBytes(removedSize)}`);
  }

  /**
   * Calculate LRU score (lower = more likely to be evicted)
   */
  private calculateLRUScore(entry: CacheEntry): number {
    const now = Date.now();
    const ageScore = now - entry.lastAccessed; // Older = higher score
    const accessScore = -entry.accessCount * 1000; // More accessed = lower score
    return ageScore + accessScore;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;

    // Find most accessed entries
    const entries = Array.from(this.cache.values());
    const mostAccessed = entries
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 5)
      .map(entry => entry.id);

    // Find oldest entry
    const oldestEntry = entries
      .sort((a, b) => a.timestamp - b.timestamp)[0]?.id;

    return {
      totalEntries: this.cache.size,
      totalSize: this.currentSize,
      hitRate: Math.round(hitRate * 100) / 100,
      mostAccessed,
      oldestEntry
    };
  }

  /**
   * Get cache utilization percentage
   */
  getUtilization(): { size: number; entries: number } {
    return {
      size: Math.round((this.currentSize / this.maxSize) * 100),
      entries: Math.round((this.cache.size / this.maxEntries) * 100)
    };
  }

  /**
   * Set cache limits
   */
  setLimits(maxSize: number, maxEntries: number): void {
    this.maxSize = maxSize;
    this.maxEntries = maxEntries;

    // Trigger cleanup if necessary
    if (this.currentSize > maxSize || this.cache.size > maxEntries) {
      this.cleanup(0);
    }

    logger.info(`Cache: Updated limits to ${this.formatBytes(maxSize)} and ${maxEntries} entries`);
  }

  /**
   * Prefetch image data (for anticipated usage)
   */
  async prefetch(
    filePath: string,
    width: number,
    height: number,
    processingParams?: Record<string, unknown>,
    loader?: () => Promise<{ data: Float32Array; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    // Check if already cached
    if (this.has(filePath, width, height, processingParams)) {
      return;
    }

    // Load and cache if loader provided
    if (loader) {
      try {
        const result = await loader();
        this.set(filePath, result.data, width, height, processingParams, result.metadata);
        logger.debug(`Cache: Prefetched ${filePath}`);
      } catch (error) {
        logger.warn(`Cache: Prefetch failed for ${filePath}:`, error);
      }
    }
  }

  /**
   * Format bytes for human reading
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Log cache statistics
   */
  private logCacheStats(): void {
    if (this.cache.size % 10 === 0) { // Log every 10 entries
      const stats = this.getStats();
      logger.debug(`Cache Stats: ${stats.totalEntries} entries, ${this.formatBytes(stats.totalSize)}, ${stats.hitRate}% hit rate`);
    }
  }

  /**
   * Export cache contents (for debugging)
   */
  exportCache(): Array<Omit<CacheEntry, 'data'>> {
    return Array.from(this.cache.values()).map(entry => ({
      id: entry.id,
      width: entry.width,
      height: entry.height,
      timestamp: entry.timestamp,
      accessCount: entry.accessCount,
      lastAccessed: entry.lastAccessed,
      size: entry.size,
      metadata: entry.metadata
    }));
  }
}

export const imageCacheService = ImageCacheService.getInstance();