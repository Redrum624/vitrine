/**
 * Round-6 P10: deterministic LRU-eviction ORDER for ImageCacheService.
 *
 * calculateLRUScore() ranks entries by `accessCount * 1000 - staleness`, where
 * staleness = Date.now() - lastAccessed. A test that sets several entries "back to back"
 * and then asserts WHICH one is evicted is implicitly betting that each set()/get() lands
 * in a distinguishable millisecond — false under a fast runner, where same-ms timestamps
 * collapse the staleness term to 0 and the assertion silently rides on Map insertion order
 * instead of the recency logic it means to exercise.
 *
 * These tests inject a clock via jest's fake system time (jest.setSystemTime): every
 * set/get happens at an EXPLICIT timestamp, so the staleness term — and therefore the
 * eviction order — is fully deterministic regardless of how fast (or same-ms) the runner is.
 * They complement imageCacheBaseBudget.test.ts (which asserts the dedicated base budget) by
 * pinning the ORDER in which the LRU picks its victim.
 *
 * Scaled fixtures (same convention as imageCacheBaseBudget.test.ts): a 1,000,000-byte base
 * budget holds two 400,000-byte "bases" (80%) under the 900,000-byte (90%) cleanup threshold;
 * a third forces exactly one eviction.
 */
import { imageCacheService } from '../services/ImageCacheService';

const BASE_BUDGET = 1_000_000;
const base = () => new Float32Array(100_000); // 400,000 bytes

describe('ImageCacheService — deterministic LRU eviction order (injected clock)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    imageCacheService.clear();
    imageCacheService.setLimits(500 * 1024 * 1024, 100, BASE_BUDGET);
  });

  afterEach(() => {
    imageCacheService.clear();
    imageCacheService.setLimits(500 * 1024 * 1024, 100); // restore real defaults
    jest.useRealTimers();
  });

  it('evicts the entry with the OLDEST lastAccessed when access counts are equal', () => {
    // Equal access counts (both untouched after set): the ONLY differentiator is staleness.
    jest.setSystemTime(1_000);
    imageCacheService.setBase('/a.orf', base(), 4000, 3000); // oldest
    jest.setSystemTime(5_000);
    imageCacheService.setBase('/b.orf', base(), 4000, 3000);

    // A third base forces one eviction. At t=9000 A's staleness (8000) > B's (4000), and both
    // have accessCount 0, so A scores lower and is the victim — deterministically, not by luck.
    jest.setSystemTime(9_000);
    imageCacheService.setBase('/c.orf', base(), 4000, 3000);

    expect(imageCacheService.getBase('/a.orf')).toBeNull();      // oldest → evicted
    expect(imageCacheService.getBase('/b.orf')).not.toBeNull();  // survives
    expect(imageCacheService.getBase('/c.orf')).not.toBeNull();  // just stored
  });

  it('a recently RE-ACCESSED older entry survives; the now-stale one is evicted instead', () => {
    jest.setSystemTime(1_000);
    imageCacheService.setBase('/a.orf', base(), 4000, 3000);
    jest.setSystemTime(2_000);
    imageCacheService.setBase('/b.orf', base(), 4000, 3000);

    // Touch A at t=3000 — its lastAccessed jumps ahead of B's, so A is now the more-recently
    // used entry even though it was inserted first. Eviction must follow recency, not insertion.
    jest.setSystemTime(3_000);
    expect(imageCacheService.getBase('/a.orf')).not.toBeNull();

    jest.setSystemTime(4_000);
    imageCacheService.setBase('/c.orf', base(), 4000, 3000);

    expect(imageCacheService.getBase('/a.orf')).not.toBeNull(); // touched → protected
    expect(imageCacheService.getBase('/b.orf')).toBeNull();     // now the stalest → evicted
    expect(imageCacheService.getBase('/c.orf')).not.toBeNull();
  });

  it('protects a frequently-accessed entry from eviction even when it is the oldest', () => {
    // A is oldest by insertion but hammered with accesses; B is newer but untouched. The
    // accessCount term (×1000) must dominate the staleness term, sparing A and evicting B.
    jest.setSystemTime(1_000);
    imageCacheService.setBase('/a.orf', base(), 4000, 3000);
    jest.setSystemTime(2_000);
    imageCacheService.setBase('/b.orf', base(), 4000, 3000);

    // Five accesses on A (each at the same explicit time so the test doesn't depend on ms drift).
    jest.setSystemTime(2_500);
    for (let i = 0; i < 5; i++) imageCacheService.getBase('/a.orf');

    jest.setSystemTime(3_000);
    imageCacheService.setBase('/c.orf', base(), 4000, 3000);

    expect(imageCacheService.getBase('/a.orf')).not.toBeNull(); // high access count → protected
    expect(imageCacheService.getBase('/b.orf')).toBeNull();     // untouched → evicted
    expect(imageCacheService.getBase('/c.orf')).not.toBeNull();
  });
});
