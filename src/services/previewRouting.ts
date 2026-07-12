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
}

export function choosePreviewPath(opts: PreviewRoutingOpts): 'gpu' | 'worker' | 'main' {
  const { gpuAvailable, activeCpuBridgeCount, passCount, width, height } = opts;

  if (gpuAvailable && activeCpuBridgeCount === 0 && passCount > 0) {
    return 'gpu';
  }

  if (width * height >= WORKER_MIN_PIXELS) {
    return 'worker';
  }

  return 'main';
}
