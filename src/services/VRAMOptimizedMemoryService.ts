import { logger } from '../utils/Logger';

export interface VRAMAllocation {
  id: string;
  size: number;
  type: 'texture' | 'buffer' | 'framebuffer' | 'cache';
  priority: 'critical' | 'high' | 'medium' | 'low';
  lastAccessed: number;
  persistent: boolean;
  gpuResource: WebGLTexture | WebGLBuffer | any;
}

export interface MemoryPool {
  totalVRAM: number;
  availableVRAM: number;
  allocatedVRAM: number;
  reservedVRAM: number;
  fragmentedVRAM: number;
  allocations: Map<string, VRAMAllocation>;
}

export interface ProcessingBuffer {
  id: string;
  width: number;
  height: number;
  format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'R32F' | 'RG32F';
  texture: WebGLTexture | any | null; // Support WebGL textures, WebGPU buffers, or null for tiled
  framebuffer?: WebGLFramebuffer | null;
  size: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  persistent: boolean;
  lastUsed: number;
  type?: 'webgl' | 'webgpu' | 'tiled'; // Processing type
  tileConfig?: {
    tileSize: number;
    tilesX: number;
    tilesY: number;
    totalTiles: number;
  };
}

export class VRAMOptimizedMemoryService {
  private static instance: VRAMOptimizedMemoryService;
  private memoryPool: MemoryPool;
  private gl: WebGL2RenderingContext | null = null;
  private textureCache: Map<string, ProcessingBuffer> = new Map();
  // @ts-ignore: Reserved for future framebuffer optimization
  private __framebufferCache: Map<string, WebGLFramebuffer> = new Map();
  private cleanupTimer: number | null = null;
  // @ts-ignore: Reserved for memory usage analytics
  private __allocationHistory: VRAMAllocation[] = [];

  // RTX 3080 16GB configuration with 12GB dedicated
  // @ts-ignore: System memory reference for monitoring
  private readonly __TOTAL_VRAM = 16 * 1024 * 1024 * 1024; // 16GB
  private readonly DEDICATED_VRAM = 12 * 1024 * 1024 * 1024; // 12GB for our app
  // @ts-ignore: System reserve reference for calculations
  private readonly __SYSTEM_RESERVED = 2 * 1024 * 1024 * 1024; // 2GB for system
  private readonly CLEANUP_THRESHOLD = 0.85; // Start cleanup at 85% usage
  private readonly CLEANUP_INTERVAL = 30000; // 30 seconds

  private constructor() {
    this.memoryPool = {
      totalVRAM: this.DEDICATED_VRAM,
      availableVRAM: this.DEDICATED_VRAM,
      allocatedVRAM: 0,
      reservedVRAM: 0,
      fragmentedVRAM: 0,
      allocations: new Map()
    };

    this.initializeMemoryManagement();
  }

  private get estimatedVRAM(): number {
    return this.DEDICATED_VRAM;
  }

  static getInstance(): VRAMOptimizedMemoryService {
    if (!VRAMOptimizedMemoryService.instance) {
      VRAMOptimizedMemoryService.instance = new VRAMOptimizedMemoryService();
    }
    return VRAMOptimizedMemoryService.instance;
  }

  async initializeMemoryManagement(): Promise<void> {
    try {
      // Initialize WebGL2 context with optimal settings for memory management
      const canvas = new OffscreenCanvas(1, 1);
      this.gl = canvas.getContext('webgl2', {
        powerPreference: 'high-performance',
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        premultipliedAlpha: false
      });

      if (!this.gl) {
        throw new Error('Failed to initialize WebGL2 context');
      }

      // Pre-allocate common texture sizes for immediate use
      await this.preallocateCommonTextures();

      // Start memory cleanup timer
      this.startCleanupTimer();

      logger.info(`VRAM Memory Service initialized: ${this.DEDICATED_VRAM / (1024*1024*1024)}GB dedicated`);

    } catch (error) {
      logger.error('Failed to initialize VRAM memory service:', error);
    }
  }

