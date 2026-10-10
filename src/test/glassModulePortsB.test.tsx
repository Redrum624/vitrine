/**
 * TDD spec for Task 4 (batch B — structure/enhance/history/raw modules) of the
 * "Glass · Sectioned" redesign: each module's BODY renders through the shared
 * Controls library (SectionLabel / ChipButton / SliderRow / Segmented) instead
 * of the pre-port bespoke markup, and keeps the same params/handlers.
 */
import { render, screen, fireEvent } from '@testing-library/react';

// ── Crop ─────────────────────────────────────────────────────────────────────
import { CropModuleComponent } from '../components/Modules/CropModuleComponent';
import { CropModule } from '../modules/CropModule';

describe('CropModuleComponent — glass port', () => {
  it('renders the Ratio / Geometry sections in order with SliderRow controls', () => {
    const module = new CropModule();
    render(<CropModuleComponent module={module} onParamsChange={() => {}} imageWidth={4000} imageHeight={3000} />);

    const sections = screen.getAllByText(/^(Ratio|Geometry)$/);
    expect(sections.map((el) => el.textContent)).toEqual(['Ratio', 'Geometry']);
    expect(screen.getByLabelText('Rotation')).toBeInTheDocument();
  });

  it('MANDATORY: restores the Uncrop chip (dropped with the old header in Task 2), wired to module.uncrop', () => {
    const module = new CropModule();
    module.setOriginalDimensions(4000, 3000);
    module.setParams({ enabled: true, x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    const uncropSpy = jest.spyOn(module, 'uncrop');
    const onParamsChange = jest.fn();
    render(<CropModuleComponent module={module} onParamsChange={onParamsChange} imageWidth={4000} imageHeight={3000} />);

    const uncropChip = screen.getByRole('button', { name: /uncrop/i });
    expect(uncropChip).toBeEnabled();
    fireEvent.click(uncropChip);
    expect(uncropSpy).toHaveBeenCalledTimes(1);
    expect(onParamsChange).toHaveBeenCalled();
  });

  it('disables the Uncrop chip when the image is not cropped', () => {
    const module = new CropModule();
    render(<CropModuleComponent module={module} onParamsChange={() => {}} imageWidth={4000} imageHeight={3000} />);
    expect(screen.getByRole('button', { name: /uncrop/i })).toBeDisabled();
  });
});

// ── Enhance ──────────────────────────────────────────────────────────────────
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => null),
  getOriginalImageDimensions: jest.fn(() => null),
  getCurrentImage: jest.fn(() => null),
} }));
jest.mock('../services/EnhanceService', () => ({
  getUpscaleFeasibility: jest.requireActual('../services/EnhanceService').getUpscaleFeasibility,
  enhanceService: {
    applyUpscale: jest.fn(async () => {}), revert: jest.fn(), canRevert: () => false,
    markEnhanceApplied: jest.fn(), isEnhanceStale: jest.fn(() => false),
  },
}));
import EnhanceModuleComponent from '../components/Modules/EnhanceModuleComponent';
import { enhanceModule } from '../modules/EnhanceModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';

describe('EnhanceModuleComponent — glass port', () => {
  it('renders the Detail & quality section with SliderRow controls and a full-width accent Apply button', () => {
    enhanceModule.resetParams();
    render(<EnhanceModuleComponent module={enhanceModule} noiseReductionModule={new NoiseReductionModule()} />);

    expect(screen.getByText('Detail & quality')).toBeInTheDocument();
    expect(screen.getByLabelText('Sharpen strength')).toBeInTheDocument();

    const apply = screen.getByRole('button', { name: /apply enhance/i });
    expect(apply).toHaveStyle({ background: 'var(--accent)' });
  });
});

// ── Lens Corrections ─────────────────────────────────────────────────────────
import { LensCorrectionsModuleComponent } from '../components/Modules/LensCorrectionsModuleComponent';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';

describe('LensCorrectionsModuleComponent — glass port', () => {
  it('renders Vignetting / Distortion / Chromatic Aberration / Blur / Film Grain sections in order', () => {
    const defaults = new LensCorrectionsModule().getParams();
    render(<LensCorrectionsModuleComponent parameters={defaults} onParametersChange={() => {}} />);

    const sections = screen.getAllByText(/^(Vignetting|Distortion|Chromatic Aberration|Blur|Film Grain)$/);
    expect(sections.map((el) => el.textContent)).toEqual([
      'Vignetting', 'Distortion', 'Chromatic Aberration', 'Blur', 'Film Grain',
    ]);
    expect(screen.getByLabelText('Midpoint')).toBeInTheDocument();
  });
});

// ── Local Adjustments ────────────────────────────────────────────────────────
import { LocalAdjustmentsModuleComponent } from '../components/Modules/LocalAdjustmentsModuleComponent';
import type { LocalAdjustmentParams, BrushParameters } from '../modules/LocalAdjustmentsModule';

