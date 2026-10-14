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

  test.each([
    ['high', 0.25],
    ['max', 0.4],
  ] as const)('%s: base + pipeline TOGETHER never exceed %d of RAM (8/16/64 GB)', (preset, frac) => {
    for (const ram of [8 * GB, 16 * GB, 64 * GB]) {
      const b = computeMemoryBudgets(preset, ram);
      expect(b.baseCacheBytes + b.pipelineBytes).toBeLessThanOrEqual(Math.ceil(ram * frac));
      // split in today's 700:500 proportion
      expect(b.pipelineBytes / b.baseCacheBytes).toBeCloseTo(500 / 700, 3);
      expect(b.baseCacheBytes).toBeLessThanOrEqual((preset === 'high' ? 4 : 8) * GB);
      expect(b.baseCacheBytes).toBeGreaterThanOrEqual(700 * MB);
    }
  });

  test('exact fixtures: the combined pool is the preset fraction until the absolute cap bites', () => {
    const h8 = computeMemoryBudgets('high', 8 * GB); // pool 2 GB
    expect(h8.baseCacheBytes).toBe(Math.floor(2 * GB * (7 / 12)));
    const m16 = computeMemoryBudgets('max', 16 * GB); // pool 6.4 GB
    expect(m16.baseCacheBytes + m16.pipelineBytes).toBeCloseTo(16 * GB * 0.4, -2);
    expect(computeMemoryBudgets('high', 64 * GB).baseCacheBytes).toBe(4 * GB); // cap
    expect(computeMemoryBudgets('max', 64 * GB).baseCacheBytes).toBe(8 * GB); // cap
    expect(computeMemoryBudgets('max', 64 * GB).diskCacheBytes).toBe(8 * GB);
    expect(computeMemoryBudgets('high', 64 * GB).diskCacheBytes).toBe(4 * GB);
  });

  test('never below Balanced on tiny-RAM machines', () => {
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
