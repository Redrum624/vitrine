// src/test/adjustmentPanelModuleActionsRemount.test.tsx
/**
 * Regression test locking the "module switch/remount ends on the NEW instance"
 * invariant documented in AdjustmentPanel.tsx (`moduleActions` state comment: "Only
 * one module mounts at a time... React runs cleanups before setups, so a module
 * switch ends on the new module") and moduleCardActions.ts's
 * useRegisterModuleCardActions (registers once per MOUNT via a stable `onRegister`
 * — `setModuleActions` — dispatching through a ref so the header always calls the
 * LATEST handler without the effect re-firing on every render).
 *
 * This has been "verified only by inspection since G2" (the reprocess-loop fix) —
 * nothing actually exercises a REMOUNT of the registering module and re-clicks
 * the card header's Reset afterwards. AdjustmentPanel re-keys the selected
 * module's body on `paramSync = ${resetCounter}-${externalParamsVersion}` (e.g.
 * `basicadj-${paramSync}`) — bumping `externalParamsVersion` (the "Paste Style /
 * Auto All / presets" bulk-setter path) forces React to fully unmount the current
 * BasicAdjustmentsModuleComponent and mount a fresh one. The card header's
 * registered Reset handler must still dispatch to the (same) module instance
 * after that remount — if the re-registration ever broke, Reset would either go
 * silent (moduleActions left null) or stop firing after the remount.
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
  // Each pass takes one (fake-timer) 10ms tick, same as adjustmentPanelReprocessLoop's
  // harness — a runaway loop (if the fix ever regressed) is paced by timer advances
  // instead of spinning unboundedly inside a single act() microtask flush.
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
import { useAppStore } from '../stores/appStore';

describe('AdjustmentPanel — module-card action re-registration across a remount', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    basicAdjModuleInstance.resetParams();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('keeps dispatching the card header Reset to the current module instance after externalParamsVersion remounts it', async () => {
    const resetSpy = jest.spyOn(basicAdjModuleInstance, 'resetParams');

    await act(async () => {
      render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />);
    });
    await act(async () => { jest.advanceTimersByTime(100); });

    const clickReset = () => fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    clickReset();
    expect(resetSpy).toHaveBeenCalledTimes(1);

    // Bump externalParamsVersion — re-keys `basicadj-${paramSync}`, forcing React to
    // unmount the currently-mounted BasicAdjustmentsModuleComponent and mount a fresh
    // one (the same trigger a real Paste Style / Auto All / preset apply would fire).
    await act(async () => {
      useAppStore.getState().notifyExternalParamsChange();
      jest.advanceTimersByTime(100);
    });

    // The header's registered Reset must still be wired up — and to the CURRENT
    // (post-remount) instance's handler, not a stale/orphaned one left null or
    // pointing nowhere.
    clickReset();
    expect(resetSpy).toHaveBeenCalledTimes(2);
  });
});
