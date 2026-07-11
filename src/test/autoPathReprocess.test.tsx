// src/test/autoPathReprocess.test.tsx
/**
 * Round-6 P10: behavioral spy for the module Auto (⚡) path's reprocess behavior — the
 * upgrade to the "verified only by inspection since G2" note in
 * adjustmentPanelModuleActionsRemount.test.tsx.
 *
 * G2 fixed an AdjustmentPanel feedback loop where a single param change fanned out into ~82
 * identical pipeline passes (adjustmentPanelReprocessLoop.test.tsx pins the MOUNT path). This
 * test pins the AUTO path: clicking a module card's Auto (⚡) chip must (a) apply the analyzed
 * params to the module (setParams fires) and (b) coalesce into a SMALL, bounded number of
 * pipeline passes that then go quiet — never the runaway loop.
 *
 * Harness mirrors moduleAutoDevelopingGuard.test.tsx (real AdjustmentPanel + mocked ImageService
 * / pipeline / GPU plumbing), but the mocked processImage takes one fake-timer tick per pass so a
 * regressed loop is paced by timer advances instead of spinning inside a single microtask flush.
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
};

import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
const basicAdjModuleInstance = new BasicAdjustmentsModule();

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModule: jest.fn((id: string) => (id === 'basicadj' ? basicAdjModuleInstance : undefined)),
  getOrderedModules: jest.fn(() => []),
  isModuleActive: jest.fn(() => false),
  invalidateModuleCache: jest.fn(),
  resetAllModules: jest.fn(),
  getStats: jest.fn(() => ({ enabledModules: 0, moduleCount: 0 })),
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
  webWorkerImageProcessor: { processImage: jest.fn() },
}));

jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));

jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

import { render, act, fireEvent, screen, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';

describe('Module Auto (⚡) path — applies params and coalesces to a bounded reprocess (G2)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    basicAdjModuleInstance.resetParams();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false, developing: false });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('clicking Auto applies analyzed params and triggers a small, stable number of passes (no loop)', async () => {
    const setParamsSpy = jest.spyOn(basicAdjModuleInstance, 'setParams');

    await act(async () => { render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />); });
    // Let the mount pass settle.
    for (let i = 0; i < 4; i++) await act(async () => { jest.advanceTimersByTime(50); });

    // Isolate the Auto path from the mount pass.
    (imageProcessingPipeline.processImage as jest.Mock).mockClear();
    setParamsSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

    // Simulated ~2s of timer/microtask flushing after the Auto click.
    for (let i = 0; i < 40; i++) await act(async () => { jest.advanceTimersByTime(50); });

    // (a) The analyzed params were applied to the module.
    expect(setParamsSpy).toHaveBeenCalled();

    // (b) The reprocess coalesced: a bounded handful of passes, not the ~82-cycle runaway.
    const calls = (imageProcessingPipeline.processImage as jest.Mock).mock.calls.length;
    expect(calls).toBeLessThanOrEqual(4);

    // Stabilisation: another simulated ~1s adds NO further passes.
    for (let i = 0; i < 20; i++) await act(async () => { jest.advanceTimersByTime(50); });
    expect((imageProcessingPipeline.processImage as jest.Mock).mock.calls.length).toBe(calls);
  });
});
