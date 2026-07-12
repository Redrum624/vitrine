// src/test/baseImageVersion.test.ts
//
// Regression: a RAW re-decode replaces the base pixels in place at the SAME path
// and SAME dimensions, so the GPU resident-source upload (keyed on path+dims in
// AdjustmentPanel) skipped re-uploading and the canvas showed the stale decode.
// baseImageVersion is the signal that lets that cache know the pixels changed; it
// must bump whenever the working base is replaced via updateCurrentImageData.
import { useAppStore } from '../stores/appStore';
import { imageService } from '../services/ImageService';

describe('baseImageVersion', () => {
  beforeEach(() => {
    useAppStore.setState({ baseImageVersion: 0 });
  });

  it('bumpBaseImageVersion increments the counter', () => {
    expect(useAppStore.getState().baseImageVersion).toBe(0);
    useAppStore.getState().bumpBaseImageVersion();
    useAppStore.getState().bumpBaseImageVersion();
    expect(useAppStore.getState().baseImageVersion).toBe(2);
  });

  it('updateCurrentImageData bumps baseImageVersion so consumers refresh the base', () => {
    // White-box: give the singleton a current image so the guarded update runs.
    (imageService as unknown as { currentImage: unknown }).currentImage = {
      data: new Float32Array(2 * 2 * 4).fill(0.5),
      width: 2,
      height: 2,
      filePath: 'C:/img/test.orf',
    };

    const before = useAppStore.getState().baseImageVersion;
    imageService.updateCurrentImageData(new Float32Array(2 * 2 * 4).fill(0.25), 2, 2);
    expect(useAppStore.getState().baseImageVersion).toBe(before + 1);
  });

  it('does not bump when there is no current image (no base to replace)', () => {
    (imageService as unknown as { currentImage: unknown }).currentImage = null;
    const before = useAppStore.getState().baseImageVersion;
    imageService.updateCurrentImageData(new Float32Array(4), 1, 1);
    expect(useAppStore.getState().baseImageVersion).toBe(before);
  });
});
