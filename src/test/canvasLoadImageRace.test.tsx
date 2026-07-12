/**
 * Regression test for a stale-write race in `Canvas.loadImage`.
 *
 * `loadImage` awaits `imageService.loadImage(image.path)` and then, using the
 * closure's OWN `image` param (not re-checked), writes `setImageDimensions` and
 * `checkpointService.loadForPath` for that image (and, in the beforeNotify hook,
 * `editPersistenceService.restoreState`). If the user switches to a different image while the first
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
    getSavedEditState: jest.fn(async () => null),
    restoreState: jest.fn(() => false),
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
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it('bails without applying stale writes when a newer image finishes decoding first', async () => {
    // Emulates ImageService's OWN internal generation guard (ImageService.ts:
    // "Guard against stale loads"): only the LAST-STARTED call's resolution ever
    // updates `currentImage`, regardless of resolution order.
    let generation = 0;
    let current: { filePath: string; width: number; height: number } | null = null;
    let resolveA: () => void = () => {};

    // Thread the beforeNotify hook exactly like the real ImageService: it only fires when
    // this decode is still current (the generation guard), so a superseded load never seeds
    // its (stale) edits — mirroring ImageService returning before notify for a stale gen.
    (imageService.loadImage as jest.Mock).mockImplementation((path: string, beforeNotify?: (r: unknown) => void) => {
      const myGeneration = ++generation;
      if (path === IMG_A.path) {
        return new Promise<void>((resolve) => {
          resolveA = () => {
            if (myGeneration === generation) {
              current = { filePath: path, width: 111, height: 222 };
              beforeNotify?.(current);
            }
            resolve();
          };
        });
      }
      if (myGeneration === generation) {
        current = { filePath: path, width: 20, height: 10 };
        beforeNotify?.(current);
      }
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
    // Restore now happens in the beforeNotify hook (restoreState); it must not have run for
    // the superseded image A (logPath arg is the 4th param).
    expect((editPersistenceService.restoreState as jest.Mock).mock.calls.map((c) => c[3])).not.toContain(IMG_A.path);
  });
});

/**
 * Regression test for a SECOND, EARLIER race in the same `loadImage`: the
 * `setRawDecodeOptions` store write happens after awaiting the single full-edit-state
 * read `editPersistenceService.getSavedEditState(image.path)` but BEFORE
 * `imageService.loadImage(image.path)` even starts — i.e. before ImageService's own
 * generation guard (exercised by the test above) ever comes into play. If the user
 * switches images while that earlier await is in flight, the stale call would
 * otherwise overwrite the newer image's already-applied decode options AND go on to
 * decode the stale image with the wrong (newer image's) options in the store.
 *
 * Fixed by the monotonic load token (`loadTokenRef`, which replaced the original
 * path-equality `activeLoadPathRef` — see the A→B→A describe below), bumped
 * synchronously at the very top of `loadImage` (before any await) and re-checked
 * right after `getSavedEditState` resolves — mirrors the post-decode identity
 * guard's pattern one step earlier in the flow.
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
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it("does not let a superseded image's saved decode options land after a newer image already set its own", async () => {
    // Decode options now arrive as part of the single full-edit-state read (getSavedEditState).
    const stateFor = (opts: RawDecodeOptions) => ({ version: 1, modules: {}, rawDecodeOptions: opts });
    let resolveA: (state: unknown) => void = () => {};
    (editPersistenceService.getSavedEditState as jest.Mock).mockImplementation((path: string) => {
      if (path === IMG_A.path) {
        return new Promise((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve(stateFor(B_OPTIONS));
    });
    (imageService.loadImage as jest.Mock).mockImplementation((path: string, beforeNotify?: (r: unknown) => void) => {
      if (path === IMG_B.path) {
        const decoded = { filePath: IMG_B.path, width: 20, height: 10 };
        (imageService.getCurrentImage as jest.Mock).mockReturnValue(decoded);
        beforeNotify?.(decoded);
      }
      return Promise.resolve();
    });

    const { rerender } = render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);

    // Let A's loadImage start and reach its (held-open) getSavedEditState await — the single
    // full-edit-state read that now carries both decode options and module edits — before
    // switching to B — the exact "rapid click" scenario.
    await Promise.resolve();
    rerender(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_B} />);

    // Flush B's (fast) load through to completion — B's saved options land in the store.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().rawDecodeOptions).toEqual(B_OPTIONS);

    // Now resolve A's stale getSavedEditState call.
    resolveA(stateFor(A_OPTIONS));
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
 * Final whole-branch review of the latency round, important #2: the pre-decode guard above
 * originally discriminated by PATH (`activeLoadPathRef`), not call instance. A→B→A rapid
 * clicks: call 1 (A) suspends on the saved-state read; call 2 (B) and call 3 (A again)
 * complete; call 1 then resumes, sees "A is (again) the active path", passes the guard and
 * re-dispatches `imageService.loadImage(A)` — bumping ImageService's generation and
 * superseding call 3's already-completed load. Final state is coherent (same
 * path/options/savedState), but on a cold RAW this runs a SECOND full decode + preview
 * extraction + notify/reprocess of the same file. Fixed by a monotonic load token
 * (`loadTokenRef`): each call captures its own token and, after every await, only the
 * LATEST call instance proceeds — a newer call for ANY path (same or different)
 * invalidates older in-flight instances.
 */
