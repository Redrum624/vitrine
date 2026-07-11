// src/test/moduleHeaderIconDistinctness.test.tsx
/**
 * Round-6 P8 polish: basicadj and shadowshighlights both used the same lucide `Sun` glyph
 * in the module card header (AdjustmentPanel's getModuleIcon() map) — shadowshighlights isn't
 * on the IconSidebar rail (only basicadj is, see IconSidebar.tsx's TOOLS list), so there was no
 * rail collision, but the card header itself showed an identical icon for two different
 * modules. shadowshighlights now uses `Contrast` (a half-filled-circle glyph, consistent with
 * the rest of the lucide-react set already in use) so the two module headers are visually
 * distinguishable.
 *
 * Mocking mirrors adjustmentPanelModuleActionsRemount.test.tsx's minimal scaffold — the module
 * card header (icon + title) renders purely off `selectedModule`, independent of whether the
 * specific module instance/pipeline exists, but the surrounding services are still imported and
 * touched on mount, so they need the same light mocks to render at all.
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

import { render, screen, act, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { useAppStore } from '../stores/appStore';

describe('AdjustmentPanel module card header — basicadj vs shadowshighlights glyph', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useAppStore.setState({ processingVersion: 0, externalParamsVersion: 0, isProcessing: false });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('gives shadowshighlights a distinct glyph from basicadj (both no longer render Sun)', async () => {
    await act(async () => {
      render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />);
    });
    const basicAdjIcon = screen.getByTestId('module-card-icon').querySelector('svg');
    expect(basicAdjIcon).toHaveClass('lucide-sun');
    cleanup();

    await act(async () => {
      render(<AdjustmentPanel selectedModule="shadowshighlights" currentImage={null} />);
    });
    const shadowsHighlightsIcon = screen.getByTestId('module-card-icon').querySelector('svg');
    expect(shadowsHighlightsIcon).toHaveClass('lucide-contrast');
    expect(shadowsHighlightsIcon).not.toHaveClass('lucide-sun');
  });
});
