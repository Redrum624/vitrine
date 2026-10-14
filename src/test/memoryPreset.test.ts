import {
  computeMemoryBudgets, describeBudgets, BALANCED_BASE_CACHE_BYTES, BALANCED_PIPELINE_BYTES,
  BALANCED_DISK_CACHE_BYTES, BALANCED_PREVIEW_CAP,
} from '../utils/memoryPreset';

const main = require('../../electron/memoryPresetMain.cjs') as {
  diskBudget: (p: string) => number | undefined;
  readPresetSync: (dir: string) => string;
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('memoryPreset budgets', () => {
  test.each([0, 4 * GB, 8 * GB, 16 * GB, 64 * GB])('balanced is the current exact numbers at %d RAM', (ram) => {
    const b = computeMemoryBudgets('balanced', ram);
    expect(b.baseCacheBytes).toBe(700 * MB);
    expect(b.pipelineBytes).toBe(500 * MB);
    expect(b.diskCacheBytes).toBe(2 * GB);
    expect(b.previewCapMax).toBe(4096);
    expect(b.keepGpuBuffers).toBe(false);
    expect(BALANCED_BASE_CACHE_BYTES).toBe(700 * MB);
    expect(BALANCED_PIPELINE_BYTES).toBe(500 * MB);
    expect(BALANCED_DISK_CACHE_BYTES).toBe(2 * GB);
    expect(BALANCED_PREVIEW_CAP).toBe(4096);
  });

  test('high: min(25% RAM, 4 GB) base cache; scales with RAM and respects the cap', () => {
    expect(computeMemoryBudgets('high', 8 * GB).baseCacheBytes).toBe(2 * GB);
    expect(computeMemoryBudgets('high', 16 * GB).baseCacheBytes).toBe(4 * GB);
    expect(computeMemoryBudgets('high', 64 * GB).baseCacheBytes).toBe(4 * GB);
    expect(computeMemoryBudgets('high', 64 * GB).diskCacheBytes).toBe(4 * GB);
  });

  test('max: min(40% RAM, 8 GB) base cache; disk 8 GB', () => {
    expect(computeMemoryBudgets('max', 8 * GB).baseCacheBytes).toBe(Math.round(8 * GB * 0.4));
    expect(computeMemoryBudgets('max', 16 * GB).baseCacheBytes).toBe(Math.round(16 * GB * 0.4));
    expect(computeMemoryBudgets('max', 64 * GB).baseCacheBytes).toBe(8 * GB);
    expect(computeMemoryBudgets('max', 64 * GB).diskCacheBytes).toBe(8 * GB);
  });

  test('pipeline budget scales by the same factor as the base cache; never below Balanced', () => {
    const b = computeMemoryBudgets('high', 16 * GB);
    expect(b.pipelineBytes).toBe(Math.round(500 * MB * ((4 * GB) / (700 * MB))));
    const tiny = computeMemoryBudgets('high', 1 * GB);
    expect(tiny.baseCacheBytes).toBe(700 * MB);
    expect(tiny.pipelineBytes).toBe(500 * MB);
  });

  test('high/max raise the preview ceiling and keep GPU buffers', () => {
    for (const p of ['high', 'max'] as const) {
      const b = computeMemoryBudgets(p, 16 * GB);
      expect(b.previewCapMax).toBeGreaterThan(4096);
      expect(b.keepGpuBuffers).toBe(true);
    }
  });

  test('describeBudgets names every budget with numbers', () => {
    expect(describeBudgets(computeMemoryBudgets('max', 64 * GB)).join('\n')).toMatch(/8 GB in memory, 8 GB on disk/);
    expect(describeBudgets(computeMemoryBudgets('balanced', 16 * GB)).join('\n')).toMatch(/700 MB in memory, 2 GB on disk[\s\S]*500 MB[\s\S]*4096 px/);
  });

  test('main-process disk budget mirrors the renderer table', () => {
    expect(main.diskBudget('balanced')).toBeUndefined();
    expect(main.diskBudget('high')).toBe(computeMemoryBudgets('high', 16 * GB).diskCacheBytes);
    expect(main.diskBudget('max')).toBe(computeMemoryBudgets('max', 16 * GB).diskCacheBytes);
  });

  test('readPresetSync falls back to balanced when nothing is stored', () => {
    expect(main.readPresetSync('C:/definitely/not/here')).toBe('balanced');
  });
});
