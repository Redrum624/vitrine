import { logger } from '../utils/Logger';
import { createPipelineWorker } from '../workers/createPipelineWorker';
import { setWorkerPool } from './ImageProcessingPipeline';
import { spatialApron, effectiveTileSize, planApronTile, pipelineUsesEdgeMask } from '../utils/tiledPipeline';
import { computeGlobalEdgeMax } from '../utils/enhanceOps';

export interface WorkerImageData {
  width: number;
  height: number;
  data: Float32Array;
  channels: number;
  /** v1.36.0 C5: full-PASS `processingLongEdge / nativeLongEdge` (WYSIWYG enhance kernels).
   *  Rides the whole-image message as-is and is forwarded verbatim to every PROCESS_TILE —
   *  never re-derived from tile dims (same out-of-band rule as edgeMaskGlobalMax).
   *  Undefined → native semantics (scale 1). */
  kernelScale?: number;
}

export interface WorkerModuleConfig {
  moduleId: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface ProcessingResult {
  success: boolean;
  data: Float32Array;
  processingTime: number;
  error?: string;
  /** True output width after processing (may differ from input when CropModule is active). */
  width?: number;
  /** True output height after processing (may differ from input when CropModule is active). */
  height?: number;
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
  // Sticky failure flag: once initialization fails (e.g. the worker bundle
  // crashed at module evaluation), do NOT retry on every frame — each retry
  // costs the caller the full init sequence. Callers route to the main thread.
  private initFailed = false;
  private messageId = 0;
  private pendingMessages = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }>();

  // Configuration - optimized for 30MP+ processing
  private readonly maxWorkers = Math.min(8, navigator.hardwareConcurrency || 4); // Use more workers
  private readonly tileSize = 2048; // Process in 2048x2048 tiles for large images (4x larger than before)
  private readonly largeImageThreshold = 8000 * 6000; // 48MP threshold - much higher
  private readonly hugeTileSize = 4096; // For 100MP+ images, use even larger tiles
  private readonly hugeImageThreshold = 12000 * 8000; // 96MP threshold

  static getInstance(): WebWorkerImageProcessor {
    if (!WebWorkerImageProcessor.instance) {
      WebWorkerImageProcessor.instance = new WebWorkerImageProcessor();
    }
    return WebWorkerImageProcessor.instance;
  }

  /** False once initialization has failed — preview routing then keeps ≥1MP
   *  frames on the main thread instead of paying dead-worker timeouts. */
  isHealthy(): boolean {
    return !this.initFailed;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized || this.initFailed) return;

