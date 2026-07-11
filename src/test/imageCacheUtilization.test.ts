/**
 * P6 item 4: ImageCacheService.getUtilization must report PER-CATEGORY utilization, not only the
 * combined ratio. The sized and base budgets are evicted independently, so a combined figure can
 * hide one exhausted category behind the much larger other budget's headroom — a monitor watching
 * only `size` would miss a base-cache that is thrashing at ~100%.
 */
import { imageCacheService } from '../services/ImageCacheService';

describe('ImageCacheService.getUtilization — per-category (P6 item 4)', () => {
  beforeEach(() => {
    imageCacheService.clear();
    // sized budget 1000 bytes, base budget 1000 bytes, 100 entries.
    imageCacheService.setLimits(1000, 100, 1000);
  });

  afterEach(() => {
    imageCacheService.clear();
    // Restore real defaults for any test file that runs after this one.
    imageCacheService.setLimits(500 * 1024 * 1024, 100);
  });

  it('keeps the combined `size`/`entries` fields for backwards-compat', () => {
    const u = imageCacheService.getUtilization();
    expect(u).toHaveProperty('size');
    expect(u).toHaveProperty('entries');
    expect(u.size).toBe(0);
    expect(u.entries).toBe(0);
  });

  it('reports base and sized utilization independently — the combined ratio masks base exhaustion', () => {
    // A base entry filling ~80% of the 1000-byte base budget (200 floats * 4 = 800 bytes). The
    // sized category stays empty.
    imageCacheService.setBase('/a.orf', new Float32Array(200), 10, 20);

    const u = imageCacheService.getUtilization();
    expect(u.base.size).toBe(80);  // base budget 80% full…
    expect(u.sized.size).toBe(0);  // …sized budget empty
    // The combined figure hides it: 800 / (1000 + 1000) = 40%.
    expect(u.size).toBe(40);
  });

  it('reports sized utilization independently of the base budget', () => {
    // A sized entry filling ~40% of the 1000-byte sized budget (100 floats * 4 = 400 bytes).
    imageCacheService.set('/thumb.jpg', new Float32Array(100), 5, 20);

    const u = imageCacheService.getUtilization();
    expect(u.sized.size).toBe(40);
    expect(u.base.size).toBe(0);
    expect(u.size).toBe(20); // 400 / 2000
  });
});
