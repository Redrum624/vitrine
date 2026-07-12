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
import { guardDeveloping } from '../App';

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
const baseReadApi = () => (window as unknown as { electronAPI: { baseCacheRead: jest.Mock } }).electronAPI.baseCacheRead;
const baseWriteApi = () => (window as unknown as { electronAPI: { baseCacheWrite: jest.Mock } }).electronAPI.baseCacheWrite;

beforeEach(() => {
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  useAppStore.getState().setDeveloping(false);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    decodeRawFile: jest.fn().mockImplementation(async () => makeFullPayload(8, 4, 200)),
    decodeRawPreview: jest.fn().mockImplementation(async () => makePreviewPayload(4, 2, 100)),
    // Disk base cache (L2). Default: a MISS (null) + a resolving write, so every existing test keeps
    // its exact old behaviour (disk absent → decode runs; write-through is a harmless no-op mock).
    baseCacheRead: jest.fn().mockResolvedValue(null),
    baseCacheWrite: jest.fn().mockResolvedValue(true),
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

  it('caches the superseded decode without swapping when the image is switched mid-decode (write-before-guard, no clobber)', async () => {
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

    // A's superseded full decode lands — it must NOT swap state (B stays on screen), but the
    // fully-paid pixels ARE written to A's base cache (write-before-guard) so a reopen of A pays
    // forward instead of paying for the ~4.3s decode a second time.
    fullA.resolve(makeFullPayload(10, 5, 50));
    await flush();
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf'); // current state untouched
    expect(imageService.getCurrentImage()?.width).toBe(12);
    expect(imageCacheService.getBase('/a.orf')?.width).toBe(10);      // A's superseded decode cached

    // Reopening A now serves from the base cache — NO second decode IPC and no progressive preview.
    decodeApi().mockClear();
    previewApi().mockClear();
    const reopenedA = await imageService.loadImage('/a.orf', undefined, () => {});
    expect(reopenedA.width).toBe(10);              // served from cache (the superseded full decode)
    expect(decodeApi()).not.toHaveBeenCalled();    // no re-decode — the paid decode paid forward
    expect(previewApi()).not.toHaveBeenCalled();   // no progressive preview on a cache hit
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
    // Write-before-guard is deliberately SKIPPED in this one case: the image is still current and
    // only the options changed, so a fresher re-decode of THIS SAME path may already own the base —
    // caching our stale-options pixels would clobber it. (When the open instead moves to a DIFFERENT
    // image, the superseded decode IS cached — see the switch-mid-decode test above.)
    expect(imageCacheService.getBase('/photo.orf')).toBeNull();  // stale-options full never cached
  });

  it('skips the wasteful OLD-options swap when a re-decode is in flight, but STILL writes L1 (Case-A failure recovery)', async () => {
    // Case A of the OLD→NEW double swap: the ORIGINAL background full decode (started first, so it
    // lands first) resolves while a re-decode is in flight but has NOT yet updated the store
    // options — so `optionsChanged` still reads false. The wasteful OLD-options VISUAL swap is
    // suppressed (reDecode owns the screen). The L1 cache write, however, now HAPPENS under the
    // captured options: reDecode's own setBase overwrites it on success, and on reDecode FAILURE it
    // survives as an instant L1 hit on reopen — upgrading failure recovery from an L2 read to L1.
    const captured = { demosaic: 'dcb' as const, highlightMode: 'blend' as const };
    const full = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async () => full.promise);
    useAppStore.getState().setRawDecodeOptions(captured);

    await imageService.loadImage('/photo.orf', undefined, () => {});
    expect(imageService.getCurrentImage()?.width).toBe(4); // preview on screen

    // A re-decode (RawDecodePanel → reDecode) flips `reDecoding` true synchronously but does NOT
    // update the store options until its OWN decode resolves.
    useAppStore.getState().setReDecoding(true);

    const swap = jest.spyOn(imageService, 'updateCurrentImageData');
    full.resolve(makeFullPayload(8, 4, 200));
    await flush();

    expect(swap).not.toHaveBeenCalled();                         // no wasteful OLD-options swap
    expect(imageService.getCurrentImage()?.width).toBe(4);       // still the preview — reDecode will swap
    // …but the fully-paid decode IS now cached under its captured options (Case-A L1 write).
    const entry = imageCacheService.getBase('/photo.orf');
    expect(entry?.width).toBe(8);
    expect(entry?.metadata?.decodeOptions).toEqual(captured);
    swap.mockRestore();

    // Simulate reDecode FAILURE: reDecoding lowered, store options UNCHANGED (still `captured`), so
    // reDecode never overwrote the L1 entry. Reopening now serves full quality straight from L1 —
    // NO LibRaw decode IPC, NO progressive preview.
    useAppStore.getState().setReDecoding(false);
    decodeApi().mockClear();
    previewApi().mockClear();
    const reopened = await imageService.loadImage('/photo.orf', undefined, () => {});
    expect(reopened.width).toBe(8);              // recovered from L1 (Case-A entry)
    expect(decodeApi()).not.toHaveBeenCalled();  // instant L1 hit — no re-decode
    expect(previewApi()).not.toHaveBeenCalled(); // no progressive preview on a cache hit
  });

  it('caches a superseded decode WITHOUT swapping the working image (write-before-guard invariant)', async () => {
    const fullA = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async (path: string) =>
      path === '/a.orf' ? fullA.promise : makeFullPayload(12, 6, 200));

    // Open A progressively — preview on screen, A's full decode pending.
    await imageService.loadImage('/a.orf', undefined, () => {});
    // Switch to B — this bumps the load generation and swaps B in (updateCurrentImageData for B).
    await imageService.loadImage('/b.orf', undefined, () => {});
    await flush();

    // From here on, any updateCurrentImageData call would be A's stale decode clobbering B.
    const swap = jest.spyOn(imageService, 'updateCurrentImageData');
    fullA.resolve(makeFullPayload(10, 5, 50));
    await flush();

    expect(swap).not.toHaveBeenCalled();                        // superseded decode never swaps state
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf');
    expect(imageCacheService.getBase('/a.orf')?.width).toBe(10); // …but it IS cached for reopen
    swap.mockRestore();
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

  it('clears the developing flag immediately when switching to a warm/non-RAW image mid-background-decode (L3 review round 1, important #4)', async () => {
    // Prime the base cache for B with a full decode (a "warm" reopen target).
    await imageService.loadImage('/b.orf', undefined, () => {});
    await flush();
    expect(imageCacheService.getBase('/b.orf')?.width).toBe(8);

    // Start a progressive RAW open on A — its full decode never resolves in this test, so
    // without the fix `developing` would stay stuck true forever once we move away from A.
    const fullA = deferred<ReturnType<typeof makeFullPayload>>();
    decodeApi().mockImplementation(async (path: string) => (path === '/a.orf' ? fullA.promise : makeFullPayload(8, 4, 200)));
    await imageService.loadImage('/a.orf', undefined, () => {});
    expect(useAppStore.getState().developing).toBe(true);

    // Switch to B (warm/cache-hit) while A's full decode is still pending — this must clear
    // the affordance right away, not leave it stuck on.
    await imageService.loadImage('/b.orf', undefined, () => {});
    expect(useAppStore.getState().developing).toBe(false);

    // A's stale full decode resolving later must not resurrect the affordance (generation guard).
    fullA.resolve(makeFullPayload(10, 5, 50));
    await flush();
    expect(useAppStore.getState().developing).toBe(false);
  });
});