    try {
      logger.info(`Initializing Web Worker image processing with ${this.maxWorkers} workers...`);
      const startTime = performance.now();

      // Create workers
      for (let i = 0; i < this.maxWorkers; i++) {
        // Vite-compiled worker chunk bundling the real ImageProcessingPipeline
        // (zero drift). Boot path differs per environment — blob: URL under the
        // packaged file:// app — see src/workers/createPipelineWorker.ts.
        const worker = await createPipelineWorker();
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
      logger.warn('Web Worker initialization failed, will use main-thread processing:', error);
      // Don't throw — the pipeline falls back to main thread automatically.
      // Mark the failure STICKY and tear down any half-created workers so no
      // dead worker lingers in the pool for a later request to hang on.
      this.isInitialized = false;
      this.initFailed = true;
      for (const w of this.workers) {
        try { w.terminate(); } catch { /* already dead */ }
      }
      this.workers = [];
      this.availableWorkers = [];
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
            pendingMessage.resolve({ success: true });
          } else {
            pendingMessage.reject(new Error(error || 'Initialization failed'));
          }
          break;

        case 'PROCESS_COMPLETE': {
          if (success) {
            // Include outputWidth/outputHeight from the worker so callers can use the
            // TRUE post-crop dims (CropModule mutates the worker-local context).
            const { outputWidth, outputHeight } = event.data as { outputWidth?: number; outputHeight?: number };
            pendingMessage.resolve({
              success: true,
              data,
              processingTime,
              width: outputWidth,
              height: outputHeight,
            });
          } else {
            pendingMessage.reject(new Error(error || 'Processing failed'));
          }
          break;
        }

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
      // A worker 'error' event (e.g. the bundle threw at module evaluation)
      // means in-flight requests will never get a response message. Reject
      // every pending request NOW so callers hit their main-thread fallbacks
      // immediately instead of waiting out the 30s message timeout.
      const message = (error && (error as ErrorEvent).message) || 'Worker crashed';
      for (const [id, pending] of this.pendingMessages) {
        pending.reject(new Error(`Worker error: ${message}`));
        this.pendingMessages.delete(id);
      }
    });
  }

  private sendMessage(worker: Worker, type: string, data: unknown): Promise<unknown> {
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
    // Init failed (now or previously): fail fast so the caller's main-thread
    // fallback runs immediately — getAvailableWorker() would spin forever on
    // an empty pool.
    if (!this.isInitialized) {
      return {
        success: false,
        data: imageData.data,
        processingTime: 0,
        error: 'Web Workers unavailable (initialization failed)',
      };
    }

    const pixelCount = imageData.width * imageData.height;
    const isHugeImage = pixelCount > this.hugeImageThreshold;
    const isLargeImage = pixelCount > this.largeImageThreshold;

    if (isHugeImage) {
      logger.info(`Processing huge image (${imageData.width}x${imageData.height}, ${(pixelCount/1000000).toFixed(1)}MP) with large tiles`);
      return this.processTiledImage(imageData, pipeline, this.hugeTileSize);
    } else if (isLargeImage) {
      logger.info(`Processing large image (${imageData.width}x${imageData.height}, ${(pixelCount/1000000).toFixed(1)}MP) with standard tiles`);
      return this.processTiledImage(imageData, pipeline, this.tileSize);
    } else {
      logger.info(`Processing image (${imageData.width}x${imageData.height}, ${(pixelCount/1000000).toFixed(1)}MP) in single worker`);
      return this.processSingleImage(imageData, pipeline);
    }
  }

  private async processSingleImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[]): Promise<ProcessingResult> {
    const startTime = performance.now();

    try {
      const worker = await this.getAvailableWorker();
      const result = await this.sendMessage(worker, 'PROCESS_IMAGE', { imageData, pipeline }) as ProcessingResult;

      const totalTime = performance.now() - startTime;
      logger.info(`Single-worker processing completed in ${totalTime.toFixed(2)}ms (worker: ${result.processingTime?.toFixed(2)}ms)`);

      return result as ProcessingResult;

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

  private async processTiledImage(imageData: WorkerImageData, pipeline: WorkerModuleConfig[], tileSize: number = this.tileSize): Promise<ProcessingResult> {
    const startTime = performance.now();
    const { width, height, data } = imageData;

    try {
      // Spatial (kernel-based) modules read neighbour pixels; a bare tile boundary cuts the kernel
      // off from the adjacent tile and leaves a visible SEAM. Borrow an apron of neighbour pixels
      // around each tile — sized to the ACTUAL summed kernel radius of the enabled modules — and
      // crop it after processing (see processTile + src/utils/tiledPipeline.ts). apron 0 for
      // point-operation-only pipelines, so tiling stays free there.
      const apron = spatialApron(pipeline);
      // A wide kernel on a small tile wastes compute on the apron; grow the tile to cap that
      // overhead. No-op for the common single-filter case on the production 2048/4096 tiles.
      const effTile = effectiveTileSize(tileSize, apron);

      // Global edge-mask normalisation (two-pass, pass 1 here): the enhance sharpen chain's edgeMask
      // normalises Sobel magnitudes by the buffer max — per-TILE when tiled → a smooth per-tile
      // sharpen-gain step at crop lines. Compute the full-image max ONCE (one extra O(N) luma-Sobel
      // sweep, only when an enhance-sharpen edgeMask is actually in the pipeline) and thread it to
      // every tile so all tiles normalise by the SAME constant (matches the untiled whole-image
      // gain). Pointwise → no new spatial dependency, so the apron above is unchanged.
      //
      // NOTE — this sweeps the pipeline-INPUT `data`, but edgeMask runs after the upstream point-ops
      // (exposure/tone) that shift luma, so the constant is an APPROXIMATION of the true post-upstream
      // max. Investigated + decided WONTFIX (bounded by clamp01 on the brighten side, uniform/seam-
      // free, alpha-gated, >48MP-only; the 1/8-downsample refinement only trades it for a same-
      // direction underestimate at real cost). Full analysis: moduleApron enhance case in tiledPipeline.ts.
      const edgeMaskGlobalMax = pipelineUsesEdgeMask(pipeline)
        ? computeGlobalEdgeMax(data, width, height)
        : undefined;

      // Calculate tile dimensions using the (possibly grown) effective tile size
      const tilesX = Math.ceil(width / effTile);
      const tilesY = Math.ceil(height / effTile);
      const totalTiles = tilesX * tilesY;

      logger.info(`Processing ${totalTiles} tiles (${tilesX}x${tilesY}, ${effTile}px, apron ${apron}px) with ${this.maxWorkers} workers`);

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
            effTile,
            pipeline,
            processedData,
            apron,
            edgeMaskGlobalMax
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
    tileSize: number,
    pipeline: WorkerModuleConfig[],
    resultArray: Float32Array,
    apron = 0,
    edgeMaskGlobalMax?: number
  ): Promise<void> {
    const { width, height, data, channels } = imageData;

    // Padded-extract + crop geometry: the tile is grown by `apron` px of neighbour context on each
    // interior side (clamped at the image borders — there the padded edge IS the image edge, so the
    // module's own clamp policy applies exactly as untiled). Only the interior `core` region is
    // written back, so the redundantly-processed apron pixels never reach the output.
    const plan = planApronTile(tileX, tileY, tileSize, width, height, apron);
    const { coreX, coreY, coreW, coreH, padX, padY, padW, padH, apronLeft, apronTop } = plan;

    // Extract the padded tile data
    const tileData = new Float32Array(padW * padH * channels);
    for (let y = 0; y < padH; y++) {
      for (let x = 0; x < padW; x++) {
        const srcIndex = ((padY + y) * width + (padX + x)) * channels;
        const dstIndex = (y * padW + x) * channels;
        for (let c = 0; c < channels; c++) {
          tileData[dstIndex + c] = data[srcIndex + c];
        }
      }
    }

    try {
      // Process the PADDED tile as a standalone image (the worker sees full kernel context for
      // every interior pixel).
      const worker = await this.getAvailableWorker();
      const result = await this.sendMessage(worker, 'PROCESS_TILE', {
        tileData,
        tileX,
        tileY,
        tileWidth: padW,
        tileHeight: padH,
        fullWidth: width,
        fullHeight: height,
        channels,
        pipeline,
        // Full-image edge-mask max (undefined unless the pipeline runs the enhance edgeMask); the
        // worker puts it on the ProcessingContext so this tile's edgeMask normalises globally.
        edgeMaskGlobalMax,
        // C5: the FULL-pass kernel scale (never derived from this tile's padded dims) so every
        // tile's enhance sharpen kernels compensate identically — no per-tile sharpen seams.
        kernelScale: imageData.kernelScale
      }) as TileProcessingResult;

      if (!result.success) {
        throw new Error(result.error || 'Tile processing failed');
      }

      // Copy ONLY the interior (core) region back, cropping the apron off the padded result.
      for (let y = 0; y < coreH; y++) {
        for (let x = 0; x < coreW; x++) {
          const srcIndex = ((apronTop + y) * padW + (apronLeft + x)) * channels;
          const dstIndex = ((coreY + y) * width + (coreX + x)) * channels;
          for (let c = 0; c < channels; c++) {
            resultArray[dstIndex + c] = result.data[srcIndex + c];
          }
        }
      }

      logger.debug(`Tile ${tileX},${tileY} processed in ${result.processingTime?.toFixed(2)}ms`);

    } catch (error) {
      logger.error(`Failed to process tile ${tileX},${tileY}:`, error);

      // Copy original core data on failure (apron pixels belong to neighbouring tiles)
      for (let y = 0; y < coreH; y++) {
        for (let x = 0; x < coreW; x++) {
          const srcIndex = ((coreY + y) * width + (coreX + x)) * channels;
          const dstIndex = srcIndex;
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

// Register as the pipeline's worker-routing delegate. Registration lives HERE —
// not as a value import inside ImageProcessingPipeline — so the worker bundle
// (whose entry graph is ImageProcessingPipeline) never contains this module or
// its own worker factory. See WorkerPoolLike in ImageProcessingPipeline.ts.
setWorkerPool(webWorkerImageProcessor);