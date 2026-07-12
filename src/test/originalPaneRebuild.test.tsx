/**
 * L3 review round 1, minor #6: OriginalPane (App.tsx) built its offscreen Before/After snapshot
 * once per mount ([] deps) — the parent only re-keys it on an image SWITCH (key={currentImage?.id}),
 * so if the base is swapped in place while the split stays open (a progressive RAW open's
 * background full-decode swap, or a RAW Decode re-decode), Before kept showing the stale
 * (e.g. graded preview) base forever. Fix: rebuild whenever `baseImageVersion` bumps — the store
 * bumps it on every ImageService.updateCurrentImageData call.
 */
import { render, act } from '@testing-library/react';
import { OriginalPane } from '../App';
import { imageService } from '../services/ImageService';
import { useAppStore } from '../stores/appStore';

describe('OriginalPane — rebuilds the offscreen snapshot when the base image swaps', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-reads getOriginalImage() when baseImageVersion bumps', () => {
    const getOriginal = jest
      .spyOn(imageService, 'getOriginalImage')
      .mockReturnValue({ data: new Float32Array([0.5, 0.5, 0.5, 1]), width: 1, height: 1 });

    render(<OriginalPane />);
    expect(getOriginal).toHaveBeenCalledTimes(1);

    // Simulate the background full-decode swap (or a RAW re-decode) bumping the version.
    act(() => {
      useAppStore.getState().bumpBaseImageVersion();
    });

    expect(getOriginal).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild on unrelated store changes (viewport/mainCanvasFit only)', () => {
    const getOriginal = jest
      .spyOn(imageService, 'getOriginalImage')
      .mockReturnValue({ data: new Float32Array([0.5, 0.5, 0.5, 1]), width: 1, height: 1 });

    render(<OriginalPane />);
    expect(getOriginal).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().setViewport({ zoom: 2, panX: 0, panY: 0 });
    });

    // Viewport changes redraw from the cached offscreen canvas; they must not re-trigger the
    // (expensive) float32→uint8 rebuild.
    expect(getOriginal).toHaveBeenCalledTimes(1);
  });

  // Bug: in Before/After the "before" sometimes showed a DIFFERENT photo from the same folder.
  // Cause: a fresh open (plain/JPEG/cache) records the new original via deferOriginalSnapshot but
  // does NOT bump baseImageVersion (only the in-place RAW swap does), so the pane never re-read
  // and kept the previous image's original. Fix: bump a dedicated originalSnapshotVersion whenever
  // a new original is recorded, and fold it into the pane's rebuild deps.
  it('re-reads getOriginalImage() when originalSnapshotVersion bumps (fresh open of another image)', () => {
    const getOriginal = jest
      .spyOn(imageService, 'getOriginalImage')
      .mockReturnValue({ data: new Float32Array([0.5, 0.5, 0.5, 1]), width: 1, height: 1 });

    render(<OriginalPane />);
    expect(getOriginal).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().bumpOriginalSnapshotVersion();
    });

    expect(getOriginal).toHaveBeenCalledTimes(2);
  });

  it('imageService.setOriginalImage bumps originalSnapshotVersion so the Before pane refreshes', () => {
    const before = useAppStore.getState().originalSnapshotVersion;
    imageService.setOriginalImage(new Float32Array([0, 0, 0, 1]), 1, 1);
    expect(useAppStore.getState().originalSnapshotVersion).toBe(before + 1);
  });
});
