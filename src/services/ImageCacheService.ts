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

  // Dedicated budget for __BASE__ entries (RAW/regular decode base pixels), tracked and
  // evicted completely independently from the shared `maxSize`/`currentSize` used by sized
  // (generateKey) entries. See setBase()'s doc comment for the memory-sizing rationale — this
  // is what lets the app hold 2-3 large RAW bases in the same session without a sized entry
  // (e.g. a prefetch) ever stealing room from them, or vice versa.
  private baseMaxSize: number;
  private baseCurrentSize = 0;

  // Cache configuration
  private readonly DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500MB — shared budget for sized/thumbnail entries
  private readonly DEFAULT_BASE_MAX_SIZE = 700 * 1024 * 1024; // 700MB — dedicated budget for RAW/regular decode bases
  private readonly DEFAULT_MAX_ENTRIES = 100;
  private readonly CLEANUP_THRESHOLD = 0.9; // Start cleanup at 90% capacity
  private readonly BASE_KEY_SUFFIX = '__BASE__';

  constructor(maxSize?: number, maxEntries?: number, baseMaxSize?: number) {
    this.maxSize = maxSize || this.DEFAULT_MAX_SIZE;
    this.maxEntries = maxEntries || this.DEFAULT_MAX_ENTRIES;
    this.baseMaxSize = baseMaxSize || this.DEFAULT_BASE_MAX_SIZE;
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
    return `${filePath}${this.BASE_KEY_SUFFIX}`;
  }

  /**
   * Whether a cache key belongs to the __BASE__ namespace (see generateBaseKey). Base entries
   * are accounted and evicted against `baseMaxSize`/`baseCurrentSize`, entirely independent of
   * the shared `maxSize`/`currentSize` used by sized (generateKey) entries — a base eviction
   * can never take a sized/thumbnail entry, and vice versa.
   */
  private isBaseKey(key: string): boolean {
    return key.endsWith(this.BASE_KEY_SUFFIX);
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
   * Budget: base entries are accounted against a DEDICATED `baseMaxSize` (default
   * DEFAULT_BASE_MAX_SIZE, 700MB) rather than the shared `maxSize` used by sized/thumbnail
   * entries — a base write or eviction never touches, and is never touched by, the sized
   * cache. Sizing rationale: a 20MP Float32 RGBA base is ~310MB, so 700MB holds TWO such
   * bases (620MB) with room to spare below the 90% cleanup threshold (630MB) — an A→B→A
   * switch between two large RAWs serves both from cache with zero re-decodes. Smaller RAWs
   * (12-16MP) fit three or more automatically since accounting is size-based, not
   * count-based. Beyond that, the LRU evicts the oldest base ONLY — sized/thumbnail entries
   * are never affected by a base eviction. This ceiling is a deliberate memory trade-off: two
   * resident bases (~620MB) plus the working copy, an undo/original snapshot, and GPU
   * textures already puts a session in the 1.5-2GB range, which is the accepted cost for
   * multi-image reopen speed. The guard in setWithKey refuses a single entry larger than its
   * category's budget outright rather than evicting the whole cache to make room.
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
    const isBase = this.isBaseKey(key);
    const budget = isBase ? this.baseMaxSize : this.maxSize;

    // An entry larger than its category's entire budget can never be satisfied by cleanup()'s
    // eviction loop (its break condition — current size at/under target — is unreachable
    // when the incoming entry alone exceeds the budget), so it would evict every other entry
    // in that category and still get stored. Refuse it instead: the caller (typically a RAW
    // reopen) simply decodes fresh, and every other cached entry (in EITHER category) survives
    // untouched.
    if (size > budget) {
      logger.debug(`Cache: Refusing oversized ${isBase ? 'base ' : ''}entry ${key} (${this.formatBytes(size)} > ${this.formatBytes(budget)} ${isBase ? 'base ' : ''}max) — not cached`);
      return;
    }

    // Check if we need to make space (within this entry's own category only)
    if (this.shouldCleanup(size, isBase)) {
      this.cleanup(size, isBase);
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
      if (isBase) {
        this.baseCurrentSize -= existingEntry.size;
      } else {
        this.currentSize -= existingEntry.size;
      }
    }

    // Add new entry
    this.cache.set(key, entry);
    if (isBase) {
      this.baseCurrentSize += size;
    } else {
      this.currentSize += size;
    }

    logger.debug(`Cache: Stored ${isBase ? 'base ' : ''}image ${key} (${this.formatBytes(size)})`);
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
    const sizeFreed = this.currentSize + this.baseCurrentSize;

    this.cache.clear();
    this.currentSize = 0;
    this.baseCurrentSize = 0;
    this.hitCount = 0;
    this.missCount = 0;

    logger.info(`Cache: Cleared ${entriesCount} entries, freed ${this.formatBytes(sizeFreed)}`);
  }

  /**
   * Number of entries currently in the given category (base vs sized) — never the whole cache.
   * Used to keep the `maxEntries` backstop honest per category (see shouldCleanup/cleanup):
   * counting against the COMBINED cache.size let a category with many small entries (e.g. lots
   * of sized/thumbnail entries) trip the entries backstop for the OTHER category (e.g. a new
   * base) even though that category itself was nowhere near its own limit — cleanup() then
   * evicted base entries (expensive RAW decodes) to satisfy a count threshold it could never
   * actually reach that way, since it only ever removes entries from its own category.
   */
  private categoryEntryCount(isBase: boolean): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (this.isBaseKey(key) === isBase) count++;
    }
    return count;
  }

  /**
   * Check if cleanup is needed for an incoming entry of the given category (base vs sized).
   * Both the size AND the entry-count checks are against that category's OWN accounting — a
   * base entry can never trigger cleanup of the sized budget/count, or vice versa.
   */
  private shouldCleanup(incomingSize: number, isBase: boolean): boolean {
    const currentSize = isBase ? this.baseCurrentSize : this.currentSize;
    const budget = isBase ? this.baseMaxSize : this.maxSize;
    const wouldExceedSize = (currentSize + incomingSize) > (budget * this.CLEANUP_THRESHOLD);
    const wouldExceedEntries = this.categoryEntryCount(isBase) >= this.maxEntries;

    return wouldExceedSize || wouldExceedEntries;
  }

  /**
   * Cleanup old or least used entries — restricted to the SAME category (base vs sized) as the
   * incoming entry. Candidates are filtered to that category before sorting, so a base
   * eviction can only ever remove other base entries (never a sized/thumbnail entry) and vice
   * versa; each category is evicted against its own budget AND its own entry count.
   */
  private cleanup(incomingSize: number, isBase: boolean): void {
    const budget = isBase ? this.baseMaxSize : this.maxSize;
    const targetSize = budget * 0.7; // Clean to 70% capacity
    const targetEntries = Math.floor(this.maxEntries * 0.8); // Clean to 80% capacity

    // Convert to array (restricted to this entry's category) and sort by LRU criteria
    const entries = Array.from(this.cache.entries()).filter(([key]) => this.isBaseKey(key) === isBase);

    // Sort by: last accessed (ascending) and access count (ascending)
    entries.sort(([, a], [, b]) => {
      const scoreDiff = this.calculateLRUScore(a) - this.calculateLRUScore(b);
      return scoreDiff !== 0 ? scoreDiff : a.lastAccessed - b.lastAccessed;
    });

    let removedCount = 0;
    let removedSize = 0;
    const startSize = isBase ? this.baseCurrentSize : this.currentSize;
    const startEntries = entries.length; // THIS category's own count, not the whole cache

    for (const [key, entry] of entries) {
      const sizeAtTarget = startSize - removedSize <= targetSize;
      const entriesAtTarget = startEntries - removedCount <= targetEntries;
      if (sizeAtTarget && entriesAtTarget) {
        break;
      }

      // Early-exit once the incoming entry already fits within budget — but ONLY when the
      // entries count is also satisfied. A category can have ample size headroom (e.g. many
      // tiny base entries under a 700MB budget) while still being way over its entries target;
      // without the `entriesAtTarget` guard this exit fired immediately on every call and the
      // entries backstop could never actually evict anything for such a category.
      if (entriesAtTarget && startSize - removedSize + incomingSize <= budget) {
        break;
      }

      this.cache.delete(key);
      removedCount++;
      removedSize += entry.size;
    }

    if (isBase) {
      this.baseCurrentSize -= removedSize;
    } else {
      this.currentSize -= removedSize;
    }

    logger.info(`Cache: Cleaned up ${removedCount} ${isBase ? 'base ' : ''}entries, freed ${this.formatBytes(removedSize)}`);
  }

  /**
   * Calculate LRU score (lower = more likely to be evicted).
   *
   * Bug fix (Task R2): the previous formula added a POSITIVE staleness term and a NEGATIVE
   * access-count term, which made stale (long-untouched) entries score HIGHER — i.e. LESS
   * likely to be evicted — and frequently-accessed entries score LOWER — i.e. MORE likely to
   * be evicted. That is backwards from LRU (the entry untouched the longest should be evicted
   * FIRST). It went undetected because the only prior eviction test asserted a new entry got
   * stored, never WHICH existing entry was evicted. The dedicated base-budget tests added in
   * this task assert eviction by identity ("the oldest base only"), which caught it.
   */
  private calculateLRUScore(entry: CacheEntry): number {
    const now = Date.now();
    const staleness = now - entry.lastAccessed; // Larger gap since last access = more stale
    // Staleness pushes the score DOWN (more evictable); access count pushes it UP (protects
    // frequently-used entries from eviction).
    return entry.accessCount * 1000 - staleness;
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
      // Combined footprint across both categories — sized/thumbnail entries plus RAW/regular
      // decode bases — since this figure is meant to reflect the cache's total memory use.
      totalSize: this.currentSize + this.baseCurrentSize,
      hitRate: Math.round(hitRate * 100) / 100,
      mostAccessed,
      oldestEntry
    };
  }

  /**
   * Get cache utilization as PERCENTAGES. `size`/`entries` remain the COMBINED figures (across the
   * sized and base budgets) for backwards-compatibility with any existing caller. `sized`/`base`
   * break the size utilization out PER CATEGORY: the combined ratio can hide one exhausted
   * category behind the other (e.g. the 700MB base budget sitting at 98% is invisible when the
   * larger combined denominator still reads ~55%), so a monitor that only watched the combined
   * figure would miss a base-cache thrash. The two budgets are evicted independently (see
   * setWithKey/cleanup), so they deserve independent utilization readouts.
   */
  getUtilization(): {
    size: number;
    entries: number;
    sized: { size: number };
    base: { size: number };
  } {
    return {
      size: Math.round(((this.currentSize + this.baseCurrentSize) / (this.maxSize + this.baseMaxSize)) * 100),
      entries: Math.round((this.cache.size / this.maxEntries) * 100),
      sized: { size: Math.round((this.currentSize / this.maxSize) * 100) },
      base: { size: Math.round((this.baseCurrentSize / this.baseMaxSize) * 100) },
    };
  }

  /**
   * Set cache limits. `maxBaseSize` is optional and defaults back to DEFAULT_BASE_MAX_SIZE
   * (700MB) when omitted, so existing 2-arg call sites (e.g. "restore defaults" in tests)
   * reset the base budget too rather than leaving a previously-shrunk value in place.
   */
  setLimits(maxSize: number, maxEntries: number, maxBaseSize: number = this.DEFAULT_BASE_MAX_SIZE): void {
    this.maxSize = maxSize;
    this.maxEntries = maxEntries;
    this.baseMaxSize = maxBaseSize;

    // Trigger cleanup if necessary, independently per category — entry counts are checked
    // against EACH category's own count (categoryEntryCount), never the combined cache.size,
    // for the same reason cleanup() itself is category-scoped (see shouldCleanup's doc comment).
    if (this.currentSize > this.maxSize || this.categoryEntryCount(false) > this.maxEntries) {
      this.cleanup(0, false);
    }
    if (this.baseCurrentSize > this.baseMaxSize || this.categoryEntryCount(true) > this.maxEntries) {
      this.cleanup(0, true);
    }

    logger.info(`Cache: Updated limits to ${this.formatBytes(maxSize)} sized / ${this.formatBytes(maxBaseSize)} base / ${maxEntries} entries`);
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