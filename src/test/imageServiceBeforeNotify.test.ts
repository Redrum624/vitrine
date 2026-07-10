/**
 * Task L2: persisted edits must apply BEFORE the first pipeline pass.
 *
 * The first pass is triggered by ImageService.notifyImageLoaded() → the load listeners
 * (AdjustmentPanel's imageLoadListener → processCurrentImageRealTime). If restored module
 * params are seeded AFTER that notify, the first pass renders the UNEDITED defaults (a
 * visible flash) and a second pass has to redo it. The fix threads a `beforeNotify` hook
 * through loadImage that fires once the base is decoded (real dims known) but BEFORE the
 * listeners run. These tests drive the REAL ImageService + ImageCacheService (mocked decode
 * IPC) and assert the ordering on both the fresh-decode and the warm base-cache paths.
 */
import { imageService } from '../services/ImageService';
import { imageCacheService } from '../services/ImageCacheService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

// A native-decode IPC payload: 4×2, 3-channel, 16-bit.
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
});

describe('ImageService.loadImage — beforeNotify seeds edits before the first pass', () => {
  it('fires beforeNotify BEFORE the load listeners on a fresh decode (RAW)', async () => {
    const order: string[] = [];
    const cleanup = imageService.addImageLoadListener(() => order.push('listener'));

    await imageService.loadImage('/photo.orf', (res) => {
      order.push('beforeNotify');
      // The hook receives the decoded result, so it can restore geometry at REAL dims.
      expect(res.width).toBe(4);
      expect(res.height).toBe(2);
    });

    cleanup();
    expect(order).toEqual(['beforeNotify', 'listener']);
  });

  it('fires beforeNotify BEFORE the load listeners on a base-cache hit (warm reopen)', async () => {
    // First open populates the session base cache (this is the expensive decode).
    await imageService.loadImage('/photo.orf');

    const order: string[] = [];
    const cleanup = imageService.addImageLoadListener(() => order.push('listener'));

    await imageService.loadImage('/photo.orf', () => order.push('beforeNotify'));

    cleanup();
    expect(order).toEqual(['beforeNotify', 'listener']);
    // The reopen was served from cache — the decode ran once, for the first open only.
    expect(decodeApi()).toHaveBeenCalledTimes(1);
  });

  it('is optional — callers that pass no hook still load (back-compat for batch/export)', async () => {
    const seen: string[] = [];
    const cleanup = imageService.addImageLoadListener(() => seen.push('listener'));

    await expect(imageService.loadImage('/photo.orf')).resolves.toBeDefined();

    cleanup();
    expect(seen).toEqual(['listener']);
  });
});
