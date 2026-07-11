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
import type { WorkerModuleConfig, WorkerImageData } from '../services/WebWorkerImageProcessor';

// `self` inside a worker is the DedicatedWorkerGlobalScope. The project tsconfig now
// includes the "WebWorker" lib (added cleanly — no project-wide type conflicts), so
// we can declare it properly rather than using an opaque `unknown` cast.
declare const self: DedicatedWorkerGlobalScope;
const ctx = self;

// One real pipeline per worker thread. Each worker is its own module instance, so
// configuring it from the per-message config never races with other workers.
const pipeline = new ImageProcessingPipeline();

// ---------------------------------------------------------------------------
// Typed discriminated union for inbound worker messages
// ---------------------------------------------------------------------------

interface InitializeMessage {
  type: 'INITIALIZE';
  id: string;
}

interface ProcessImageMessage {
  type: 'PROCESS_IMAGE';
  id: string;
  data: {
    imageData: WorkerImageData;
    pipeline: WorkerModuleConfig[];
  };
}

interface ProcessTileMessage {
  type: 'PROCESS_TILE';
  id: string;
  data: {
    tileData: Float32Array;
    tileWidth: number;
    tileHeight: number;
    tileX: number;
    tileY: number;
    /** Full-image dimensions sent by the caller; unused here — tiles are processed
     *  as standalone images (see NOTE below). */
    fullWidth?: number;
    fullHeight?: number;
    channels?: number;
    pipeline: WorkerModuleConfig[];
  };
}

type WorkerInboundMessage = InitializeMessage | ProcessImageMessage | ProcessTileMessage;

// ---------------------------------------------------------------------------

/** Configure the real pipeline from the message config, then run its CPU path.
 *
 * processOnMainThread() opens with `let currentData = new Float32Array(input)`,
 * so it copies the buffer internally and does NOT mutate the caller's array.
 * We therefore pass `data` directly — the extra `new Float32Array(data)` copy
 * that used to live here was redundant. */
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
  return pipeline.processImage(data, context, false);
}

ctx.addEventListener('message', async (event: MessageEvent) => {
  // Treat the inbound payload as typed; fall through to `default` for unknown shapes.
  const msg = event.data as WorkerInboundMessage;

  try {
    switch (msg.type) {
      case 'INITIALIZE': {
        // Pipeline is constructed at module load; nothing else to warm up.
        ctx.postMessage({ type: 'INITIALIZE_COMPLETE', id: msg.id, success: true });
        break;
      }

      case 'PROCESS_IMAGE': {
        const startTime = performance.now();
        const { imageData, pipeline: pipelineConfig } = msg.data;
        // Build a local context so we can read the output dims AFTER processing.
        // CropModule mutates context.width/height in place when an active crop
        // changes the image dimensions. The structured-clone boundary means the
        // caller's context never sees that mutation, so we must return the final
        // dims explicitly in the response.
        const context: ProcessingContext = {
          width: imageData.width,
          height: imageData.height,
          channels: imageData.channels,
        };
        pipeline.applyWorkerConfig(pipelineConfig);
        const result = await pipeline.processImage(imageData.data, context, false);
        const processingTime = performance.now() - startTime;
        // context.width / context.height now hold the TRUE output dims (post-crop).
        ctx.postMessage(
          {
            type: 'PROCESS_COMPLETE',
            id: msg.id,
            success: true,
            data: result,
            processingTime,
            outputWidth: context.width,
            outputHeight: context.height,
          },
          [result.buffer],
        );
        break;
      }

      case 'PROCESS_TILE': {
        const startTime = performance.now();
        const { tileData, tileWidth, tileHeight, tileX, tileY, channels, pipeline: pipelineConfig } = msg.data;
        // Tiles are processed as standalone images. The caller (WebWorkerImageProcessor.processTile)
        // grows each tile by an APRON of neighbour pixels sized to the enabled modules' summed kernel
        // radius (spatialApron), so every INTERIOR pixel already has full kernel context here; the
        // caller then crops the apron off. BOUNDED-CONVOLUTION filters (blur/sharpen/NLM/
        // ShadowsHighlights mask blur/the enhance kernel cone) are therefore seam-free at tile
        // boundaries. NOT covered (see moduleApron in src/utils/tiledPipeline.ts): geometric warps
        // (lens distortion/perspective/CA, crop rotation — displacement scales with image size) and
        // global statistics (enhance edgeMask mmax). tileWidth/tileHeight are the PADDED dims;
        // fullWidth/fullHeight remain informational only.
        const resolvedChannels = channels ?? 4;
        const result = await runPipeline(
          tileData, tileWidth, tileHeight, resolvedChannels, pipelineConfig,
        );
        const processingTime = performance.now() - startTime;
        ctx.postMessage(
          {
            type: 'TILE_COMPLETE',
            id: msg.id,
            success: true,
            data: result,
            tileX,
            tileY,
            tileWidth,
            tileHeight,
            processingTime,
          },
          [result.buffer],
        );
        break;
      }

      default: {
        // Exhaustiveness: `msg` is typed, but the cast above could receive unknown
        // message types at runtime — report them rather than silently dropping.
        const unknown = event.data as { type?: unknown; id?: unknown };
        ctx.postMessage({ type: 'ERROR', id: unknown.id, error: `Unknown message type: ${String(unknown.type)}` });
        break;
      }
    }
  } catch (error) {
    const fallbackId = (event.data as { id?: unknown }).id;
    ctx.postMessage({
      type: 'ERROR',
      id: fallbackId,
      error: error instanceof Error ? error.message : 'Worker error',
    });
  }
});