describe('ImageService.loadImage — disk-persisted base cache (L2, Task R4)', () => {
  it('(disk hit) serves full quality from the disk cache with NO LibRaw decode — via the same guarded swap', async () => {
    // Fresh session: L1 (in-memory) is empty (cleared in beforeEach); the disk cache holds the full
    // 16-bit decode for this (path, options). The progressive PREVIEW still paints first (unchanged);
    // the disk hit just makes full quality land ~1s later instead of ~5.5s.
    baseReadApi().mockResolvedValue(makeFullPayload(8, 4, 200));

    const fullDims: string[] = [];
    const result = await imageService.loadImage('/photo.orf', undefined, (w, h) => fullDims.push(`${w}x${h}`));
    expect(result.width).toBe(4);                       // preview paints first
    expect(previewApi()).toHaveBeenCalledTimes(1);

    await flush();                                       // developFullDecode awaits the disk-served full

    expect(decodeApi()).not.toHaveBeenCalled();          // the ~4.3s LibRaw decode IPC never ran
    expect(baseReadApi()).toHaveBeenCalledWith('/photo.orf', DEFAULT_RAW_DECODE_OPTIONS);
    expect(imageService.getCurrentImage()?.width).toBe(8); // full quality swapped in (guarded swap)
    expect(fullDims).toEqual(['8x4']);
    expect(imageCacheService.getBase('/photo.orf')?.width).toBe(8); // promoted into L1 for the session
    expect(baseWriteApi()).not.toHaveBeenCalled();       // a disk HIT is already persisted — no rewrite
  });

  it('(disk miss) runs the decode and WRITES THROUGH to disk with the CAPTURED options', async () => {
    useAppStore.getState().setRawDecodeOptions({ demosaic: 'ahd', highlightMode: 'off' });
    baseReadApi().mockResolvedValue(null); // miss

    await imageService.loadImage('/photo.orf', undefined, () => {});
    await flush();

    expect(decodeApi()).toHaveBeenCalledTimes(1);        // miss → the real decode runs
    expect(baseWriteApi()).toHaveBeenCalledTimes(1);     // …and write-through persists it
    const [wPath, wOpts, wPayload] = baseWriteApi().mock.calls[0];
    expect(wPath).toBe('/photo.orf');
    expect(wOpts).toEqual({ demosaic: 'ahd', highlightMode: 'off' }); // captured options, not stale store
    expect(wPayload.bitDepth).toBe(16);                  // the FULL 16-bit decode (never the preview)
    expect(wPayload.width).toBe(8);
    expect(wPayload.height).toBe(4);
  });

  it('(disk miss, 8-bit fallback) an embedded-JPEG fallback decode is NEVER written through to disk', async () => {
    // A transient native-decode failure degrades to the 8-bit embedded-JPEG rung. The cache key
    // carries no bitDepth, so persisting it would lock 8-bit pixels in across sessions under the
    // key a 16-bit native decode would use. Write-through must skip anything that isn't 16-bit.
    baseReadApi().mockResolvedValue(null); // miss
    decodeApi().mockImplementation(async () => {
      const px = new Uint8Array(8 * 4 * 3).fill(200);
      return { data: px.buffer.slice(0), width: 8, height: 4, channels: 3, bitDepth: 8 };
    });

    await imageService.loadImage('/photo.orf', undefined, () => {});
    await flush();

    expect(decodeApi()).toHaveBeenCalledTimes(1);        // the (degraded) decode ran
    expect(baseWriteApi()).not.toHaveBeenCalled();       // …but the fallback is never persisted
  });

  it('(disk hit, superseded) an image switch before the disk read lands bails the swap but still pays A forward', async () => {
    const diskA = deferred<ReturnType<typeof makeFullPayload>>();
    baseReadApi().mockImplementation(async (path: string) =>
      path === '/a.orf' ? diskA.promise : makeFullPayload(12, 6, 200));
    previewApi().mockImplementation(async (path: string) =>
      path === '/a.orf' ? makePreviewPayload(4, 2, 100) : makePreviewPayload(6, 3, 150));

    // Open A — preview shown, A's disk read still pending.
    const rA = await imageService.loadImage('/a.orf', undefined, () => {});
    expect(rA.width).toBe(4);

    // Open B — disk hit resolves immediately, B swaps in.
    await imageService.loadImage('/b.orf', undefined, () => {});
    await flush();
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf');
    expect(imageService.getCurrentImage()?.width).toBe(12);

    // A's disk read lands late — the generation/identity guards must BAIL the swap (B stays on
    // screen), but the write-before-guard still promotes A's fully-valid base into L1 for a reopen.
    diskA.resolve(makeFullPayload(10, 5, 50));
    await flush();
    expect(imageService.getCurrentImage()?.filePath).toBe('/b.orf'); // guards intact — no clobber
    expect(imageService.getCurrentImage()?.width).toBe(12);
    expect(imageCacheService.getBase('/a.orf')?.width).toBe(10);     // A paid forward into L1
    expect(decodeApi()).not.toHaveBeenCalled();                     // both served from disk, never LibRaw
    expect(baseWriteApi()).not.toHaveBeenCalled();                  // disk HITs don't rewrite the disk
  });
});

