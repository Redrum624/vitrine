import { imageCacheService } from '../services/ImageCacheService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { applyMemoryPreset, initMemoryPreset } from '../services/memoryPresetRuntime';
import { computeRequiredPreviewCap, getKeepGpuBuffers, getPreviewCapCeiling } from '../utils/previewQuality';
import { computeMemoryBudgets } from '../utils/memoryPreset';
import { useAppStore } from '../stores/appStore';
import { LRUCache } from '../utils/LRUCache';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('memory preset runtime', () => {
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getMemoryInfo: jest.fn(async () => ({ totalRamBytes: 16 * GB, measuredHeapLimitMB: 3586 })),
      setDiskCacheBudget: jest.fn(async () => true),
      storeGet: jest.fn(async (k: string) => store[k] ?? null),
    };
  });
  afterEach(async () => {
    await applyMemoryPreset('balanced');
    imageCacheService.clear();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const cap = () => computeRequiredPreviewCap({ zoom: 8, cropFraction: 1, nativeLongEdge: 8000 });

  test('switching preset resizes the base budget and the preview cap follows', async () => {
    const max = computeMemoryBudgets('max', 16 * GB);
    await applyMemoryPreset('max', () => 16384);
    expect(imageCacheService.getBaseBudget()).toBe(max.baseCacheBytes);
    expect(imageProcessingPipeline.getCacheBudget()).toBe(max.pipelineBytes);
    expect(max.baseCacheBytes + max.pipelineBytes).toBeLessThanOrEqual(16 * GB * 0.4 + 1);
    expect(cap()).toBeGreaterThan(4096);
    expect(getKeepGpuBuffers()).toBe(true);
    await applyMemoryPreset('balanced');
    expect(imageCacheService.getBaseBudget()).toBe(700 * MB);
    expect(imageProcessingPipeline.getCacheBudget()).toBe(500 * MB);
    expect(cap()).toBe(4096);
    expect(getKeepGpuBuffers()).toBe(false);
  });

  test('GL max clamps the High/Max ceiling; no WebGL2 keeps 4096; Balanced never probes', async () => {
    await applyMemoryPreset('max', () => 8192);
    expect(getPreviewCapCeiling()).toBe(8192);
    await applyMemoryPreset('high', () => 2048); // below today's cap: device limit still wins
    expect(getPreviewCapCeiling()).toBe(2048);
    await applyMemoryPreset('max', () => null);
    expect(getPreviewCapCeiling()).toBe(4096);
    const probe = jest.fn(() => 16384);
    await applyMemoryPreset('balanced', probe);
    expect(probe).not.toHaveBeenCalled();
    expect(getPreviewCapCeiling()).toBe(4096);
  });

  test('lowering the preset lowers an already-ratcheted store cap and reprocesses', async () => {
    await applyMemoryPreset('max', () => 16384);
    useAppStore.getState().setPreviewQualityCap(12000);
    const before = useAppStore.getState().processingVersion;
    await applyMemoryPreset('balanced');
    expect(useAppStore.getState().previewQualityCap).toBe(4096);
    expect(useAppStore.getState().processingVersion).toBeGreaterThan(before);
    useAppStore.getState().setPreviewQualityCap(1024);
    await applyMemoryPreset('max', () => 16384);
    useAppStore.getState().setPreviewQualityCap(2000);
    await applyMemoryPreset('high', () => 16384);
    expect(useAppStore.getState().previewQualityCap).toBe(2000); // under the ceiling: untouched
  });

  test('shrinking evicts bases down to the new budget immediately', () => {
    imageCacheService.setLimits(500 * MB, 100, 1_000_000);
    for (let i = 0; i < 4; i++) imageCacheService.setBase(`/f${i}.orf`, new Float32Array(50_000), 100, 100); // 200 KB each
    imageCacheService.setBaseBudget(300_000);
    expect(imageCacheService.getUtilization().base.size).toBeLessThanOrEqual(100);
    expect(imageCacheService.getBaseBudget()).toBe(300_000);
    imageCacheService.setLimits(500 * MB, 100);
  });

  test('pipeline module cache budget shrinks and evicts', () => {
    const c = new LRUCache<{ n: number }>({ maxSize: 10, maxMemory: 1000 });
    for (let i = 0; i < 5; i++) c.set(`k${i}`, { n: i }, 200);
    expect(c.setMaxMemory(400)).toBeGreaterThan(0);
    expect(c.getStats().memoryUsage).toBeLessThanOrEqual(400);
    expect(() => imageProcessingPipeline.setCacheBudget(600 * MB)).not.toThrow();
    imageProcessingPipeline.setCacheBudget(500 * MB);
  });

  test('disk budget is pushed to main for the preset', async () => {
    await applyMemoryPreset('high');
    const api = (window as unknown as { electronAPI: { setDiskCacheBudget: jest.Mock } }).electronAPI;
    expect(api.setDiskCacheBudget).toHaveBeenCalledWith('high');
  });

  test('init applies the stored preset; garbage falls back to balanced', async () => {
    store.memoryPreset = 'high';
    await initMemoryPreset();
    expect(imageCacheService.getBaseBudget()).toBe(computeMemoryBudgets('high', 16 * GB).baseCacheBytes);
    store.memoryPreset = 'bogus';
    await initMemoryPreset();
    expect(imageCacheService.getBaseBudget()).toBe(700 * MB);
  });
});