  /**
   * Pre-allocate textures for common RAW image sizes
   */
  private async preallocateCommonTextures(): Promise<void> {
    if (!this.gl) return;

    // Check WebGL limits first
    const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    const maxRenderbufferSize = this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE);
    const maxSize = Math.min(maxTextureSize, maxRenderbufferSize);

    logger.info(`WebGL limits: Max texture size: ${maxTextureSize}, Max renderbuffer: ${maxRenderbufferSize}`);

    // Professional RAW processing pre-allocation - target actual camera resolutions
    const commonFormats = [
      // Standard professional camera formats
      { width: 4000, height: 3000, format: 'RGBA16F' as const },   // 12MP (most DSLRs)
      { width: 6000, height: 4000, format: 'RGBA16F' as const },   // 24MP (full frame)
      { width: 8000, height: 6000, format: 'RGBA16F' as const },   // 48MP (high-res)
      { width: 9504, height: 6336, format: 'RGBA16F' as const },   // 60MP (Sony A7R V)
      { width: 11008, height: 7344, format: 'RGBA16F' as const },  // 80MP+ (medium format)
      // Efficient fallback formats
      { width: 4000, height: 3000, format: 'RGBA8' as const },     // 12MP display
      { width: 2048, height: 1536, format: 'RGBA8' as const },     // Preview/thumbnail
    ];

    // Smart format selection - prefer WebGPU buffers for large textures, WebGL for small ones
    const validFormats = commonFormats.filter(spec => {
      // Always allow small textures for WebGL compatibility
      if (spec.width <= 4096 && spec.height <= 4096) return true;

      // For larger textures, only allocate if we have WebGPU or sufficient VRAM
      const requiredMemory = spec.width * spec.height * 4 * (spec.format.includes('16F') ? 2 : 1);
      const hasWebGPU = 'gpu' in navigator;
      const hasEnoughVRAM = requiredMemory < this.estimatedVRAM * 0.3; // Use max 30% VRAM for pre-allocation

      return hasWebGPU || hasEnoughVRAM;
    });

