export interface CacheEntry {
  id: string;
  imageHash: string;
  operation: string;
  parameters: string; // JSON stringified parameters
  width: number;
  height: number;
  data: Float32Array;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  memorySize: number;
  compressionLevel: number;
  isCompressed: boolean;
}

export interface CacheStats {
  entries: number;
  hitRate: number;
  memoryUsage: number;
  maxMemory: number;
  oldestEntry: number;
  newestEntry: number;
  averageAccessTime: number;
  compressionRatio: number;
}

export interface CacheOptions {
  maxMemoryUsage: number; // bytes
  maxEntries: number;
  compressionThreshold: number; // bytes - compress entries larger than this
  compressionLevel: number; // 0-9
  previewSizes: number[]; // standard preview sizes to maintain
  enablePersistence: boolean;
  persistenceKey: string;
  maxAge: number; // milliseconds
}

export interface PreviewRequest {
  imageHash: string;
  operation: string;
  parameters: Record<string, unknown>;
  width: number;
  height: number;
  priority: number;
}

export interface PreviewResult {
  data: Float32Array;
  width: number;
  height: number;
  fromCache: boolean;
  generationTime: number;
  compressionRatio?: number;
}

class PreviewCacheService {
  private static instance: PreviewCacheService;
  private cache: Map<string, CacheEntry> = new Map();
  private options: CacheOptions;
  private stats: CacheStats;
  private compressionWorker: Worker | null = null;
  private pendingRequests: Map<string, Promise<PreviewResult>> = new Map();

  private constructor() {
    this.options = this.createDefaultOptions();
    this.stats = this.createDefaultStats();
    this.initializeCompressionWorker();
    this.startCacheManager();
  }

  static getInstance(): PreviewCacheService {
    if (!PreviewCacheService.instance) {
      PreviewCacheService.instance = new PreviewCacheService();
    }
    return PreviewCacheService.instance;
  }

  private createDefaultOptions(): CacheOptions {
    return {
      maxMemoryUsage: 512 * 1024 * 1024, // 512MB
      maxEntries: 1000,
      compressionThreshold: 1024 * 1024, // 1MB
      compressionLevel: 6,
      previewSizes: [128, 256, 512, 1024],
      enablePersistence: true,
      persistenceKey: 'photo_editor_preview_cache',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    };
  }

  private createDefaultStats(): CacheStats {
    return {
      entries: 0,
      hitRate: 0,
      memoryUsage: 0,
      maxMemory: 0,
      oldestEntry: 0,
      newestEntry: 0,
      averageAccessTime: 0,
      compressionRatio: 1.0
    };
  }

  configure(options: Partial<CacheOptions>): void {
    this.options = { ...this.options, ...options };

    // Adjust cache if memory limit changed
    if (options.maxMemoryUsage || options.maxEntries) {
      this.enforceMemoryLimits();
    }
  }

  async getPreview(request: PreviewRequest): Promise<PreviewResult> {
    const cacheKey = this.generateCacheKey(request);

    // Check if already processing
    const existingRequest = this.pendingRequests.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return this.handleCacheHit(cached);
    }

    // Generate new preview
    const generationPromise = this.generatePreview(request, cacheKey);
    this.pendingRequests.set(cacheKey, generationPromise);

    try {
      const result = await generationPromise;
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async handleCacheHit(entry: CacheEntry): Promise<PreviewResult> {
    const startTime = performance.now();

    // Update access statistics
    entry.lastAccessed = Date.now();
    entry.accessCount++;

    // Decompress if needed
    let data = entry.data;
    if (entry.isCompressed) {
      data = await this.decompressData(entry.data);
    }

    this.updateStats();
    this.updateHitRate(true);

    const accessTime = performance.now() - startTime;
    this.updateAverageAccessTime(accessTime);

    return {
      data,
      width: entry.width,
      height: entry.height,
      fromCache: true,
      generationTime: 0,
      compressionRatio: entry.isCompressed ? entry.compressionLevel : undefined
    };
  }

  private async generatePreview(request: PreviewRequest, cacheKey: string): Promise<PreviewResult> {
    const startTime = performance.now();

    // This would normally call the actual image processing service
    // For now, create a placeholder
    const data = new Float32Array(request.width * request.height * 4);

    // Fill with a pattern based on the operation for demonstration
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.random() * 255;     // R
      data[i + 1] = Math.random() * 255; // G
      data[i + 2] = Math.random() * 255; // B
      data[i + 3] = 255;                 // A
    }

    const generationTime = performance.now() - startTime;

    // Cache the result
    await this.cachePreview(request, data, cacheKey);

    this.updateHitRate(false);

    return {
      data,
      width: request.width,
      height: request.height,
      fromCache: false,
      generationTime
    };
  }

