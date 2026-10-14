/**
 * Task 12c fix round 1 — AdjustmentPanel's live-preview path (mask drag frames).
 *
 * Contracts:
 *  - a live request reprocesses at once: no adaptive debounce, no processingVersion bump
 *    (History checkpoints + persistence ride processingVersion, i.e. the release only)
 *  - a live request inside the 50 ms throttle window re-fires itself directly (still no bump)
 *  - a replay armed ONLY by live requests re-runs directly (no bump); a replay armed by a
 *    normal trigger keeps the processingVersion route
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
};

// One live, mutable module so the panel's state signature can change mid-pass.
const liveParams: { value: number } = { value: 1 };
const fakeModule = {
  getId: () => 'basicadj',
  getName: () => 'Basic',
  isEnabled: true,
  getParams: () => ({ exposure: liveParams.value }),
};

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModule: jest.fn(() => undefined),
  getOrderedModules: jest.fn(() => [fakeModule]),
  isModuleActive: jest.fn(() => false),
  invalidateModuleCache: jest.fn(),
  resetAllModules: jest.fn(),
  getStats: jest.fn(() => ({ enabledModules: 1, moduleCount: 1 })),
  processImage: jest.fn(async (d: Float32Array) => {
    await new Promise((r) => setTimeout(r, 500));
    return d;
  }),
} }));

jest.mock('../shaders/GpuPreviewPipeline', () => ({ gpuPreviewPipeline: {
  isAvailable: jest.fn(() => false),
  getMaxTextureSize: jest.fn(() => 16384),
  setSource: jest.fn(),
  setDehazeParam: jest.fn(),
  render: jest.fn(),
  readback: jest.fn(() => new Float32Array(4)),
} }));

jest.mock('../shaders/passDescriptors', () => ({
  buildPassList: jest.fn(() => ({ passes: [], cpuBridges: [] })),
  getGpuUnsafeModuleIds: jest.fn(() => new Set<string>()),
  setGpuUnsafeModuleIds: jest.fn(),
}));

const mockRoute = { path: 'main' as 'main' | 'worker' | 'gpu' };
jest.mock('../services/previewRouting', () => ({
  choosePreviewRoute: jest.fn(() => ({ path: mockRoute.path, reason: 'test' })),
}));

jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { processImage: jest.fn(), isHealthy: jest.fn(() => true) },
}));

jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));

jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

import { render, act, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import { adaptiveDebounceService } from '../services/AdaptiveDebounceService';
import { requestLivePreview } from '../utils/livePreviewRequest';

const mainProcess = imageProcessingPipeline.processImage as jest.Mock;
// The real setter, captured before any spy: zustand copies state props into each new state
// object, so a restored spy from a previous test would otherwise linger as a no-op.
const realSetProcessed = useAppStore.getState().setProcessedImageData;

async function flush(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    await act(async () => { jest.advanceTimersByTime(50); });
  }
}

async function mountPanel() {
  await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
}

describe('AdjustmentPanel live preview (Task 12c)', () => {
  const debounce = adaptiveDebounceService.debounce as jest.Mock;
  const version = () => useAppStore.getState().processingVersion;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.advanceTimersByTime(1000); // the throttle ignores a 0 timestamp
    liveParams.value = 1;
    mockRoute.path = 'main';
    useAppStore.setState({
      processingVersion: 0, externalParamsVersion: 0, isProcessing: false, processedImageData: null,
      cropDragSuspended: false, setProcessedImageData: realSetProcessed,
    });
    mainProcess.mockClear();
    debounce.mockClear();
  });

  afterEach(() => {
    cleanup();
    mainProcess.mockImplementation(async (d: Float32Array) => {
      await new Promise((r) => setTimeout(r, 500));
      return d;
    });
    jest.useRealTimers();
  });

  test('a live request reprocesses immediately without the debounce or a processingVersion bump', async () => {
    await mountPanel();
    await flush(1000); // mount pass done
    expect(mainProcess).toHaveBeenCalledTimes(1);
    liveParams.value = 2;
    await act(async () => { requestLivePreview(); });
    expect(mainProcess).toHaveBeenCalledTimes(2); // no timer advanced: not debounced
    await flush(1000);
    expect(debounce).not.toHaveBeenCalled();
    expect(version()).toBe(0);
  });

  test('a live request inside the 50 ms throttle window re-fires itself (no bump)', async () => {
    const seen: number[] = [];
    mainProcess.mockImplementation(async (d: Float32Array) => { seen.push(liveParams.value); return d; });
    await mountPanel(); // instant pass A
    expect(seen).toEqual([1]);
    liveParams.value = 4;
    await act(async () => { requestLivePreview(); }); // inside A's 50 ms window
    expect(seen).toEqual([1]);
    await flush(150);
    expect(seen).toEqual([1, 4]);
    expect(debounce).not.toHaveBeenCalled();
    expect(version()).toBe(0);
  });

  test('a replay armed only by live requests re-runs directly (no bump)', async () => {
    await mountPanel(); // 500 ms pass in flight
    liveParams.value = 3;
    await act(async () => { requestLivePreview(); requestLivePreview(); }); // queued behind it
    await flush(2000);
    expect(mainProcess).toHaveBeenCalledTimes(2);
    expect(version()).toBe(0);
    expect(debounce).not.toHaveBeenCalled();
  });

  test('a replay armed by a normal trigger keeps the processingVersion route', async () => {
    await mountPanel();
    liveParams.value = 3;
    await act(async () => { requestLivePreview(); });
    await act(async () => { useAppStore.getState().triggerReprocessing(); }); // the release
    expect(version()).toBe(1);
    await flush(2000);
    expect(version()).toBe(2); // replay via triggerReprocessing
    expect(mainProcess).toHaveBeenCalledTimes(2);
  });
});
