// src/test/moduleCardChrome.test.tsx
/**
 * TDD spec for Task 2 of the "Glass · Sectioned" redesign: the unified module-card
 * chrome (ModuleCardHeader: 28px accent icon chip + title + state subtitle + Auto⚡
 * then Reset↺ chips, same order every module) and the standalone Histogram glass card.
 *
 * Anatomy comes from the Glass UI design spec ("Module card system") and the
 * reference shots (4a-develop.png, 4a-module-*.png).
 */
import { Sun } from 'lucide-react';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';

// DOCUMENT_POSITION_FOLLOWING — spelled out to avoid the `Node` global under eslint.
const DOCUMENT_POSITION_FOLLOWING = 4;

// ── ModuleCardHeader (presentational) ────────────────────────────────────────
import { ModuleCardHeader } from '../components/Controls/ModuleCardHeader';

describe('ModuleCardHeader', () => {
  afterEach(cleanup);

  it('renders the icon chip, title, subtitle, and Auto BEFORE Reset in DOM order', () => {
    render(
      <ModuleCardHeader
        icon={<Sun size={15} />}
        title="Basic Adjustments"
        subtitle="2 edits active"
        onAuto={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText('Basic Adjustments')).toBeInTheDocument();
    expect(screen.getByText('2 edits active')).toBeInTheDocument();
    expect(screen.getByTestId('module-card-icon')).toBeInTheDocument();

    const auto = screen.getByRole('button', { name: 'Auto' });
    const reset = screen.getByRole('button', { name: 'Reset' });
    // Auto must precede Reset in the document (same order on every module).
    expect(auto.compareDocumentPosition(reset) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the Auto chip when the module has no auto function (Reset only)', () => {
    render(<ModuleCardHeader icon={<Sun size={15} />} title="Enhance" onReset={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('fires the wired handlers on click', () => {
    const onAuto = jest.fn();
    const onReset = jest.fn();
    render(<ModuleCardHeader icon={<Sun size={15} />} title="White Balance" onAuto={onAuto} onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onAuto).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

// ── AdjustmentPanel integration: the mounted module's card header ─────────────
// Keep the real ImageProcessingPipeline (so getModule('basicadj') is a real module
// with resetParams to spy on); stub only the heavy async/no-display services.
jest.mock('../services/ImageService', () => ({
  imageService: {
    getCurrentImage: jest.fn(() => null),
    getOriginalImage: jest.fn(() => null),
    addImageLoadListener: jest.fn(() => () => {}),
    setProcessingPipeline: jest.fn(),
  },
}));
jest.mock('../shaders/GpuPreviewPipeline', () => ({
  gpuPreviewPipeline: {
    isAvailable: jest.fn(() => false),
    setSource: jest.fn(),
    setDehazeParam: jest.fn(),
    render: jest.fn(),
    readback: jest.fn(() => new Float32Array(4)),
    getSize: jest.fn(() => ({ width: 0, height: 0 })),
  },
}));
jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { processImage: jest.fn() },
}));
jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));
// Debounce → no-op so clicking Reset doesn't kick off a real (imageless) reprocess.
jest.mock('../services/AdaptiveDebounceService', () => ({
  adaptiveDebounceService: {
    debounce: jest.fn(),
    cancelAll: jest.fn(),
    clearHistory: jest.fn(),
  },
}));

import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { HistogramPanel } from '../components/Panels/HistogramPanel';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

describe('AdjustmentPanel module-card chrome', () => {
  afterEach(cleanup);

  it('renders the unified card header for the mounted module (title + Auto-then-Reset)', async () => {
    await act(async () => {
      render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />);
    });
    expect(screen.getByText('Basic Adjustments')).toBeInTheDocument();

    const header = screen.getByTestId('module-card-header');
    const auto = within(header).getByRole('button', { name: 'Auto' });
    const reset = within(header).getByRole('button', { name: 'Reset' });
    expect(auto.compareDocumentPosition(reset) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('wires the card Reset to the module reset handler', async () => {
    const mod = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
    const resetSpy = jest.spyOn(mod, 'resetParams');
    await act(async () => {
      render(<AdjustmentPanel selectedModule="basicadj" currentImage={null} />);
    });

    const header = screen.getByTestId('module-card-header');
    await act(async () => {
      fireEvent.click(within(header).getByRole('button', { name: 'Reset' }));
    });
    expect(resetSpy).toHaveBeenCalled();
    resetSpy.mockRestore();
  });

  it('does not crash with a null module / null image (selectedModule=null)', async () => {
    await act(async () => {
      render(<AdjustmentPanel selectedModule={null} currentImage={null} />);
    });
    // No module mounted → no action chips registered.
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
  });
});

// ── Histogram glass card ─────────────────────────────────────────────────────
describe('HistogramPanel glass card', () => {
  afterEach(cleanup);

  it('renders the HISTOGRAM header with inline R · G · B averages', () => {
    const { container } = render(<HistogramPanel />);
    expect(screen.getByText('HISTOGRAM')).toBeInTheDocument();
    expect(screen.getByTestId('histogram-averages')).toBeInTheDocument();
    // Restyled as a glass card (radius 20 surface).
    expect(container.querySelector('.glass-card')).not.toBeNull();
  });
});
