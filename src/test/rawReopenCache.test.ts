/**
 * Regression + feature test for Task C1: the RAW base-image cache must actually SERVE reopens.
 *
 * Before this fix, ImageService.loadImage looked up `imageCacheService.get(path, 0, 0)` while
 * every write stored under the REAL W×H, so the keys never matched — the cache was write-only
 * and every RAW open/reopen ran a full (multi-second) LibRaw decode. These tests drive the real
 * ImageService + RawImageService + ImageCacheService and count the decode IPC (the seam that
 * does the expensive work) to prove a reopen is served from the session base cache.
 *
 * Coherence proof (in-session): a RAW re-decode with new options OVERWRITES the same base key,
 * so a subsequent reopen serves the NEW pixels — never stale ones (test b). The cache is
 * memory-only, so there is no cross-session divergence to worry about.
 */
import { imageService } from '../services/ImageService';
import { rawImageService } from '../services/RawImageService';
import { imageCacheService } from '../services/ImageCacheService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS, RawDecodeOptions } from '../types/electron';

const AHD_RECON: RawDecodeOptions = { demosaic: 'ahd', highlightMode: 'reconstruct' };

// A native-decode IPC payload: 4×2, 3-channel, 16-bit. `fill` lets each test produce a
// distinguishable pixel value so we can assert WHICH decode's pixels were served.
const makeDecodePayload = (fill: number) => {
  const px = new Uint16Array(4 * 2 * 3).fill(fill);
  return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
};

const decodeApi = () =>
  (window as unknown as { electronAPI: { decodeRawFile: jest.Mock } }).electronAPI.decodeRawFile;

beforeEach(() => {
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  useAppStore.getState().setReDecoding(false);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    decodeRawFile: jest.fn().mockImplementation(async () => makeDecodePayload(16384)),
    storeGet: jest.fn(),
    storeSet: jest.fn(),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  useAppStore.getState().setReDecoding(false);
});

describe('RAW reopen serves from the session base cache', () => {
  it('(a) a second loadImage(samePath) serves cached pixels and does NOT decode again', async () => {
    const first = await imageService.loadImage('/photo.orf');
    const second = await imageService.loadImage('/photo.orf');

    // The expensive decode ran exactly ONCE across both opens — the second was a cache hit.
    expect(decodeApi()).toHaveBeenCalledTimes(1);
    // The served pixels are identical in content...
    expect(second.data).toEqual(first.data);
    expect(second.width).toBe(first.width);
    expect(second.height).toBe(first.height);
    expect(second.isRaw).toBe(true);
    // ...but a distinct buffer, so the working image never aliases the cache's copy.
    expect(second.data).not.toBe(first.data);
  });

  it('(b) after reDecode with new options, a reopen serves the NEW pixels (never stale)', async () => {
    // Initial open decodes with fill=16384 → base cache holds ~0.25 pixels.
    decodeApi().mockImplementation(async () => makeDecodePayload(16384));
    const initial = await imageService.loadImage('/photo.orf');
    expect(initial.data[0]).toBeCloseTo(16384 / 65535, 4);
    expect(decodeApi()).toHaveBeenCalledTimes(1);

    // User changes decode options → reDecode re-decodes with fill=49152 (~0.75) and OVERWRITES
    // the same base cache key + persists the new options in the same call.
    decodeApi().mockImplementation(async () => makeDecodePayload(49152));
    await rawImageService.reDecode(AHD_RECON);
    expect(decodeApi()).toHaveBeenCalledTimes(2);

    // Reopen: a cache HIT that serves the RE-DECODED pixels, not the original ones. No third decode.
    const reopened = await imageService.loadImage('/photo.orf');
    expect(decodeApi()).toHaveBeenCalledTimes(2);
    expect(reopened.data[0]).toBeCloseTo(49152 / 65535, 4);
    expect(reopened.data[0]).not.toBeCloseTo(16384 / 65535, 4);
  });

  it('(c) a DIFFERENT path still decodes fresh (base cache is per-path)', async () => {
    await imageService.loadImage('/a.orf');
    expect(decodeApi()).toHaveBeenCalledTimes(1);

    await imageService.loadImage('/b.orf');
    // Distinct path → distinct base key → a fresh decode (no false hit).
    expect(decodeApi()).toHaveBeenCalledTimes(2);
    expect(decodeApi()).toHaveBeenLastCalledWith('/b.orf', DEFAULT_RAW_DECODE_OPTIONS);
  });

  it('(e) a base whose recorded options no longer match the store is a MISS (never serves stale-options pixels)', async () => {
    // First open with DEFAULT options → base cached with provenance decodeOptions = DEFAULT.
    await imageService.loadImage('/photo.orf');
    expect(decodeApi()).toHaveBeenCalledTimes(1);
    expect(imageCacheService.getBase('/photo.orf')).not.toBeNull();

    // Race/corruption case: the store now holds DIFFERENT decode options than the cached base was
    // decoded with (Canvas normally keeps these in lock-step). The read-side coherence guard must
    // treat the hit as a MISS and decode fresh rather than serve wrong-options pixels.
    useAppStore.getState().setRawDecodeOptions(AHD_RECON);
    await imageService.loadImage('/photo.orf');
    expect(decodeApi()).toHaveBeenCalledTimes(2); // MISS → fresh decode with the new options

    // The re-decode rewrote the base with matching provenance (AHD_RECON) — the next reopen is a
    // HIT again (no third decode).
    await imageService.loadImage('/photo.orf');
    expect(decodeApi()).toHaveBeenCalledTimes(2);
  });

  it('(d) non-RAW reopen also serves from the base cache (same loadImage path, bonus)', async () => {
    // Design decision: non-RAW images share the base-cache path, so a reopen skips the
    // file read/decode too. Drive the private regular-image loader as the decode seam.
    const data = new Float32Array(4 * 2 * 4).fill(0.5);
    const loadRegular = jest
      .spyOn(imageService as unknown as { loadRegularImage: (p: string) => Promise<unknown> }, 'loadRegularImage')
      .mockResolvedValue({
        width: 4, height: 2, data, fileName: 'photo.jpg', filePath: '/photo.jpg', isRaw: false,
      });

    const first = await imageService.loadImage('/photo.jpg');
    const second = await imageService.loadImage('/photo.jpg');

    // The regular decode ran exactly once — the reopen was a cache hit.
    expect(loadRegular).toHaveBeenCalledTimes(1);
    expect(decodeApi()).not.toHaveBeenCalled();
    expect(second.data).toEqual(first.data);
    expect(second.isRaw).toBe(false);
    expect(second.data).not.toBe(first.data);
  });
});
