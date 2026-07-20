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
 */

import { webWorkerImageProcessor } from './WebWorkerImageProcessor';

/** Pixel count above which WebWorkerImageProcessor switches to its TILED path. MUST mirror
 *  `largeImageThreshold` (8000×6000) in WebWorkerImageProcessor — pinned by exportRouting.test.ts. */
export const EXPORT_TILED_MIN_PIXELS = 8000 * 6000;

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
  reason: 'worker-pool' | 'workers-unhealthy' | 'nr-needs-renderer-gpu' | 'tiled-path-not-parity-proven';
}

export function chooseExportProcessing(opts: ExportRoutingOpts): ExportProcessingDecision {
  if (!opts.workersHealthy) return { useWebWorkers: false, reason: 'workers-unhealthy' };
  if (opts.nrActive) return { useWebWorkers: false, reason: 'nr-needs-renderer-gpu' };
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
