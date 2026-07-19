// src/test/adjustmentPanelReprocessLoop.test.tsx
/**
 * Regression test for the AdjustmentPanel infinite reprocess loop.
 *
 * Root cause: processCurrentImageRealTime's useCallback deps included the isProcessing
 * STATE while every run toggled that state (true at start, false in finally). Each toggle
 * minted a new callback identity → the mount effect with deps [processCurrentImageRealTime]
 * re-fired → another pass. A second feedback channel: the re-fired call landing mid-run
 * armed pendingReprocessRef, whose finally-block triggerReprocessing() bumped
 * processingVersion and scheduled yet another pass. Observed in the renderer log as 82
 * identical "No modules were processed - image unchanged" cycles paced by the 50ms throttle.
 *
 * This test renders the panel with a loaded image, flushes fake timers for a simulated
 * ~2s, and asserts the pipeline runs a small bounded number of passes and then goes quiet.
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
  // Each pass takes one (fake-timer) 10ms tick so a runaway loop is paced by timer
  // advances instead of spinning unboundedly inside a single act() microtask flush.
  processImage: jest.fn(async (d: Float32Array) => {
    await new Promise((r) => setTimeout(r, 10));
    return d;
  }),
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
  webWorkerImageProcessor: { processImage: jest.fn(), isHealthy: jest.fn(() => true) },
}));

jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));

// Deterministic stand-in for the adaptive debouncer: schedule on the fake-timer wheel
// (the real service also ultimately fires the callback after a short delay).
jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

import { render, act, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';

describe('AdjustmentPanel reprocess-loop regression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false });
    (imageProcessingPipeline.processImage as jest.Mock).mockClear();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('runs a bounded number of pipeline passes after mount, then stabilises (no endless loop)', async () => {
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });

    // Simulated ~2s: flush timers + microtasks in 50ms steps (the panel's throttle window).
    for (let i = 0; i < 40; i++) {
      await act(async () => { jest.advanceTimersByTime(50); });
    }

    const calls = (imageProcessingPipeline.processImage as jest.Mock).mock.calls.length;
    // Unfixed, the isProcessing-dep identity churn re-fired the mount effect on every
    // pass (~82 cycles in the bug report). Fixed, the single mount pass is all there is.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);

    // Stabilisation proof: another simulated ~1s of flushing adds NO further passes.
    for (let i = 0; i < 20; i++) {
      await act(async () => { jest.advanceTimersByTime(50); });
    }
    expect((imageProcessingPipeline.processImage as jest.Mock).mock.calls.length).toBe(calls);
  });
});
