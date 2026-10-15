/**
 * v1.40.0: overwrite prompt (Replace / Keep both / Cancel) before an export writes over an
 * existing file. Covers the dialog component (focus, Esc, choices) and ExportDialog wiring
 * for single and batch exports.
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
    getPlannedOutputPath: jest.fn(() => 'C:/out/photo_VIT.jpg'),
    outputExists: jest.fn(),
    exportImage: jest.fn(),
  },
}));
jest.mock('../services/ImageService', () => ({
  imageService: {
    getProcessingPipeline: jest.fn(() => null),
    isBakedUpscaleActive: jest.fn(() => false),
    isBakedDeblurActive: jest.fn(() => false),
  },
}));
jest.mock('../services/MultiExportService', () => ({
  multiExportService: { exportMany: jest.fn(), findExistingTargets: jest.fn() },
}));
jest.mock('../components/Dialogs/resolveExportSource', () => ({
  resolveExportSource: jest.fn(async () => ({ data: new Float32Array(4 * 4 * 4), width: 4, height: 4 })),
}));
jest.mock('../services/NotificationService', () => ({
  notificationService: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { ExportDialog } from '../components/Dialogs/ExportDialog';
import { OverwriteConfirmDialog } from '../components/Dialogs/OverwriteConfirmDialog';
import { exportService } from '../services/ExportService';
import { multiExportService } from '../services/MultiExportService';

const mockExportImage = exportService.exportImage as jest.Mock;
const mockExists = exportService.outputExists as jest.Mock;
const mockExportMany = multiExportService.exportMany as jest.Mock;
const mockFindExisting = multiExportService.findExistingTargets as jest.Mock;

// The prompt's own buttons live in the topmost aria-modal; scope queries to it.
const prompt = () => {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals[modals.length - 1] as HTMLElement;
};
const promptBtn = (name: string) =>
  Array.from(prompt().querySelectorAll('button')).find((b) => b.textContent?.trim() === name)!;

describe('OverwriteConfirmDialog', () => {
  afterEach(cleanup);

  it('focuses Keep both by default and maps Esc to cancel', () => {
    const onChoose = jest.fn();
    render(<OverwriteConfirmDialog isOpen fileName="photo_VIT.jpg" onChoose={onChoose} />);
    expect(screen.getByRole('button', { name: 'Keep both' })).toHaveFocus();
    expect(screen.getByText('photo_VIT.jpg', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onChoose).toHaveBeenCalledWith('cancel');
  });

  it('reports each button choice and is aria-modal', () => {
    const onChoose = jest.fn();
    render(<OverwriteConfirmDialog isOpen existingCount={2} total={3} onChoose={onChoose} />);
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
    expect(screen.getByText(/2 of 3/, { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(['replace', 'keepBoth', 'cancel']);
  });
});

describe('ExportDialog overwrite prompt - single export', () => {
  const onClose = jest.fn();
  const renderSingle = () => render(
    <ExportDialog
      isOpen onClose={onClose}
      imageData={new Float32Array(4 * 4 * 4)} imageWidth={4} imageHeight={4}
      originalFilePath="C:/p/photo.orf" onExportComplete={jest.fn()}
    />,
  );
  const clickExport = async () => {
    const btn = screen.getAllByRole('button').find((b) => /^\s*export\s*$/i.test(b.textContent || ''))!;
    await act(async () => { fireEvent.click(btn); });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExportImage.mockResolvedValue({ success: true, outputPath: 'C:/out/photo_VIT.jpg' });
  });
  afterEach(cleanup);

  it('shows no prompt when the target does not exist', async () => {
    mockExists.mockResolvedValue(false);
    renderSingle();
    await clickExport();
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('File already exists')).toBeNull();
    expect(mockExportImage.mock.calls[0][3].overwritePolicy).toBeUndefined();
  });

  it('Replace exports with overwritePolicy replace', async () => {
    mockExists.mockResolvedValue(true);
    renderSingle();
    await clickExport();
    expect(await screen.findByText('File already exists')).toBeInTheDocument();
    expect(mockExportImage).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(promptBtn('Replace')); });
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(mockExportImage.mock.calls[0][3].overwritePolicy).toBe('replace');
  });

  it('Keep both exports with overwritePolicy keepBoth', async () => {
    mockExists.mockResolvedValue(true);
    renderSingle();
    await clickExport();
    await screen.findByText('File already exists');
    await act(async () => { fireEvent.click(promptBtn('Keep both')); });
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(mockExportImage.mock.calls[0][3].overwritePolicy).toBe('keepBoth');
  });

  it('Cancel writes nothing and leaves the export dialog open', async () => {
    mockExists.mockResolvedValue(true);
    renderSingle();
    await clickExport();
    await screen.findByText('File already exists');
    await act(async () => { fireEvent.click(promptBtn('Cancel')); });
    expect(mockExportImage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('File already exists')).toBeNull();
    expect(screen.getByText('Export Image')).toBeInTheDocument();
  });
});

describe('ExportDialog overwrite prompt - re-entry, focus, remembered folder (fix round 1)', () => {
  const onClose = jest.fn();
  const renderSingle = () => render(
    <ExportDialog
      isOpen onClose={onClose}
      imageData={new Float32Array(4 * 4 * 4)} imageWidth={4} imageHeight={4}
      originalFilePath="C:/p/photo.orf" onExportComplete={jest.fn()}
    />,
  );
  const exportBtn = () => screen.getAllByRole('button').find((b) => /^\s*export\s*$/i.test(b.textContent || ''))!;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExportImage.mockResolvedValue({ success: true, outputPath: 'C:/out/photo_VIT.jpg' });
  });
  afterEach(() => { cleanup(); localStorage.clear(); delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

  it('a second Export click while the prompt is open does not replace the pending choice', async () => {
    mockExists.mockResolvedValue(true);
    renderSingle();
    await act(async () => { fireEvent.click(exportBtn()); });
    await screen.findByText('File already exists');
    await act(async () => { fireEvent.click(exportBtn()); });
    expect(screen.getByText('File already exists')).toBeInTheDocument();
    await act(async () => { fireEvent.click(promptBtn('Replace')); });
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(mockExportImage.mock.calls[0][3].overwritePolicy).toBe('replace');
  });

  it('Tab stays inside the prompt', async () => {
    mockExists.mockResolvedValue(true);
    renderSingle();
    await act(async () => { fireEvent.click(exportBtn()); });
    await screen.findByText('File already exists');
    expect(promptBtn('Keep both')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(promptBtn('Cancel')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(promptBtn('Keep both')).toHaveFocus();
  });

  it('reopened dialog: single export targets the remembered folder it displays', async () => {
    localStorage.setItem('photo_editor_export_settings', JSON.stringify({ version: 2, options: {}, outputDirectory: 'C:/remembered' }));
    mockExists.mockResolvedValue(false);
    renderSingle();
    await act(async () => { fireEvent.click(exportBtn()); });
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(mockExportImage.mock.calls[0][3].outputDirectory).toBe('C:/remembered');
    expect(exportService.getPlannedOutputPath).toHaveBeenCalledWith('C:/p/photo.orf', expect.objectContaining({ outputDirectory: 'C:/remembered' }));
  });

  it('a remembered folder that no longer exists falls back visibly to the original folder', async () => {
    localStorage.setItem('photo_editor_export_settings', JSON.stringify({ version: 2, options: {}, outputDirectory: 'C:/gone' }));
    (window as unknown as { electronAPI: unknown }).electronAPI = { fileExists: jest.fn() };
    mockExists.mockResolvedValue(false);
    renderSingle();
    fireEvent.click(screen.getByRole('button', { name: 'Color & Metadata' }));
    expect(await screen.findByText('Same folder as original')).toBeInTheDocument();
    await act(async () => { fireEvent.click(exportBtn()); });
    await waitFor(() => expect(mockExportImage).toHaveBeenCalledTimes(1));
    expect(mockExportImage.mock.calls[0][3].outputDirectory).toBeUndefined();
  });
});

describe('ExportDialog overwrite prompt - batch export', () => {
  const paths = ['/i/a.jpg', '/i/b.jpg', '/i/c.jpg'];
  const renderMulti = () => render(
    <ExportDialog
      isOpen onClose={jest.fn()}
      imageData={new Float32Array(4 * 4 * 4)} imageWidth={4} imageHeight={4}
      onExportComplete={jest.fn()} multiPaths={paths}
    />,
  );
  const startBatch = async () => {
    const btn = screen.getAllByRole('button').find((b) => /^\s*export(\s+3.*)?\s*$/i.test(b.textContent || ''))!;
    await act(async () => { fireEvent.click(btn); });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('photo_editor_export_settings', JSON.stringify({ version: 2, options: {}, outputDirectory: 'C:/out' }));
    mockExportMany.mockResolvedValue({ exported: [], failed: [], upscaleSkipped: [] });
    mockFindExisting.mockResolvedValue(['a_VIT.jpg', 'b_VIT.jpg']);
  });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('asks once with the count, and applies Replace to the whole batch', async () => {
    renderMulti();
    await startBatch();
    expect(await screen.findByText('Some files already exist')).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/, { selector: 'strong' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(promptBtn('Replace')); });
    await waitFor(() => expect(mockExportMany).toHaveBeenCalledTimes(1));
    expect(mockExportMany.mock.calls[0][1].overwritePolicy).toBe('replace');
  });

  it('Keep both applies to the whole batch; Cancel exports nothing', async () => {
    renderMulti();
    await startBatch();
    await screen.findByText('Some files already exist');
    await act(async () => { fireEvent.click(promptBtn('Keep both')); });
    await waitFor(() => expect(mockExportMany).toHaveBeenCalledTimes(1));
    expect(mockExportMany.mock.calls[0][1].overwritePolicy).toBe('keepBoth');

    mockExportMany.mockClear();
    cleanup();
    renderMulti();
    await startBatch();
    await screen.findByText('Some files already exist');
    await act(async () => { fireEvent.click(promptBtn('Cancel')); });
    expect(mockExportMany).not.toHaveBeenCalled();
  });

  it('does not prompt when nothing exists', async () => {
    mockFindExisting.mockResolvedValue([]);
    renderMulti();
    await startBatch();
    await waitFor(() => expect(mockExportMany).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Some files already exist')).toBeNull();
  });
});
