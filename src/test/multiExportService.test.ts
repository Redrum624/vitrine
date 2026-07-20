/**
 * Unit tests for MultiExportService.exportMany.
 *
 * Verifies the core guarantees: each image is exported with ITS OWN saved edits
 * (reset → restoreForPath per image), output names use the _VIT suffix and never
 * clobber (auto-suffix vs both on-disk files and same-run names), cancellation
 * stops the loop, per-image failures are collected without aborting, and the
 * editor's pre-export state is always restored afterward.
 *
 * All heavy collaborators are mocked so this is a pure logic test.
 */

// --- Mocks --------------------------------------------------------------
const loadImageForExport = jest.fn();
const getCurrentImage = jest.fn();
const resetAllModules = jest.fn();
const processImage = jest.fn();
const getProcessingPipeline = jest.fn(() => ({ resetAllModules, processImage }));

jest.mock('../services/ImageService', () => ({
  imageService: { loadImageForExport, getCurrentImage, getProcessingPipeline },
}));

const flush = jest.fn();
const serialize = jest.fn(() => ({ snapshot: 'CURRENT' }));
const restore = jest.fn();
const getSavedEditState = jest.fn();
const restoreState = jest.fn();

jest.mock('../services/EditPersistenceService', () => ({
  editPersistenceService: { flush, serialize, restore, getSavedEditState, restoreState },
}));

const exportImage = jest.fn();
jest.mock('../services/ExportService', () => ({
  exportService: { exportImage },
}));

import { multiExportService } from '../services/MultiExportService';

const fileExists = jest.fn();

const controls = (over: Partial<{ isCancelled: () => boolean }> = {}) => ({
  outputDirectory: 'C:\\out',
  onProgress: jest.fn(),
  isCancelled: over.isCancelled ?? (() => false),
});

const okOptions = { format: 'jpeg' as const };

beforeEach(() => {
  jest.clearAllMocks();
  (window as unknown as { electronAPI: { fileExists: typeof fileExists } }).electronAPI = { fileExists };
  fileExists.mockResolvedValue(false);
  loadImageForExport.mockImplementation(async () => ({ width: 100, height: 50, data: new Float32Array(100 * 50 * 4) }));
  getCurrentImage.mockReturnValue({ width: 200, height: 120 });
  processImage.mockImplementation(async (d: Float32Array) => d);
  getSavedEditState.mockResolvedValue(null);
  restoreState.mockReturnValue(true);
  exportImage.mockResolvedValue({ success: true, outputPath: 'out' });
});

describe('exportMany — per-image edits', () => {
  it('resets then restores each image\'s saved edits before processing', async () => {
    await multiExportService.exportMany(['/i/a.jpg', '/i/b.png'], okOptions, controls());
    // Fetches each image's state once, then restores it (behaviour-identical to the old
    // restoreForPath, but the single read also lets us detect an unapplied upscale intent).
    expect(getSavedEditState).toHaveBeenCalledWith('/i/a.jpg');
    expect(getSavedEditState).toHaveBeenCalledWith('/i/b.png');
    expect(restoreState).toHaveBeenCalledWith(null, 100, 50, '/i/a.jpg');
    expect(restoreState).toHaveBeenCalledWith(null, 100, 50, '/i/b.png');
    // resetAllModules runs per image (2) plus once in the finally restore = 3.
    expect(resetAllModules).toHaveBeenCalledTimes(3);
  });

  it('exports each image with a _VIT filename into the chosen folder', async () => {
    await multiExportService.exportMany(['/i/a.jpg', '/i/b.png'], okOptions, controls());
    expect(exportImage).toHaveBeenCalledTimes(2);
    expect(exportImage.mock.calls[0][3]).toMatchObject({ outputDirectory: 'C:\\out', filename: 'a_VIT.jpg' });
    expect(exportImage.mock.calls[1][3]).toMatchObject({ filename: 'b_VIT.jpg' });
  });
});