  private async cachePreview(
    request: PreviewRequest,
    data: Float32Array,
    cacheKey: string
  ): Promise<void> {
    const memorySize = data.byteLength;
    let processedData = data;
    let isCompressed = false;
    let compressionLevel = 1.0;

    // Compress if data is large enough
    if (memorySize > this.options.compressionThreshold) {
      try {
        processedData = await this.compressData(data);
        isCompressed = true;
        compressionLevel = processedData.byteLength / data.byteLength;
      } catch (error) {
        console.warn('Failed to compress preview data:', error);
      }
    }

    const entry: CacheEntry = {
      id: cacheKey,
      imageHash: request.imageHash,
      operation: request.operation,
      parameters: JSON.stringify(request.parameters),
      width: request.width,
      height: request.height,
      data: processedData,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      memorySize: processedData.byteLength,
      compressionLevel,
      isCompressed
    };

    this.cache.set(cacheKey, entry);
    this.enforceMemoryLimits();
    this.updateStats();

    // Persist to storage if enabled
    if (this.options.enablePersistence) {
      this.persistEntry(entry).catch(error => {
        console.warn('Failed to persist cache entry:', error);
      });
    }
  }

  private generateCacheKey(request: PreviewRequest): string {
    const keyData = {
      imageHash: request.imageHash,
      operation: request.operation,
      parameters: request.parameters,
      width: request.width,
      height: request.height
    };

    return this.hashObject(keyData);
  }

  private hashObject(obj: unknown): string {
    const str = JSON.stringify(obj);
    let hash = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }

  private enforceMemoryLimits(): void {
    // Remove entries exceeding max count
    while (this.cache.size > this.options.maxEntries) {
      this.evictLeastRecentlyUsed();
    }

    // Remove entries exceeding memory limit
    while (this.getCurrentMemoryUsage() > this.options.maxMemoryUsage && this.cache.size > 0) {
      this.evictLeastRecentlyUsed();
    }

    // Remove expired entries
    this.cleanupExpiredEntries();
  }

