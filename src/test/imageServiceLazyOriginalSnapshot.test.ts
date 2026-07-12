/**
 * Task L4, Part A: the before/after original snapshot used to be an EAGER deep copy of the
 * full-res buffer on every single image open (queueMicrotask + `new Float32Array(image.data)`)
 * — ~90-230ms and ~310MB for a 20MP image — even though most opens never open Before/After.
 *
 * ImageService now defers that copy: loadImage only records a REFERENCE to the as-decoded
 * pixels (deferOriginalSnapshot, zero allocation); the deep copy happens lazily, in
 * materializeOriginalSnapshot, the first time something actually needs the original —
 * getOriginalImage() (Before/After) or updateCurrentImageData() (a copy-on-write safety net so
 * an in-place-looking mutation, e.g. rotate, can never lose the pre-mutation pixels).
 *
 * These tests drive the REAL ImageService + ImageCacheService (mocked decode IPC), matching the
 * pattern in imageServiceBeforeNotify.test.ts.
 */
import { imageService } from '../services/ImageService';
import { imageCacheService } from '../services/ImageCacheService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

// A native-decode IPC payload: 4×2, 3-channel, 16-bit, every pixel set to `fill`.
const makeDecodePayload = (fill: number) => {
  const px = new Uint16Array(4 * 2 * 3).fill(fill);
  return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
};

// Reach into ImageService's private materialization seam. TypeScript `private` is
// compile-time-only; at runtime this is just a method on the singleton, and spying on it
// directly is the only way to observe "was an original-snapshot COPY made" without depending on
// fragile TypedArray-constructor interception.
type ImageServiceInternals = { materializeOriginalSnapshot: (...args: unknown[]) => unknown };
const materializeSpy = () =>
  jest.spyOn(imageService as unknown as ImageServiceInternals, 'materializeOriginalSnapshot');

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

describe('ImageService — lazy/copy-on-write original snapshot', () => {
  it('does not materialize (copy) the original snapshot on a plain open', async () => {
    const spy = materializeSpy();

    await imageService.loadImage('/photo.orf');

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not materialize on a warm base-cache reopen either', async () => {
    await imageService.loadImage('/photo.orf'); // populates the base cache
    const spy = materializeSpy();

    await imageService.loadImage('/photo.orf'); // served from cache

    expect(spy).not.toHaveBeenCalled();
  });

  it('materializes lazily on the first getOriginalImage() call, and only once', async () => {
    await imageService.loadImage('/photo.orf');
    const spy = materializeSpy();

    const first = imageService.getOriginalImage();
    const second = imageService.getOriginalImage();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(second).toBe(first); // cached, same object — no re-copy
  });

  it('getOriginalImage() reflects the fresh decode (sanity: correct pixels/dims before any mutation)', async () => {
    await imageService.loadImage('/photo.orf');

    const original = imageService.getOriginalImage();
    expect(original).not.toBeNull();
    expect(original!.width).toBe(4);
    expect(original!.height).toBe(2);
    // 16384/65535 normalised is what RawImageService produces for this fill value.
    expect(original!.data[0]).toBeGreaterThan(0);
  });

  it('shows the PRE-mutation original after an in-place-looking mutation (e.g. rotate)', async () => {
    await imageService.loadImage('/photo.orf');
    const preMutation = imageService.getCurrentImage()!;
    expect(preMutation.width).toBe(4);
    expect(preMutation.height).toBe(2);

    // Simulate a rotate: a NEW array at swapped dimensions, exactly like
    // rotateImage90CW/CCW/flip/resize in App.tsx.
    const rotated = new Float32Array(preMutation.data.length).fill(0.9);
    imageService.updateCurrentImageData(rotated, 2, 4);

    expect(imageService.getCurrentImage()!.width).toBe(2);
    expect(imageService.getCurrentImage()!.height).toBe(4);

    // Before/After must still show the PRE-rotation image, not the rotated working buffer.
    const original = imageService.getOriginalImage();
    expect(original).not.toBeNull();
    expect(original!.width).toBe(4);
    expect(original!.height).toBe(2);
    expect(Array.from(original!.data)).toEqual(Array.from(preMutation.data));
  });

  it('a mutation before Before/After was ever used triggers exactly one copy-on-write materialization', async () => {
    await imageService.loadImage('/photo.orf');
    const spy = materializeSpy();

    const rotated = new Float32Array(24).fill(0.5);
    imageService.updateCurrentImageData(rotated, 2, 4);

    expect(spy).toHaveBeenCalledTimes(1);

    // A SECOND mutation must not re-materialize — the snapshot is already locked in.
    const flipped = new Float32Array(24).fill(0.7);
    imageService.updateCurrentImageData(flipped, 2, 4);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('setOriginalImage supersedes a still-deferred snapshot without an extra copy from updateCurrentImageData', async () => {
    await imageService.loadImage('/photo.orf');
    const spy = materializeSpy();

    const cleanBase = new Float32Array(48).fill(0.3);
    // Mirrors EnhanceService/RawImageService's order: setOriginalImage BEFORE
    // updateCurrentImageData, so the copy-on-write check in updateCurrentImageData is a no-op.
    imageService.setOriginalImage(cleanBase, 4, 3);
    imageService.updateCurrentImageData(new Float32Array(48).fill(0.6), 4, 3);

    expect(spy).not.toHaveBeenCalled();
    expect(imageService.getOriginalImage()!.data[0]).toBeCloseTo(0.3);
  });

  it('a fresh loadImage() invalidates a previously materialized snapshot from the last image', async () => {
    await imageService.loadImage('/photo.orf');
    const first = imageService.getOriginalImage();
    expect(first).not.toBeNull();

    // Open a different image — must not keep serving the previous photo's original.
    await imageService.loadImage('/other.orf');
    const spy = materializeSpy();
    const second = imageService.getOriginalImage();

    expect(spy).toHaveBeenCalledTimes(1); // re-materialized for the new image
    expect(second).not.toBe(first);
  });
});

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
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ImageService — progressive RAW open (the L3 full-decode swap) also defers the copy', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      decodeRawFile: jest.fn().mockImplementation(async () => makeFullPayload(8, 4, 200)),
      decodeRawPreview: jest.fn().mockImplementation(async () => makePreviewPayload(4, 2, 100)),
      storeGet: jest.fn(),
      storeSet: jest.fn(),
    };
  });

  it('the full-decode swap does not materialize the original snapshot (was an unconditional eager copy)', async () => {
    const spy = materializeSpy();

    await imageService.loadImage('/photo.orf', undefined, () => {}); // preview render
    await flush(); // background full decode + swap settles

    expect(imageService.getCurrentImage()?.width).toBe(8); // full decode landed
    expect(spy).not.toHaveBeenCalled(); // swap itself must not copy
  });

  it('getOriginalImage() after the swap lazily materializes the FULL (post-swap) pixels, not the preview', async () => {
    await imageService.loadImage('/photo.orf', undefined, () => {});
    await flush();
    const spy = materializeSpy();

    const original = imageService.getOriginalImage();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(original).not.toBeNull();
    expect(original!.width).toBe(8);
    expect(original!.height).toBe(4);
  });
});
