import { useAppStore } from '../stores/appStore';
import { editPersistenceService } from '../services/EditPersistenceService';
import { rawImageService } from '../services/RawImageService';
import { imageService } from '../services/ImageService';
import { checkpointService } from '../services/CheckpointService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageCacheService } from '../services/ImageCacheService';
import { DEFAULT_RAW_DECODE_OPTIONS, RawDecodeOptions } from '../types/electron';
import { saveRawDecodeDefaults } from '../utils/rawDecodeDefaultsStorage';
import type { ImageData as ServiceImageData } from '../services/ImageService';

const AHD_RECON: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'reconstruct' };

describe('RAW decode options — store', () => {
  afterEach(() => {
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
    useAppStore.getState().setReDecoding(false);
  });

  it('defaults to DEFAULT_RAW_DECODE_OPTIONS and reDecoding=false', () => {
    const s = useAppStore.getState();
    expect(s.rawDecodeOptions).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
    expect(s.reDecoding).toBe(false);
  });

  it('setters update state', () => {
    useAppStore.getState().setRawDecodeOptions(AHD_RECON);
    expect(useAppStore.getState().rawDecodeOptions).toEqual(AHD_RECON);
    useAppStore.getState().setReDecoding(true);
    expect(useAppStore.getState().reDecoding).toBe(true);
  });
});

describe('RAW decode options — persistence round-trip', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      storeGet: jest.fn(),
      storeSet: jest.fn(),
    };
  });
  afterEach(() => {
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
    jest.clearAllMocks();
  });

  it('serialize() embeds the current store rawDecodeOptions', () => {
    useAppStore.getState().setRawDecodeOptions({ demosaic: 'ahd', highlightMode: 'off' });
    const state = editPersistenceService.serialize();
    expect(state.rawDecodeOptions).toEqual({ demosaic: 'ahd', highlightMode: 'off' });
  });

  it('getSavedRawDecodeOptions reads persisted options back for a path', async () => {
    (window as unknown as { electronAPI: { storeGet: jest.Mock } }).electronAPI.storeGet.mockResolvedValue({
      version: 1,
      modules: {},
      rawDecodeOptions: AHD_RECON,
    });
    const got = await editPersistenceService.getSavedRawDecodeOptions('/photo.orf');
    expect(got).toEqual(AHD_RECON);
  });

  it('getSavedRawDecodeOptions returns null when nothing is saved (caller uses defaults)', async () => {
    (window as unknown as { electronAPI: { storeGet: jest.Mock } }).electronAPI.storeGet.mockResolvedValue(null);
    expect(await editPersistenceService.getSavedRawDecodeOptions('/photo.orf')).toBeNull();
  });
});

