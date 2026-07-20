// Memory-leak regression tests.
//
// 1. ImageProcessingPipeline module cache: full-resolution export processing must
//    NOT populate the per-module result cache (a 24MP export would park ~384MB
//    Float32 copies per module in the LRU, evicting the preview entries the
//    slider-drag fast path relies on and keeping hundreds of MB resident after
//    the export finishes). Preview processing must keep caching.
// 2. ThumbnailPanel data-URL cache: bounded with FIFO (oldest-inserted) eviction
//    so folders with thousands of files don't grow renderer memory without bound.
// 3. rawDecoder tmp dirs: a startup sweep purges stale photoapp-raw-* dirs left
//    behind when the per-decode best-effort cleanup never ran (crash/kill).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImageProcessingPipeline, setWorkerPool, type WorkerPoolLike } from '../services/ImageProcessingPipeline';
import { evictOldestThumbnails, MAX_THUMBNAIL_CACHE } from '../components/Panels/ThumbnailPanel';

const { sweepStaleRawTmpDirs } = require('../../electron/rawDecoder.cjs') as {
  sweepStaleRawTmpDirs: (opts?: { baseDir?: string; maxAgeMs?: number }) => number;
};

// ── helpers ──────────────────────────────────────────────────────────────────

const cacheSizeOf = (pipeline: ImageProcessingPipeline): number =>
  (pipeline as unknown as { moduleCache: { size(): number } }).moduleCache.size();

const makeImage = (w: number, h: number): Float32Array => {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0.25; data[i + 1] = 0.5; data[i + 2] = 0.75; data[i + 3] = 1;
  }
  return data;
};

describe('ImageProcessingPipeline module cache vs export path', () => {
  const w = 8, h = 8;
  const ctx = { width: w, height: h, channels: 4 };

  const makeNonIdentityPipeline = (): ImageProcessingPipeline => {
    const pipeline = new ImageProcessingPipeline();
    // Non-zero exposure makes basicadj non-identity, so it actually processes.
    const basicadj = pipeline.getModule('basicadj') as unknown as {
      setParams(p: Record<string, unknown>): void;
    };
    basicadj.setParams({ exposure: 0.5 });
    return pipeline;
  };

  it('caches module results for preview processing (default)', async () => {
    const pipeline = makeNonIdentityPipeline();
    await pipeline.processImage(makeImage(w, h), ctx, { useWebWorkers: false });
    expect(cacheSizeOf(pipeline)).toBeGreaterThan(0);
  });

  it('does NOT cache module results when cacheResults=false (export path)', async () => {
    const pipeline = makeNonIdentityPipeline();
    const out = await pipeline.processImage(makeImage(w, h), ctx, { useWebWorkers: false, cacheResults: false });
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(w * h * 4);
    expect(cacheSizeOf(pipeline)).toBe(0);
  });

  it('export-path processing produces the same pixels as cached preview processing', async () => {
    const a = await makeNonIdentityPipeline().processImage(makeImage(w, h), ctx, { useWebWorkers: false });
    const b = await makeNonIdentityPipeline().processImage(makeImage(w, h), ctx, { useWebWorkers: false, cacheResults: false });
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  // W4 R2: the worker route's main-thread FALLBACK must honor cacheResults=false too. Before this,
  // a bake/export develop pass whose worker run failed fell back via processOnMainThread(input,
  // context) — silently re-enabling caching and parking full-res module results after all.
  it('worker-path fallback to the main thread still honors cacheResults=false', async () => {
    const pipeline = makeNonIdentityPipeline();
    // 256x256 clears the small-preview floor so the pool is consulted; the pool then fails.
    const fw = 256, fh = 256;
    const failingPool: WorkerPoolLike = {
      shouldUseWorkers: () => true,
      processImage: async () => { throw new Error('pool exploded (test)'); },
    };
    setWorkerPool(failingPool);
    try {
      const out = await pipeline.processImage(
        makeImage(fw, fh), { width: fw, height: fh, channels: 4 },
        { useWebWorkers: true, cacheResults: false },
      );
      expect(out.length).toBe(fw * fh * 4);
      expect(cacheSizeOf(pipeline)).toBe(0);
    } finally {
      setWorkerPool(null as unknown as WorkerPoolLike);
    }
  });
});

describe('ThumbnailPanel thumbnail cache cap', () => {
  it('exposes a bounded cap constant', () => {
    expect(MAX_THUMBNAIL_CACHE).toBeGreaterThan(0);
    expect(MAX_THUMBNAIL_CACHE).toBeLessThanOrEqual(1000);
  });

  it('leaves maps at/below the cap untouched', () => {
    const map = new Map<string, string>([['a', '1'], ['b', '2']]);
    const out = evictOldestThumbnails(map, 2);
    expect(out).toBe(map); // mutates in place, no copy
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe('1');
  });

  it('evicts oldest-inserted entries first when over the cap', () => {
    const map = new Map<string, string>();
    for (let i = 0; i < 450; i++) map.set(`img-${i}`, `url-${i}`);
    evictOldestThumbnails(map, 400);
    expect(map.size).toBe(400);
    expect(map.has('img-0')).toBe(false);
    expect(map.has('img-49')).toBe(false);
    expect(map.has('img-50')).toBe(true);
    expect(map.has('img-449')).toBe(true);
  });

  it('uses the default cap when none is given', () => {
    const map = new Map<string, string>();
    for (let i = 0; i < MAX_THUMBNAIL_CACHE + 10; i++) map.set(`k${i}`, 'v');
    evictOldestThumbnails(map);
    expect(map.size).toBe(MAX_THUMBNAIL_CACHE);
  });
});

describe('rawDecoder stale tmp-dir sweep', () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const makeDir = (name: string, ageMs: number): string => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'input.orf'), 'x');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, t, t);
    return dir;
  };

  it('removes stale photoapp-raw-* dirs and keeps fresh + unrelated ones', () => {
    const stale = makeDir('photoapp-raw-aabbcc112233', 2 * 60 * 60 * 1000); // 2h old
    const fresh = makeDir('photoapp-raw-ddeeff445566', 0);                  // just now
    const other = makeDir('some-other-dir', 2 * 60 * 60 * 1000);            // old but unrelated

    const removed = sweepStaleRawTmpDirs({ baseDir: base, maxAgeMs: 60 * 60 * 1000 });

    expect(removed).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('ignores non-matching names and plain files, and never throws on a missing base dir', () => {
    fs.writeFileSync(path.join(base, 'photoapp-raw-001122334455'), 'a file, not a dir');
    expect(sweepStaleRawTmpDirs({ baseDir: base, maxAgeMs: 0 })).toBe(0);
    expect(sweepStaleRawTmpDirs({ baseDir: path.join(base, 'does-not-exist'), maxAgeMs: 0 })).toBe(0);
  });
});
