/**
 * Q3 item 1: a batch run must decode each RAW with ITS OWN persisted decode options, not the
 * STORE's current options (which belong to whatever image the user has open). BatchProcessingService
 * now decodes via ImageService.decodeForExport (side-effect-free, per-image option resolution) rather
 * than loadImage (store options). This test drives a real two-image batch job through the public API
 * and spies the decode IPC to prove each path decoded with its own options.
 */
import { batchProcessingService, BatchProcessingSettings } from '../services/BatchProcessingService';
import { exportService } from '../services/ExportService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { ImageFileInfo } from '../services/FileSystemService';
import { RawDecodeOptions } from '../types/electron';

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
  // No image open → decodeForExport resolves BOTH files via their persisted per-image options.
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

describe('BatchProcessingService — per-image RAW decode options', () => {
  it('decodes each batch image with its OWN persisted options (not the store options)', async () => {
    const jobId = batchProcessingService.createBatchJob(
      'per-image-opts',
      [rawImage('/a.orf', 'a.orf'), rawImage('/b.orf', 'b.orf')],
      settings,
      { format: 'jpeg' },
    );

    await batchProcessingService.startBatchJob(jobId);

    // Each path hit the decode IPC with ITS OWN options — proof the batch no longer smears one
    // image's options across the whole run.
    expect(decodeApi()).toHaveBeenCalledWith('/a.orf', OPTS_A);
    expect(decodeApi()).toHaveBeenCalledWith('/b.orf', OPTS_B);

    // And the job completed cleanly (both images exported).
    const job = batchProcessingService.getJobs().find((j) => j.id === jobId);
    expect(job?.status).toBe('completed');
    expect(job?.results.every((r) => r.success)).toBe(true);
  });
});
