/**
 * Final-review fix 3: previewStateSignature() ran after isProcessingRef=true but OUTSIDE the
 * pass's try/finally, so a throwing module getParams() left isProcessingRef stuck true and every
 * later preview trigger queued forever (previews wedged). It must run inside the try.
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
};

// One live, mutable module so the panel's state signature can change mid-pass.
const liveParams: { value: number } = { value: 1 };
const throwParams = { on: false };
const fakeModule = {
  getId: () => 'basicadj',
  getName: () => 'Basic',
  isEnabled: true,
  getParams: () => { if (throwParams.on) { throwParams.on = false; throw new Error("boom"); } return { exposure: liveParams.value }; },
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

describe('AdjustmentPanel signature throw does not wedge previews', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    liveParams.value = 1;
    mockRoute.path = 'main';
    useAppStore.setState({
      processingVersion: 0, externalParamsVersion: 0, isProcessing: false, processedImageData: null,
      cropDragSuspended: false, setProcessedImageData: realSetProcessed,
    });
    mainProcess.mockClear();
  });
  afterEach(() => { cleanup(); jest.useRealTimers(); });

  test('a getParams throw during the signature snapshot releases the in-flight slot', async () => {
    throwParams.on = true;
    await mountPanel().catch(() => {});
    await flush(500);
    expect(throwParams.on).toBe(false); // the throw happened
    const before = mainProcess.mock.calls.length;
    liveParams.value = 2;
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(2000);
    expect(mainProcess.mock.calls.length).toBeGreaterThan(before);
  });
});
