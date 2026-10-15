import { choosePreviewRoute, WORKER_TILED_MIN_PIXELS } from '../services/previewRouting';

/**
 * Final-review fix 1: the High/Max memory preset lifts the preview cap to native, so a > 48 MP
 * non-GPU preview frame could reach WebWorkerImageProcessor's TILED path, where crop/lens warps/
 * dehaze run per tile and the result carries no width/height/frameRect → garbled, mis-sized
 * preview. Every non-GPU frame above the tiled threshold must stay on the main thread.
 */
describe('choosePreviewRoute keeps tiled-size frames off the worker pool', () => {
  const base = { gpuAvailable: false, activeCpuBridgeCount: 1, passCount: 2 };

  it('80 MP frame without LA → main / not-tile-safe', () => {
    expect(choosePreviewRoute({ ...base, width: 10368, height: 7776 })).toEqual({ path: 'main', reason: 'not-tile-safe' });
  });
  it('exactly at the threshold still uses the worker (tiling starts strictly above)', () => {
    expect(WORKER_TILED_MIN_PIXELS).toBe(8000 * 6000);
    expect(choosePreviewRoute({ ...base, width: 8000, height: 6000 })).toEqual({ path: 'worker', reason: 'worker' });
  });
  it('LA active above the threshold keeps its specific reason', () => {
    expect(choosePreviewRoute({ ...base, width: 10000, height: 6000, laActive: true })).toEqual({ path: 'main', reason: 'la-not-tile-safe' });
  });
  it('GPU-eligible large frames still go to the GPU', () => {
    expect(choosePreviewRoute({ ...base, gpuAvailable: true, activeCpuBridgeCount: 0, width: 10368, height: 7776 }).path).toBe('gpu');
  });
});
