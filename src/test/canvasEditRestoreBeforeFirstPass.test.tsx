/**
 * Task L2: Canvas.loadImage restores persisted edits BEFORE the first pipeline pass.
 *
 * OLD flow (double pass + unedited flash on every edited photo):
 *   read decode options → decode → notifyImageLoaded → FIRST pass with DEFAULT params
 *   → (async) restoreForPath → triggerReprocessing → SECOND pass with restored params.
 *
 * NEW flow (single pass, no flash):
 *   ONE read of the full edit state (decode options + module edits) up front → decode →
 *   beforeNotify hook applies the restored params → notifyImageLoaded → FIRST (and only)
 *   pass already has the restored params. No post-load restoreForPath, no triggerReprocessing.
 *
 * These tests mock the services and make imageService.loadImage invoke the beforeNotify hook
 * (as the real ImageService does, synchronously before notify) so we can assert: exactly ONE
 * store read, the restore is seeded via restoreState with the REAL decoded dims, and the
 * redundant second pass (restoreForPath / triggerReprocessing) is gone.
 */
import { render } from '@testing-library/react';
import { Canvas } from '../components/Layout/Canvas';
import { useAppStore } from '../stores/appStore';
import { imageService } from '../services/ImageService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { checkpointService } from '../services/CheckpointService';
import type { ImageFileInfo } from '../services/FileSystemService';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

jest.mock('../services/ImageService', () => ({
  imageService: {
    loadImage: jest.fn(),
    getCurrentImage: jest.fn(() => null),
  },
}));
jest.mock('../services/EditPersistenceService', () => ({
  editPersistenceService: {
    flush: jest.fn(),
    scheduleSave: jest.fn(),
    getSavedEditState: jest.fn(async () => null),
    restoreState: jest.fn(() => false),
    // Legacy methods must remain UNCALLED by the open flow — spies to prove that.
    getSavedRawDecodeOptions: jest.fn(async () => null),
    validateSavedRawDecodeOptions: jest.fn((saved) => saved ?? null),
    validateBakedUpscaleIntent: jest.fn(() => null),
    validateBakeOrder: jest.fn(() => undefined),
    restoreForPath: jest.fn(async () => false),
  },
}));
jest.mock('../services/CheckpointService', () => ({
  checkpointService: {
    flush: jest.fn(),
    loadForPath: jest.fn(async () => {}),
    getCheckpoints: jest.fn(() => [{ id: 1 }]),
    record: jest.fn(),
  },
}));
jest.mock('../services/ImageProcessingPipeline', () => ({
  imageProcessingPipeline: {
    resetAllModules: jest.fn(),
    getModule: jest.fn(() => null),
    invalidateModuleCache: jest.fn(),
    clearCache: jest.fn(),
  },
}));
jest.mock('../services/NotificationService', () => ({ notificationService: { error: jest.fn() } }));
jest.mock('../shaders/GpuPreviewPipeline', () => ({
  gpuPreviewPipeline: { attach: jest.fn(() => false), present: jest.fn(), destroy: jest.fn(), isAvailable: jest.fn(() => false) },
}));

const IMG_A: ImageFileInfo = {
  id: 'a', name: 'a.orf', path: '/a.orf', size: 100, format: 'orf', type: 'image',
  lastModified: 0, dateModified: new Date(),
};

const AHD_RECON = { demosaic: 'ahd' as const, highlightMode: 'reconstruct' as const };
const EDIT_STATE = { version: 1, modules: { basicadj: { exposure: 0.5 } }, rawDecodeOptions: AHD_RECON };

// Simulate the real ImageService: after "decoding", set currentImage and invoke the
// beforeNotify hook synchronously (before the load listeners would fire the first pass).
const mockLoadImageInvokingHook = () => {
  (imageService.loadImage as jest.Mock).mockImplementation(
    async (path: string, beforeNotify?: (r: unknown) => void) => {
      const decoded = { filePath: path, width: 4000, height: 3000, data: new Float32Array(4), fileName: 'a.orf' };
      (imageService.getCurrentImage as jest.Mock).mockReturnValue(decoded);
      beforeNotify?.(decoded);
      return decoded;
    },
  );
};

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('Canvas.loadImage — persisted edits apply before the first pass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ imageDimensions: {}, processingVersion: 0, rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS });
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
    mockLoadImageInvokingHook();
  });

  it('seeds restored params via restoreState with the REAL decoded dims — no second pass', async () => {
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(EDIT_STATE);

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);
    await flush();

    // ONE store read up front (decode options + edits together), not the old two reads.
    expect(editPersistenceService.getSavedEditState).toHaveBeenCalledTimes(1);
    expect(editPersistenceService.getSavedEditState).toHaveBeenCalledWith(IMG_A.path);
    expect(editPersistenceService.getSavedRawDecodeOptions).not.toHaveBeenCalled();
    expect(editPersistenceService.restoreForPath).not.toHaveBeenCalled();

    // Restore is seeded with the fetched state at the decoded dimensions.
    expect(editPersistenceService.restoreState).toHaveBeenCalledWith(EDIT_STATE, 4000, 3000, IMG_A.path);

    // Decode options came from the same single read.
    expect(useAppStore.getState().rawDecodeOptions).toEqual(AHD_RECON);

    // No redundant second pass: the post-load triggerReprocessing is gone.
    expect(useAppStore.getState().processingVersion).toBe(0);
  });

  it('pristine image: one read, restoreState seeds the baseline (null), default decode options, no extra pass', async () => {
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(null);

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);
    await flush();

    // Still exactly ONE read for a pristine image — zero added IPC round-trips.
    expect(editPersistenceService.getSavedEditState).toHaveBeenCalledTimes(1);
    // restoreState is still called (with null) to seed the baseline so no spurious save fires.
    expect(editPersistenceService.restoreState).toHaveBeenCalledWith(null, 4000, 3000, IMG_A.path);
    expect(useAppStore.getState().rawDecodeOptions).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
    expect(useAppStore.getState().processingVersion).toBe(0);
  });
});
