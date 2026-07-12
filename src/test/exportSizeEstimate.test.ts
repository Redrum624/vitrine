import { estimateBytesPerPixel, estimateExportSizeBytes } from '../utils/exportSizeEstimate';

/**
 * Expectations are the EMPIRICAL calibration points measured against the app's
 * real encode path (sharp 0.34.5 with the exact electron/imageWriter.cjs
 * options). The lossy curves (JPEG/WebP/TIFF-jpeg) are the MIDPOINT of a
 * smooth already-JPEG reference and a genuinely detailed RAW-decoded
 * reference — see the table in exportSizeEstimate.ts. The interpolator must
 * pass exactly through the measured grid points, and flat-clamp outside them.
 * 24 unit tests total in this file.
 */
describe('exportSizeEstimate — calibrated bytes/pixel model', () => {
  describe('JPEG (mozjpeg)', () => {
    it.each([
      [60, 0.0243],
      [75, 0.0389],
      [85, 0.0650],
      [90, 0.0976],
      [95, 0.1650],
      [100, 0.4999],
    ])('q%i hits the measured %f B/px', (quality, bpp) => {
      expect(estimateBytesPerPixel({ format: 'jpeg', quality })).toBeCloseTo(bpp, 4);
    });

    it('interpolates linearly between grid points (q80 = midpoint of q75/q85)', () => {
      expect(estimateBytesPerPixel({ format: 'jpeg', quality: 80 })).toBeCloseTo((0.0389 + 0.0650) / 2, 4);
    });

    it('no longer produces the old 3x overestimate (q90 was 1.35 B/px)', () => {
      expect(estimateBytesPerPixel({ format: 'jpeg', quality: 90 })).toBeLessThan(0.2);
    });

    it('flat-clamps below the lowest measured grid point instead of extrapolating to a guessed anchor', () => {
      const lowest = estimateBytesPerPixel({ format: 'jpeg', quality: 60 });
      expect(estimateBytesPerPixel({ format: 'jpeg', quality: 1 })).toBeCloseTo(lowest, 6);
    });
  });

  describe('PNG (compressionLevel 6)', () => {
    it('8-bit uses the measured constant', () => {
      expect(estimateBytesPerPixel({ format: 'png', bitDepth: 8 })).toBeCloseTo(1.65, 2);
    });
    it('16-bit uses the measured midpoint constant', () => {
      expect(estimateBytesPerPixel({ format: 'png', bitDepth: 16 })).toBeCloseTo(2.72, 2);
    });
  });

  describe('WebP', () => {
    it.each([
      [75, 0.0222],
      [90, 0.0892],
      [100, 0.2727],
    ])('q%i hits the measured %f B/px', (quality, bpp) => {
      expect(estimateBytesPerPixel({ format: 'webp', quality })).toBeCloseTo(bpp, 4);
    });
    it('lossless uses the measured constant', () => {
      expect(estimateBytesPerPixel({ format: 'webp', quality: 90, lossless: true })).toBeCloseTo(0.91, 2);
    });
    it('flat-clamps below the lowest measured grid point instead of extrapolating to a guessed anchor', () => {
      const lowest = estimateBytesPerPixel({ format: 'webp', quality: 75 });
      expect(estimateBytesPerPixel({ format: 'webp', quality: 1 })).toBeCloseTo(lowest, 6);
    });
  });

  describe('TIFF', () => {
    it('uncompressed is exact: RGBA x bytes/sample', () => {
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'none', bitDepth: 8 })).toBeCloseTo(4.0, 3);
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'none', bitDepth: 16 })).toBeCloseTo(8.0, 3);
    });
    it('lzw uses the measured constants', () => {
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'lzw', bitDepth: 8 })).toBeCloseTo(1.54, 2);
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'lzw', bitDepth: 16 })).toBeCloseTo(4.98, 2);
    });
    it('zip (deflate) uses the measured constants', () => {
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'zip', bitDepth: 8 })).toBeCloseTo(1.45, 2);
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'zip', bitDepth: 16 })).toBeCloseTo(3.98, 2);
    });
    it('jpeg-in-tiff follows its own measured curve (libjpeg, not mozjpeg)', () => {
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'jpeg', quality: 90 })).toBeCloseTo(0.2921, 4);
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'jpeg', quality: 100 })).toBeCloseTo(1.2325, 4);
    });
    it('jpeg-in-tiff flat-clamps below the lowest measured grid point instead of extrapolating to a guessed anchor', () => {
      const lowest = estimateBytesPerPixel({ format: 'tiff', compression: 'jpeg', quality: 60 });
      expect(estimateBytesPerPixel({ format: 'tiff', compression: 'jpeg', quality: 1 })).toBeCloseTo(lowest, 6);
    });
  });

  describe('estimateExportSizeBytes', () => {
    it('scales bytes/pixel by the pixel count', () => {
      const pixels = 6000 * 4000; // 24 MP
      const bytes = estimateExportSizeBytes(pixels, { format: 'jpeg', quality: 90 });
      expect(bytes).toBeCloseTo(pixels * 0.0976, 0);
      // The old (uncalibrated) model said ~32 MB for a 24MP q90 JPEG; the calibrated one ~2.3 MB.
      expect(bytes).toBeLessThan(5 * 1024 * 1024);
    });

    it('clamps quality into 1..100 instead of extrapolating wildly', () => {
      const at100 = estimateBytesPerPixel({ format: 'jpeg', quality: 100 });
      expect(estimateBytesPerPixel({ format: 'jpeg', quality: 250 })).toBeCloseTo(at100, 6);
      const at1 = estimateBytesPerPixel({ format: 'jpeg', quality: 1 });
      expect(estimateBytesPerPixel({ format: 'jpeg', quality: -5 })).toBeCloseTo(at1, 6);
    });

    it('defaults match the writer defaults (quality 90, 8-bit, tiff lzw)', () => {
      expect(estimateBytesPerPixel({ format: 'jpeg' })).toBeCloseTo(0.0976, 4);
      expect(estimateBytesPerPixel({ format: 'png' })).toBeCloseTo(1.65, 2);
      expect(estimateBytesPerPixel({ format: 'tiff' })).toBeCloseTo(1.54, 2);
    });
  });
});