describe('Canvas.loadImage — A→B→A rapid-switch race (stale call must not re-dispatch)', () => {
  beforeEach(() => {
    useAppStore.setState({ imageDimensions: {} });
    jest.clearAllMocks();
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it('a superseded call resumed AFTER its path became current again bails instead of loading twice', async () => {
    // Call 1 (A) is held open on the saved-state read; calls 2 (B) and 3 (A) resolve immediately.
    let resolveFirstA: (state: unknown) => void = () => {};
    let aStateReads = 0;
    (editPersistenceService.getSavedEditState as jest.Mock).mockImplementation((path: string) => {
      if (path === IMG_A.path && ++aStateReads === 1) {
        return new Promise((resolve) => { resolveFirstA = resolve; });
      }
      return Promise.resolve(null);
    });
    (imageService.loadImage as jest.Mock).mockImplementation(async (path: string, beforeNotify?: (r: unknown) => void) => {
      const decoded = { filePath: path, width: 20, height: 10 };
      (imageService.getCurrentImage as jest.Mock).mockReturnValue(decoded);
      beforeNotify?.(decoded);
    });

    const props = { onFitWindow: () => {}, onActualSize: () => {}, onZoomIn: () => {}, onZoomOut: () => {}, zoom: 1 };
    const { rerender } = render(<Canvas {...props} currentImage={IMG_A} />);

    // Call 1 starts (synchronous prefix) and suspends awaiting A's saved edit state.
    await Promise.resolve();

    // Click B: call 2 runs to completion.
    rerender(<Canvas {...props} currentImage={IMG_B} />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Click A again: call 3 runs to completion — A's decode has been dispatched ONCE.
    rerender(<Canvas {...props} currentImage={IMG_A} />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((imageService.loadImage as jest.Mock).mock.calls.length).toBe(2); // B (call 2) + A (call 3)

    // Call 1 resumes. A path-equality guard would see "A is current again", proceed, and
    // dispatch a SECOND decode of A (superseding call 3's completed load); the monotonic
    // token guard makes the stale instance bail instead.
    resolveFirstA(null);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const paths = (imageService.loadImage as jest.Mock).mock.calls.map((c) => c[0]);
    expect(paths.filter((p) => p === IMG_A.path)).toHaveLength(1); // call 3 only — call 1 never re-dispatches
    expect((imageService.loadImage as jest.Mock).mock.calls.length).toBe(2);
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
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it("writes the decoded width/height under the loaded image's id once loadImage resolves", async () => {
    (imageService.loadImage as jest.Mock).mockImplementation(async (path: string, beforeNotify?: (r: unknown) => void) => {
      const decoded = { filePath: path, width: 4000, height: 3000 };
      (imageService.getCurrentImage as jest.Mock).mockReturnValue(decoded);
      beforeNotify?.(decoded);
    });

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_A} />);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(useAppStore.getState().imageDimensions[IMG_A.id]).toEqual({ width: 4000, height: 3000 });
  });
});

/**
 * L3 review round 1, minor #5: while a progressive RAW open's background full decode is still
 * running, `imageService.loadImage` returns the fast embedded PREVIEW (not the true dims). The
 * post-`await` dims write in Canvas.loadImage must skip recording those preview dims — otherwise
 * they can stick as the gallery/dock tile's dims if the swap never lands — and instead rely on
 * the (already-wired) `onFullDecode` callback to write the TRUE dims once the swap does land.
 */
describe('Canvas.loadImage — progressive-open dims gating (developing window)', () => {
  const IMG_C: ImageFileInfo = {
    id: 'c', name: 'c.orf', path: '/c.orf', size: 100, format: 'orf', type: 'image',
    lastModified: 0, dateModified: new Date(),
  };

  beforeEach(() => {
    useAppStore.setState({ imageDimensions: {}, developing: false });
    jest.clearAllMocks();
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);
  });

  it('skips the post-load dims write while developing; onFullDecode writes the true dims once the swap lands', async () => {
    useAppStore.getState().setDeveloping(true); // the fast preview is on screen; full decode pending

    let fullDecodeCb: ((w: number, h: number) => void) | undefined;
    (imageService.loadImage as jest.Mock).mockImplementation(
      (path: string, beforeNotify?: (r: unknown) => void, onFullDecode?: (w: number, h: number) => void) => {
        fullDecodeCb = onFullDecode;
        const preview = { filePath: path, width: 4, height: 2 }; // preview dims, NOT the true dims
        (imageService.getCurrentImage as jest.Mock).mockReturnValue(preview);
        beforeNotify?.(preview);
        return Promise.resolve(preview);
      },
    );

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_C} />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Still developing when loadImage resolved — the preview's dims must NOT be recorded.
    expect(useAppStore.getState().imageDimensions[IMG_C.id]).toBeUndefined();

    // The background full decode lands: ImageService.developFullDecode fires onFullDecode with
    // the TRUE dims — Canvas's existing (unconditional) wiring for that callback writes them.
    fullDecodeCb?.(8, 4);
    expect(useAppStore.getState().imageDimensions[IMG_C.id]).toEqual({ width: 8, height: 4 });
  });

  it('writes the dims normally (unchanged behavior) when the load is NOT progressive (developing stays false)', async () => {
    (imageService.loadImage as jest.Mock).mockImplementation(async (path: string, beforeNotify?: (r: unknown) => void) => {
      const decoded = { filePath: path, width: 20, height: 10 };
      (imageService.getCurrentImage as jest.Mock).mockReturnValue(decoded);
      beforeNotify?.(decoded);
    });

    render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_C} />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(useAppStore.getState().imageDimensions[IMG_C.id]).toEqual({ width: 20, height: 10 });
  });
});
