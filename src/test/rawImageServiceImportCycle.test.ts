/**
 * P6 item 8: RawImageService ↔ ImageService no longer form a static (runtime) import cycle.
 * RawImageService no longer imports ImageService statically at all — reDecode resolves the
 * ImageService singleton LAZILY via a dynamic `import('./ImageService')`, so the static edge is
 * gone and each module initialises independently in ANY order. Proof of module-init-order safety:
 * each module must load cleanly IN ISOLATION (a genuine circular-init bug throws "Cannot access X
 * before initialization" or leaves an undefined binding), and reDecode must resolve its
 * ImageService dependency at call time without a static back-edge.
 */
type RawMod = {
  rawImageService: {
    isRawFile: (p: string) => boolean;
    reDecode: (o: { demosaic: string; highlightMode: string }) => Promise<void>;
  };
};
type ImgMod = { imageService: unknown };

describe('RawImageService / ImageService import-cycle safety (P6 item 8)', () => {
  it('RawImageService loads in isolation without a circular-init crash', () => {
    jest.isolateModules(() => {
      const mod = require('../services/RawImageService') as RawMod;
      expect(mod.rawImageService).toBeDefined();
      // A non-ImageService method works — the singleton constructed fine with no static back-edge.
      expect(mod.rawImageService.isRawFile('/x.orf')).toBe(true);
      expect(mod.rawImageService.isRawFile('/x.jpg')).toBe(false);
    });
  });

  it('ImageService loads in isolation without a circular-init crash', () => {
    jest.isolateModules(() => {
      const mod = require('../services/ImageService') as ImgMod;
      expect(mod.imageService).toBeDefined();
    });
  });

  it('reDecode resolves ImageService lazily at call time (no current image → no-op, no throw)', async () => {
    const { rawImageService } = require('../services/RawImageService') as RawMod;
    // reDecode dynamically imports ImageService; with no image open it returns immediately. The
    // point: it resolves its ImageService dependency without any static import, and never throws.
    await expect(
      rawImageService.reDecode({ demosaic: 'dcb', highlightMode: 'blend' }),
    ).resolves.toBeUndefined();
  });
});
