import { imageService } from '../services/ImageService';

describe('ImageService - Baked Upscale Marker', () => {
  afterEach(() => {
    imageService.clearBakedUpscale();
  });

  test('isBakedUpscaleActive returns false by default', () => {
    expect(imageService.isBakedUpscaleActive()).toBe(false);
  });

  test('getBakedUpscale returns null by default', () => {
    expect(imageService.getBakedUpscale()).toBeNull();
  });

  test('setBakedUpscale sets the marker and isBakedUpscaleActive returns true', () => {
    const info = { scale: 2, nativeWidth: 4, nativeHeight: 4 };
    imageService.setBakedUpscale(info);

    expect(imageService.isBakedUpscaleActive()).toBe(true);
    expect(imageService.getBakedUpscale()).toEqual(info);
  });

  test('clearBakedUpscale clears the marker and isBakedUpscaleActive returns false', () => {
    const info = { scale: 2, nativeWidth: 4, nativeHeight: 4 };
    imageService.setBakedUpscale(info);
    expect(imageService.isBakedUpscaleActive()).toBe(true);

    imageService.clearBakedUpscale();

    expect(imageService.isBakedUpscaleActive()).toBe(false);
    expect(imageService.getBakedUpscale()).toBeNull();
  });

  test('different scale/dimension values are correctly stored and retrieved', () => {
    const info = { scale: 4, nativeWidth: 1920, nativeHeight: 1080 };
    imageService.setBakedUpscale(info);

    expect(imageService.getBakedUpscale()).toEqual(info);
  });

  test('clearImage() also clears the baked marker (no stale marker without an image)', () => {
    imageService.setBakedUpscale({ scale: 2, nativeWidth: 4, nativeHeight: 4 });
    expect(imageService.isBakedUpscaleActive()).toBe(true);
    imageService.clearImage();
    expect(imageService.isBakedUpscaleActive()).toBe(false);
  });
});

