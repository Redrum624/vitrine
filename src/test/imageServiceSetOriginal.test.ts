import { imageService } from '../services/ImageService';

describe('ImageService.setOriginalImage', () => {
  it('overwrites the original snapshot returned by getOriginalImage', () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 1]);
    imageService.setOriginalImage(data, 1, 1);
    const orig = imageService.getOriginalImage();
    expect(orig).not.toBeNull();
    expect(orig!.width).toBe(1);
    expect(orig!.height).toBe(1);
    expect(orig!.data[0]).toBeCloseTo(0.1);
  });
});
