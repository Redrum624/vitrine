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
  /** v1.40.0 Task 9b fix 1: drag-suspension preview pass (see ProcessingContext.cropSuspended). */
  cropSuspended?: boolean;
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
  /** v1.40.0 Task 9b: the effective crop rect the pass rendered (expanded-canvas normalised);
   *  absent when crop did not run. */
  frameRect?: { x: number; y: number; width: number; height: number };
}

export interface TileProcessingResult extends ProcessingResult {
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
}

/** A message the worker has not answered within this window is abandoned: the worker is
 *  terminated and replaced (v1.40.0 Task 10b — never hand a still-busy worker back to the pool). */
export const WORKER_MESSAGE_TIMEOUT_MS = 30_000;
/** How long a job waits for a free worker before failing (its caller then falls back to the
 *  main thread). Two message timeouts: every busy worker either answers or is recycled within one. */
export const WORKER_ACQUIRE_DEADLINE_MS = 2 * WORKER_MESSAGE_TIMEOUT_MS;

export class WebWorkerImageProcessor {
  private static instance: WebWorkerImageProcessor;
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  // Jobs waiting for a free worker (FIFO). A released worker goes straight to the oldest
  // waiter instead of the pool, so a waiter never polls.
  private workerWaiters: Array<{ resolve: (w: Worker) => void; reject: (e: Error) => void }> = [];
  private isInitialized = false;
  // Sticky failure flag: once initialization fails (e.g. the worker bundle
  // crashed at module evaluation), do NOT retry on every frame — each retry
  // costs the caller the full init sequence. Callers route to the main thread.
  private initFailed = false;
  // Bumped by dispose(): a respawn started under an older generation never joins the pool.
  private generation = 0;
  // Replacements being spawned/initialised for the CURRENT generation (pool may refill).
  private respawnsInFlight = 0;
  private messageId = 0;
  private pendingMessages = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    worker: Worker;
    timer: ReturnType<typeof setTimeout>;
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
    return !this.initFailed && !this.isDrained();
  }

  /** Initialised, but every worker is gone and none is being respawned: the pool can never
   *  refill, so jobs must fail fast (callers fall back to the main thread). */
  private isDrained(): boolean {
    return this.isInitialized && this.workers.length === 0 && this.respawnsInFlight === 0;
  }

  /** The pool just drained: fail every waiting job now instead of at its deadline. */
  private failWaitersIfDrained(): void {
    if (!this.isDrained()) return;
    logger.warn('Pipeline worker pool drained (respawns failed); previews fall back to the main thread');
    const waiters = this.workerWaiters;
    this.workerWaiters = [];
    for (const w of waiters) w.reject(new Error('No worker available (pool drained)'));
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
      clearTimeout(pendingMessage.timer);

      // A worker that failed to boot is never pooled: terminate and drop it.
      if (type === 'INITIALIZE_COMPLETE' && !success) {
        logger.warn('Pipeline worker failed INITIALIZE; terminating it:', error || 'no reason given');
        try { worker.terminate(); } catch { /* already dead */ }
        this.workers = this.workers.filter((w) => w !== worker);
        this.availableWorkers = this.availableWorkers.filter((w) => w !== worker);
      } else if (this.workers.includes(worker)) {
        // Return worker to available pool (only a worker still in the pool — a recycled
        // worker's late answer must never re-enter it).
        this.releaseWorker(worker);
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
            const { outputWidth, outputHeight, frameRect } = event.data as {
              outputWidth?: number; outputHeight?: number; frameRect?: ProcessingResult['frameRect'];
            };
            pendingMessage.resolve({
              success: true,
              data,
              processingTime,
              width: outputWidth,
              height: outputHeight,
              frameRect,
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
        clearTimeout(pending.timer);
        pending.reject(new Error(`Worker error: ${message}`));
        this.pendingMessages.delete(id);
      }
    });
  }

  private sendMessage(worker: Worker, type: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;

      // Remove worker from available pool
      const workerIndex = this.availableWorkers.indexOf(worker);
      if (workerIndex > -1) {
        this.availableWorkers.splice(workerIndex, 1);
      }

      // Safety timeout. The worker is still BUSY (a long synchronous pass cannot be
      // interrupted), so it is terminated and replaced — returning it to the pool made every
      // later job queue behind it for another full timeout (v1.40.0 R4 cascade).
      const timer = setTimeout(() => {
        if (!this.pendingMessages.has(id)) return;
        this.pendingMessages.delete(id);
        reject(new Error('Worker timeout'));
        this.recycleWorker(worker, `no answer to ${type} within ${WORKER_MESSAGE_TIMEOUT_MS}ms`, type !== 'INITIALIZE');
      }, WORKER_MESSAGE_TIMEOUT_MS);

      this.pendingMessages.set(id, { resolve, reject, worker, timer });
      worker.postMessage({ type, id, data });
    });
  }

  /**
   * Terminate a hung worker, drop it from the pool (and fail anything else it still owed),
   * then spawn a replacement so the pool stays at maxWorkers. A replacement that itself
   * hangs on INITIALIZE is not respawned again (no spawn loop).
   */
  private recycleWorker(worker: Worker, reason: string, respawn: boolean): void {
    logger.warn(`Recycling pipeline worker: ${reason}`);
    try { worker.terminate(); } catch { /* already dead */ }
    this.workers = this.workers.filter((w) => w !== worker);
    this.availableWorkers = this.availableWorkers.filter((w) => w !== worker);
    for (const [id, pending] of this.pendingMessages) {
      if (pending.worker !== worker) continue;
      clearTimeout(pending.timer);
      this.pendingMessages.delete(id);
      pending.reject(new Error('Worker terminated'));
    }
    if (!respawn || !this.isInitialized) {
      this.failWaitersIfDrained();
      return;
    }
    const gen = this.generation;
    this.respawnsInFlight++;
    void (async () => {
      let replacement: Worker | null = null;
      try {
        replacement = await createPipelineWorker();
        // dispose() (and maybe a re-initialize()) ran meanwhile: never join a newer pool.
        if (gen !== this.generation || !this.isInitialized) {
          replacement.terminate();
          return;
        }
        this.setupWorkerEventHandlers(replacement);
        this.workers.push(replacement);
        // Pooled by the INITIALIZE_COMPLETE handler (sendMessage takes it out until then).
        await this.sendMessage(replacement, 'INITIALIZE', {});
        logger.info(`Replacement pipeline worker ready (${this.workers.length}/${this.maxWorkers})`);
      } catch (error) {
        logger.warn('Replacement pipeline worker failed to start:', error instanceof Error ? error.message : String(error));
        if (replacement && gen === this.generation) {
          try { replacement.terminate(); } catch { /* already dead */ }
          this.workers = this.workers.filter((w) => w !== replacement);
          this.availableWorkers = this.availableWorkers.filter((w) => w !== replacement);
        }
      } finally {
        if (gen === this.generation) {
          this.respawnsInFlight--;
          this.failWaitersIfDrained();
        }
      }
    })();
  }

  /** Hand a free worker to the oldest waiting job, or back to the pool. */
  private releaseWorker(worker: Worker): void {
    if (this.availableWorkers.includes(worker)) return;
    const waiter = this.workerWaiters.shift();
    if (waiter) waiter.resolve(worker);
    else this.availableWorkers.push(worker);
  }

  /** Claim a free worker (removed from the pool at once, so two jobs never share one).
   *  Fails after `deadlineMs` instead of waiting forever on an empty pool. */
  private getAvailableWorker(deadlineMs = WORKER_ACQUIRE_DEADLINE_MS): Promise<Worker> {
    const free = this.availableWorkers.shift();
    if (free) return Promise.resolve(free);
    if (this.isDrained()) return Promise.reject(new Error('No worker available (pool drained)'));
    return new Promise<Worker>((resolve, reject) => {
      const waiter = {
        resolve: (w: Worker) => { clearTimeout(timer); resolve(w); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      };
      const timer = setTimeout(() => {
        this.workerWaiters = this.workerWaiters.filter((x) => x !== waiter);
        reject(new Error(`No worker available within ${deadlineMs}ms`));
      }, deadlineMs);
      this.workerWaiters.push(waiter);
    });
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

    // A respawn still in flight belongs to this (now dead) generation.
    this.generation++;
    this.respawnsInFlight = 0;

    // Fail pending messages (and clear their timeout timers) so no caller hangs forever.
    for (const pending of this.pendingMessages.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Worker pool disposed'));
    }
    this.pendingMessages.clear();

    // Terminate workers
    this.workers.forEach(worker => {
      worker.terminate();
    });

    this.workers = [];
    this.availableWorkers = [];
    for (const waiter of this.workerWaiters) waiter.reject(new Error('Worker pool disposed'));
    this.workerWaiters = [];
    this.isInitialized = false;
  }
}

export const webWorkerImageProcessor = WebWorkerImageProcessor.getInstance();

// Register as the pipeline's worker-routing delegate. Registration lives HERE —
// not as a value import inside ImageProcessingPipeline — so the worker bundle
// (whose entry graph is ImageProcessingPipeline) never contains this module or
// its own worker factory. See WorkerPoolLike in ImageProcessingPipeline.ts.
setWorkerPool(webWorkerImageProcessor);