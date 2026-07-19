/**
 * Eager rating seeder — on folder load, reads every file's xmp:Rating into the
 * store so the rating filter sees ALL rated photos, not just the ones whose
 * thumbnails happened to mount (lazy loadThumbnail seeding was the only path
 * before, so a rated-but-never-scrolled-to photo vanished from filtered views
 * after a restart). Contract under test:
 *  - applies ratings > 0, skips null/0 results and read failures
 *  - caps concurrent reads
 *  - never reads the same path twice across passes (dedupe survives re-runs)
 *  - a new pass (folder switch) stops the remainder of the previous pass
 */

import { ImageFileInfo } from '../services/FileSystemService';

type Seeder = typeof import('../utils/ratingSeeder');

const img = (n: number, folder = 'A'): ImageFileInfo => ({
  id: `id${n}`,
  name: `img${n}.jpg`,
  path: `D:\\photos\\${folder}\\img${n}.jpg`,
  size: 1000,
  dateModified: new Date(2026, 0, n + 1),
  format: 'jpg',
} as unknown as ImageFileInfo);

describe('ratingSeeder', () => {
  let seeder: Seeder;

  beforeEach(() => {
    jest.resetModules();
    seeder = require('../utils/ratingSeeder');
  });

  test('applies ratings > 0 and skips null/0/failed reads', async () => {
    const ratings: Record<string, number | null> = { id1: 3, id2: 0, id3: null, id5: 5 };
    const read = jest.fn(async (p: string) => {
      const m = p.match(/img(\d+)/)!;
      if (m[1] === '4') throw new Error('unreadable');
      return ratings[`id${m[1]}`] ?? null;
    });
    const apply = jest.fn();

    await seeder.seedImageRatings([1, 2, 3, 4, 5].map((n) => img(n)), read, apply);

    expect(read).toHaveBeenCalledTimes(5);
    expect(apply.mock.calls).toEqual(expect.arrayContaining([['id1', 3], ['id5', 5]]));
    expect(apply).toHaveBeenCalledTimes(2);
  });

  test('caps concurrent reads at 8', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const read = jest.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });

    await seeder.seedImageRatings(Array.from({ length: 30 }, (_, i) => img(i + 1)), read, jest.fn());

    expect(read).toHaveBeenCalledTimes(30);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  test('dedupes by path across passes (watcher reload reads nothing twice)', async () => {
    const list = [1, 2, 3].map((n) => img(n));
    const read = jest.fn(async () => 2);
    const apply = jest.fn();

    await seeder.seedImageRatings(list, read, apply);
    await seeder.seedImageRatings(list, read, apply);

    expect(read).toHaveBeenCalledTimes(3);
  });

  test('a new pass cancels the remainder of the previous one', async () => {
    const resolvers: Array<() => void> = [];
    const readA = jest.fn((_p: string) => new Promise<number | null>((resolve) => {
      resolvers.push(() => resolve(null));
    }));

    // Pass A: 20 files, 8 reads start and block.
    const passA = seeder.seedImageRatings(Array.from({ length: 20 }, (_, i) => img(i + 1, 'A')), readA, jest.fn());
    await Promise.resolve();
    expect(readA).toHaveBeenCalledTimes(8);

    // Folder switch: pass B begins — pass A must not issue further reads.
    const readB = jest.fn(async () => null);
    const passB = seeder.seedImageRatings([img(1, 'B'), img(2, 'B')], readB, jest.fn());

    resolvers.forEach((r) => r());
    await passA;
    await passB;

    expect(readA).toHaveBeenCalledTimes(8); // the 12 remaining A-reads were dropped
    expect(readB).toHaveBeenCalledTimes(2);
  });

  test('files skipped by a canceled pass are seeded when their folder reopens', async () => {
    const blockers: Array<() => void> = [];
    const readA1 = jest.fn((_p: string) => new Promise<number | null>((resolve) => {
      blockers.push(() => resolve(null));
    }));
    const listA = Array.from({ length: 12 }, (_, i) => img(i + 1, 'A'));

    const passA1 = seeder.seedImageRatings(listA, readA1, jest.fn());
    await Promise.resolve();
    expect(readA1).toHaveBeenCalledTimes(8);

    // Switch away (cancels A's remaining 4), then come back to folder A.
    const passB = seeder.seedImageRatings([img(1, 'B')], jest.fn(async () => null), jest.fn());
    blockers.forEach((r) => r());
    await passA1;
    await passB;

    const readA2 = jest.fn(async () => null);
    await seeder.seedImageRatings(listA, readA2, jest.fn());
    expect(readA2).toHaveBeenCalledTimes(4); // exactly the canceled remainder
  });
});