describe('RawImageService.reDecode', () => {
  const makeRaw = (over: Partial<ServiceImageData> = {}): ServiceImageData => ({
    width: 4,
    height: 2,
    data: new Float32Array(4 * 2 * 4),
    fileName: 'photo.orf',
    filePath: '/photo.orf',
    isRaw: true,
    ...over,
  });

  beforeEach(() => {
    checkpointService.clear();
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
    useAppStore.getState().setReDecoding(false);
    const px = new Uint16Array(4 * 2 * 3).fill(32768); // 3ch 16-bit native decode payload
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      decodeRawFile: jest.fn().mockImplementation(async () => {
        // The re-decoding flag must be raised for the whole IPC round-trip.
        expect(useAppStore.getState().reDecoding).toBe(true);
        return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
      }),
      storeGet: jest.fn(),
      storeSet: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
    useAppStore.getState().setReDecoding(false);
  });

  const api = () => (window as unknown as { electronAPI: { decodeRawFile: jest.Mock } }).electronAPI;

  it('re-decodes the RAW base, replaces the image, applies+persists options, reprocesses, clears flag', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(makeRaw());
    const upd = jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    const setOrig = jest.spyOn(imageService, 'setOriginalImage').mockImplementation(() => {});
    const save = jest.spyOn(editPersistenceService, 'scheduleSave').mockImplementation(() => {});
    const clearCache = jest.spyOn(imageProcessingPipeline, 'clearCache');

    const v0 = useAppStore.getState().processingVersion;
    const cp0 = checkpointService.getCheckpoints().length;

    await rawImageService.reDecode(AHD_RECON);

    expect(api().decodeRawFile).toHaveBeenCalledWith('/photo.orf', AHD_RECON);
    expect(upd).toHaveBeenCalledWith(expect.any(Float32Array), 4, 2);
    expect(setOrig).toHaveBeenCalledWith(expect.any(Float32Array), 4, 2);
    expect(clearCache).toHaveBeenCalled();
    expect(useAppStore.getState().rawDecodeOptions).toEqual(AHD_RECON);
    expect(save).toHaveBeenCalled();
    expect(useAppStore.getState().processingVersion).toBe(v0 + 1);
    expect(useAppStore.getState().reDecoding).toBe(false);
    // History integrity: a re-decode does NOT push a checkpoint (decode options are a
    // property of the base image, orthogonal to the module-edit timeline).
    expect(checkpointService.getCheckpoints().length).toBe(cp0);
  });

  it('clears the reDecoding flag even if the decode fails', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(makeRaw());
    jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    // Force the whole loadRawImage fallback chain to fail.
    api().decodeRawFile.mockRejectedValue(new Error('decode boom'));
    jest.spyOn(rawImageService, 'loadRawImage').mockRejectedValue(new Error('all paths failed'));

    await expect(rawImageService.reDecode(AHD_RECON)).rejects.toThrow();
    expect(useAppStore.getState().reDecoding).toBe(false);
  });

  it('no-ops for a non-RAW current image', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(makeRaw({ isRaw: false, filePath: '/a.jpg' }));
    await rawImageService.reDecode(AHD_RECON);
    expect(api().decodeRawFile).not.toHaveBeenCalled();
  });

  it('no-ops when no image is loaded', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(null);
    await rawImageService.reDecode(AHD_RECON);
    expect(api().decodeRawFile).not.toHaveBeenCalled();
  });

  it('bails out without mutating the newly-selected image when the user switches mid-decode', async () => {
    const original = makeRaw();
    const switched = makeRaw({ fileName: 'other.orf', filePath: '/other.orf' });
    let liveImage: ServiceImageData | null = original;
    jest.spyOn(imageService, 'getCurrentImage').mockImplementation(() => liveImage);
    const upd = jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    const setOrig = jest.spyOn(imageService, 'setOriginalImage').mockImplementation(() => {});
    const save = jest.spyOn(editPersistenceService, 'scheduleSave').mockImplementation(() => {});
    const cacheSet = jest.spyOn(imageCacheService, 'setBase');
    const clearCache = jest.spyOn(imageProcessingPipeline, 'clearCache');

    api().decodeRawFile.mockImplementation(async () => {
      // Simulate the user switching to a different image while this native decode IPC call
      // is still in flight (before it resolves back into RawImageService.reDecode).
      liveImage = switched;
      const px = new Uint16Array(4 * 2 * 3).fill(32768);
      return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
    });

    await rawImageService.reDecode(AHD_RECON);

    // The base-cache write must NOT happen either: it is gated by the same identity check as
    // the store options/persistence. If it ran unconditionally, the cache would hold the new
    // (Y-options) pixels for '/photo.orf' while the persisted options for that path stayed at
    // the old (X) value — a silent mismatch discovered only on a later reopen of '/photo.orf'.
    expect(cacheSet).not.toHaveBeenCalled();

    // Nothing about the newly-selected image (now the one on screen) is touched.
    expect(upd).not.toHaveBeenCalled();
    expect(setOrig).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
    expect(useAppStore.getState().rawDecodeOptions).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
    expect(useAppStore.getState().reDecoding).toBe(false);
  });

  it('writes the gallery/dock tile dims for the given imageId (L3 review round 1, minor #5)', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(makeRaw());
    jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    jest.spyOn(imageService, 'setOriginalImage').mockImplementation(() => {});
    jest.spyOn(editPersistenceService, 'scheduleSave').mockImplementation(() => {});
    useAppStore.setState({ imageDimensions: {} });

    await rawImageService.reDecode(AHD_RECON, 'tile-id-1');

    // reDecode always knows the true dims it just produced — write them under the caller's id.
    // This is what closes the gap when a re-decode supersedes a still-in-flight progressive RAW
    // open: developFullDecode's decode-options guard bails BEFORE calling onFullDecode, so
    // Canvas never gets a chance to write the tile's dims for that swap.
    expect(useAppStore.getState().imageDimensions['tile-id-1']).toEqual({ width: 4, height: 2 });
  });

  it('is a no-op on imageDimensions when no imageId is passed (backward compatible)', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(makeRaw());
    jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    jest.spyOn(imageService, 'setOriginalImage').mockImplementation(() => {});
    jest.spyOn(editPersistenceService, 'scheduleSave').mockImplementation(() => {});
    useAppStore.setState({ imageDimensions: {} });

    await rawImageService.reDecode(AHD_RECON);

    expect(useAppStore.getState().imageDimensions).toEqual({});
  });
});

