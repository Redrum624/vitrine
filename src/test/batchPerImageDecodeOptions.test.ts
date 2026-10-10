/**
 * A batch run decodes every RAW the one fixed way the editor does (the RAW Decode panel and
 * per-photo decode options were removed). Options an older build persisted per photo must be
 * ignored, so a batch export can never disagree with what the editor shows. BatchProcessingService
 * decodes via ImageService.decodeForExport (side-effect-free). This test drives a real two-image
 * batch job through the public API and spies the decode IPC.
 */
import { batchProcessingService, BatchProcessingSettings } from '../services/BatchProcessingService';
import { exportService } from '../services/ExportService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { ImageFileInfo } from '../services/FileSystemService';
import { DEFAULT_RAW_DECODE_OPTIONS, RawDecodeOptions } from '../types/electron';

const OPTS_A: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'off' };
const OPTS_B: RawDecodeOptions = { demosaic: 'dcb', highlightMode: 'reconstruct' };

const makeFullPayload = () => {
  const px = new Uint16Array(4 * 2 * 3).fill(32768);
  return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
};

const rawImage = (path: string, name: string): ImageFileInfo => ({
  id: path,
  name,
  path,
  size: 1024,
  format: 'orf',
  type: 'orf',
  lastModified: 0,
  dateModified: new Date(0),
});

// useCurrentAdjustments:false → no pipeline capture/apply; processInBackground:true → no inter-image
// throttle delay. The batch just decodes each image (per-image options) and exports it.
const settings: BatchProcessingSettings = {
  useCurrentAdjustments: false,
  preserveOriginalSettings: false,
  processInBackground: true,
  maxConcurrentJobs: 2,
  outputSuffix: '_batch',
};

const decodeApi = () => (window as unknown as { electronAPI: { decodeRawFile: jest.Mock } }).electronAPI.decodeRawFile;

beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    // No baseCacheRead/Write → L2 disk cache is skipped, so every image runs the decode IPC.
    decodeRawFile: jest.fn().mockImplementation(async () => makeFullPayload()),
    storeGet: jest.fn(),
    storeSet: jest.fn(),
  };
  // No image open, and each file carries options an older build persisted — to be ignored.
  jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(null);
  jest.spyOn(editPersistenceService, 'getSavedRawDecodeOptions').mockImplementation(
    async (path: string) => (path === '/a.orf' ? OPTS_A : OPTS_B),
  );
  jest.spyOn(exportService, 'exportImage').mockResolvedValue({
    success: true,
    outputPath: '/out.jpg',
    outputSize: 100,
  } as Awaited<ReturnType<typeof exportService.exportImage>>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('BatchProcessingService — fixed RAW decode', () => {
  it('decodes every batch image with the default options, ignoring persisted per-photo options', async () => {
    const jobId = batchProcessingService.createBatchJob(
      'per-image-opts',
      [rawImage('/a.orf', 'a.orf'), rawImage('/b.orf', 'b.orf')],
      settings,
      { format: 'jpeg' },
    );

    await batchProcessingService.startBatchJob(jobId);

    expect(decodeApi()).toHaveBeenCalledWith('/a.orf', DEFAULT_RAW_DECODE_OPTIONS);
    expect(decodeApi()).toHaveBeenCalledWith('/b.orf', DEFAULT_RAW_DECODE_OPTIONS);

    // And the job completed cleanly (both images exported).
    const job = batchProcessingService.getJobs().find((j) => j.id === jobId);
    expect(job?.status).toBe('completed');
    expect(job?.results.every((r) => r.success)).toBe(true);
  });
});
