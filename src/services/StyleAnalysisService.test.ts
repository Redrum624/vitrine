/**
 * Regression: "Paste Style works but the module sliders don't update to the new
 * values." applyParams updated the pipeline modules + reprocessed the image, but
 * never signalled the panels to re-read module.getParams() — so the sliders went
 * stale. pasteStyle must now bump the store's externalParamsVersion (the signal
 * AdjustmentPanel folds into its remount key) AND apply params to the modules.
 */
import { useAppStore } from '../stores/appStore';

// jest hoists these factories; vars prefixed with `mock` are allowed inside them.
const mockModules: Record<string, { setParams: jest.Mock }> = {
  tonecurve: { setParams: jest.fn() },
  basicadj: { setParams: jest.fn() },
};
let mockCurrentImage: { data: Float32Array; width: number; height: number } | null = null;

jest.mock('./ImageProcessingPipeline', () => ({
  imageProcessingPipeline: {
    getModule: (id: string) => mockModules[id],
    invalidateModuleCache: jest.fn(),
    getModules: () => new Map(),
  },
}));

jest.mock('./ImageService', () => ({
  imageService: { getCurrentImage: () => mockCurrentImage },
}));

// Imported after the mocks above; the mocked singletons are accessed lazily.
import { styleAnalysisService } from './StyleAnalysisService';

function makeImage(w: number, h: number, shift: number): { data: Float32Array; width: number; height: number } {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = (i % w) / Math.max(1, w - 1);
    data[i * 4] = Math.min(1, Math.max(0, t + shift));
    data[i * 4 + 1] = t;
    data[i * 4 + 2] = Math.min(1, Math.max(0, t - shift));
    data[i * 4 + 3] = 1;
  }
  return { data, width: w, height: h };
}

describe('StyleAnalysisService — paste refreshes panel sliders', () => {
  beforeEach(() => {
    mockModules.tonecurve.setParams.mockClear();
    mockModules.basicadj.setParams.mockClear();
  });

  // Runs first, while the singleton clipboard is still empty.
  test('pasteStyle with no copied style returns false and emits no signal', () => {
    expect(styleAnalysisService.hasStyle()).toBe(false);
    mockCurrentImage = makeImage(16, 16, 0);
    const before = useAppStore.getState().externalParamsVersion;

    const ok = styleAnalysisService.pasteStyle();

    expect(ok).toBe(false);
    expect(useAppStore.getState().externalParamsVersion).toBe(before);
    expect(mockModules.tonecurve.setParams).not.toHaveBeenCalled();
  });

  test('pasteStyle bumps externalParamsVersion and applies tonecurve + basicadj params', () => {
    // Copy a style from one image.
    mockCurrentImage = makeImage(16, 16, 0.3);
    useAppStore.getState().setProcessedImageData({
      data: mockCurrentImage.data, width: 16, height: 16, isPreview: true,
    });
    expect(styleAnalysisService.copyStyle()).not.toBeNull();
    expect(styleAnalysisService.hasStyle()).toBe(true);

    // Paste onto a DIFFERENT image.
    mockCurrentImage = makeImage(16, 16, -0.15);
    const before = useAppStore.getState().externalParamsVersion;

    const ok = styleAnalysisService.pasteStyle();

    expect(ok).toBe(true);
    // The signal AdjustmentPanel watches must fire so the open panel re-reads
    // module.getParams() — this is the actual bug fix.
    expect(useAppStore.getState().externalParamsVersion).toBe(before + 1);
    // And the params were genuinely applied to the pipeline modules.
    expect(mockModules.tonecurve.setParams).toHaveBeenCalledTimes(1);
    expect(mockModules.basicadj.setParams).toHaveBeenCalledTimes(1);
    const toneArg = mockModules.tonecurve.setParams.mock.calls[0][0] as { rgbCurve?: unknown };
    expect(toneArg.rgbCurve).toBeDefined();
  });
});
