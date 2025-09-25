import { logger } from '../utils/Logger';

export interface WorkerImageData {
  width: number;
  height: number;
  data: Float32Array;
  channels: number;
}

export interface WorkerModuleConfig {
  moduleId: string;
  enabled: boolean;
  params: any;
}

export interface ProcessingResult {
  success: boolean;
  data: Float32Array;
  processingTime: number;
  error?: string;
}

export interface TileProcessingResult extends ProcessingResult {
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
}

export class WebWorkerImageProcessor {
  private static instance: WebWorkerImageProcessor;
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private isInitialized = false;
  private messageId = 0;
  private pendingMessages = new Map<number, { resolve: Function; reject: Function }>();

  // Configuration
  private readonly maxWorkers = Math.min(4, navigator.hardwareConcurrency || 2);
  private readonly tileSize = 512; // Process in 512x512 tiles for large images
  private readonly largeImageThreshold = 4000 * 3000; // 12MP threshold

  static getInstance(): WebWorkerImageProcessor {
    if (!WebWorkerImageProcessor.instance) {
      WebWorkerImageProcessor.instance = new WebWorkerImageProcessor();
    }
    return WebWorkerImageProcessor.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info(`Initializing Web Worker image processing with ${this.maxWorkers} workers...`);
      const startTime = performance.now();

      // Create workers
      for (let i = 0; i < this.maxWorkers; i++) {
        const worker = new Worker('/workers/image-processor.worker.js');
        this.setupWorkerEventHandlers(worker);
        this.workers.push(worker);
        this.availableWorkers.push(worker);

        // Initialize each worker
        await this.sendMessage(worker, 'INITIALIZE', {});
      }

      this.isInitialized = true;
      const initTime = performance.now() - startTime;
      logger.info(`Web Worker image processing initialized in ${initTime.toFixed(2)}ms`);

    } catch (error) {
      logger.error('Failed to initialize Web Worker image processing:', error);
      throw error;
    }
  }

  private setupWorkerEventHandlers(worker: Worker): void {
    worker.addEventListener('message', (event) => {
      const { type, id, success, data, processingTime, error, ...rest } = event.data;

      const pendingMessage = this.pendingMessages.get(id);
      if (!pendingMessage) {
        logger.warn('Received message for unknown request:', id);
        return;
      }

      this.pendingMessages.delete(id);

      // Return worker to available pool
      if (!this.availableWorkers.includes(worker)) {
        this.availableWorkers.push(worker);
      }

      switch (type) {
        case 'INITIALIZE_COMPLETE':
          if (success) {
            pendingMessage.resolve();
          } else {
            pendingMessage.reject(new Error(error || 'Initialization failed'));
          }
          break;

        case 'PROCESS_COMPLETE':
          if (success) {
            pendingMessage.resolve({ success: true, data, processingTime });
          } else {
            pendingMessage.reject(new Error(error || 'Processing failed'));
          }
          break;

        case 'TILE_COMPLETE':
          pendingMessage.resolve({ success, data, processingTime, error, ...rest });
          break;

        case 'ERROR':
          pendingMessage.reject(new Error(error || 'Worker error'));
          break;

        default:
          logger.warn('Unknown message type from worker:', type);
      }
    });

    worker.addEventListener('error', (error) => {
      logger.error('Worker error:', error);
      // Handle worker errors - could restart worker if needed
    });
  }

  private sendMessage(worker: Worker, type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingMessages.set(id, { resolve, reject });

      // Remove worker from available pool
      const workerIndex = this.availableWorkers.indexOf(worker);
      if (workerIndex > -1) {
        this.availableWorkers.splice(workerIndex, 1);
      }

      worker.postMessage({ type, id, data });

      // Set timeout for safety
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error('Worker timeout'));

          // Return worker to pool on timeout
          if (!this.availableWorkers.includes(worker)) {
            this.availableWorkers.push(worker);
          }
        }
      }, 30000); // 30 second timeout
    });
  }

  private async getAvailableWorker(): Promise<Worker> {
    // Wait for an available worker
    while (this.availableWorkers.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return this.availableWorkers[0];
  }

  async processImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[]): Promise<ProcessingResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const pixelCount = imageData.width * imageData.height;
    const isLargeImage = pixelCount > this.largeImageThreshold;

    if (isLargeImage) {
      logger.info(`Processing large image (${imageData.width}x${imageData.height}) with tiled approach`);
      return this.processTiledImage(imageData, pipeline);
    } else {
      logger.info(`Processing image (${imageData.width}x${imageData.height}) in single worker`);
      return this.processSingleImage(imageData, pipeline);
    }
  }

  private async processSingleImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[]): Promise<ProcessingResult> {
    const startTime = performance.now();

    try {
      const worker = await this.getAvailableWorker();
      const result = await this.sendMessage(worker, 'PROCESS_IMAGE', { imageData, pipeline });

      const totalTime = performance.now() - startTime;
      logger.info(`Single-worker processing completed in ${totalTime.toFixed(2)}ms (worker: ${result.processingTime?.toFixed(2)}ms)`);

      return result;

    } catch (error) {
      logger.error('Single-worker processing failed:', error);
      return {
        success: false,
        data: imageData.data,
        processingTime: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Processing failed'
      };
    }
  }

  private async processTiledImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[]): Promise<ProcessingResult> {
    const startTime = performance.now();
    const { width, height, data } = imageData;

    try {
      // Calculate tile dimensions
      const tilesX = Math.ceil(width / this.tileSize);
      const tilesY = Math.ceil(height / this.tileSize);
      const totalTiles = tilesX * tilesY;

      logger.info(`Processing ${totalTiles} tiles (${tilesX}x${tilesY}) with ${this.maxWorkers} workers`);

      // Create result array
      const processedData = new Float32Array(data.length);

      // Process tiles in parallel
      const tilePromises: Promise<void>[] = [];

      for (let tileY = 0; tileY < tilesY; tileY++) {
        for (let tileX = 0; tileX < tilesX; tileX++) {
          const promise = this.processTile(
            imageData,
            tileX,
            tileY,
            pipeline,
            processedData
          );
          tilePromises.push(promise);
        }
      }

      // Wait for all tiles to complete
      await Promise.all(tilePromises);

      const totalTime = performance.now() - startTime;
      logger.info(`Tiled processing completed in ${totalTime.toFixed(2)}ms (${totalTiles} tiles)`);

      return {
        success: true,
        data: processedData,
        processingTime: totalTime
      };

    } catch (error) {
      logger.error('Tiled processing failed:', error);
      return {
        success: false,
        data: imageData.data,
        processingTime: performance.now() - startTime,
        error: error instanceof Error ? error.message : 'Tiled processing failed'
      };
    }
  }

  private async processTile(
    imageData: WorkerImageData,
    tileX: number,
    tileY: number,
    pipeline: WorkerModuleConfig[],
    resultArray: Float32Array
  ): Promise<void> {
    const { width, height, data, channels } = imageData;

    // Calculate tile bounds
    const startX = tileX * this.tileSize;
    const startY = tileY * this.tileSize;
    const tileWidth = Math.min(this.tileSize, width - startX);
    const tileHeight = Math.min(this.tileSize, height - startY);

    // Extract tile data
    const tileDataSize = tileWidth * tileHeight * channels;
    const tileData = new Float32Array(tileDataSize);

    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        const srcIndex = ((startY + y) * width + (startX + x)) * channels;
        const dstIndex = (y * tileWidth + x) * channels;

        for (let c = 0; c < channels; c++) {
          tileData[dstIndex + c] = data[srcIndex + c];
        }
      }
    }

    try {
      // Process tile
      const worker = await this.getAvailableWorker();
      const result: TileProcessingResult = await this.sendMessage(worker, 'PROCESS_TILE', {
        tileData,
        tileX,
        tileY,
        tileWidth,
        tileHeight,
        fullWidth: width,
        fullHeight: height,
        pipeline
      });

      if (!result.success) {
        throw new Error(result.error || 'Tile processing failed');
      }

      // Copy processed tile back to result array
      for (let y = 0; y < tileHeight; y++) {
        for (let x = 0; x < tileWidth; x++) {
          const srcIndex = (y * tileWidth + x) * channels;
          const dstIndex = ((startY + y) * width + (startX + x)) * channels;

          for (let c = 0; c < channels; c++) {
            resultArray[dstIndex + c] = result.data[srcIndex + c];
          }
        }
      }

      logger.debug(`Tile ${tileX},${tileY} processed in ${result.processingTime?.toFixed(2)}ms`);

    } catch (error) {
      logger.error(`Failed to process tile ${tileX},${tileY}:`, error);

      // Copy original data on failure
      for (let y = 0; y < tileHeight; y++) {
        for (let x = 0; x < tileWidth; x++) {
          const srcIndex = ((startY + y) * width + (startX + x)) * channels;
          const dstIndex = (y * tileWidth + x) * channels;

          for (let c = 0; c < channels; c++) {
            resultArray[dstIndex + c] = data[srcIndex + c];
          }
        }
      }
    }
  }

  // Check if Web Workers are supported and beneficial for given image
  shouldUseWorkers(imageData: WorkerImageData): boolean {
    if (!this.isInitialized) return false;

    // Don't use workers for very small images (overhead not worth it)
    const pixelCount = imageData.width * imageData.height;
    const minPixelThreshold = 1000 * 1000; // 1MP

    return pixelCount >= minPixelThreshold;
  }

  // Get processing statistics
  getStats() {
    return {
      maxWorkers: this.maxWorkers,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.workers.length - this.availableWorkers.length,
      pendingMessages: this.pendingMessages.size,
      isInitialized: this.isInitialized,
      tileSize: this.tileSize,
      largeImageThreshold: this.largeImageThreshold
    };
  }

  // Cleanup
  dispose(): void {
    logger.info('Disposing Web Worker image processor...');

    // Clear pending messages
    this.pendingMessages.clear();

    // Terminate workers
    this.workers.forEach(worker => {
      worker.terminate();
    });

    this.workers = [];
    this.availableWorkers = [];
    this.isInitialized = false;
  }
}

export const webWorkerImageProcessor = WebWorkerImageProcessor.getInstance();