describe('ImageService.decodeForExport — per-file RAW decode options', () => {
  const px = new Uint16Array(4 * 2 * 3).fill(32768); // 3ch 16-bit native decode payload

  beforeEach(() => {
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      decodeRawFile: jest.fn().mockImplementation(async () => ({
        data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16,
      })),
      storeGet: jest.fn(),
      storeSet: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  });

  const api = () => (window as unknown as { electronAPI: { decodeRawFile: jest.Mock } }).electronAPI;

  it('uses the store options when exporting the CURRENT image', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue({
      width: 4, height: 2, data: new Float32Array(4 * 2 * 4),
      fileName: 'photo.orf', filePath: '/photo.orf', isRaw: true,
    });
    useAppStore.getState().setRawDecodeOptions(AHD_RECON);
    const getSaved = jest.spyOn(editPersistenceService, 'getSavedRawDecodeOptions');

    await imageService.decodeForExport('/photo.orf');

    expect(api().decodeRawFile).toHaveBeenCalledWith('/photo.orf', AHD_RECON);
    expect(getSaved).not.toHaveBeenCalled();
  });

  it('uses the persisted per-image options when exporting a NON-current file', async () => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue({
      width: 4, height: 2, data: new Float32Array(4 * 2 * 4),
      fileName: 'photo.orf', filePath: '/photo.orf', isRaw: true,
    });
    jest.spyOn(editPersistenceService, 'getSavedRawDecodeOptions').mockResolvedValue(AHD_RECON);

    await imageService.decodeForExport('/other.orf');

    expect(api().decodeRawFile).toHaveBeenCalledWith('/other.orf', AHD_RECON);
  });

  it('falls back to the USER decode defaults for a non-current file with nothing persisted', async () => {
    // v1.31.0: the fallback is the user's saved decode defaults (main-process
    // durable store), not the factory constants. Wire the storeGet/storeSet
    // mocks to a real in-memory map so a save round-trips.
    const mem: Record<string, unknown> = {};
    const eapi = (window as unknown as { electronAPI: Record<string, jest.Mock> }).electronAPI;
    eapi.storeGet = jest.fn(async (k: string) => (k in mem ? mem[k] : null));
    eapi.storeSet = jest.fn(async (k: string, v: unknown) => { mem[k] = v; return true; });
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(null);
    jest.spyOn(editPersistenceService, 'getSavedRawDecodeOptions').mockResolvedValue(null);

    await imageService.decodeForExport('/other.orf');
    expect(api().decodeRawFile).toHaveBeenCalledWith('/other.orf', DEFAULT_RAW_DECODE_OPTIONS);

    saveRawDecodeDefaults(AHD_RECON);
    await Promise.resolve(); // fire-and-forget storeSet lands
    await imageService.decodeForExport('/other.orf');
    expect(api().decodeRawFile).toHaveBeenLastCalledWith(
      '/other.orf',
      { ...AHD_RECON, cameraMatch: !!AHD_RECON.cameraMatch },
    );
  });
});
