/**
 * Regression test for a stale-write race in `Canvas.loadImage`.
 *
 * `loadImage` awaits `imageService.loadImage(image.path)` and then, using the
 * closure's OWN `image` param (not re-checked), writes `setImageDimensions`,
 * `editPersistenceService.restoreForPath`, and `checkpointService.loadForPath`
 * for that image. If the user switches to a different image while the first
 * decode is still in flight (rapid filmstrip/gallery clicks), the first call's
 * awaited `imageService.loadImage` can resolve AFTER a second, newer call has
 * already finished and become the one on screen — `imageService.currentImage`
 * (per its own internal generation guard) reflects the NEWER image, but the
 * stale first call would still apply that decoded width/height under the OLD
 * image's id/path, and — worse — overwrite the just-loaded checkpoint history
 * for the NEW image with the OLD image's history.
 *
 * The fix re-checks `imageService.getCurrentImage()?.filePath` against the
 * closure's `image.path` right after the await and bails if they no longer
 * match, mirroring `RawImageService.reDecode`'s `stillCurrent` guard (see
 * `rawDecodeOptions.test.ts`'s mid-flight test for the sibling pattern this
 * one follows).
 */
import { render } from '@testing-library/react';
import { Canvas } from '../components/Layout/Canvas';
import { useAppStore } from '../stores/appStore';
import { imageService } from '../services/ImageService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { checkpointService } from '../services/CheckpointService';
import type { ImageFileInfo } from '../services/FileSystemService';

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
    getSavedRawDecodeOptions: jest.fn(async () => null),
    restoreForPath: jest.fn(async () => false),
  },
}));
jest.mock('../services/CheckpointService', () => ({
  checkpointService: {
    flush: jest.fn(),
    loadForPath: jest.fn(async () => {}),
    getCheckpoints: jest.fn(() => [{ id: 1 }]), // non-empty: skip the record('Opened') branch
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
const IMG_B: ImageFileInfo = {
  id: 'b', name: 'b.orf', path: '/b.orf', size: 100, format: 'orf', type: 'image',
  lastModified: 0, dateModified: new Date(),
};

describe('Canvas.loadImage — mid-flight image-switch race', () => {
  beforeEach(() => {
    useAppStore.setState({ imageDimensions: {} });
    jest.clearAllMocks();
    (editPersistenceService.getSavedRawDecodeOptions as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreForPath as jest.Mock).mockResolvedValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it('bails without applying stale writes when a newer image finishes decoding first', async () => {
    // Emulates ImageService's OWN internal generation guard (ImageService.ts:
    // "Guard against stale loads"): only the LAST-STARTED call's resolution ever
    // updates `currentImage`, regardless of resolution order.
    let generation = 0;
    let current: { filePath: string; width: number; height: number } | null = null;
    let resolveA: () => void = () => {};

    (imageService.loadImage as jest.Mock).mockImplementation((path: string) => {
      const myGeneration = ++generation;
      if (path === IMG_A.path) {
        return new Promise<void>((resolve) => {
          resolveA = () => {
            if (myGeneration === generation) current = { filePath: path, width: 111, height: 222 };
            resolve();
          };
        });
      }
      if (myGeneration === generation) current = { filePath: path, width: 20, height: 10 };
      return Promise.resolve();
    });
    (imageService.getCurrentImage as jest.Mock).mockImplementation(() => current);

    const { rerender } = render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);

    // Let A's loadImage start (synchronous prefix through the first await) and switch to B
    // before A's decode resolves — this is the "rapid click" scenario.
    await Promise.resolve();
    rerender(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_B} />);

    // Flush B's (fast) load through to completion.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((checkpointService.loadForPath as jest.Mock).mock.calls.map((c) => c[0])).toContain(IMG_B.path);
    expect(useAppStore.getState().imageDimensions[IMG_B.id]).toEqual({ width: 20, height: 10 });

    // Now resolve A's decode. ImageService's generation guard means `current` stays B's
    // data (A's resolution no-ops on `current`) — exactly like the real app.
    resolveA();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The guard must have bailed for A: no stale write of B's dimensions under A's id/path,
    // no restore/checkpoint-history clobber of B's just-loaded state with A's.
    expect(useAppStore.getState().imageDimensions[IMG_A.id]).toBeUndefined();
    expect((checkpointService.loadForPath as jest.Mock).mock.calls.map((c) => c[0])).not.toContain(IMG_A.path);
    expect((editPersistenceService.restoreForPath as jest.Mock).mock.calls.map((c) => c[0])).not.toContain(IMG_A.path);
  });
});
