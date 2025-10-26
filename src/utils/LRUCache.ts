/**
 * LRU (Least Recently Used) Cache Implementation
 * High-performance cache with automatic eviction of least recently used items
 * Perfect for image processing pipeline caching
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  accessCount: number;
  size?: number; // Optional size in bytes for memory management
}

export interface LRUCacheOptions {
  maxSize: number; // Maximum number of entries
  maxMemory?: number; // Optional maximum memory in bytes
  onEvict?: (key: string, value: unknown) => void; // Callback when item evicted
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private accessOrder: string[] = []; // Track access order (most recent at end)
  private options: Required<LRUCacheOptions>;
  private currentMemory: number = 0;

  constructor(options: LRUCacheOptions) {
    this.options = {
      maxSize: options.maxSize,
      maxMemory: options.maxMemory ?? Infinity,
      onEvict: options.onEvict ?? (() => {})
    };
  }

  /**
   * Get value from cache
   * Updates access order to mark as recently used
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Update access metadata
    entry.timestamp = Date.now();
    entry.accessCount++;

    // Move to end of access order (most recently used)
    this.updateAccessOrder(key);

    return entry.value;
  }

  /**
   * Set value in cache
   * Automatically evicts LRU items if cache is full
   */
  set(key: string, value: T, size?: number): void {
    // If key already exists, remove old entry first
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Check if we need to evict items
    while (this.shouldEvict(size)) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      accessCount: 1,
      size: size ?? 0
    };

    this.cache.set(key, entry);
    this.accessOrder.push(key);

    if (size) {
      this.currentMemory += size;
    }
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete specific key from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Update memory tracking
    if (entry.size) {
      this.currentMemory -= entry.size;
    }

    // Remove from cache and access order
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);

    return true;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    // Call onEvict for all items
    for (const [key, entry] of this.cache.entries()) {
      this.options.onEvict(key, entry.value);
    }

    this.cache.clear();
    this.accessOrder = [];
    this.currentMemory = 0;
  }

  /**
   * Get current cache size (number of entries)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get current memory usage in bytes
   */
  memoryUsage(): number {
    return this.currentMemory;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    memoryUsage: number;
    maxMemory: number;
    hitRate: number;
    entries: Array<{ key: string; accessCount: number; timestamp: number }>;
  } {
    const entries = Array.from(this.cache.values())
      .map(entry => ({
        key: entry.key,
        accessCount: entry.accessCount,
        timestamp: entry.timestamp
      }))
      .sort((a, b) => b.accessCount - a.accessCount);

    const totalAccesses = entries.reduce((sum, e) => sum + e.accessCount, 0);
    const hitRate = totalAccesses > 0 ? this.cache.size / totalAccesses : 0;

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      memoryUsage: this.currentMemory,
      maxMemory: this.options.maxMemory,
      hitRate,
      entries
    };
  }

  /**
   * Check if we should evict items
   */
  private shouldEvict(newItemSize: number = 0): boolean {
    // Check size limit
    if (this.cache.size >= this.options.maxSize) {
      return true;
    }

    // Check memory limit
    if (this.currentMemory + newItemSize > this.options.maxMemory) {
      return true;
    }

    return false;
  }

  /**
   * Evict least recently used item
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    // Get least recently used key (first in access order)
    const lruKey = this.accessOrder[0];
    const entry = this.cache.get(lruKey);

    if (entry) {
      // Call eviction callback
      this.options.onEvict(lruKey, entry.value);

      // Remove from cache
      this.delete(lruKey);
    }
  }

  /**
   * Update access order to mark key as recently used
   */
  private updateAccessOrder(key: string): void {
    // Remove from current position
    this.accessOrder = this.accessOrder.filter(k => k !== key);

    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  /**
   * Get all keys in cache (ordered by most recently used)
   */
  keys(): string[] {
    return [...this.accessOrder].reverse();
  }

  /**
   * Get all values in cache (ordered by most recently used)
   */
  values(): T[] {
    return this.keys()
      .map(key => this.cache.get(key))
      .filter((entry): entry is CacheEntry<T> => entry !== undefined)
      .map(entry => entry.value);
  }

  /**
   * Prune cache to specific size (useful for memory pressure)
   */
  prune(targetSize: number): number {
    let evicted = 0;

    while (this.cache.size > targetSize && this.accessOrder.length > 0) {
      this.evictLRU();
      evicted++;
    }

    return evicted;
  }

  /**
   * Prune cache to specific memory limit
   */
  pruneMemory(targetMemory: number): number {
    let evicted = 0;

    while (this.currentMemory > targetMemory && this.accessOrder.length > 0) {
      this.evictLRU();
      evicted++;
    }

    return evicted;
  }
}
