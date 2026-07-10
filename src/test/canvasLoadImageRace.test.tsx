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
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';
import type { RawDecodeOptions } from '../types/electron';

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

/**
 * Regression test for a SECOND, EARLIER race in the same `loadImage`: the
 * `setRawDecodeOptions` store write (Canvas.tsx ~:710-722) happens after awaiting
 * `editPersistenceService.getSavedRawDecodeOptions(image.path)` but BEFORE
 * `imageService.loadImage(image.path)` even starts — i.e. before ImageService's own
 * generation guard (exercised by the test above) ever comes into play. If the user
 * switches images while that earlier await is in flight, the stale call would
 * otherwise overwrite the newer image's already-applied decode options AND go on to
 * decode the stale image with the wrong (newer image's) options in the store.
 *
 * Fixed by `activeLoadPathRef`, set synchronously at the very top of `loadImage`
 * (before any await) and re-checked right after `getSavedRawDecodeOptions` resolves —
 * mirrors the post-decode identity guard's pattern one step earlier in the flow.
 */
describe('Canvas.loadImage — mid-flight setRawDecodeOptions race (pre-decode)', () => {
  const A_OPTIONS: RawDecodeOptions = { demosaic: 'dcb', highlightMode: 'blend' };
  const B_OPTIONS: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'reconstruct' };

  beforeEach(() => {
    useAppStore.setState({ imageDimensions: {}, rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS });
    jest.clearAllMocks();
    // `clearAllMocks` resets calls/results but NOT a previous `mockImplementation` —
    // reset this back to its safe default (the prior describe block's test leaves it
    // pointing at a stale local `current` closure otherwise, crashing Canvas's redraw
    // effect on mount here).
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    (editPersistenceService.restoreForPath as jest.Mock).mockResolvedValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it("does not let a superseded image's saved decode options land after a newer image already set its own", async () => {
    let resolveA: (opts: RawDecodeOptions) => void = () => {};
    (editPersistenceService.getSavedRawDecodeOptions as jest.Mock).mockImplementation((path: string) => {
      if (path === IMG_A.path) {
        return new Promise<RawDecodeOptions>((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve(B_OPTIONS);
    });
    (imageService.loadImage as jest.Mock).mockImplementation((path: string) => {
      if (path === IMG_B.path) {
        (imageService.getCurrentImage as jest.Mock).mockReturnValue({ filePath: IMG_B.path, width: 20, height: 10 });
      }
      return Promise.resolve();
    });

    const { rerender } = render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);

    // Let A's loadImage start and reach its (held-open) getSavedRawDecodeOptions await
    // before switching to B — the exact "rapid click" scenario.
    await Promise.resolve();
    rerender(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_B} />);

    // Flush B's (fast) load through to completion — B's saved options land in the store.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().rawDecodeOptions).toEqual(B_OPTIONS);

    // Now resolve A's stale getSavedRawDecodeOptions call.
    resolveA(A_OPTIONS);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // A's (stale) options must NOT have overwritten B's — the guard bails before the write.
    expect(useAppStore.getState().rawDecodeOptions).toEqual(B_OPTIONS);
    // And A's decode must never even have been requested — the guard returns before
    // reaching imageService.loadImage at all.
    expect((imageService.loadImage as jest.Mock).mock.calls.map((c) => c[0])).not.toContain(IMG_A.path);
  });
});

/**
 * Companion to the two race tests above, isolating the CLEAN (non-racy) path: a
 * single successful load, with nothing else in flight, must still write the
 * decoded width/height into the shared `imageDimensions` map under the loaded
 * image's id (Canvas.tsx ~:742, the B2 bonus line) — the invariant the identity
 * guards above exist to PROTECT, not exercised by either race scenario on its own.
 */
describe('Canvas.loadImage — post-decode setImageDimensions write (clean path, no race)', () => {
  beforeEach(() => {
    useAppStore.setState({ imageDimensions: {} });
    jest.clearAllMocks();
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    (editPersistenceService.getSavedRawDecodeOptions as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreForPath as jest.Mock).mockResolvedValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it("writes the decoded width/height under the loaded image's id once loadImage resolves", async () => {
    (imageService.loadImage as jest.Mock).mockImplementation(async (path: string) => {
      (imageService.getCurrentImage as jest.Mock).mockReturnValue({ filePath: path, width: 4000, height: 3000 });
    });

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(useAppStore.getState().imageDimensions[IMG_A.id]).toEqual({ width: 4000, height: 3000 });
  });
});
