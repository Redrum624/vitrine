/**
 * Task R4: disk-persisted base cache — main-process module tests.
 *
 * electron/baseCache.cjs is the L2 (on-disk) tier behind the in-memory L1 base cache: it persists
 * a decoded RAW base (the raw IPC payload buffer verbatim) plus a sidecar JSON keyed by
 * (file path, decode options), so a SECOND session's cold open of a RAW gets full quality from a
 * fast NVMe read instead of paying the ~4.3s LibRaw decode again.
 *
 * These tests exercise the pure helpers (key derivation, sidecar validation, LRU eviction
 * selection) AND a real fs round-trip (init/write/read + invalidation + eviction) against a temp
 * dir. Imported via require so ts-jest treats the .cjs as CommonJS (matching jest.config.js).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const baseCache = require('../../electron/baseCache.cjs') as {
  optionsHash: (o: { demosaic?: string; highlightMode?: string; cameraMatch?: boolean } | undefined) => string;
  entryName: (filePath: string, o?: { demosaic?: string; highlightMode?: string }) => string;
  sidecarIsValid: (meta: { sourceMtimeMs?: number; sourceSize?: number } | null, stat: { mtimeMs: number; size: number } | null) => boolean;
  selectEvictions: (entries: { key: string; size: number; lastAccess: number }[], incomingSize: number, budget: number) => string[];
  bufferToArrayBuffer: (buf: Buffer) => ArrayBuffer;
  init: (dir: string, opts?: { budget?: number }) => number;
  read: (filePath: string, o?: { demosaic?: string; highlightMode?: string }) => Promise<{ data: ArrayBuffer; width: number; height: number; channels: number; bitDepth: number } | null>;
  write: (filePath: string, o: { demosaic?: string; highlightMode?: string } | undefined, payload: { data: ArrayBuffer; width: number; height: number; channels: number; bitDepth: number }) => Promise<void>;
  DEFAULT_BUDGET_BYTES: number;
};

const OPTS = { demosaic: 'dcb', highlightMode: 'blend' };

// A packed 16-bit RGB payload (w*h*3 uint16), fill lets each entry be content-distinguishable.
const makePayload = (w: number, h: number, fill: number) => {
  const px = new Uint16Array(w * h * 3).fill(fill);
  return { data: px.buffer.slice(0), width: w, height: h, channels: 3, bitDepth: 16 };
};

describe('baseCache pure helpers', () => {
  describe('optionsHash', () => {
    it('is stable for the same options', () => {
      expect(baseCache.optionsHash(OPTS)).toBe(baseCache.optionsHash({ ...OPTS }));
    });
    it('differs when the demosaic changes', () => {
      expect(baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend' }))
        .not.toBe(baseCache.optionsHash({ demosaic: 'ahd', highlightMode: 'blend' }));
    });
    it('differs when the highlight mode changes', () => {
      expect(baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend' }))
        .not.toBe(baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'off' }));
    });
    it('falls back to the FULL default options for undefined (camera match ON)', () => {
      // An absent options object means "decode with defaults", which includes
      // cameraMatch: true — it must NOT key the same entry as an explicit
      // options object without the field (whose pixels are unmatched).
      expect(baseCache.optionsHash(undefined)).toBe(
        baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true }),
      );
      expect(baseCache.optionsHash(undefined)).not.toBe(
        baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend' }),
      );
    });
    it('differs when cameraMatch changes; absent field keys as false', () => {
      const off = baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend', cameraMatch: false });
      const on = baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true });
      const absent = baseCache.optionsHash({ demosaic: 'dcb', highlightMode: 'blend' });
      expect(on).not.toBe(off);
      expect(absent).toBe(off);
    });
  });

  describe('entryName', () => {
    it('is deterministic for the same (path, options)', () => {
      expect(baseCache.entryName('/a/b/photo.orf', OPTS)).toBe(baseCache.entryName('/a/b/photo.orf', OPTS));
    });
    it('differs for a different path', () => {
      expect(baseCache.entryName('/a/photo.orf', OPTS)).not.toBe(baseCache.entryName('/b/photo.orf', OPTS));
    });
    it('differs for different decode options (options-coherence)', () => {
      expect(baseCache.entryName('/a/photo.orf', { demosaic: 'dcb', highlightMode: 'blend' }))
        .not.toBe(baseCache.entryName('/a/photo.orf', { demosaic: 'ahd', highlightMode: 'off' }));
    });
    it('is filesystem-safe (hex + single dash, no path separators)', () => {
      expect(baseCache.entryName('C:\\Users\\me\\My Photos\\shot.orf', OPTS)).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
    });
  });

  describe('sidecarIsValid', () => {
    const meta = { sourceMtimeMs: 1000, sourceSize: 5000 };
    it('accepts a matching mtime + size', () => {
      expect(baseCache.sidecarIsValid(meta, { mtimeMs: 1000, size: 5000 })).toBe(true);
    });
    it('rejects a changed mtime', () => {
      expect(baseCache.sidecarIsValid(meta, { mtimeMs: 2000, size: 5000 })).toBe(false);
    });
    it('rejects a changed size', () => {
      expect(baseCache.sidecarIsValid(meta, { mtimeMs: 1000, size: 6000 })).toBe(false);
    });
    it('rejects a missing meta or stat', () => {
      expect(baseCache.sidecarIsValid(null, { mtimeMs: 1000, size: 5000 })).toBe(false);
      expect(baseCache.sidecarIsValid(meta, null)).toBe(false);
    });
  });

  describe('bufferToArrayBuffer (zero-copy on a full-span Buffer, slice otherwise)', () => {
    it('returns the SAME underlying ArrayBuffer (no copy) when the Buffer spans its whole backing store', () => {
      // Buffer.from(ArrayBuffer) views the ArrayBuffer with byteOffset 0 and full length — the
      // shape a large dedicated fs.readFile produces. bufferToArrayBuffer must hand it back as-is.
      const ab = new ArrayBuffer(48);
      new Uint8Array(ab).fill(9);
      const buf = Buffer.from(ab);
      const out = baseCache.bufferToArrayBuffer(buf);
      expect(out).toBe(ab);                 // same reference — zero copy
      expect(out.byteLength).toBe(48);
    });

    it('SLICES (copies) a partial view over a shared/pooled ArrayBuffer so no unrelated bytes leak', () => {
      const ab = new ArrayBuffer(48);
      new Uint8Array(ab).forEach((_, i, arr) => (arr[i] = i));
      const partial = Buffer.from(ab, 8, 16); // byteOffset 8, byteLength 16 over a 48-byte store
      const out = baseCache.bufferToArrayBuffer(partial);
      expect(out).not.toBe(ab);              // a fresh, copied ArrayBuffer
      expect(out.byteLength).toBe(16);       // exactly the view's length, not the whole 48
      expect(Array.from(new Uint8Array(out))).toEqual(Array.from({ length: 16 }, (_, i) => i + 8));
    });
  });

  describe('selectEvictions (LRU by lastAccess)', () => {
    const entries = [
      { key: 'old', size: 100, lastAccess: 1 },
      { key: 'mid', size: 100, lastAccess: 2 },
      { key: 'new', size: 100, lastAccess: 3 },
    ];
    it('evicts nothing when the incoming entry fits', () => {
      expect(baseCache.selectEvictions(entries, 50, 1000)).toEqual([]);
    });
    it('evicts the OLDEST first, just enough to fit', () => {
      // total 300 + incoming 100 = 400 > budget 350 → evict one (oldest).
      expect(baseCache.selectEvictions(entries, 100, 350)).toEqual(['old']);
    });
    it('evicts multiple oldest entries when needed', () => {
      // total 300 + incoming 100 = 400 > budget 200 → evict old then mid; remaining new(100) +
      // incoming(100) = 200 fits exactly, so `new` survives.
      expect(baseCache.selectEvictions(entries, 100, 200)).toEqual(['old', 'mid']);
    });
  });
});

describe('baseCache fs round-trip', () => {
  let dir: string;
  let src: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'basecache-test-'));
    src = path.join(dir, 'photo.orf');
    fs.writeFileSync(src, Buffer.alloc(4096, 7)); // a fake source RAW file for mtime/size provenance
    baseCache.init(dir, { budget: baseCache.DEFAULT_BUDGET_BYTES });
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('write then read round-trips the exact buffer + geometry (a cache HIT)', async () => {
    const payload = makePayload(8, 4, 4242);
    await baseCache.write(src, OPTS, payload);

    const hit = await baseCache.read(src, OPTS);
    expect(hit).not.toBeNull();
    expect(hit!.width).toBe(8);
    expect(hit!.height).toBe(4);
    expect(hit!.channels).toBe(3);
    expect(hit!.bitDepth).toBe(16);
    expect(new Uint16Array(hit!.data)[0]).toBe(4242);
    expect(hit!.data.byteLength).toBe(8 * 4 * 3 * 2);
  });

  it('is a MISS for different decode options (options-coherence)', async () => {
    await baseCache.write(src, { demosaic: 'dcb', highlightMode: 'blend' }, makePayload(8, 4, 1));
    expect(await baseCache.read(src, { demosaic: 'ahd', highlightMode: 'off' })).toBeNull();
  });

  it('INVALIDATES on a source mtime/size change and deletes the stale entry (miss)', async () => {
    await baseCache.write(src, OPTS, makePayload(8, 4, 9));
    expect(await baseCache.read(src, OPTS)).not.toBeNull();

    // Mutate the source file's size (and mtime) → the sidecar's recorded provenance no longer matches.
    fs.writeFileSync(src, Buffer.alloc(9000, 3));
    expect(await baseCache.read(src, OPTS)).toBeNull(); // stale → miss + delete

    // The stale .bin/.json were removed on the invalidating read (no lingering files for this key).
    const key = baseCache.entryName(src, OPTS);
    expect(fs.existsSync(path.join(dir, key + '.bin'))).toBe(false);
    expect(fs.existsSync(path.join(dir, key + '.json'))).toBe(false);
  });

  it('LRU-evicts the oldest entry at write time when the budget is exceeded', async () => {
    // Each makePayload(4,2) is 4*2*3*2 = 48 bytes. Budget fits 2 (96B), not 3 (144B): the third
    // write must evict the oldest.
    const srcA = path.join(dir, 'a.orf'); fs.writeFileSync(srcA, Buffer.alloc(10, 1));
    const srcB = path.join(dir, 'b.orf'); fs.writeFileSync(srcB, Buffer.alloc(10, 1));
    const srcC = path.join(dir, 'c.orf'); fs.writeFileSync(srcC, Buffer.alloc(10, 1));
    baseCache.init(dir, { budget: 100 }); // room for 2 × 48B payloads, not 3

    await baseCache.write(srcA, OPTS, makePayload(4, 2, 1)); // 96 bytes
    await new Promise((r) => setTimeout(r, 5));
    await baseCache.write(srcB, OPTS, makePayload(4, 2, 2));
    await new Promise((r) => setTimeout(r, 5));
    await baseCache.write(srcC, OPTS, makePayload(4, 2, 3)); // evicts A (oldest)

    expect(await baseCache.read(srcA, OPTS)).toBeNull();     // A evicted
    expect(await baseCache.read(srcB, OPTS)).not.toBeNull(); // B, C survive
    expect(await baseCache.read(srcC, OPTS)).not.toBeNull();
  });

  it('init rebuilds the in-memory index from an existing dir (survives a fresh init)', async () => {
    await baseCache.write(src, OPTS, makePayload(8, 4, 55));
    // Simulate a NEW session: re-init from the same dir. The entry must still be readable AND
    // counted by the index (so eviction accounting is correct across sessions).
    const count = baseCache.init(dir, { budget: baseCache.DEFAULT_BUDGET_BYTES });
    expect(count).toBe(1);
    const hit = await baseCache.read(src, OPTS);
    expect(hit).not.toBeNull();
    expect(new Uint16Array(hit!.data)[0]).toBe(55);
  });

  it('init sweeps *.tmp orphans (crash before the renames) — they never accumulate', async () => {
    // A crash between writeFile(tmp) and the renames leaves <key>.<ext>.<rnd>.tmp staging files
    // (~122MB each in production) that are invisible to the LRU budget. init must delete every
    // .tmp: no in-flight write survives a restart, so any .tmp at init time is garbage.
    await baseCache.write(src, OPTS, makePayload(8, 4, 55)); // one committed entry stays intact
    const orphanBin = path.join(dir, 'deadbeef-cafe0123.bin.k3xq9z.tmp');
    const orphanJson = path.join(dir, 'deadbeef-cafe0123.json.k3xq9z.tmp');
    fs.writeFileSync(orphanBin, Buffer.alloc(64, 1));
    fs.writeFileSync(orphanJson, '{"partial":true}');

    const count = baseCache.init(dir, { budget: baseCache.DEFAULT_BUDGET_BYTES });

    expect(fs.existsSync(orphanBin)).toBe(false);
    expect(fs.existsSync(orphanJson)).toBe(false);
    expect(count).toBe(1); // the committed entry survives the sweep
    expect(await baseCache.read(src, OPTS)).not.toBeNull();
  });
});
