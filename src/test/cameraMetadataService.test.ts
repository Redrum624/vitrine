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

type AnyApi = {
  readImageMetadata?: (p: string) => Promise<unknown>;
  readRawMetadata?: (p: string) => Promise<unknown>;
};

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
        LensModel: { description: 'M.Zuiko Digital 17mm F1.8' },
        ExposureTime: { value: [1, 500], description: '1/500' },
        FNumber: { value: [18, 10], description: 'f/1.8' },
        FocalLength: { value: [17, 1], description: '17 mm' },
        DateTimeOriginal: { description: '2025:02:06 20:27:48' }
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
    expect(info!.shutter).toBe('1/500 s');
    expect(info!.aperture).toBeCloseTo(1.8, 5);
    expect(info!.focalLength).toBe(17);
    expect(info!.dateTime).toBe('2025:02:06 20:27:48');
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

  test('returns null when EXIF is empty (a stripped JPG)', async () => {
    const payload = { exif: {}, iptc: {}, xmp: {}, icc: {}, thumbnail: null };
    setApi({ readImageMetadata: jest.fn().mockResolvedValue(payload) });

    const info = await service.getCameraInfo(makeImage('C:/pics/stripped.jpg'));
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

    const img = makeImage('C:/pics/x.jpg');
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

describe('CameraMetadataService.getCameraInfo — RAW routing', () => {
  test('RAW files route to read-raw-metadata and map every field', async () => {
    const rawReader = jest.fn().mockResolvedValue({
      make: 'OLYMPUS CORPORATION',
      model: 'PEN-F',
      iso: 1600,
      exposureTime: 0.002,
      aperture: 1.8,
      focalLength: 17,
      dateTime: '2025:02:06 20:27:48',
      lens: 'OLYMPUS M.17mm F1.8'
    });
    const imgReader = jest.fn();
    setApi({ readRawMetadata: rawReader, readImageMetadata: imgReader });

    const info = await service.getCameraInfo(makeImage('C:/pics/P2060833.ORF'));
    expect(info).toEqual({
      make: 'OLYMPUS CORPORATION',
      model: 'PEN-F',
      iso: 1600,
      lensModel: 'OLYMPUS M.17mm F1.8',
      aperture: 1.8,
      focalLength: 17,
      dateTime: '2025:02:06 20:27:48',
      shutter: '1/500 s'
    });
    // RAW must NOT go through the exifreader (read-image-metadata) path.
    expect(rawReader).toHaveBeenCalledWith('C:/pics/P2060833.ORF');
    expect(imgReader).not.toHaveBeenCalled();
  });

  test('formats slow shutter speeds (>= 1s) as "N s"', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue({ make: 'FUJIFILM', exposureTime: 2 }) });
    const info = await service.getCameraInfo(makeImage('C:/pics/night.raf'));
    expect(info!.shutter).toBe('2 s');
  });

  // Round-9 Q6 LOW: the 0.5-1.0s band used to fall through to the fraction branch and render
  // as a misleading "1/1 s" instead of a decimal.
  test('formats a 0.5-1.0s exposure (0.77s) as a decimal "0.8 s", not "1/1 s"', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue({ make: 'FUJIFILM', exposureTime: 0.77 }) });
    const info = await service.getCameraInfo(makeImage('C:/pics/dusk.raf'));
    expect(info!.shutter).toBe('0.8 s');
  });

  test('formats exactly 0.5s as the decimal "0.5 s" (band boundary)', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue({ make: 'FUJIFILM', exposureTime: 0.5 }) });
    const info = await service.getCameraInfo(makeImage('C:/pics/boundary.raf'));
    expect(info!.shutter).toBe('0.5 s');
  });

  test('a fast fraction shutter (1/500s) is unchanged by the decimal-band fix', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue({ make: 'FUJIFILM', exposureTime: 1 / 500 }) });
    const info = await service.getCameraInfo(makeImage('C:/pics/fast.raf'));
    expect(info!.shutter).toBe('1/500 s');
  });

  test('just below the band (0.49s) still renders as a fraction', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue({ make: 'FUJIFILM', exposureTime: 0.49 }) });
    const info = await service.getCameraInfo(makeImage('C:/pics/below-band.raf'));
    expect(info!.shutter).toBe('1/2 s');
  });

  test('returns null when the readRawMetadata bridge is unavailable', async () => {
    setApi({ readImageMetadata: jest.fn() });
    const info = await service.getCameraInfo(makeImage('C:/pics/x.nef'));
    expect(info).toBeNull();
  });

  test('returns null when read-raw-metadata resolves null (no EXIF found)', async () => {
    setApi({ readRawMetadata: jest.fn().mockResolvedValue(null) });
    const info = await service.getCameraInfo(makeImage('C:/pics/x.cr2'));
    expect(info).toBeNull();
  });

  test('caches the RAW result (read-raw-metadata called once for two lookups)', async () => {
    const rawReader = jest.fn().mockResolvedValue({ make: 'SONY', model: 'ILCE-7M3', iso: 3200 });
    setApi({ readRawMetadata: rawReader });
    const img = makeImage('C:/pics/a7.arw');
    await service.getCameraInfo(img);
    await service.getCameraInfo(img);
    expect(rawReader).toHaveBeenCalledTimes(1);
  });
});
