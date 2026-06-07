/**
 * Unit tests for OutputCollectionService.exportCollection real-file export.
 *
 * The collection export used to call a private simulateImageExport stub that
 * fabricated a 2MB-per-image totalSize and a `${destination}/${name}` path.
 * It now performs a real per-image export by loading source pixels via
 * imageService.decodeForExport (a non-mutating decode that does NOT touch the
 * live editor singleton — using the mutating loadImage here clobbered the open
 * image and fired image-loaded listeners per image) and encoding via
 * exportService.exportImage. These tests mock both singletons and pin the real
 * wiring: the right call shape, the real totalSize/outputPath propagation,
 * per-image error handling, and the honest "exported from source" warning.
 */
import { OutputCollectionService } from '../services/OutputCollectionService';
import { imageService } from '../services/ImageService';
import { exportService } from '../services/ExportService';

// Mock the two singletons the service now delegates to. The factory must not
// reference out-of-scope variables (jest hoisting), so the mock fns are read
// back from the imported (mocked) modules below.
jest.mock('../services/ImageService', () => ({
  imageService: {
    decodeForExport: jest.fn()
  }
}));

jest.mock('../services/ExportService', () => ({
  exportService: {
    exportImage: jest.fn()
  }
}));

const decodeForExport = imageService.decodeForExport as jest.Mock;
const exportImage = exportService.exportImage as jest.Mock;

// Fresh service instance per test (the singleton getInstance caches one map,
// so we use the class directly with a private-constructor cast to isolate).
function makeService(): OutputCollectionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (OutputCollectionService as any)();
}

beforeEach(() => {
  decodeForExport.mockReset();
  exportImage.mockReset();
});

describe('OutputCollectionService.exportCollection', () => {
  test('exports each image for real (decodeForExport + exportImage) and propagates size/path', async () => {
    const data = new Float32Array(4 * 4 * 4).fill(0.5);
    decodeForExport.mockResolvedValue({ width: 4, height: 4, data });
    exportImage.mockResolvedValue({
      success: true,
      outputPath: 'C:/out/a.jpg',
      outputSize: 12345
    });

    const service = makeService();
    const collectionId = service.createCollection('Test', '', 'project');
    const imageId = service.addImageToCollection(collectionId, 'C:/in/a.orf', 'a');

    const record = await service.exportCollection(collectionId, 'C:/out', {});

    // The non-mutating decodeForExport is fed the source path, not the display
    // name. Critically, the mutating loadImage is NOT used (cp-1): the batch
    // export must not clobber the live editor singleton.
    expect(decodeForExport).toHaveBeenCalledTimes(1);
    expect(decodeForExport).toHaveBeenCalledWith('C:/in/a.orf');
    expect(
      (imageService as unknown as { loadImage?: unknown }).loadImage
    ).toBeUndefined();

    // exportImage gets the decoded pixels, dims, settings carrying the chosen
    // outputDirectory, and the original path so the writer derives the name.
    expect(exportImage).toHaveBeenCalledTimes(1);
    expect(exportImage).toHaveBeenCalledWith(
      data,
      4,
      4,
      expect.objectContaining({ outputDirectory: 'C:/out' }),
      'C:/in/a.orf'
    );

    // Real size/path, not the old 2MB fabrication or `${destination}/${name}`.
    expect(record.totalSize).toBe(12345);
    expect(record.imageCount).toBe(1);
    expect(record.success).toBe(true);

    // cp-2: a successful export from unedited source pixels must disclose that
    // the editor adjustments were not applied, rather than implying an edited
    // deliverable.
    expect(record.warnings).toEqual([
      'Exported from source — editor adjustments not applied'
    ]);

    const updated = service.getCollection(collectionId)!;
    const img = updated.images.find((i) => i.id === imageId)!;
    expect(img.status).toBe('completed');
    expect(img.exportPath).toBe('C:/out/a.jpg');
    expect(img.fileSize).toBe(12345);
  });

  test('records a failed export without aborting the batch', async () => {
    decodeForExport.mockResolvedValue({
      width: 2,
      height: 2,
      data: new Float32Array(2 * 2 * 4)
    });
    exportImage.mockResolvedValue({ success: false, error: 'boom' });

    const service = makeService();
    const collectionId = service.createCollection('Test', '', 'project');
    const imageId = service.addImageToCollection(collectionId, 'C:/in/b.jpg', 'b');

    const record = await service.exportCollection(collectionId, 'C:/out', {});

    expect(record.success).toBe(false);
    expect(record.imageCount).toBe(0);
    expect(record.error).toContain('boom');
    // No image succeeded, so there is nothing to disclose.
    expect(record.warnings).toBeUndefined();

    const img = service.getCollection(collectionId)!.images.find((i) => i.id === imageId)!;
    expect(img.status).toBe('error');
  });

  test('no longer exposes the simulateImageExport stub', () => {
    const service = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).simulateImageExport).toBeUndefined();
  });
});
