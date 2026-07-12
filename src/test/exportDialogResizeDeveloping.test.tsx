/**
 * Round-6 P10: ExportDialog render harness (the "no dialog harness" excuse retired) +
 * the resize-disable-during-`developing` contract.
 *
 * The Dimensions tab's "Resize image" toggle seeds width/height from imageWidth/imageHeight.
 * During a progressive RAW open those props are the fast embedded PREVIEW dims (e.g. 2048px),
 * not the true sensor dims — enabling Resize then would silently downscale the (otherwise
 * full-res, safe) export. ExportDialog therefore disables just that toggle while
 * `developing` is true (ExportDialog.tsx renderDimensionsTab). These tests render the real
 * dialog with the services it imports mocked (none are exercised by simply opening the
 * Dimensions tab) and drive the store's `developing` flag.
 */
jest.mock('../services/ExportService', () => ({
  exportService: {
    getDefaultOptions: () => ({
      format: 'jpeg', quality: 90, bitDepth: 8, compression: 'none', lossless: false,
      colorSpace: 'srgb', preserveMetadata: true, includeProcessingHistory: false,
      maintainAspectRatio: true, resizeMode: 'fit', width: undefined, height: undefined,
    }),
    getPresets: () => [],
    getPreset: () => undefined,
    validateOptions: () => ({ valid: true, errors: [] }),
  },
}));

let mockExportBaked = false;
let mockExportDeblurBaked = false;
jest.mock('../services/ImageService', () => ({
  imageService: {
    getProcessingPipeline: jest.fn(() => null),
    isBakedUpscaleActive: jest.fn(() => mockExportBaked),
    isBakedDeblurActive: jest.fn(() => mockExportDeblurBaked),
  },
}));

jest.mock('../services/MultiExportService', () => ({
  multiExportService: { exportMany: jest.fn() },
}));

jest.mock('../components/Dialogs/resolveExportSource', () => ({
  resolveExportSource: jest.fn(),
}));

jest.mock('../services/NotificationService', () => ({
  notificationService: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ExportDialog } from '../components/Dialogs/ExportDialog';
import { useAppStore } from '../stores/appStore';

function renderDialog() {
  return render(
    <ExportDialog
      isOpen
      onClose={jest.fn()}
      imageData={new Float32Array(4 * 4 * 4)}
      imageWidth={2048}
      imageHeight={1365}
      originalFilePath="/photo.orf"
      onExportComplete={jest.fn()}
    />,
  );
}

describe('ExportDialog — Resize toggle gating during the developing window', () => {
  beforeEach(() => {
    useAppStore.setState({ developing: false });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ developing: false });
  });

  const openDimensionsTab = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Dimensions' }));

  it('leaves the Resize toggle enabled once full quality has settled (developing false)', () => {
    renderDialog();
    openDimensionsTab();
    const resize = screen.getByRole('checkbox', { name: /resize image/i });
    expect(resize).not.toBeDisabled();
  });

  it('disables the Resize toggle (and explains why) while developing', () => {
    act(() => { useAppStore.getState().setDeveloping(true); });
    renderDialog();
    openDimensionsTab();

    const resize = screen.getByRole('checkbox', { name: /resize image/i });
    expect(resize).toBeDisabled();
    // The wrapping label carries the hover explanation for the greyed-out control.
    expect(resize.closest('label')).toHaveAttribute(
      'title',
      'Available when full quality finishes developing',
    );
  });

  it('re-enables the Resize toggle when developing clears mid-session', () => {
    act(() => { useAppStore.getState().setDeveloping(true); });
    renderDialog();
    openDimensionsTab();
    expect(screen.getByRole('checkbox', { name: /resize image/i })).toBeDisabled();

    act(() => { useAppStore.getState().setDeveloping(false); });
    expect(screen.getByRole('checkbox', { name: /resize image/i })).not.toBeDisabled();
  });
});

describe('ExportDialog — unapplied upscale warning (Q7, NO silent loss)', () => {
  beforeEach(() => {
    mockExportBaked = false;
    useAppStore.setState({ developing: false, upscaleIntent: null });
  });
  afterEach(() => {
    cleanup();
    mockExportBaked = false;
    useAppStore.setState({ developing: false, upscaleIntent: null });
  });

  it('warns when a persisted upscale intent exists but the base is NOT baked (reopened, not re-applied)', () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    renderDialog();
    const warn = screen.getByTestId('export-upscale-warning');
    expect(warn).toHaveTextContent(/×2/);
    expect(warn).toHaveTextContent(/AI/);
    expect(warn).toHaveTextContent(/native resolution/i);
  });

  it('does NOT warn when the upscale is currently baked (re-applied → export honors it)', () => {
    mockExportBaked = true;
    useAppStore.setState({ upscaleIntent: { scale: 4, mode: 'standard' } });
    renderDialog();
    expect(screen.queryByTestId('export-upscale-warning')).toBeNull();
  });

  it('does NOT warn when there is no upscale intent at all', () => {
    renderDialog();
    expect(screen.queryByTestId('export-upscale-warning')).toBeNull();
  });

  it('does NOT warn in multi-export mode (per-image counts surface in the completion toast instead)', () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' } });
    render(
      <ExportDialog
        isOpen
        onClose={jest.fn()}
        imageData={new Float32Array(4 * 4 * 4)}
        imageWidth={2048}
        imageHeight={1365}
        originalFilePath="/photo.orf"
        onExportComplete={jest.fn()}
        multiPaths={['/a.orf', '/b.orf']}
      />,
    );
    expect(screen.queryByTestId('export-upscale-warning')).toBeNull();
  });
});

describe('ExportDialog — unapplied DEBLUR warning (Z1, NO silent loss)', () => {
  beforeEach(() => {
    mockExportBaked = false;
    mockExportDeblurBaked = false;
    useAppStore.setState({ developing: false, upscaleIntent: null, deblurIntent: false });
  });
  afterEach(() => {
    cleanup();
    mockExportBaked = false;
    mockExportDeblurBaked = false;
    useAppStore.setState({ developing: false, upscaleIntent: null, deblurIntent: false });
  });

  it('warns when a persisted deblur intent exists but the base is NOT baked (reopened, not re-applied)', () => {
    useAppStore.setState({ deblurIntent: true });
    renderDialog();
    const warn = screen.getByTestId('export-upscale-warning');
    expect(warn).toHaveTextContent(/deblur/i);
    expect(warn).toHaveTextContent(/pre-deblur/i);
  });

  it('does NOT warn when the deblur is currently baked (re-applied → export honors it)', () => {
    mockExportDeblurBaked = true;
    useAppStore.setState({ deblurIntent: true });
    renderDialog();
    expect(screen.queryByTestId('export-upscale-warning')).toBeNull();
  });

  it('surfaces BOTH bakes when upscale AND deblur intents are pending', () => {
    useAppStore.setState({ upscaleIntent: { scale: 2, mode: 'ai' }, deblurIntent: true });
    renderDialog();
    const warn = screen.getByTestId('export-upscale-warning');
    expect(warn).toHaveTextContent(/×2/);
    expect(warn).toHaveTextContent(/deblur/i);
  });

  it('does NOT warn when there is no bake intent at all', () => {
    renderDialog();
    expect(screen.queryByTestId('export-upscale-warning')).toBeNull();
  });
});
