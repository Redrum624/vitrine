/**
 * Pure routing-decision helper for AdjustmentPanel's preview path.
 *
 * Returns which execution path should handle the next preview frame:
 *   'gpu'    — WebGL2 GPU pipeline (fast, off main thread)
 *   'worker' — CPU pipeline in the worker pool (off main thread, ≥1MP)
 *   'main'   — CPU pipeline on the main thread (tiny previews below 1MP)
 */

export const WORKER_MIN_PIXELS = 1_000_000; // 1MP

export interface PreviewRoutingOpts {
  gpuAvailable: boolean;
  activeCpuBridgeCount: number;
  passCount: number;
  width: number;
  height: number;
  /** WebWorkerImageProcessor.isHealthy() — false once worker init has failed.
   *  Routes ≥1MP frames to 'main' instead of a dead worker pool. Optional so
   *  existing callers/tests keep the pre-health behaviour (assumed healthy). */
  workersHealthy?: boolean;
  /** imageProcessingPipeline.isModuleActive('noise-reduction'): NR needs the renderer's WebGL2,
   *  so a non-GPU frame must stay on the main thread (workers have no GL and skip NR). */
  nrActive?: boolean;
}

export type PreviewRouteReason = 'gpu' | 'worker' | 'small-main' | 'workers-unhealthy' | 'nr-needs-renderer-gpu';

export function choosePreviewRoute(opts: PreviewRoutingOpts): { path: 'gpu' | 'worker' | 'main'; reason: PreviewRouteReason } {
  const { gpuAvailable, activeCpuBridgeCount, passCount, width, height, workersHealthy = true, nrActive = false } = opts;

  if (gpuAvailable && activeCpuBridgeCount === 0 && passCount > 0) {
    return { path: 'gpu', reason: 'gpu' };
  }

  // NR in a worker silently no-ops above 1MP (no WebGL2 there) — keep it on the renderer.
  if (nrActive) {
    return { path: 'main', reason: 'nr-needs-renderer-gpu' };
  }

  if (!workersHealthy) {
    return { path: 'main', reason: 'workers-unhealthy' };
  }

  if (width * height >= WORKER_MIN_PIXELS) {
    return { path: 'worker', reason: 'worker' };
  }

  return { path: 'main', reason: 'small-main' };
}

export function choosePreviewPath(opts: PreviewRoutingOpts): 'gpu' | 'worker' | 'main' {
  return choosePreviewRoute(opts).path;
}