describe('disk write-through interactive gating (P6 item 2)', () => {
  it('an INTERACTIVE open writes the fresh decode through to disk', async () => {
    baseReadApi().mockResolvedValue(null); // miss → the real decode runs
    await imageService.loadImage('/photo.orf'); // default interactive=true (non-progressive: no onFullDecode)
    await flush();
    expect(decodeApi()).toHaveBeenCalledTimes(1);
    expect(baseWriteApi()).toHaveBeenCalledTimes(1); // …and interactive → write-through persists it
  });

  it('a NON-INTERACTIVE loadImage (batch) does NOT write through, but still READS the disk', async () => {
    baseReadApi().mockResolvedValue(null); // miss
    await imageService.loadImage('/photo.orf', undefined, undefined, false);
    await flush();
    expect(decodeApi()).toHaveBeenCalledTimes(1);       // decode still ran
    expect(baseReadApi()).toHaveBeenCalled();           // disk READ stays enabled for batch
    expect(baseWriteApi()).not.toHaveBeenCalled();      // …but the one-shot batch decode is NOT persisted
  });

  it('decodeForExport does NOT write through to disk (export is a one-shot)', async () => {
    baseReadApi().mockResolvedValue(null); // miss
    await imageService.decodeForExport('/photo.orf');
    await flush();
    expect(decodeApi()).toHaveBeenCalledTimes(1);
    expect(baseWriteApi()).not.toHaveBeenCalled();
  });
});

describe('guardDeveloping — pixel-analysis/print action gate (L3 review round 1, important #1/#2)', () => {
  afterEach(() => {
    useAppStore.getState().setDeveloping(false);
  });

  it('blocks and shows an info notification while developing', () => {
    useAppStore.getState().setDeveloping(true);
    const showInfo = jest.fn();
    expect(guardDeveloping(showInfo, 'Auto All')).toBe(true);
    expect(showInfo).toHaveBeenCalledTimes(1);
    expect(showInfo).toHaveBeenCalledWith('Auto All', expect.stringMatching(/developing/i));
  });

  it('lets the caller proceed (no notification) once the background decode has settled', () => {
    useAppStore.getState().setDeveloping(false);
    const showInfo = jest.fn();
    expect(guardDeveloping(showInfo, 'Auto All')).toBe(false);
    expect(showInfo).not.toHaveBeenCalled();
  });
});