    for (const spec of validFormats) {
      try {
        const buffer = await this.allocateProcessingBuffer(
          `preallocated_${spec.width}x${spec.height}_${spec.format}`,
          spec.width,
          spec.height,
          spec.format,
          'high',
          true
        );

        if (buffer) {
          logger.info(`Pre-allocated: ${spec.width}x${spec.height} ${spec.format} (${this.formatBytes(buffer.size)})`);
        }
      } catch (error) {
        logger.warn(`Failed to pre-allocate ${spec.width}x${spec.height} texture:`, error);
        // Continue with other allocations
      }
    }
  }

  /**
   * Allocate optimized processing buffer for RTX 3080 - WebGPU first, WebGL fallback
   */
  async allocateProcessingBuffer(
    id: string,
    width: number,
    height: number,
    format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'R32F' | 'RG32F',
    priority: 'critical' | 'high' | 'medium' | 'low' = 'medium',
    persistent: boolean = false
  ): Promise<ProcessingBuffer | null> {

    // Calculate memory requirements first
    const bytesPerPixel = this.getBytesPerPixel(format);
    const requiredSize = width * height * bytesPerPixel;
    const isLargeTexture = width > 8192 || height > 8192 || requiredSize > 256 * 1024 * 1024; // 256MB threshold

    // For large textures, prefer WebGPU or streaming
    if (isLargeTexture) {
      logger.info(`Large texture detected: ${width}x${height} (${this.formatBytes(requiredSize)}), using advanced processing`);

      // Try WebGPU buffer first
      const webgpuBuffer = await this.allocateWebGPUBuffer(id, width, height, format, priority, persistent);
      if (webgpuBuffer) {
        return webgpuBuffer;
      }

      // If WebGPU not available, use tiled processing approach
      logger.info(`WebGPU not available for large texture, will use tiled processing`);
      return this.createTiledProcessingBuffer(id, width, height, format, priority, persistent);
    }

    // For smaller textures, use standard WebGL
    if (!this.gl) {
      logger.error('WebGL2 context not available');
      return null;
    }

    // Check WebGL limits for standard textures
    const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    if (width > maxTextureSize || height > maxTextureSize) {
      logger.info(`Texture ${width}x${height} exceeds WebGL limit ${maxTextureSize}, falling back to WebGPU/tiled processing`);

      const webgpuBuffer = await this.allocateWebGPUBuffer(id, width, height, format, priority, persistent);
      if (webgpuBuffer) return webgpuBuffer;

      return this.createTiledProcessingBuffer(id, width, height, format, priority, persistent);
    }

    // Check if buffer already exists
    if (this.textureCache.has(id)) {
      const existing = this.textureCache.get(id)!;
      existing.framebuffer = existing.framebuffer || this.createFramebuffer(existing.texture);
      return existing;
    }

    // Check available VRAM
    if (!this.canAllocate(requiredSize, priority)) {
      // Try to free up space
      await this.freeMemoryForAllocation(requiredSize, priority);

      if (!this.canAllocate(requiredSize, priority)) {
        logger.warn(`Cannot allocate ${this.formatBytes(requiredSize)} for ${id}`);
        return null;
      }
    }

    try {
      // Create optimized texture
      const texture = this.createOptimizedTexture(width, height, format);
      const framebuffer = this.createFramebuffer(texture);

      const buffer: ProcessingBuffer = {
        id,
        width,
        height,
        format,
        texture,
        framebuffer,
        size: requiredSize,
        priority,
        persistent,
        lastUsed: Date.now()
      };

      // Track allocation
      const allocation: VRAMAllocation = {
        id,
        size: requiredSize,
        type: 'texture',
        priority,
        lastAccessed: Date.now(),
        persistent,
        gpuResource: texture
      };

      this.textureCache.set(id, buffer);
      this.memoryPool.allocations.set(id, allocation);
      this.updateMemoryStats(requiredSize, true);

      logger.debug(`Allocated ${this.formatBytes(requiredSize)} for ${id} (${width}x${height} ${format})`);
      return buffer;

    } catch (error) {
      logger.error(`Failed to allocate WebGL buffer ${id}:`, error);

      // Fallback: Try WebGPU buffer first
      logger.debug(`Falling back to WebGPU for ${id}`);
      const webgpuBuffer = await this.allocateWebGPUBuffer(id, width, height, format, priority, persistent);
      if (webgpuBuffer) return webgpuBuffer;

      // Final fallback: Use tiled processing
      logger.info(`Falling back to tiled processing for ${id}`);
      return this.createTiledProcessingBuffer(id, width, height, format, priority, persistent);
    }
  }

  private createOptimizedTexture(width: number, height: number, format: string): WebGLTexture {
    if (!this.gl) throw new Error('WebGL2 context not available');

    const texture = this.gl.createTexture();
    if (!texture) throw new Error('Failed to create texture');

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Set optimal texture parameters for RTX 3080
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Choose optimal internal format
    let internalFormat: number;
    let dataFormat: number;
    let dataType: number;

    switch (format) {
      case 'RGBA32F':
        internalFormat = this.gl.RGBA32F;
        dataFormat = this.gl.RGBA;
        dataType = this.gl.FLOAT;
        break;
      case 'RGBA16F':
        internalFormat = this.gl.RGBA16F;
        dataFormat = this.gl.RGBA;
        dataType = this.gl.HALF_FLOAT;
        break;
      case 'RGBA8':
        internalFormat = this.gl.RGBA8;
        dataFormat = this.gl.RGBA;
        dataType = this.gl.UNSIGNED_BYTE;
        break;
      case 'R32F':
        internalFormat = this.gl.R32F;
        dataFormat = this.gl.RED;
        dataType = this.gl.FLOAT;
        break;
      case 'RG32F':
        internalFormat = this.gl.RG32F;
        dataFormat = this.gl.RG;
        dataType = this.gl.FLOAT;
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Allocate texture memory
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      dataFormat,
      dataType,
      null
    );

    return texture;
  }

  private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    if (!this.gl) throw new Error('WebGL2 context not available');

    const framebuffer = this.gl.createFramebuffer();
    if (!framebuffer) throw new Error('Failed to create framebuffer');

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0
    );

    // Verify framebuffer completeness
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.deleteFramebuffer(framebuffer);

      // Log the specific error for debugging
      const errorMap: Record<number, string> = {
        36054: 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT - Texture too large or unsupported format',
        36055: 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT',
        36057: 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS',
        36061: 'FRAMEBUFFER_UNSUPPORTED'
      };

      const errorName = errorMap[status] || `Unknown error ${status}`;
      throw new Error(`Framebuffer creation failed: ${errorName}`);
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  /**
   * Allocate WebGPU buffer for large textures (unlimited size)
   */
  private async allocateWebGPUBuffer(
    id: string,
    width: number,
    height: number,
    format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'R32F' | 'RG32F',
    priority: 'critical' | 'high' | 'medium' | 'low',
    persistent: boolean
  ): Promise<ProcessingBuffer | null> {
    try {
      // Check if WebGPU is available
      if (!('gpu' in navigator)) {
        return null;
      }

      const adapter = await navigator.gpu?.requestAdapter({
        powerPreference: 'high-performance'
      });

      if (!adapter) {
        return null;
      }

      const device = await adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: 2147483648 // 2GB limit for large RAW files
        }
      });
      const bytesPerPixel = this.getBytesPerPixel(format);
      const bufferSize = width * height * bytesPerPixel;

      // Create WebGPU storage buffer (no size limits like WebGL textures)
      const buffer = device.createBuffer({
        size: bufferSize,
        usage: 0x80 | 0x04 | 0x08, // STORAGE | COPY_SRC | COPY_DST
        mappedAtCreation: false
      });

      const processingBuffer: ProcessingBuffer = {
        id,
        texture: buffer as any, // Store WebGPU buffer in texture field
        framebuffer: null, // Not applicable for WebGPU
        width,
        height,
        format,
        size: bufferSize,
        priority,
        persistent,
        lastUsed: Date.now(),
        type: 'webgpu' // New type to distinguish from WebGL
      };

      this.textureCache.set(id, processingBuffer);
      this.updateMemoryUsage(processingBuffer, 'allocate');

      logger.info(`WebGPU buffer allocated: ${width}x${height} ${format} (${this.formatBytes(bufferSize)})`);
      return processingBuffer;

    } catch (error) {
      logger.warn(`WebGPU buffer allocation failed: ${error}`);
      return null;
    }
  }

  /**
   * Create tiled processing buffer for huge images
   */
  private createTiledProcessingBuffer(
    id: string,
    width: number,
    height: number,
    format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'R32F' | 'RG32F',
    priority: 'critical' | 'high' | 'medium' | 'low',
    persistent: boolean
  ): ProcessingBuffer {
    const tileSize = 2048; // Much larger tiles for 30MP+ processing
    const tilesX = Math.ceil(width / tileSize);
    const tilesY = Math.ceil(height / tileSize);
    const totalTiles = tilesX * tilesY;

    logger.info(`Creating tiled buffer: ${width}x${height} -> ${tilesX}x${tilesY} tiles (${totalTiles} total)`);

    const processingBuffer: ProcessingBuffer = {
      id,
      texture: null, // Will be managed by tiled processor
      framebuffer: null,
      width,
      height,
      format,
      size: width * height * this.getBytesPerPixel(format),
      priority,
      persistent,
      lastUsed: Date.now(),
      type: 'tiled', // New type for tiled processing
      tileConfig: {
        tileSize,
        tilesX,
        tilesY,
        totalTiles
      }
    };

    this.textureCache.set(id, processingBuffer);
    return processingBuffer;
  }

  /**
   * Get or create processing buffer with automatic size optimization
   */
  async getOptimalBuffer(
    width: number,
    height: number,
    format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'R32F' | 'RG32F',
    purpose: string
  ): Promise<ProcessingBuffer | null> {

    // Try to find existing buffer with exact dimensions
    const exactId = `${purpose}_${width}x${height}_${format}`;
    let buffer = this.textureCache.get(exactId);

    if (buffer) {
      this.updateLastAccessed(exactId);
      return buffer;
    }

    // Try to find larger buffer we can reuse
    const suitableBuffer = this.findReusableBuffer(width, height, format);
    if (suitableBuffer) {
      this.updateLastAccessed(suitableBuffer.id);
      return suitableBuffer;
    }

    // Allocate new buffer
    return this.allocateProcessingBuffer(exactId, width, height, format, 'high', false);
  }

  private findReusableBuffer(
    minWidth: number,
    minHeight: number,
    format: string
  ): ProcessingBuffer | null {

    for (const buffer of this.textureCache.values()) {
      if (buffer.format === format &&
          buffer.width >= minWidth &&
          buffer.height >= minHeight &&
          !this.isBufferInUse(buffer.id)) {
        return buffer;
      }
    }
    return null;
  }

  private isBufferInUse(_bufferId: string): boolean {
    // Check if buffer is currently being used in rendering pipeline
    // This would need integration with the rendering system
    return false;
  }

  /**
   * Intelligent memory cleanup based on usage patterns
   */
  private async performIntelligentCleanup(): Promise<void> {
    const currentTime = Date.now();
    const utilizationRatio = this.memoryPool.allocatedVRAM / this.memoryPool.totalVRAM;

    if (utilizationRatio < this.CLEANUP_THRESHOLD) {
      return; // No cleanup needed
    }

    logger.info(`Starting memory cleanup (${(utilizationRatio * 100).toFixed(1)}% utilization)`);

    // Sort allocations by priority and last access time
    const allocations = Array.from(this.memoryPool.allocations.values())
      .filter(alloc => !alloc.persistent)
      .sort((a, b) => {
        // Priority order: low, medium, high, critical
        const priorityWeight = { low: 1, medium: 2, high: 3, critical: 4 };
        if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
          return priorityWeight[a.priority] - priorityWeight[b.priority];
        }
        return a.lastAccessed - b.lastAccessed; // Older first
      });

    let freedMemory = 0;
    const targetFreeMemory = this.memoryPool.totalVRAM * 0.2; // Free 20%

    for (const allocation of allocations) {
      if (freedMemory >= targetFreeMemory) break;

      // Don't free recently accessed resources
      const timeSinceAccess = currentTime - allocation.lastAccessed;
      if (timeSinceAccess < 10000 && allocation.priority !== 'low') continue; // 10 seconds

      this.deallocateResource(allocation.id);
      freedMemory += allocation.size;
    }

    logger.info(`Freed ${this.formatBytes(freedMemory)} of VRAM`);
  }

  /**
   * Free memory for a specific allocation request
   */
  private async freeMemoryForAllocation(
    requiredSize: number,
    priority: 'critical' | 'high' | 'medium' | 'low'
  ): Promise<void> {

    const priorityLevels = ['low', 'medium', 'high', 'critical'];
    const maxPriorityToFree = priorityLevels.indexOf(priority);

    let freedMemory = 0;
    const allocationsToFree = Array.from(this.memoryPool.allocations.values())
      .filter(alloc =>
        !alloc.persistent &&
        priorityLevels.indexOf(alloc.priority) <= maxPriorityToFree
      )
      .sort((a, b) => a.lastAccessed - b.lastAccessed);

    for (const allocation of allocationsToFree) {
      if (freedMemory >= requiredSize) break;

      this.deallocateResource(allocation.id);
      freedMemory += allocation.size;
    }

    if (freedMemory < requiredSize) {
      logger.warn(`Could only free ${this.formatBytes(freedMemory)} of required ${this.formatBytes(requiredSize)}`);
    }
  }

  private deallocateResource(id: string): void {
    const allocation = this.memoryPool.allocations.get(id);
    if (!allocation) return;

    // Remove from caches
    const buffer = this.textureCache.get(id);
    if (buffer && this.gl) {
      this.gl.deleteTexture(buffer.texture);
      if (buffer.framebuffer) {
        this.gl.deleteFramebuffer(buffer.framebuffer);
      }
      this.textureCache.delete(id);
    }

    this.memoryPool.allocations.delete(id);
    this.updateMemoryStats(allocation.size, false);

    logger.debug(`Deallocated ${this.formatBytes(allocation.size)} for ${id}`);
  }

  private canAllocate(size: number, priority: string): boolean {
    const available = this.memoryPool.availableVRAM;

    if (size <= available) return true;

    // For critical allocations, allow some over-allocation
    if (priority === 'critical') {
      const overallocationLimit = this.memoryPool.totalVRAM * 1.1; // 10% over
      return (this.memoryPool.allocatedVRAM + size) <= overallocationLimit;
    }

    return false;
  }

  private updateMemoryStats(size: number, allocating: boolean): void {
    if (allocating) {
      this.memoryPool.allocatedVRAM += size;
      this.memoryPool.availableVRAM -= size;
    } else {
      this.memoryPool.allocatedVRAM -= size;
      this.memoryPool.availableVRAM += size;
    }
  }

  private updateLastAccessed(id: string): void {
    const allocation = this.memoryPool.allocations.get(id);
    if (allocation) {
      allocation.lastAccessed = Date.now();
    }
  }

  private updateMemoryUsage(buffer: ProcessingBuffer, operation: 'allocate' | 'deallocate'): void {
    const allocation: VRAMAllocation = {
      id: buffer.id,
      size: buffer.size,
      type: 'buffer',
      priority: buffer.priority,
      lastAccessed: Date.now(),
      persistent: buffer.persistent,
      gpuResource: buffer.texture
    };

    if (operation === 'allocate') {
      this.memoryPool.allocations.set(buffer.id, allocation);
      this.updateMemoryStats(buffer.size, true);
    } else {
      this.memoryPool.allocations.delete(buffer.id);
      this.updateMemoryStats(buffer.size, false);
    }
  }

  private getBytesPerPixel(format: string): number {
    switch (format) {
      case 'RGBA32F': return 16; // 4 components × 4 bytes
      case 'RGBA16F': return 8;  // 4 components × 2 bytes
      case 'RGBA8': return 4;    // 4 components × 1 byte
      case 'R32F': return 4;     // 1 component × 4 bytes
      case 'RG32F': return 8;    // 2 components × 4 bytes
      default: return 4;
    }
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = window.setInterval(() => {
      this.performIntelligentCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Get current memory usage statistics
   */
  getMemoryStats(): MemoryPool {
    return {
      ...this.memoryPool,
      fragmentedVRAM: this.calculateFragmentation()
    };
  }

  private calculateFragmentation(): number {
    // Simple fragmentation calculation based on allocation sizes
    const allocations = Array.from(this.memoryPool.allocations.values());
    if (allocations.length < 2) return 0;

    const totalGaps = allocations.length - 1;
    const avgAllocationSize = this.memoryPool.allocatedVRAM / allocations.length;

    return totalGaps * avgAllocationSize * 0.1; // Estimate 10% overhead per gap
  }

  /**
   * Force garbage collection and defragmentation
   */
  async forceCleanup(): Promise<void> {
    logger.info('Forcing VRAM cleanup and defragmentation...');

    // Clear all non-persistent, non-critical allocations
    const allocationsToFree = Array.from(this.memoryPool.allocations.values())
      .filter(alloc => !alloc.persistent && alloc.priority !== 'critical');

    for (const allocation of allocationsToFree) {
      this.deallocateResource(allocation.id);
    }

    // Re-allocate commonly used textures
    await this.preallocateCommonTextures();

    logger.info('VRAM cleanup completed');
  }

  /**
   * Get optimal format for given parameters
   */
  getOptimalFormat(
    requiresHighPrecision: boolean,
    isIntermediateBuffer: boolean,
    isOutputBuffer: boolean
  ): 'RGBA32F' | 'RGBA16F' | 'RGBA8' {

    if (requiresHighPrecision || !isOutputBuffer) {
      return 'RGBA32F'; // Full precision for processing
    }

    if (isIntermediateBuffer) {
      return 'RGBA16F'; // Half precision for intermediate steps
    }

    return 'RGBA8'; // Standard precision for final output
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear all allocations
    for (const id of this.memoryPool.allocations.keys()) {
      this.deallocateResource(id);
    }

    logger.info('VRAM Memory Service cleaned up');
  }
}

export const vramOptimizedMemoryService = VRAMOptimizedMemoryService.getInstance();