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
  /** Local Adjustments active: a > 48 MP worker frame would be TILED, and tiles rebake the
   *  mask geometry per tile (fix round 1, Task 12c) — keep such frames on the main thread. */
  laActive?: boolean;
}

/** Mirrors WebWorkerImageProcessor.largeImageThreshold / exportRouting.EXPORT_TILED_MIN_PIXELS. */
export const WORKER_TILED_MIN_PIXELS = 8000 * 6000;

export type PreviewRouteReason = 'gpu' | 'worker' | 'small-main' | 'workers-unhealthy' | 'nr-needs-renderer-gpu' | 'la-not-tile-safe' | 'not-tile-safe';

export function choosePreviewRoute(opts: PreviewRoutingOpts): { path: 'gpu' | 'worker' | 'main'; reason: PreviewRouteReason } {
  const { gpuAvailable, activeCpuBridgeCount, passCount, width, height, workersHealthy = true, nrActive = false, laActive = false } = opts;

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

  if (laActive && width * height > WORKER_TILED_MIN_PIXELS) {
    return { path: 'main', reason: 'la-not-tile-safe' };
  }

  // Any frame above the tiled threshold would hit the pool's TILED path, where crop/lens warps/
  // dehaze run per tile and the result carries no width/height/frameRect (garbled, mis-sized
  // preview). Reachable once the High/Max memory preset lifts the preview cap to native.
  if (width * height > WORKER_TILED_MIN_PIXELS) {
    return { path: 'main', reason: 'not-tile-safe' };
  }

  if (width * height >= WORKER_MIN_PIXELS) {
    return { path: 'worker', reason: 'worker' };
  }

  return { path: 'main', reason: 'small-main' };
}

export function choosePreviewPath(opts: PreviewRoutingOpts): 'gpu' | 'worker' | 'main' {
  return choosePreviewRoute(opts).path;
}

/**
 * True when a worker-routed pass at w×h would take the pool's TILED path (> 48 MP) while
 * Local Adjustments are active (fix round 1, Task 12c): tiles are processed as standalone
 * images, so each tile would rebake the mask geometry over ITSELF — the mask lands per tile,
 * not on the photo. Callers that would otherwise pass `useWebWorkers: true` (EnhanceService
 * bake develop pass, the preview route) keep such passes on the main thread. Exports above
 * 48 MP are already main-thread (chooseExportProcessing).
 */
export function laTiledWorkerUnsafe(
  pipeline: { isModuleActive?(moduleId: string): boolean } | null | undefined,
  width: number,
  height: number,
): boolean {
  if (width * height <= WORKER_TILED_MIN_PIXELS) return false;
  return typeof pipeline?.isModuleActive === 'function' ? pipeline.isModuleActive('localadjustments') : false;
}