describe('exportMany — cropped images export with the POST-CROP dims', () => {
  it('reads the crop-mutated context dims when processImage returns a bare Float32Array', async () => {
    // Regression (v1.29.1 shredded-export class): with a crop active the
    // pipeline mutates context.width/height and returns a SMALLER buffer.
    // Exporting that buffer with the original dims corrupts the file.
    processImage.mockImplementation(async (_d: Float32Array, context: { width: number; height: number }) => {
      context.width = 50;   // crop to half
      context.height = 25;
      return new Float32Array(50 * 25 * 4);
    });
    await multiExportService.exportMany(['/i/a.jpg'], okOptions, controls());
    expect(exportImage).toHaveBeenCalledTimes(1);
    expect(exportImage.mock.calls[0][1]).toBe(50);  // width  = post-crop
    expect(exportImage.mock.calls[0][2]).toBe(25);  // height = post-crop
  });
});

describe('exportMany — unapplied upscale intent (Q7, NO silent loss)', () => {
  it('records images whose saved state carries a bakedUpscale intent in summary.upscaleSkipped', async () => {
    getSavedEditState.mockImplementation(async (path: string) =>
      path === '/i/a.jpg' ? { version: 1, modules: {}, bakedUpscale: { scale: 2, mode: 'ai' } } : null,
    );
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.png'], okOptions, controls());
    // Both still export (at native resolution) — the intent is surfaced, never silently dropped.
    expect(summary.exported).toEqual(['a_VIT.jpg', 'b_VIT.jpg']);
    expect(summary.upscaleSkipped).toEqual(['a']);
  });

  it('leaves upscaleSkipped empty when no selected image carries an intent', async () => {
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.png'], okOptions, controls());
    expect(summary.upscaleSkipped).toEqual([]);
  });
});

describe('exportMany — collision handling', () => {
  it('auto-suffixes when a file already exists on disk', async () => {
    // First candidate exists; the bumped one does not.
    fileExists.mockImplementation(async (p: string) => p.endsWith('a_VIT.jpg'));
    await multiExportService.exportMany(['/i/a.jpg'], okOptions, controls());
    expect(exportImage.mock.calls[0][3].filename).toBe('a_VIT_1.jpg');
  });

  it('auto-suffixes when two sources share a base name', async () => {
    await multiExportService.exportMany(['/x/a.jpg', '/y/a.png'], okOptions, controls());
    expect(exportImage.mock.calls[0][3].filename).toBe('a_VIT.jpg');
    expect(exportImage.mock.calls[1][3].filename).toBe('a_VIT_1.jpg');
  });
});

describe('exportMany — cancellation & failures', () => {
  it('stops before the next image when cancelled', async () => {
    let calls = 0;
    const isCancelled = () => calls++ > 0; // false for first check, true afterwards
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg', '/i/c.jpg'], okOptions, controls({ isCancelled }));
    expect(exportImage).toHaveBeenCalledTimes(1);
    expect(summary.exported).toEqual(['a_VIT.jpg']);
  });

  it('collects a failed export and continues with the rest', async () => {
    exportImage
      .mockResolvedValueOnce({ success: false, error: 'disk full' })
      .mockResolvedValueOnce({ success: true });
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    expect(summary.failed).toEqual([{ path: '/i/a.jpg', error: 'disk full' }]);
    expect(summary.exported).toEqual(['b_VIT.jpg']);
  });

  it('collects a thrown error and continues', async () => {
    loadImageForExport.mockRejectedValueOnce(new Error('decode failed'));
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    expect(summary.failed[0]).toEqual({ path: '/i/a.jpg', error: 'decode failed' });
    expect(summary.exported).toEqual(['b_VIT.jpg']);
  });
});

