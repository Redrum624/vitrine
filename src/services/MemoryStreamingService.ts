export interface StreamingOptions {
  tileSize: number; // Size of each tile in pixels
  maxMemoryUsage: number; // Maximum memory usage in bytes
  preloadTiles: number; // Number of tiles to preload
  compressionLevel: number; // 0-9, 0 = no compression
  enableTileCache: boolean;
  prioritizeViewport: boolean;
}

export interface ImageTile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number; // pyramid level
  data: Float32Array | null;
  compressed?: Uint8Array;
  isLoaded: boolean;
  isLoading: boolean;
  lastAccessed: number;
  memoryUsage: number;
}

export interface ViewportInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface StreamingStats {
  totalTiles: number;
  loadedTiles: number;
  memoryUsage: number;
  cacheHitRate: number;
  averageLoadTime: number;
  compressionRatio: number;
}

export interface TileRequest {
  tileId: string;
  priority: number;
  callback: (tile: ImageTile) => void;
  timeoutId?: number;
}

class MemoryStreamingService {
  private static instance: MemoryStreamingService;
  private options: StreamingOptions;
  private tileCache: Map<string, ImageTile> = new Map();
  private currentImage: {
    data: Float32Array;
    width: number;
    height: number;
    hash: string;
  } | null = null;
  private tileRequests: Map<string, TileRequest> = new Map();
  private loadingQueue: TileRequest[] = [];
  private stats: StreamingStats;
  private isProcessing = false;

  private constructor() {
    this.options = this.createDefaultOptions();
    this.stats = this.createDefaultStats();
    this.startTileLoader();
    this.startMemoryManager();
  }

  static getInstance(): MemoryStreamingService {
    if (!MemoryStreamingService.instance) {
      MemoryStreamingService.instance = new MemoryStreamingService();
    }
    return MemoryStreamingService.instance;
  }

  private createDefaultOptions(): StreamingOptions {
    return {
      tileSize: 1024,
      maxMemoryUsage: 2 * 1024 * 1024 * 1024, // 2GB
      preloadTiles: 9, // 3x3 grid around viewport
      compressionLevel: 3,
      enableTileCache: true,
      prioritizeViewport: true
    };
  }

  private createDefaultStats(): StreamingStats {
    return {
      totalTiles: 0,
      loadedTiles: 0,
      memoryUsage: 0,
      cacheHitRate: 0,
      averageLoadTime: 0,
      compressionRatio: 1.0
    };
  }

  configure(options: Partial<StreamingOptions>): void {
    this.options = { ...this.options, ...options };

    // Adjust cache size if memory limit changed
    if (options.maxMemoryUsage) {
      this.enforceMemoryLimit();
    }
  }

