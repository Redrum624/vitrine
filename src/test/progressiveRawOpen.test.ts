/**
 * Task L3: progressive RAW open — instant embedded preview + background full 16-bit decode swap.
 *
 * ImageService.loadImage, when the interactive editor opts in (by passing `onFullDecode`) AND the
 * `decodeRawPreview` IPC is available, paints the camera's fast embedded-JPEG preview first
 * (near-instant), returns it, and swaps the full LibRaw decode in place in the BACKGROUND once it
 * lands. These tests drive the REAL ImageService + ImageCacheService with mocked decode IPCs and
 * assert:
 *   A. preview renders first, then the full decode swaps in; base cache holds ONLY the full decode;
 *   B. an image switch mid-background-decode bails (never clobbers the newer image);
 *   C. a decode-options change mid-background-decode (re-decode) supersedes the stale swap;
 *   D. the warm path (base-cache hit) takes NO preview IPC;
 *   E. batch/export (no onFullDecode) always gets the full decode, never the preview.
 */
import { imageService } from '../services/ImageService';
import { imageCacheService } from '../services/ImageCacheService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

// Full native-decode IPC payload: 16-bit, 3-channel.
const makeFullPayload = (w: number, h: number, fill: number) => {
  const px = new Uint16Array(w * h * 3).fill(fill);
  return { data: px.buffer.slice(0), width: w, height: h, channels: 3, bitDepth: 16 };
};
// Embedded-preview IPC payload: 8-bit, 3-channel.
const makePreviewPayload = (w: number, h: number, fill: number) => {
  const px = new Uint8Array(w * h * 3).fill(fill);
  return { data: px.buffer.slice(0), width: w, height: h, channels: 3, bitDepth: 8 };
};

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

// Flush all pending microtasks (background developFullDecode + its finally block).
const flush = () => new Promise((r) => setTimeout(r, 0));

const decodeApi = () => (window as unknown as { electronAPI: { decodeRawFile: jest.Mock } }).electronAPI.decodeRawFile;
const previewApi = () => (window as unknown as { electronAPI: { decodeRawPreview: jest.Mock } }).electronAPI.decodeRawPreview;

beforeEach(() => {
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  useAppStore.getState().setDeveloping(false);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    decodeRawFile: jest.fn().mockImplementation(async () => makeFullPayload(8, 4, 200)),
    decodeRawPreview: jest.fn().mockImplementation(async () => makePreviewPayload(4, 2, 100)),
    storeGet: jest.fn(),
    storeSet: jest.fn(),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  useAppStore.getState().setDeveloping(false);
});

describe('ImageService.loadImage — progressive RAW open', () => {
  it('renders the preview first, then swaps the full decode in place (base cache holds only the full decode)', async () => {
    const full = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async () => full.promise);

    const order: string[] = [];
    const cleanup = imageService.addImageLoadListener(() => {
      const ci = imageService.getCurrentImage();
      order.push(`${ci?.width}x${ci?.height}`);
    });
    const fullDims: string[] = [];

    // loadImage returns the PREVIEW while the full decode is still in flight.
    const result = await imageService.loadImage('/photo.orf', undefined, (w, h) => fullDims.push(`${w}x${h}`));
    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect(order).toEqual(['4x2']);                        // only the preview pass so far
    expect(useAppStore.getState().developing).toBe(true);  // "Developing full quality…" affordance
    expect(imageCacheService.getBase('/photo.orf')).toBeNull(); // preview NEVER cached as base

    // The full decode lands → swap.
    full.resolve(makeFullPayload(8, 4, 200));
    await flush();
    cleanup();

    expect(order).toEqual(['4x2', '8x4']);                 // preview render, then full swap
    expect(fullDims).toEqual(['8x4']);                     // onFullDecode fired with TRUE dims
    expect(imageService.getCurrentImage()?.width).toBe(8);
    expect(imageCacheService.getBase('/photo.orf')?.width).toBe(8); // base cache = full decode only
    expect(decodeApi()).toHaveBeenCalledTimes(1);
    expect(previewApi()).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().developing).toBe(false); // affordance cleared
  });

  it('bails when the image is switched during the background full decode (no clobber)', async () => {
    const fullA = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async (path: string) =>
      path === '/a.orf' ? fullA.promise : makeFullPayload(12, 6, 200));
    previewApi().mockImplementation(async (path: string) =>
      path === '/a.orf' ? makePreviewPayload(4, 2, 100) : makePreviewPayload(6, 3, 150));

    // Open A — preview shown, A's full still pending.
    const rA = await imageService.loadImage('/a.orf', undefined, () => {});
    expect(rA.width).toBe(4);

    // Open B — preview + immediate full swap to B.
    await imageService.loadImage('/b.orf', undefined, () => {});
    await flush();
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf');
    expect(imageService.getCurrentImage()?.width).toBe(12);

    // A's stale full decode lands — must BAIL (generation superseded), leaving B intact.
    fullA.resolve(makeFullPayload(10, 5, 50));
    await flush();
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf');
    expect(imageService.getCurrentImage()?.width).toBe(12);
    expect(imageCacheService.getBase('/a.orf')).toBeNull(); // A's full never cached (bailed first)
  });

  it('supersedes the swap when decode options change during the background decode (re-decode wins)', async () => {
    const full = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async () => full.promise);
    useAppStore.getState().setRawDecodeOptions({ demosaic: 'dcb', highlightMode: 'blend' });

    await imageService.loadImage('/photo.orf', undefined, () => {});
    expect(imageService.getCurrentImage()?.width).toBe(4); // preview

    // The user changes demosaic/highlights (a re-decode) while the original full decode is in flight.
    useAppStore.getState().setRawDecodeOptions({ demosaic: 'ahd', highlightMode: 'off' });

    // The stale-options full decode resolves — must BAIL so it never overwrites the re-decode.
    full.resolve(makeFullPayload(8, 4, 200));
    await flush();
    expect(imageService.getCurrentImage()?.width).toBe(4);            // still the preview — swap bailed
    expect(imageCacheService.getBase('/photo.orf')).toBeNull();  // stale full never cached
  });

  it('warm path (base-cache hit) takes NO preview IPC and serves the full decode', async () => {
    // First open populates the base cache with the full decode.
    await imageService.loadImage('/photo.orf', undefined, () => {});
    await flush();
    expect(imageCacheService.getBase('/photo.orf')?.width).toBe(8);

    previewApi().mockClear();
    decodeApi().mockClear();

    const reopened = await imageService.loadImage('/photo.orf', undefined, () => {});
    expect(reopened.width).toBe(8);                 // served from cache (full decode)
    expect(previewApi()).not.toHaveBeenCalled();    // no progressive preview on a cache hit
    expect(decodeApi()).not.toHaveBeenCalled();     // no decode on a cache hit
  });

  it('batch/export (no onFullDecode) always gets the full decode, never the preview', async () => {
    const result = await imageService.loadImage('/photo.orf'); // no onFullDecode → not progressive
    expect(result.width).toBe(8);                   // full 16-bit decode dims
    expect(previewApi()).not.toHaveBeenCalled();    // preview path skipped for non-editor callers
    expect(useAppStore.getState().developing).toBe(false);
  });
});
