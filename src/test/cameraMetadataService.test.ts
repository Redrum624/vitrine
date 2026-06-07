/**
 * Unit tests for CameraMetadataService.getCameraInfo.
 *
 * Covers the renderer-side mapping from exifreader's expanded EXIF tag shapes
 * (returned by the read-image-metadata IPC) onto a CameraInfo {make,model,iso,
 * lensModel}. The IPC is mocked here; only the pure mapping + caching logic is
 * exercised. This is the shared accessor that replaces the hardcoded camera
 * mocks ("Olympus OM-D" / "Canon EOS R5 ISO800") in the RAW and noise modules.
 */
import { CameraMetadataService } from '../services/CameraMetadataService';
import type { ImageFile } from '../types';

type AnyApi = { readImageMetadata?: (p: string) => Promise<unknown> };

function setApi(api: AnyApi | undefined): void {
  (window as unknown as { electronAPI?: AnyApi }).electronAPI = api;
}

function makeImage(path: string): ImageFile {
  return {
    id: path,
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    thumbnail: '',
    metadata: {
      width: 100,
      height: 100,
      size: 0,
      format: 'jpg',
      dateCreated: new Date()
    }
  };
}

let service: CameraMetadataService;

beforeEach(() => {
  // Fresh instance per test so the per-path cache does not leak between cases.
  // (CameraMetadataService is also a singleton via getInstance, but the tests
  //  construct directly to isolate the cache.)
  service = new (CameraMetadataService as unknown as { new (): CameraMetadataService })();
});

afterEach(() => {
  setApi(undefined);
});

describe('CameraMetadataService.getCameraInfo', () => {
  test('maps real EXIF make/model/iso/lens and trims trailing whitespace', async () => {
    // Mirrors the real test/P2060833.JPG shape: trailing-padded strings, numeric ISO.
    const payload = {
      exif: {
        Make: { description: 'OLYMPUS CORPORATION    ' },
        Model: { description: 'PEN-F           ' },
        ISOSpeedRatings: { value: 1600, description: '1600' },
        LensModel: { description: 'M.Zuiko Digital 17mm F1.8' }
      },
      iptc: {},
      xmp: {},
      icc: {},
      thumbnail: null
    };
    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const info = await service.getCameraInfo(makeImage('C:/pics/penf.jpg'));
    expect(info).not.toBeNull();
    expect(info!.make).toBe('OLYMPUS CORPORATION');
    expect(info!.model).toBe('PEN-F');
    expect(info!.iso).toBe(1600);
    expect(info!.lensModel).toBe('M.Zuiko Digital 17mm F1.8');
  });

  test('reads ISO from a single-element array value', async () => {
    const payload = {
      exif: {
        Make: { description: 'SONY' },
        Model: { description: 'ILCE-7M3' },
        ISOSpeedRatings: { value: [3200] }
      },
      iptc: {},
      xmp: {},
      icc: {},
      thumbnail: null
    };
    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const info = await service.getCameraInfo(makeImage('C:/pics/a7.jpg'));
    expect(info).toEqual({ make: 'SONY', model: 'ILCE-7M3', iso: 3200 });
  });

  test('returns null when EXIF is empty (the RAW/ORF case)', async () => {
    const payload = { exif: {}, iptc: {}, xmp: {}, icc: {}, thumbnail: null };
    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const info = await service.getCameraInfo(makeImage('C:/pics/raw.orf'));
    expect(info).toBeNull();
  });

  test('caches per path (readImageMetadata called once for two lookups)', async () => {
    const reader = jest.fn().mockResolvedValue({
      exif: { Make: { description: 'Nikon' }, Model: { description: 'Z6' } },
      iptc: {},
      xmp: {},
      icc: {},
      thumbnail: null
    });
    setApi({ readImageMetadata: reader });

    const img = makeImage('C:/pics/z6.jpg');
    const first = await service.getCameraInfo(img);
    const second = await service.getCameraInfo(img);

    expect(first).toEqual({ make: 'Nikon', model: 'Z6' });
    expect(second).toEqual(first);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  test('caches null results too (no repeated IPC for a RAW miss)', async () => {
    const reader = jest.fn().mockResolvedValue({ exif: {}, iptc: {}, xmp: {}, icc: {}, thumbnail: null });
    setApi({ readImageMetadata: reader });

    const img = makeImage('C:/pics/x.orf');
    expect(await service.getCameraInfo(img)).toBeNull();
    expect(await service.getCameraInfo(img)).toBeNull();
    expect(reader).toHaveBeenCalledTimes(1);
  });

  test('returns null for a null image', async () => {
    setApi({ readImageMetadata: jest.fn() });
    expect(await service.getCameraInfo(null)).toBeNull();
  });

  test('returns null when the IPC read rejects', async () => {
    setApi({ readImageMetadata: jest.fn().mockRejectedValue(new Error('boom')) });
    const info = await service.getCameraInfo(makeImage('C:/pics/broken.jpg'));
    expect(info).toBeNull();
  });

  test('returns null when the readImageMetadata bridge is unavailable', async () => {
    setApi({});
    const info = await service.getCameraInfo(makeImage('C:/pics/x.jpg'));
    expect(info).toBeNull();
  });
});
