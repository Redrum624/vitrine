/**
 * P4 review finding (perf): the area-averaged preview downsample (boxDownsampleRGBA) is
 * O(source pixels) and ran UNCONDITIONALLY on every processCurrentImageRealTime call — i.e.
 * on every slider drag at the 50ms throttle — even though on the GPU path the result is
 * usually discarded (the source upload is already gated by sourceKey). On a 24-45MP image
 * that is an analytical ~50-150ms full-source scan per drag.
 *
 * Fix under test: AdjustmentPanel memoizes previewData by
 * (filePath, previewW×H, baseImageVersion) — mirroring the GPU sourceKey pattern — so the
 * downsample runs ONCE per source, and re-runs when the base pixels are swapped in place
 * (baseImageVersion bump: progressive-open full-decode swap, RAW re-decode, rotate/flip bake).
 *
 * RED (pre-memo): the spy below records one boxDownsampleRGBA call PER processing pass, so
 * the second pass makes it 2 and the assertion `toHaveBeenCalledTimes(1)` fails.
 */
const BIG_W = 1200; // > MAX_PREVIEW_SIZE=1024 → the downsample branch runs
const BIG_H = 800;
const mockCurrentImage = {
  data: new Float32Array(BIG_W * BIG_H * 4).fill(0.5),
  width: BIG_W,
  height: BIG_H,
  filePath: 'C:/img/big.orf',
};

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModule: jest.fn(() => undefined),
  getOrderedModules: jest.fn(() => []),
  isModuleActive: jest.fn(() => false),
  invalidateModuleCache: jest.fn(),
  resetAllModules: jest.fn(),
  getStats: jest.fn(() => ({ enabledModules: 0, moduleCount: 0 })),
  processImage: jest.fn(async (d: Float32Array) => d),
} }));

jest.mock('../shaders/GpuPreviewPipeline', () => ({ gpuPreviewPipeline: {
  isAvailable: jest.fn(() => false),
  setSource: jest.fn(),
  setDehazeParam: jest.fn(),
  render: jest.fn(),
  readback: jest.fn(() => new Float32Array(4)),
} }));

jest.mock('../shaders/passDescriptors', () => ({
  buildPassList: jest.fn(() => ({ passes: [], cpuBridges: [] })),
}));

jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { processImage: jest.fn() },
}));

jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));

// Deterministic stand-in for the adaptive debouncer (fires on the fake-timer wheel).
jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

// Spy on the downsample util: returns a plausibly-sized preview without the O(input) scan.
jest.mock('../utils/imageDownsample', () => ({
  boxDownsampleRGBA: jest.fn(
    (_src: Float32Array, _sw: number, _sh: number, dw: number, dh: number) =>
      new Float32Array(dw * dh * 4).fill(0.5),
  ),
}));

import { render, act, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { boxDownsampleRGBA } from '../utils/imageDownsample';
import { useAppStore } from '../stores/appStore';

/** Flush the panel's debounce/throttle windows: advance fake timers in 50ms steps. */
async function flush(steps = 4) {
  for (let i = 0; i < steps; i++) {
    await act(async () => { jest.advanceTimersByTime(50); });
  }
}

describe('AdjustmentPanel — preview downsample memoized per source', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false, baseImageVersion: 0 });
    (boxDownsampleRGBA as jest.Mock).mockClear();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('runs the downsample once across consecutive passes, and re-runs on a baseImageVersion bump', async () => {
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    await flush();

    // Mount pass ran the downsample once.
    expect(boxDownsampleRGBA).toHaveBeenCalledTimes(1);

    // A second pass with the SAME source (same path, dims, base) — e.g. a slider drag
    // retriggering processing via the store — must reuse the memoized preview.
    await act(async () => { useAppStore.setState({ processingVersion: 1 }); });
    await flush();
    expect(boxDownsampleRGBA).toHaveBeenCalledTimes(1); // RED pre-memo: 2

    // And a third, for good measure (every drag after the first is a cache hit).
    await act(async () => { useAppStore.setState({ processingVersion: 2 }); });
    await flush();
    expect(boxDownsampleRGBA).toHaveBeenCalledTimes(1);

    // In-place base swap (progressive-open full decode, RAW re-decode, rotate/flip bake):
    // the memo key folds in baseImageVersion, so the downsample re-runs on the new pixels.
    await act(async () => {
      useAppStore.getState().bumpBaseImageVersion();
      useAppStore.setState({ processingVersion: 3 });
    });
    await flush();
    expect(boxDownsampleRGBA).toHaveBeenCalledTimes(2);
  });
});
