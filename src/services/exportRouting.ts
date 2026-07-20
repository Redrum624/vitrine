/**
 * Routing decision for the EXPORT processing paths (single export in ExportDialog, batch export in
 * MultiExportService) — the export-side sibling of previewRouting.choosePreviewPath.
 *
 * History: both export call sites hardcoded `useWebWorkers: false` ("web workers may produce
 * different results") from the era when the packaged worker pool was dead (revived 2026-07-20,
 * commit f7ab1ab) and the parity of the worker path was unproven. Parity is now pinned by
 * src/test/exportWorkerParity.test.ts (config-serialisation round-trip is bit-exact) and the
 * tileSeams suite, so exports may route through the pool — with these deliberate exceptions:
 *
 *  - `workersHealthy` false (pool init failed) → main thread, same graceful degradation as the
 *    preview path. The pipeline would also fall back internally, but deciding here keeps the
 *    single-export progress reporting (per-module onProgress) on the path that supports it.
 *  - Noise Reduction ACTIVE → main thread. NR's export-resolution path is GPU NLM (whole-frame or
 *    tiled) on the renderer's WebGL2 context; inside a worker there is no WebGL
 *    (webGLImageProcessor.isAvailable() → false) and the >1MP CPU case is an explicit pass-through
 *    no-op — routing an NR export into the pool would SILENTLY drop the denoise. Keeping the whole
 *    pipeline on the main thread preserves today's exact NR export behaviour. (A finer split —
 *    workers for the other modules, NR main-thread between two worker phases — needs new pipeline
 *    phase machinery; not worth it for the opt-in NR case.)
 *  - Image large enough for the pool's TILED path (> EXPORT_TILED_MIN_PIXELS, i.e. > 48MP) → main
 *    thread. The apron-tiled path is seam-hardened for bounded convolutions (tileSeams), but tiles
 *    are processed as standalone images, so position-dependent or whole-image-statistic modules
 *    (crop/lens warps, local-adjustment mask geometry, tone-curve auto levels, dehaze floor, the
 *    edgeMask mmax approximation) are NOT parity-exact there. Exports must stay byte-meaningful,
 *    so >48MP keeps today's main-thread behaviour. Below the threshold the pool processes the
 *    WHOLE image in one worker running the identical pipeline code — parity by construction.
 *  - BOTH dims ≤ EXPORT_GPU_MAX_DIM (4096) → main thread (W3 fix round 1, finding M2). On the
 *    main thread several module passes (lens distortion/CA/vignetting, NR NLM) run on the
 *    renderer's WebGL2 via webGLImageProcessor, which caps GPU work at 4096 per side
 *    (WebGLImageProcessor.runPass safeDim); a worker has no WebGL, so routing a small export
 *    into the pool silently swaps those GPU passes for their CPU fallbacks — numerically close
 *    but only within the GPU self-check tolerances (up to 0.02 for vignette), i.e. an output
 *    CHANGE vs pre-W3. The worker-pool speedup on ≤4096² images is marginal anyway, so small
 *    exports keep their exact pre-W3 (GPU-capable main-thread) output. Above 4096 on either
 *    side the main thread was already all-CPU, so the worker route is bit-parity there.
 */

import { webWorkerImageProcessor } from './WebWorkerImageProcessor';

/** Pixel count above which WebWorkerImageProcessor switches to its TILED path. MUST mirror
 *  `largeImageThreshold` (8000×6000) in WebWorkerImageProcessor — pinned by exportRouting.test.ts
 *  against the live source of truth (getStats().largeImageThreshold). */
export const EXPORT_TILED_MIN_PIXELS = 8000 * 6000;

/** Per-side ceiling for renderer-GPU passes. MUST mirror the `safeDim` cap in
 *  WebGLImageProcessor.runPass (`Math.min(maxTextureSize, 4096)`): at or below this on BOTH
 *  sides, main-thread module passes may run on the GPU — a worker cannot, so small exports stay
 *  on the main thread to preserve their pre-W3 GPU output (see header). */
export const EXPORT_GPU_MAX_DIM = 4096;

export interface ExportRoutingOpts {
  /** WebWorkerImageProcessor.isHealthy() — false once worker init has failed. */
  workersHealthy: boolean;
  /** pipeline.isModuleActive('noise-reduction') — NR needs the renderer's WebGL2 at export res. */
  nrActive: boolean;
  width: number;
  height: number;
}

export interface ExportProcessingDecision {
  useWebWorkers: boolean;
  /** Human-readable routing reason — logged by the export call sites so a packaged-app log shows
   *  which path an export took. */
  reason: 'worker-pool' | 'workers-unhealthy' | 'nr-needs-renderer-gpu' | 'small-image-gpu-parity' | 'tiled-path-not-parity-proven';
}

export function chooseExportProcessing(opts: ExportRoutingOpts): ExportProcessingDecision {
  if (!opts.workersHealthy) return { useWebWorkers: false, reason: 'workers-unhealthy' };
  if (opts.nrActive) return { useWebWorkers: false, reason: 'nr-needs-renderer-gpu' };
  // Size floor (finding M2): with BOTH dims ≤4096 the main-thread pipeline can run its
  // renderer-GPU module passes (workers can't — no WebGL), and the worker speedup is marginal
  // at this size. Stay on the main thread so small exports keep their exact pre-W3 output.
  if (opts.width <= EXPORT_GPU_MAX_DIM && opts.height <= EXPORT_GPU_MAX_DIM) {
    return { useWebWorkers: false, reason: 'small-image-gpu-parity' };
  }
  if (opts.width * opts.height > EXPORT_TILED_MIN_PIXELS) {
    return { useWebWorkers: false, reason: 'tiled-path-not-parity-proven' };
  }
  return { useWebWorkers: true, reason: 'worker-pool' };
}

/** Convenience wrapper reading the live worker-pool health + NR state (mirrors how
 *  AdjustmentPanel feeds choosePreviewPath). `pipeline` is structurally typed so tests and the
 *  export services can pass the real ImageProcessingPipeline without an import cycle. */
export function decideExportProcessing(
  pipeline: { isModuleActive?(moduleId: string): boolean } | null | undefined,
  width: number,
  height: number,
): ExportProcessingDecision {
  return chooseExportProcessing({
    workersHealthy: webWorkerImageProcessor.isHealthy(),
    // typeof-guarded: test doubles for the pipeline may omit isModuleActive — treat as NR-off.
    nrActive: typeof pipeline?.isModuleActive === 'function' ? pipeline.isModuleActive('noise-reduction') : false,
    width,
    height,
  });
}