  private evictLeastRecentlyUsed(): void {
    let oldestEntry: CacheEntry | null = null;
    let oldestKey = '';

    for (const [key, entry] of this.cache.entries()) {
      if (!oldestEntry || entry.lastAccessed < oldestEntry.lastAccessed) {
        oldestEntry = entry;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const maxAge = this.options.maxAge;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }
  }

  private getCurrentMemoryUsage(): number {
    let usage = 0;
    for (const entry of this.cache.values()) {
      usage += entry.memorySize;
    }
    return usage;
  }

  private updateStats(): void {
    this.stats.entries = this.cache.size;
    this.stats.memoryUsage = this.getCurrentMemoryUsage();
    this.stats.maxMemory = this.options.maxMemoryUsage;

    if (this.cache.size > 0) {
      const entries = Array.from(this.cache.values());
      this.stats.oldestEntry = Math.min(...entries.map(e => e.timestamp));
      this.stats.newestEntry = Math.max(...entries.map(e => e.timestamp));

      // Calculate average compression ratio
      const compressedEntries = entries.filter(e => e.isCompressed);
      if (compressedEntries.length > 0) {
        const totalRatio = compressedEntries.reduce((sum, e) => sum + e.compressionLevel, 0);
        this.stats.compressionRatio = totalRatio / compressedEntries.length;
      }
    }
  }

  private updateHitRate(hit: boolean): void {
    // Simple moving average for hit rate
    const alpha = 0.1; // Weight for new sample
    this.stats.hitRate = this.stats.hitRate * (1 - alpha) + (hit ? 1 : 0) * alpha;
  }

  private updateAverageAccessTime(accessTime: number): void {
    const alpha = 0.1;
    this.stats.averageAccessTime = this.stats.averageAccessTime * (1 - alpha) + accessTime * alpha;
  }

  private initializeCompressionWorker(): void {
    try {
      const workerScript = `
        // LZ77-style compression for Float32Array
        function compressFloat32Array(data) {
          const compressed = [];
          let i = 0;

          while (i < data.length) {
            let bestLength = 0;
            let bestDistance = 0;

            // Look for matches in previous data
            const lookBack = Math.min(i, 4096);
            const maxLength = Math.min(data.length - i, 258);

            for (let distance = 1; distance <= lookBack; distance++) {
              let length = 0;
              while (length < maxLength &&
                     data[i + length] === data[i - distance + length]) {
                length++;
              }

              if (length > bestLength) {
                bestLength = length;
                bestDistance = distance;
              }
            }

            if (bestLength >= 3) {
              // Encode as (distance, length)
              compressed.push(-(bestDistance), bestLength);
              i += bestLength;
            } else {
              // Encode literal
              compressed.push(data[i]);
              i++;
            }
          }

          return new Float32Array(compressed);
        }

        function decompressFloat32Array(compressed, originalLength) {
          const result = new Float32Array(originalLength);
          let resultPos = 0;
          let i = 0;

          while (i < compressed.length && resultPos < originalLength) {
            const value = compressed[i];

            if (value < 0) {
              // Compressed sequence: distance, length
              const distance = -value;
              const length = compressed[i + 1];

              for (let j = 0; j < length && resultPos < originalLength; j++) {
                result[resultPos] = result[resultPos - distance];
                resultPos++;
              }

              i += 2;
            } else {
              // Literal value
              result[resultPos] = value;
              resultPos++;
              i++;
            }
          }

          return result;
        }

        self.onmessage = function(event) {
          const { type, data, originalLength } = event.data;

          try {
            if (type === 'compress') {
              const compressed = compressFloat32Array(data);
              self.postMessage({ success: true, data: compressed });
            } else if (type === 'decompress') {
              const decompressed = decompressFloat32Array(data, originalLength);
              self.postMessage({ success: true, data: decompressed });
            }
          } catch (error) {
            self.postMessage({ success: false, error: error.message });
          }
        };
      `;

      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this.compressionWorker = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('Failed to create compression worker:', error);
    }
  }

  private async compressData(data: Float32Array): Promise<Float32Array> {
    if (!this.compressionWorker) {
      throw new Error('Compression worker not available');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Compression timeout'));
      }, 10000);

      this.compressionWorker!.onmessage = (event) => {
        clearTimeout(timeout);
        const { success, data: result, error } = event.data;

        if (success) {
          resolve(result);
        } else {
          reject(new Error(error));
        }
      };

      this.compressionWorker!.postMessage({
        type: 'compress',
        data: data
      });
    });
  }

  private async decompressData(compressed: Float32Array): Promise<Float32Array> {
    if (!this.compressionWorker) {
      throw new Error('Compression worker not available');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Decompression timeout'));
      }, 10000);

      this.compressionWorker!.onmessage = (event) => {
        clearTimeout(timeout);
        const { success, data: result, error } = event.data;

        if (success) {
          resolve(result);
        } else {
          reject(new Error(error));
        }
      };

      // Note: In real implementation, we'd need to store original length
      this.compressionWorker!.postMessage({
        type: 'decompress',
        data: compressed,
        originalLength: compressed.length * 2 // Estimate
      });
    });
  }

  async preloadPreviews(
    imageHash: string,
    operations: string[],
    parameters: Record<string, unknown>[] = []
  ): Promise<void> {
    const requests: PreviewRequest[] = [];

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const params = parameters[i] || {};

      for (const size of this.options.previewSizes) {
        requests.push({
          imageHash,
          operation,
          parameters: params,
          width: size,
          height: size,
          priority: 10 // Low priority for preload
        });
      }
    }

    // Process requests with limited concurrency
    const batchSize = 3;
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(req => this.getPreview(req)));
    }
  }

  invalidateImage(imageHash: string): number {
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.imageHash === imageHash) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    this.updateStats();
    return removedCount;
  }

  invalidateOperation(operation: string): number {
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.operation === operation) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    this.updateStats();
    return removedCount;
  }

  private async persistEntry(entry: CacheEntry): Promise<void> {
    try {
      // Only persist metadata, not the actual image data (too large for localStorage)
      const metadata = {
        id: entry.id,
        imageHash: entry.imageHash,
        operation: entry.operation,
        parameters: entry.parameters,
        width: entry.width,
        height: entry.height,
        timestamp: entry.timestamp,
        accessCount: entry.accessCount,
        lastAccessed: entry.lastAccessed
      };

      const key = `${this.options.persistenceKey}_${entry.id}`;
      localStorage.setItem(key, JSON.stringify(metadata));
    } catch (error) {
      // localStorage might be full or unavailable
      console.warn('Failed to persist cache entry:', error);
    }
  }

  async loadPersistedEntries(): Promise<void> {
    try {
      const prefix = `${this.options.persistenceKey}_`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          try {
            const metadata = JSON.parse(localStorage.getItem(key)!);

            // Check if entry is still valid (not expired)
            if (Date.now() - metadata.timestamp < this.options.maxAge) {
              // Create placeholder entry (without actual data)
              // Data will be regenerated when accessed
              console.log(`Found persisted cache entry: ${metadata.id}`);
            } else {
              // Remove expired entry
              localStorage.removeItem(key);
            }
          } catch {
            // Invalid entry, remove it
            localStorage.removeItem(key);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted cache entries:', error);
    }
  }

  private startCacheManager(): void {
    // Periodic cleanup
    setInterval(() => {
      this.enforceMemoryLimits();
      this.updateStats();
    }, 30000); // Every 30 seconds

    // Load persisted entries on startup
    if (this.options.enablePersistence) {
      this.loadPersistedEntries();
    }
  }

  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  getCacheEntries(): CacheEntry[] {
    return Array.from(this.cache.values()).sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  clearCache(): void {
    this.cache.clear();
    this.pendingRequests.clear();
    this.updateStats();

    // Clear persisted entries
    if (this.options.enablePersistence) {
      this.clearPersistedEntries();
    }
  }

  private clearPersistedEntries(): void {
    try {
      const prefix = `${this.options.persistenceKey}_`;
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Failed to clear persisted cache entries:', error);
    }
  }

  warmupCache(
    imageHash: string,
    commonOperations: string[] = ['brightness_contrast', 'exposure', 'white_balance']
  ): void {
    // Preload common preview sizes for typical operations
    setTimeout(() => {
      this.preloadPreviews(imageHash, commonOperations);
    }, 100); // Small delay to avoid blocking main thread
  }

  dispose(): void {
    this.clearCache();

    if (this.compressionWorker) {
      this.compressionWorker.terminate();
      this.compressionWorker = null;
    }
  }
}

export default PreviewCacheService;