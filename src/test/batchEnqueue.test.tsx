/**
 * Unit tests for the "add selected images to batch queue" wiring (batch-enqueue).
 *
 * The fix lifts selectedImages out of BatchProcessingDialog into props so the
 * caller (App.tsx) owns the path->ImageFileInfo conversion. These tests exercise
 * the dialog's prop-driven selection: a lifted selection renders, "Add Open
 * Images" merges availableImages through onSelectedImagesChange, and creating a
 * job forwards the lifted selection to batchProcessingService.createJobFromPreset.
 *
 * The service is mocked; only the UI->service plumbing is verified.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageFileInfo } from '../services/FileSystemService';

// --- Mock the batch service singleton -----------------------------------
const createJobFromPreset = jest.fn().mockReturnValue('job-1');
const startBatchJob = jest.fn();
const getPresets = jest.fn();
const getPreset = jest.fn();
const getJobs = jest.fn().mockReturnValue([]);
const getStatistics = jest.fn().mockReturnValue({
  totalJobs: 0,
  activeJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  totalImagesProcessed: 0,
  averageProcessingTime: 0
});

const samplePreset = {
  id: 'web',
  name: 'Web Export',
  description: 'JPEG for web',
  exportOptions: { format: 'jpeg' }
};

jest.mock('../services/BatchProcessingService', () => ({
  batchProcessingService: {
    createJobFromPreset: (...args: unknown[]) => createJobFromPreset(...args),
    startBatchJob: (...args: unknown[]) => startBatchJob(...args),
    getPresets: () => getPresets(),
    getPreset: (...args: unknown[]) => getPreset(...args),
    getJobs: () => getJobs(),
    getStatistics: () => getStatistics(),
    clearCompletedJobs: jest.fn(),
    cancelBatchJob: jest.fn(),
    removeJob: jest.fn(),
    setMaxConcurrentJobs: jest.fn()
  }
}));

import { BatchProcessingDialog } from '../components/Dialogs/BatchProcessingDialog';

const makeImage = (path: string, name: string): ImageFileInfo => ({
  id: path,
  name,
  path,
  size: 1024,
  format: 'jpg',
  type: 'jpg',
  lastModified: 0,
  dateModified: new Date(0)
});

const twoImages = [makeImage('a/b/x.jpg', 'x.jpg'), makeImage('a/b/y.jpg', 'y.jpg')];

beforeEach(() => {
  jest.clearAllMocks();
  getPresets.mockReturnValue([samplePreset]);
  getPreset.mockReturnValue(samplePreset);
});

describe('BatchProcessingDialog enqueue wiring', () => {
  test('renders the lifted selection count and creates a job with those images', () => {
    const onSelectedImagesChange = jest.fn();
    render(
      <BatchProcessingDialog
        isOpen={true}
        onClose={() => {}}
        availableImages={[]}
        selectedImages={twoImages}
        onSelectedImagesChange={onSelectedImagesChange}
        onSelectImages={() => {}}
      />
    );

    // Switch to the Create Job tab.
    fireEvent.click(screen.getByText('Create Job'));

    // The lifted selection is shown.
    expect(screen.getByText('2 images selected')).toBeInTheDocument();

    // Pick a preset, then create the job.
    fireEvent.click(screen.getByText('Web Export'));
    fireEvent.click(screen.getByText('Create and Start Batch Job'));

    expect(createJobFromPreset).toHaveBeenCalledTimes(1);
    const args = createJobFromPreset.mock.calls[0];
    expect(args[0]).toBe('web'); // preset id
    expect(args[2]).toHaveLength(2); // the lifted ImageFileInfo[]
    expect(args[2]).toEqual(twoImages);
    expect(startBatchJob).toHaveBeenCalledWith('job-1');
    // Selection is cleared via the lifted setter, not internal state.
    expect(onSelectedImagesChange).toHaveBeenCalledWith([]);
  });

  test('"Add Open Images" merges availableImages into the lifted selection (deduped)', () => {
    const onSelectedImagesChange = jest.fn();
    const alreadySelected = [makeImage('a/b/x.jpg', 'x.jpg')];
    render(
      <BatchProcessingDialog
        isOpen={true}
        onClose={() => {}}
        availableImages={twoImages}
        selectedImages={alreadySelected}
        onSelectedImagesChange={onSelectedImagesChange}
        onSelectImages={() => {}}
      />
    );

    fireEvent.click(screen.getByText('Create Job'));
    fireEvent.click(screen.getByText('Add Open Images'));

    // x.jpg already selected -> only y.jpg is added (deduped by path).
    expect(onSelectedImagesChange).toHaveBeenCalledTimes(1);
    const merged = onSelectedImagesChange.mock.calls[0][0] as ImageFileInfo[];
    expect(merged.map((i) => i.path)).toEqual(['a/b/x.jpg', 'a/b/y.jpg']);
  });

  test('"Add Open Images" is hidden when there are no available images', () => {
    render(
      <BatchProcessingDialog
        isOpen={true}
        onClose={() => {}}
        availableImages={[]}
        selectedImages={[]}
        onSelectedImagesChange={() => {}}
        onSelectImages={() => {}}
      />
    );

    fireEvent.click(screen.getByText('Create Job'));
    expect(screen.queryByText('Add Open Images')).not.toBeInTheDocument();
    expect(screen.getByText('No images selected')).toBeInTheDocument();
  });

  test('Create is disabled with no selection and does not call the service', () => {
    render(
      <BatchProcessingDialog
        isOpen={true}
        onClose={() => {}}
        availableImages={[]}
        selectedImages={[]}
        onSelectedImagesChange={() => {}}
        onSelectImages={() => {}}
      />
    );

    fireEvent.click(screen.getByText('Create Job'));
    const createBtn = screen.getByText('Create and Start Batch Job').closest('button')!;
    expect(createBtn).toBeDisabled();
  });
});
