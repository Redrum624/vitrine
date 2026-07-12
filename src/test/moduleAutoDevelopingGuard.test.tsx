// src/test/moduleAutoDevelopingGuard.test.tsx
/**
 * L3 review round 2 (Critical, re-review): six per-module Auto (⚡) actions read
 * `imageService.getCurrentImage()` pixels and baked analyzed stats into persisted module
 * params with ZERO `developing` awareness — bypassing the `guardDeveloping` gate round 1 put
 * on the toolbar/menu handlers. During the progressive-open background-decode window,
 * `getCurrentImage()` returns the camera-graded 8-bit preview, not the neutral full-res base,
 * so these actions would bake wrong params.
 *
 * These tests cover the two seam types the round-2 fix touches:
 *   (a) a module component's own Auto handler — BasicAdjustmentsModuleComponent, representative
 *       of the five identically-shaped module-component sites (Exposure, ShadowsHighlights,
 *       ToneCurve, ColorBalance share the exact same guard call);
 *   (b) AdjustmentPanel's `handleAutoWhiteBalance` → `WhiteBalanceModule.autoDetectWhiteBalance`.
 *
 * Harness mirrors adjustmentPanelModuleActionsRemount.test.tsx: render the real AdjustmentPanel
 * with mocked ImageService/ImageProcessingPipeline/GPU-pipeline plumbing, and click the module
 * card header's "Auto" chip (registered via useRegisterModuleCardActions).
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
};

import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
const basicAdjModuleInstance = new BasicAdjustmentsModule();
const whiteBalanceModuleInstance = new WhiteBalanceModule();

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModule: jest.fn((id: string) => {
    if (id === 'basicadj') return basicAdjModuleInstance;
    if (id === 'temperature') return whiteBalanceModuleInstance;
    return undefined;
  }),
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

jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

import { render, act, fireEvent, screen, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { useAppStore } from '../stores/appStore';
import { notificationService } from '../services/NotificationService';

describe('Auto (⚡) actions respect the developing window (L3 review round 2)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    basicAdjModuleInstance.resetParams();
    whiteBalanceModuleInstance.resetParams();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false, developing: false });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    useAppStore.getState().setDeveloping(false);
  });

  const clickAuto = () => fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

  it('(a) BasicAdjustmentsModuleComponent Auto: blocked + notified while developing, proceeds once settled', async () => {
    const setParamsSpy = jest.spyOn(basicAdjModuleInstance, 'setParams');
    const infoSpy = jest.spyOn(notificationService, 'info');

    await act(async () => {
      render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />);
    });
    await act(async () => { jest.advanceTimersByTime(100); });

    useAppStore.getState().setDeveloping(true);
    clickAuto();
    expect(setParamsSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Auto Basic Adjustments', expect.stringMatching(/developing/i));

    useAppStore.getState().setDeveloping(false);
    clickAuto();
    expect(setParamsSpy).toHaveBeenCalled();
  });

  it('(b) AdjustmentPanel handleAutoWhiteBalance: blocked + notified while developing, proceeds once settled', async () => {
    const autoDetectSpy = jest.spyOn(whiteBalanceModuleInstance, 'autoDetectWhiteBalance');
    const infoSpy = jest.spyOn(notificationService, 'info');

    await act(async () => {
      render(<AdjustmentPanel selectedModule="whitebalance" currentImage={null} />);
    });
    await act(async () => { jest.advanceTimersByTime(100); });

    useAppStore.getState().setDeveloping(true);
    clickAuto();
    expect(autoDetectSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Auto White Balance', expect.stringMatching(/developing/i));

    useAppStore.getState().setDeveloping(false);
    clickAuto();
    expect(autoDetectSpy).toHaveBeenCalled();
  });
});