  async loadImage(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<void> {
    const imageHash = this.calculateImageHash(imageData, width, height);

    // Check if this is the same image
    if (this.currentImage && this.currentImage.hash === imageHash) {
      return;
    }

    // Clear previous image tiles
    this.clearCache();

    // Store new image
    this.currentImage = {
      data: imageData,
      width,
      height,
      hash: imageHash
    };

    // Calculate tile grid
    this.calculateTileGrid();

    console.log(`Loaded image for streaming: ${width}x${height}, ${this.stats.totalTiles} tiles`);
  }

  private calculateTileGrid(): void {
    if (!this.currentImage) return;

    const { width, height } = this.currentImage;
    const tilesX = Math.ceil(width / this.options.tileSize);
    const tilesY = Math.ceil(height / this.options.tileSize);

    this.stats.totalTiles = tilesX * tilesY;
    this.stats.loadedTiles = 0;
  }

  async getTile(
    x: number,
    y: number,
    level: number = 0,
    priority: number = 5
  ): Promise<ImageTile> {
    const tileId = this.generateTileId(x, y, level);

    // Check cache first
    const cachedTile = this.tileCache.get(tileId);
    if (cachedTile && cachedTile.isLoaded) {
      cachedTile.lastAccessed = Date.now();
      this.updateCacheHitRate(true);
      return cachedTile;
    }

    this.updateCacheHitRate(false);

    // Return promise for tile loading
    return new Promise((resolve, reject) => {
      const request: TileRequest = {
        tileId,
        priority,
        callback: resolve,
        timeoutId: window.setTimeout(() => {
          reject(new Error(`Tile loading timeout: ${tileId}`));
        }, 30000) // 30 second timeout
      };

      this.tileRequests.set(tileId, request);
      this.queueTileLoad(request);
    });
  }

  async getTilesInViewport(viewport: ViewportInfo): Promise<ImageTile[]> {
    if (!this.currentImage) return [];

    const tiles = this.calculateViewportTiles(viewport);
    const promises = tiles.map(({ x, y, level, priority }) =>
      this.getTile(x, y, level, priority)
    );

    // Preload surrounding tiles
    if (this.options.preloadTiles > 0) {
      const preloadTiles = this.calculatePreloadTiles(viewport, tiles);
      preloadTiles.forEach(({ x, y, level, priority }) => {
        this.getTile(x, y, level, priority + 10).catch(() => {}); // Lower priority, ignore errors
      });
    }

    return Promise.all(promises);
  }

  private calculateViewportTiles(viewport: ViewportInfo): Array<{
    x: number;
    y: number;
    level: number;
    priority: number;
  }> {
    if (!this.currentImage) return [];

    const { width, height } = this.currentImage;
    const { tileSize } = this.options;

    // Calculate tile bounds for viewport
    const startX = Math.floor(viewport.x / tileSize);
    const endX = Math.ceil((viewport.x + viewport.width) / tileSize);
    const startY = Math.floor(viewport.y / tileSize);
    const endY = Math.ceil((viewport.y + viewport.height) / tileSize);

    const tiles: Array<{ x: number; y: number; level: number; priority: number }> = [];

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && y >= 0 &&
            x * tileSize < width && y * tileSize < height) {

          // Calculate priority based on distance from viewport center
          const centerX = viewport.x + viewport.width / 2;
          const centerY = viewport.y + viewport.height / 2;
          const tileX = x * tileSize + tileSize / 2;
          const tileY = y * tileSize + tileSize / 2;

          const distance = Math.sqrt(
            Math.pow(tileX - centerX, 2) + Math.pow(tileY - centerY, 2)
          );

          const priority = Math.floor(distance / tileSize);

          tiles.push({ x, y, level: 0, priority });
        }
      }
    }

    return tiles;
  }

  private calculatePreloadTiles(
    viewport: ViewportInfo,
    viewportTiles: Array<{ x: number; y: number; level: number; priority: number }>
  ): Array<{ x: number; y: number; level: number; priority: number }> {
    if (!this.currentImage) return [];

    const { width, height } = this.currentImage;
    const { tileSize } = this.options;

    const preloadTiles: Array<{ x: number; y: number; level: number; priority: number }> = [];
    const viewportTileSet = new Set(viewportTiles.map(t => `${t.x},${t.y}`));

    // Calculate extended area around viewport
    const buffer = Math.ceil(Math.sqrt(this.options.preloadTiles) / 2);
    const startX = Math.max(0, Math.floor(viewport.x / tileSize) - buffer);
    const endX = Math.min(Math.ceil(width / tileSize), Math.ceil((viewport.x + viewport.width) / tileSize) + buffer);
    const startY = Math.max(0, Math.floor(viewport.y / tileSize) - buffer);
    const endY = Math.min(Math.ceil(height / tileSize), Math.ceil((viewport.y + viewport.height) / tileSize) + buffer);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tileKey = `${x},${y}`;
        if (!viewportTileSet.has(tileKey)) {
          preloadTiles.push({ x, y, level: 0, priority: 10 });
        }
      }
    }

    return preloadTiles.slice(0, this.options.preloadTiles);
  }

  private queueTileLoad(request: TileRequest): void {
    // Insert in priority order
    const insertIndex = this.loadingQueue.findIndex(r => r.priority > request.priority);
    if (insertIndex === -1) {
      this.loadingQueue.push(request);
    } else {
      this.loadingQueue.splice(insertIndex, 0, request);
    }

    // Process queue
    this.processTileQueue();
  }

  private async processTileQueue(): Promise<void> {
    if (this.isProcessing || this.loadingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.loadingQueue.length > 0) {
      const request = this.loadingQueue.shift()!;

      try {
        const tile = await this.loadTileData(request.tileId);

        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }

        request.callback(tile);
        this.tileRequests.delete(request.tileId);

      } catch (error) {
        console.error(`Failed to load tile ${request.tileId}:`, error);

        if (request.timeoutId) {
          clearTimeout(request.timeoutId);
        }

        this.tileRequests.delete(request.tileId);
      }

      // Check memory limit
      if (this.getCurrentMemoryUsage() > this.options.maxMemoryUsage) {
        this.enforceMemoryLimit();
      }

      // Yield to avoid blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    this.isProcessing = false;
  }

  private async loadTileData(tileId: string): Promise<ImageTile> {
    const startTime = performance.now();
    const { x, y, level } = this.parseTileId(tileId);

    if (!this.currentImage) {
      throw new Error('No image loaded for streaming');
    }

    const { data: imageData, width: imageWidth, height: imageHeight } = this.currentImage;
    const { tileSize } = this.options;

    // Calculate tile bounds
    const tileX = x * tileSize;
    const tileY = y * tileSize;
    const tileWidth = Math.min(tileSize, imageWidth - tileX);
    const tileHeight = Math.min(tileSize, imageHeight - tileY);

    // Extract tile data
    const tileData = new Float32Array(tileWidth * tileHeight * 4);

    for (let ty = 0; ty < tileHeight; ty++) {
      for (let tx = 0; tx < tileWidth; tx++) {
        const srcIdx = ((tileY + ty) * imageWidth + (tileX + tx)) * 4;
        const dstIdx = (ty * tileWidth + tx) * 4;

        tileData[dstIdx] = imageData[srcIdx];
        tileData[dstIdx + 1] = imageData[srcIdx + 1];
        tileData[dstIdx + 2] = imageData[srcIdx + 2];
        tileData[dstIdx + 3] = imageData[srcIdx + 3];
      }
    }

    // Create tile object
    const tile: ImageTile = {
      id: tileId,
      x: tileX,
      y: tileY,
      width: tileWidth,
      height: tileHeight,
      level,
      data: tileData,
      isLoaded: true,
      isLoading: false,
      lastAccessed: Date.now(),
      memoryUsage: tileData.byteLength
    };

    // Apply compression if enabled
    if (this.options.compressionLevel > 0) {
      tile.compressed = await this.compressTileData(tileData);
      tile.data = null; // Free uncompressed data
      tile.memoryUsage = tile.compressed.byteLength;
    }

    // Cache the tile
    this.tileCache.set(tileId, tile);
    this.stats.loadedTiles++;

    // Update stats
    const loadTime = performance.now() - startTime;
    this.updateAverageLoadTime(loadTime);

    return tile;
  }

  private async compressTileData(data: Float32Array): Promise<Uint8Array> {
    // Simple run-length encoding for demonstration
    // In production, you might use LZ4, ZSTD, or similar
    const compressed: number[] = [];
    let runValue = data[0];
    let runLength = 1;

    for (let i = 1; i < data.length; i++) {
      if (data[i] === runValue && runLength < 255) {
        runLength++;
      } else {
        // Encode run
        compressed.push(runLength, runValue);
        runValue = data[i];
        runLength = 1;
      }
    }

    // Final run
    compressed.push(runLength, runValue);

    const result = new Uint8Array(compressed.length * 4);
    for (let i = 0; i < compressed.length; i++) {
      const bytes = new Float32Array([compressed[i]]);
      const view = new Uint8Array(bytes.buffer);
      result.set(view, i * 4);
    }

    // Update compression ratio
    this.stats.compressionRatio = result.byteLength / data.byteLength;

    return result;
  }

  private async decompressTileData(compressed: Uint8Array, originalSize: number): Promise<Float32Array> {
    const result = new Float32Array(originalSize);
    let pos = 0;
    let dataPos = 0;

    while (pos < compressed.length) {
      const lengthBytes = compressed.slice(pos, pos + 4);
      const valueBytes = compressed.slice(pos + 4, pos + 8);

      const runLength = new Float32Array(lengthBytes.buffer)[0];
      const runValue = new Float32Array(valueBytes.buffer)[0];

      for (let i = 0; i < runLength && dataPos < result.length; i++) {
        result[dataPos++] = runValue;
      }

      pos += 8;
    }

    return result;
  }

  async getDecompressedTile(tile: ImageTile): Promise<Float32Array> {
    if (tile.data) {
      return tile.data;
    }

    if (tile.compressed) {
      const originalSize = tile.width * tile.height * 4;
      return this.decompressTileData(tile.compressed, originalSize);
    }

    throw new Error('Tile has no data or compressed data');
  }

  private generateTileId(x: number, y: number, level: number): string {
    return `tile_${x}_${y}_${level}`;
  }

  private parseTileId(tileId: string): { x: number; y: number; level: number } {
    const parts = tileId.split('_');
    return {
      x: parseInt(parts[1]),
      y: parseInt(parts[2]),
      level: parseInt(parts[3])
    };
  }

  private calculateImageHash(imageData: Float32Array, width: number, height: number): string {
    let hash = width ^ height;
    const step = Math.max(1, Math.floor(imageData.length / 100));

    for (let i = 0; i < imageData.length; i += step) {
      hash = ((hash << 5) - hash + Math.round(imageData[i] * 255)) | 0;
    }

    return hash.toString(36);
  }

  private getCurrentMemoryUsage(): number {
    let usage = 0;
    for (const tile of this.tileCache.values()) {
      usage += tile.memoryUsage;
    }
    this.stats.memoryUsage = usage;
    return usage;
  }

  private enforceMemoryLimit(): void {
    const tiles = Array.from(this.tileCache.values());

    // Sort by last accessed time (oldest first)
    tiles.sort((a, b) => a.lastAccessed - b.lastAccessed);

    while (this.getCurrentMemoryUsage() > this.options.maxMemoryUsage && tiles.length > 0) {
      const tile = tiles.shift()!;
      this.tileCache.delete(tile.id);
      this.stats.loadedTiles--;
    }
  }

  private updateCacheHitRate(hit: boolean): void {
    const hits = this.stats.cacheHitRate * this.stats.totalTiles;
    const totalRequests = this.stats.totalTiles + 1;
    this.stats.cacheHitRate = (hits + (hit ? 1 : 0)) / totalRequests;
  }

  private updateAverageLoadTime(loadTime: number): void {
    const totalTime = this.stats.averageLoadTime * (this.stats.loadedTiles - 1) + loadTime;
    this.stats.averageLoadTime = totalTime / this.stats.loadedTiles;
  }

  private startTileLoader(): void {
    setInterval(() => {
      this.processTileQueue();
    }, 100); // Process queue every 100ms
  }

  private startMemoryManager(): void {
    setInterval(() => {
      this.enforceMemoryLimit();
    }, 5000); // Check memory usage every 5 seconds
  }

  getStats(): StreamingStats {
    this.getCurrentMemoryUsage(); // Update memory usage
    return { ...this.stats };
  }

  clearCache(): void {
    this.tileCache.clear();
    this.tileRequests.clear();
    this.loadingQueue.length = 0;
    this.stats.loadedTiles = 0;
    this.stats.memoryUsage = 0;
  }

  preloadRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    priority: number = 10
  ): void {
    if (!this.currentImage) return;

    const { tileSize } = this.options;
    const startX = Math.floor(x / tileSize);
    const endX = Math.ceil((x + width) / tileSize);
    const startY = Math.floor(y / tileSize);
    const endY = Math.ceil((y + height) / tileSize);

    for (let ty = startY; ty < endY; ty++) {
      for (let tx = startX; tx < endX; tx++) {
        if (tx >= 0 && ty >= 0 &&
            tx * tileSize < this.currentImage.width &&
            ty * tileSize < this.currentImage.height) {

          this.getTile(tx, ty, 0, priority).catch(() => {}); // Ignore errors
        }
      }
    }
  }

  async createVirtualTexture(
    viewport: ViewportInfo,
    targetWidth: number,
    targetHeight: number
  ): Promise<Float32Array> {
    const tiles = await this.getTilesInViewport(viewport);
    const result = new Float32Array(targetWidth * targetHeight * 4);

    for (const tile of tiles) {
      const tileData = await this.getDecompressedTile(tile);

      // Calculate destination bounds in virtual texture
      const dstX = Math.max(0, tile.x - viewport.x);
      const dstY = Math.max(0, tile.y - viewport.y);
      const dstWidth = Math.min(tile.width, targetWidth - dstX);
      const dstHeight = Math.min(tile.height, targetHeight - dstY);

      // Copy tile data to result
      for (let y = 0; y < dstHeight; y++) {
        for (let x = 0; x < dstWidth; x++) {
          const srcIdx = (y * tile.width + x) * 4;
          const dstIdx = ((dstY + y) * targetWidth + (dstX + x)) * 4;

          result[dstIdx] = tileData[srcIdx];
          result[dstIdx + 1] = tileData[srcIdx + 1];
          result[dstIdx + 2] = tileData[srcIdx + 2];
          result[dstIdx + 3] = tileData[srcIdx + 3];
        }
      }
    }

    return result;
  }

  dispose(): void {
    this.clearCache();
    this.currentImage = null;
  }
}

export default MemoryStreamingService;