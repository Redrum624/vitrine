/**
 * Vite MODULE worker for CPU image processing — ZERO drift.
 *
 * Replaces the old hand-ported public/workers/image-processor.worker.js, which kept
 * its own diverged copies of 5 modules' pixel math. This worker imports the REAL
 * ImageProcessingPipeline (a fresh instance per worker thread) and runs its actual
 * registered modules, so there is NO duplicated math and ALL 11 modules are covered.
 *
 * Worker safety: the modules gate their GPU fast-paths on webGLImageProcessor
 * .isAvailable(), which returns false inside a worker (no `document` → no WebGL2
 * context, guarded in WebGLImageProcessor.ensureContext). Every module therefore
 * takes its CPU path here. No nested workers are spawned: the pipeline is always
 * invoked with useWebWorkers=false, so there is no recursion.
 *
 * Message protocol (identical to the retired worker, matched by `id`):
 *   INITIALIZE   → INITIALIZE_COMPLETE
 *   PROCESS_IMAGE→ PROCESS_COMPLETE  (full image)
 *   PROCESS_TILE → TILE_COMPLETE     (a tile treated as a standalone image)
 *   any error    → ERROR
 * Result Float32Array buffers are posted back as transferables (zero-copy).
 */
import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { ProcessingContext } from '../services/ImageProcessingPipeline';
import type { WorkerModuleConfig } from '../services/WebWorkerImageProcessor';

// `self` inside a worker is the DedicatedWorkerGlobalScope; its postMessage takes a
// transfer list as the 2nd arg. The project tsconfig ships the DOM lib (Window) but
// not the WebWorker lib, so we type a local handle that exposes the worker shape.
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

// One real pipeline per worker thread. Each worker is its own module instance, so
// configuring it from the per-message config never races with other workers.
const pipeline = new ImageProcessingPipeline();

interface WorkerImageData {
  width: number;
  height: number;
  data: Float32Array;
  channels: number;
}

/** Configure the real pipeline from the message config, then run its CPU path. */
async function runPipeline(
  data: Float32Array,
  width: number,
  height: number,
  channels: number,
  config: WorkerModuleConfig[],
): Promise<Float32Array> {
  pipeline.applyWorkerConfig(config);
  const context: ProcessingContext = { width, height, channels };
  // useWebWorkers=false → CPU in-worker, NO nested workers (no recursion).
  return pipeline.processImage(new Float32Array(data), context, false);
}

ctx.addEventListener('message', async (event: MessageEvent) => {
  const { type, id, data } = event.data;

  try {
    switch (type) {
      case 'INITIALIZE': {
        // Pipeline is constructed at module load; nothing else to warm up.
        ctx.postMessage({ type: 'INITIALIZE_COMPLETE', id, success: true });
        break;
      }

      case 'PROCESS_IMAGE': {
        const startTime = performance.now();
        const imageData = data.imageData as WorkerImageData;
        const config = data.pipeline as WorkerModuleConfig[];
        const result = await runPipeline(
          imageData.data, imageData.width, imageData.height, imageData.channels, config,
        );
        const processingTime = performance.now() - startTime;
        ctx.postMessage(
          { type: 'PROCESS_COMPLETE', id, success: true, data: result, processingTime },
          [result.buffer],
        );
        break;
      }

      case 'PROCESS_TILE': {
        const startTime = performance.now();
        const config = data.pipeline as WorkerModuleConfig[];
        // A tile is processed as a standalone image (matches the retired worker).
        const channels = (data.channels as number) ?? 4;
        const result = await runPipeline(
          data.tileData as Float32Array, data.tileWidth, data.tileHeight, channels, config,
        );
        const processingTime = performance.now() - startTime;
        ctx.postMessage(
          {
            type: 'TILE_COMPLETE',
            id,
            success: true,
            data: result,
            tileX: data.tileX,
            tileY: data.tileY,
            tileWidth: data.tileWidth,
            tileHeight: data.tileHeight,
            processingTime,
          },
          [result.buffer],
        );
        break;
      }

      default:
        ctx.postMessage({ type: 'ERROR', id, error: `Unknown message type: ${type}` });
    }
  } catch (error) {
    ctx.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Worker error',
    });
  }
});
