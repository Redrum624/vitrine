/**
 * Task L4, Part B.2: the `maxEntries` entries backstop used to count the WHOLE cache
 * (`this.cache.size`, sized + base entries combined) while cleanup() only ever evicts entries
 * from the SAME category as the incoming one. So a category with many small entries (sized/
 * thumbnail) could push the combined count over `maxEntries` and trip cleanup for an unrelated
 * incoming BASE entry — which then evicted base entries (expensive RAW decodes) trying to
 * satisfy a count target it could never reach that way, since the sized entries pushing the
 * total over the limit were never candidates for removal. Fixed by counting entries per
 * category (categoryEntryCount) in both shouldCleanup and cleanup's break condition.
 *
 * Matches the fixture-scaling convention in imageCacheBaseBudget.test.ts (proportionally scaled
 * sizes/counts rather than real hundreds-of-MB buffers).
 */
import { imageCacheService } from '../services/ImageCacheService';

const MAX_ENTRIES = 3;

describe('ImageCacheService — maxEntries backstop is per-category, not whole-cache (Task L4)', () => {
  beforeEach(() => {
    imageCacheService.clear();
    imageCacheService.setLimits(500 * 1024 * 1024, MAX_ENTRIES, 700 * 1024 * 1024);
  });

  afterEach(() => {
    imageCacheService.clear();
    // Restore real defaults for any test file that runs after this one.
    imageCacheService.setLimits(500 * 1024 * 1024, 100);
  });

  it('many sized entries at the entries cap do NOT evict a base entry when a new base arrives', () => {
    // Fill the SIZED category up to (and slightly past) maxEntries=3.
    imageCacheService.set('/thumb1.jpg', new Float32Array(4), 1, 1);
    imageCacheService.set('/thumb2.jpg', new Float32Array(4), 1, 1);
    imageCacheService.set('/thumb3.jpg', new Float32Array(4), 1, 1);
    imageCacheService.set('/thumb4.jpg', new Float32Array(4), 1, 1);
    expect(imageCacheService.getStats().totalEntries).toBeGreaterThanOrEqual(MAX_ENTRIES);

    // A single base entry, well within its own (tiny, 1-entry) category count and size budget.
    imageCacheService.setBase('/a.orf', new Float32Array(100), 10, 10);

    // Before the fix: the combined cache.size (>= maxEntries from the sized entries alone) would
    // trip shouldCleanup for this base write and cleanup() would try to evict BASE entries to
    // satisfy a whole-cache count target it could never reach that way — here that means it
    // would evict the base entry we just stored (the only candidate in its category).
    expect(imageCacheService.getBase('/a.orf')).not.toBeNull();
  });

  it('a base entry is evicted when the BASE category itself exceeds maxEntries, independent of sized-entry count', () => {
    // Sized category stays comfortably empty — irrelevant to base-category eviction.
    imageCacheService.setBase('/a.orf', new Float32Array(10), 1, 1); // oldest
    imageCacheService.setBase('/b.orf', new Float32Array(10), 1, 1);
    imageCacheService.setBase('/c.orf', new Float32Array(10), 1, 1);
    // A 4th base entry pushes the BASE category's own count (4) over maxEntries=3 — THIS
    // category's own oldest/least-used entry should be evicted.
    imageCacheService.setBase('/d.orf', new Float32Array(10), 1, 1);

    expect(imageCacheService.getBase('/a.orf')).toBeNull(); // evicted — base category's own overflow
    expect(imageCacheService.getBase('/d.orf')).not.toBeNull(); // just stored
  });

  it('many base entries at the entries cap do NOT evict a sized entry when a new sized entry arrives', () => {
    imageCacheService.setBase('/a.orf', new Float32Array(10), 1, 1);
    imageCacheService.setBase('/b.orf', new Float32Array(10), 1, 1);
    imageCacheService.setBase('/c.orf', new Float32Array(10), 1, 1);
    expect(imageCacheService.getStats().totalEntries).toBeGreaterThanOrEqual(MAX_ENTRIES);

    imageCacheService.set('/thumb.jpg', new Float32Array(4), 1, 1);

    expect(imageCacheService.get('/thumb.jpg', 1, 1)).not.toBeNull();
  });
});
