/**
 * Focused regression test for Task C1 fix round 1: ImageCacheService.cleanup()'s eviction
 * loop can never satisfy its own break condition when a single incoming entry is larger than
 * the entire cache budget (maxSize) — it would evict every other entry and still store the
 * oversized one. The fix refuses to store such an entry outright (see setWithKey in
 * ImageCacheService.ts) so a reopen of that image simply decodes fresh, while every other
 * entry already in the cache survives untouched.
 */
import { imageCacheService } from '../services/ImageCacheService';

describe('ImageCacheService — oversized entry rejection', () => {
  beforeEach(() => {
    imageCacheService.clear();
  });

  afterEach(() => {
    imageCacheService.clear();
    // Restore default limits so later test files aren't affected by this file's shrink.
    imageCacheService.setLimits(500 * 1024 * 1024, 100);
  });

  it('refuses to store a single entry larger than maxSize, leaving other entries intact', () => {
    // Shrink the budget so a tiny Float32Array counts as "oversized" without allocating
    // hundreds of megabytes just to exercise the guard. Base entries are accounted against
    // their OWN dedicated budget (Task R2), so it must be shrunk explicitly too.
    imageCacheService.setLimits(1000, 100, 1000); // 1000-byte sized budget, 1000-byte base budget

    // A survivor entry that fits comfortably within the shrunk budget.
    const survivorData = new Float32Array(10); // 40 bytes
    imageCacheService.setBase('/survivor.orf', survivorData, 1, 1, { isRaw: true });
    expect(imageCacheService.getBase('/survivor.orf')).not.toBeNull();

    // An entry whose byte size alone exceeds the whole budget.
    const oversizedData = new Float32Array(300); // 1200 bytes > 1000 max
    imageCacheService.setBase('/oversized.orf', oversizedData, 1, 1, { isRaw: true });

    // The oversized entry was never stored — a reopen of it will simply decode fresh.
    expect(imageCacheService.getBase('/oversized.orf')).toBeNull();
    // The pre-existing entry was NOT evicted to make room for the entry that got rejected.
    expect(imageCacheService.getBase('/survivor.orf')).not.toBeNull();
    expect(imageCacheService.getStats().totalEntries).toBe(1);
  });

  it('still evicts normally-sized entries via LRU when a fitting entry needs room', () => {
    imageCacheService.setLimits(1000, 100, 1000);

    const a = new Float32Array(50); // 200 bytes
    const b = new Float32Array(50); // 200 bytes
    const c = new Float32Array(150); // 600 bytes — fits alone, but forces cleanup with a+b present
    imageCacheService.setBase('/a.orf', a, 1, 1);
    imageCacheService.setBase('/b.orf', b, 1, 1);
    imageCacheService.setBase('/c.orf', c, 1, 1);

    // c fits within maxSize on its own, so unlike the oversized case it IS stored.
    expect(imageCacheService.getBase('/c.orf')).not.toBeNull();
  });
});
