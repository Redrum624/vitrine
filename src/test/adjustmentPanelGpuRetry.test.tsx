/**
 * Resident-enhance render failure: AdjustmentPanel marks 'enhance-resident' GPU-unsafe ONCE,
 * skips presenting that frame, re-runs it after >60ms, and never retries a second time.
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
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
  isAvailable: jest.fn(() => true),
  getMaxTextureSize: jest.fn(() => 16384),
  setSource: jest.fn(),
  setDehazeParam: jest.fn(),
  render: jest.fn(),
  readback: jest.fn(() => new Float32Array(4)),
} }));

// Stateful stand-in for the unsafe-id registry (mirrors the real Set semantics).
const mockUnsafe = { ids: new Set<string>() };
jest.mock('../shaders/passDescriptors', () => ({
  buildPassList: jest.fn(() => ({ passes: [{ id: 'enhance' }], cpuBridges: [] })),
  getGpuUnsafeModuleIds: jest.fn(() => mockUnsafe.ids),
  setGpuUnsafeModuleIds: jest.fn((ids: Iterable<string>) => { mockUnsafe.ids = new Set(ids); }),
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
import { gpuPreviewPipeline } from '../shaders/GpuPreviewPipeline';
import { setGpuUnsafeModuleIds } from '../shaders/passDescriptors';
import { useAppStore } from '../stores/appStore';

const renderMock = gpuPreviewPipeline.render as jest.Mock;
const setUnsafeMock = setGpuUnsafeModuleIds as jest.Mock;

async function flush(steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await act(async () => { jest.advanceTimersByTime(50); });
  }
}

describe('AdjustmentPanel resident-enhance failure retry', () => {
  let setRenderMode: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockUnsafe.ids = new Set<string>();
    renderMock.mockReset();
    setUnsafeMock.mockClear();
    setRenderMode = jest.fn();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false, setRenderMode });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('marks enhance-resident unsafe once, skips the failed frame, re-runs exactly once, never loops', async () => {
    renderMock.mockReturnValue({ failedSteps: ['enhance'] }); // fails on EVERY render

    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    // Failed frame: render called, unsafe registered, gpu mode NOT announced.
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(setUnsafeMock).toHaveBeenCalledTimes(1);
    expect(Array.from(setUnsafeMock.mock.calls[0][0] as Iterable<string>)).toContain('enhance-resident');
    expect(setRenderMode).not.toHaveBeenCalledWith('gpu');

    // After >60ms exactly one more processing run happens.
    await flush(10);
    expect(renderMock).toHaveBeenCalledTimes(2);

    // Second failedSteps (id already unsafe) must NOT retry again; frame is presented.
    await flush(40);
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(setUnsafeMock).toHaveBeenCalledTimes(1);
    expect(setRenderMode).toHaveBeenCalledWith('gpu');
  });

  it('a clean render does not mark anything unsafe or retry', async () => {
    renderMock.mockReturnValue({});
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    await flush(20);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(setUnsafeMock).not.toHaveBeenCalled();
    expect(setRenderMode).toHaveBeenCalledWith('gpu');
  });
});