const DEFAULT_LA_PARAMS: LocalAdjustmentParams = {
  exposure: 0, shadows: 0, highlights: 0, temperature: 0, tint: 0,
  saturation: 0, vibrance: 0, contrast: 0, brightness: 0, clarity: 0,
  hueShift: 0, colorBalance: [0, 0, 0],
};
const DEFAULT_BRUSH_PARAMS: BrushParameters = { size: 50, hardness: 0.8, opacity: 1, flow: 1, spacing: 1 };

describe('LocalAdjustmentsModuleComponent — glass port', () => {
  it('renders the Tools/Layers/Adjust/Mask segmented tab control and mask tool chips', () => {
    render(
      <LocalAdjustmentsModuleComponent
        parameters={DEFAULT_LA_PARAMS}
        brushParams={DEFAULT_BRUSH_PARAMS}
        layers={[]}
        activeLayerId={null}
        onParametersChange={() => {}}
        onBrushParamsChange={() => {}}
        onCreateLayer={() => {}}
        onRemoveLayer={() => {}}
        onToggleLayer={() => {}}
        onSetActiveLayer={() => {}}
        onUpdateLayerOpacity={() => {}}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tools/i })).toHaveAttribute('aria-selected', 'true');
    // Mask tool chips (Brush/Eraser/Linear/Radial) via the shared ChipButton.
    expect(screen.getByRole('button', { name: /brush/i })).toBeInTheDocument();
  });
});

// ── History ──────────────────────────────────────────────────────────────────
const FAKE_CHECKPOINTS = [
  { id: 2, label: 'Exposure +0.35', at: Date.now(), state: {} },
  { id: 1, label: 'Import photo.png', at: Date.now() - 60_000, state: {} },
];
jest.mock('../services/CheckpointService', () => ({
  checkpointService: {
    getCheckpoints: () => FAKE_CHECKPOINTS,
    getActiveId: () => 2,
    subscribe: () => () => {},
    restore: jest.fn(() => true),
    clear: jest.fn(),
    setBakeBridge: jest.fn(), // called at EnhanceService module-load time
  },
}));
import { HistoryPanel } from '../components/Panels/HistoryPanel';

describe('HistoryPanel — glass port', () => {
  it('accent-highlights the active checkpoint row (accent-soft fill + accent-ring border)', () => {
    render(<HistoryPanel />);

    const activeRow = screen.getByRole('button', { name: /exposure \+0\.35/i });
    expect(activeRow).toHaveStyle({ background: 'var(--accent-soft)', borderColor: 'var(--accent-ring)' });

    const inactiveRow = screen.getByRole('button', { name: /import photo\.png/i });
    expect(inactiveRow).not.toHaveStyle({ background: 'var(--accent-soft)' });
  });
});

// ── Highlight recovery (RAW) ─────────────────────────────────────────────────
// The RAW Decode panel was removed (every RAW decodes one fixed way); its post-decode
// Highlight recovery slider moved under Basic Adjustments for RAW photos.
jest.mock('../services/RawImageService', () => ({
  rawImageService: {
    isRawFile: jest.fn((p: string) => /\.(orf|cr2|cr3|nef|arw|dng|raf|rw2)$/i.test(p)),
    reDecode: jest.fn(async () => {}),
  },
}));
jest.mock('../services/NotificationService', () => ({ notificationService: { error: jest.fn() } }));
import { HighlightRecoveryControl } from '../components/Panels/HighlightRecoveryControl';
import { rawImageService } from '../services/RawImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { ImageFileInfo } from '../services/FileSystemService';

const RAW_IMAGE: ImageFileInfo = {
  id: '1', name: 'photo.orf', path: '/photo.orf', size: 100,
  format: 'orf', type: 'image', lastModified: 0, dateModified: new Date(),
};
const JPEG_IMAGE: ImageFileInfo = { ...RAW_IMAGE, id: '2', name: 'photo.jpg', path: '/photo.jpg', format: 'jpg' };
const hrModule = () =>
  imageProcessingPipeline.getModule('highlightrecovery') as unknown as {
    getParams: () => { strength: number }; setParams: (p: { strength: number }) => void;
  };

describe('HighlightRecoveryControl', () => {
  beforeEach(() => hrModule().setParams({ strength: 0 }));

  it('renders nothing for a non-RAW photo or with no photo open', () => {
    const { container, rerender } = render(<HighlightRecoveryControl currentImage={JPEG_IMAGE} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<HighlightRecoveryControl currentImage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a shared SliderRow (default 0) for a RAW photo', () => {
    render(<HighlightRecoveryControl currentImage={RAW_IMAGE} />);
    expect(screen.getByRole('slider', { name: 'Highlight recovery' })).toHaveValue('0');
  });

  it('sets the module strength without re-decoding the file', () => {
    render(<HighlightRecoveryControl currentImage={RAW_IMAGE} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Highlight recovery' }), { target: { value: '65' } });
    expect(hrModule().getParams().strength).toBe(65);
    expect(rawImageService.reDecode).not.toHaveBeenCalled();
  });
});