describe('exportMany — batch pipelining (R4, 2026-07-20)', () => {
  const flush = async (rounds = 20) => { for (let r = 0; r < rounds; r++) await Promise.resolve(); };

  it('decodes the NEXT image while the current one is still processing (decode-ahead)', async () => {
    // Gate each processImage call so we can observe the world while photo A is "processing".
    const gates: Array<(v: Float32Array) => void> = [];
    processImage.mockImplementation((d: Float32Array) => new Promise<Float32Array>((res) => gates.push(() => res(d))));

    const run = multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    await flush();

    // A is processing (unresolved) — B's decode has ALREADY been kicked off.
    expect(processImage).toHaveBeenCalledTimes(1);
    expect(loadImageForExport).toHaveBeenCalledTimes(2);
    expect(loadImageForExport).toHaveBeenNthCalledWith(1, '/i/a.jpg');
    expect(loadImageForExport).toHaveBeenNthCalledWith(2, '/i/b.jpg');
    // …but B's EDITS are not restored yet (module state stays serial — worker-fallback safety).
    expect(restoreState).toHaveBeenCalledTimes(1);

    gates.shift()!(new Float32Array(4));
    await flush();
    gates.shift()!(new Float32Array(4));
    const summary = await run;
    expect(summary.exported).toEqual(['a_VIT.jpg', 'b_VIT.jpg']);
  });

  it('processes photo N+1 while photo N is still encoding (fire-and-track encode, ≤1 in flight)', async () => {
    let resolveEncodeA: ((v: { success: boolean }) => void) | null = null;
    exportImage
      .mockImplementationOnce(() => new Promise((res) => { resolveEncodeA = res; }))
      .mockResolvedValueOnce({ success: true });

    const run = multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    await flush();

    // A's encode is in flight (unresolved) — B has already been decoded AND processed.
    expect(resolveEncodeA).not.toBeNull();
    expect(processImage).toHaveBeenCalledTimes(2);
    // …but B's encode has NOT fired yet (bounded: one encode in flight).
    expect(exportImage).toHaveBeenCalledTimes(1);

    resolveEncodeA!({ success: true });
    const summary = await run;
    expect(exportImage).toHaveBeenCalledTimes(2);
    expect(summary.exported).toEqual(['a_VIT.jpg', 'b_VIT.jpg']);
  });

  it('a decode-ahead failure is charged to the RIGHT photo and the batch continues', async () => {
    loadImageForExport.mockImplementation(async (p: string) => {
      if (p === '/i/b.jpg') throw new Error('decode failed');
      return { width: 100, height: 50, data: new Float32Array(100 * 50 * 4) };
    });
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg', '/i/c.jpg'], okOptions, controls());
    expect(summary.exported).toEqual(['a_VIT.jpg', 'c_VIT.jpg']);
    expect(summary.failed).toEqual([{ path: '/i/b.jpg', error: 'decode failed' }]);
  });

  it('the last photo\'s tracked encode result is awaited before the summary returns', async () => {
    exportImage
      .mockResolvedValueOnce({ success: true })
      .mockImplementationOnce(() => new Promise((res) => setTimeout(() => res({ success: false, error: 'disk full' }), 5)));
    const summary = await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    expect(summary.exported).toEqual(['a_VIT.jpg']);
    expect(summary.failed).toEqual([{ path: '/i/b.jpg', error: 'disk full' }]);
  });
});

describe('exportMany — editor state restore', () => {
  it('always restores the snapshot with the current image dims in finally', async () => {
    await multiExportService.exportMany(['/i/a.jpg'], okOptions, controls());
    expect(restore).toHaveBeenCalledWith({ snapshot: 'CURRENT' }, 200, 120);
  });

  it('restores even when every image fails', async () => {
    loadImageForExport.mockRejectedValue(new Error('boom'));
    await multiExportService.exportMany(['/i/a.jpg', '/i/b.jpg'], okOptions, controls());
    expect(restore).toHaveBeenCalledWith({ snapshot: 'CURRENT' }, 200, 120);
  });
});
