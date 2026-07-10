/**
 * TDD for Task R2 (backlog round 3): the RAW base-image cache must hold MULTIPLE large bases
 * simultaneously, not just one. Before this fix, every __BASE__ entry shared the same 500MB
 * budget as sized/thumbnail entries, so a single ~310MB 20MP Float32 RGBA base already used
 * more than half of it — switching between two large RAWs (A -> B -> A) forced a re-decode of
 * whichever one got evicted.
 *
 * ImageCacheService now gives __BASE__ entries a DEDICATED budget (`baseMaxSize`, default
 * 700MB — see setBase()'s doc comment in ImageCacheService.ts for the sizing rationale),
 * tracked and evicted entirely independently of the shared budget used by sized/thumbnail
 * entries. These tests use proportionally scaled fixture sizes (via setLimits' 3-arg form)
 * rather than allocating real hundreds-of-megabytes buffers, matching the existing convention
 * in imageCacheOversizedEntry.test.ts.
 */
import { imageCacheService } from '../services/ImageCacheService';

// Scaled stand-in for a large RAW base: at real scale a 20MP Float32 RGBA decode is ~310MB
// against a 700MB base budget (~44% each, two of them ~89%). Reproduce the same ratio at test
// scale: a 1,000,000-byte (1MB) base budget holds two 400,000-byte "bases" (80% combined) with
// headroom below the 90% cleanup threshold (900,000 bytes) — mirroring the real 620MB/630MB
// relationship documented on setBase().
const BASE_BUDGET = 1_000_000;
const LARGE_BASE_FLOATS = 100_000; // Float32Array(100_000).byteLength === 400_000 bytes

const largeBase = () => new Float32Array(LARGE_BASE_FLOATS);

describe('ImageCacheService — dedicated multi-base budget (Task R2)', () => {
  beforeEach(() => {
    imageCacheService.clear();
    imageCacheService.setLimits(500 * 1024 * 1024, 100, BASE_BUDGET);
  });

  afterEach(() => {
    imageCacheService.clear();
    // Restore real defaults (500MB sized / 700MB base) for any test file that runs after this one.
    imageCacheService.setLimits(500 * 1024 * 1024, 100);
  });

  it('holds two large bases at once — both hit, no re-decode needed', () => {
    imageCacheService.setBase('/a.orf', largeBase(), 4000, 3000);
    imageCacheService.setBase('/b.orf', largeBase(), 4000, 3000);

    expect(imageCacheService.getBase('/a.orf')).not.toBeNull();
    expect(imageCacheService.getBase('/b.orf')).not.toBeNull();
    expect(imageCacheService.getStats().totalEntries).toBe(2);
  });

  it('A -> B -> A: switching back to the first RAW still serves it from cache', () => {
    imageCacheService.setBase('/a.orf', largeBase(), 4000, 3000);
    imageCacheService.setBase('/b.orf', largeBase(), 4000, 3000);

    // Switch back to A — this must be a cache hit, not a re-decode.
    const reopenedA = imageCacheService.getBase('/a.orf');
    expect(reopenedA).not.toBeNull();
    expect(reopenedA!.width).toBe(4000);

    // B must still be resident too — that's the whole point of the dedicated budget.
    expect(imageCacheService.getBase('/b.orf')).not.toBeNull();
  });

  it('a third large base evicts the LRU base ONLY — sized entries are never touched', () => {
    // A sized (non-base) entry sharing the same cache instance, well within the separate
    // shared budget.
    imageCacheService.set('/thumb.jpg', new Float32Array(10), 4, 1);

    imageCacheService.setBase('/a.orf', largeBase(), 4000, 3000); // oldest
    imageCacheService.setBase('/b.orf', largeBase(), 4000, 3000);
    // A third base pushes combined base usage (1,200,000 bytes) over the 900,000-byte cleanup
    // threshold — the LRU (oldest, least-recently-used) base, A, is evicted to make room.
    imageCacheService.setBase('/c.orf', largeBase(), 4000, 3000);

    expect(imageCacheService.getBase('/a.orf')).toBeNull(); // evicted
    expect(imageCacheService.getBase('/b.orf')).not.toBeNull(); // survives
    expect(imageCacheService.getBase('/c.orf')).not.toBeNull(); // just stored

    // The sized entry was never a candidate for a base eviction — different budget, different
    // eviction pool entirely.
    expect(imageCacheService.get('/thumb.jpg', 4, 1)).not.toBeNull();
  });

  it('a base larger than the base budget is refused, independent of the shared sized budget', () => {
    // Shared sized budget stays comfortably large (500MB); only the BASE budget is shrunk.
    imageCacheService.setLimits(500 * 1024 * 1024, 100, 1000);

    const survivorBase = new Float32Array(10); // 40 bytes, fits the 1000-byte base budget
    imageCacheService.setBase('/survivor.orf', survivorBase, 1, 1);
    expect(imageCacheService.getBase('/survivor.orf')).not.toBeNull();

    const oversizedBase = new Float32Array(300); // 1200 bytes > 1000-byte base budget
    imageCacheService.setBase('/oversized.orf', oversizedBase, 1, 1);
    expect(imageCacheService.getBase('/oversized.orf')).toBeNull();
    expect(imageCacheService.getBase('/survivor.orf')).not.toBeNull();

    // A sized entry of the SAME 1200-byte size is accepted: it's checked against the large
    // 500MB shared budget, not the tiny base budget — the two budgets are fully independent.
    imageCacheService.set('/big-thumb.jpg', new Float32Array(300), 20, 15);
    expect(imageCacheService.get('/big-thumb.jpg', 20, 15)).not.toBeNull();
  });
});
