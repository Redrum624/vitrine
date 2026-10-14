/**
 * Applies the memory preset (v1.40.0) to the live renderer services. Live-applicable limits take
 * effect immediately (no restart: see memoryPreset.ts for why there is no heap setting).
 */
import { imageCacheService } from './ImageCacheService';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { logger } from '../utils/Logger';
import {
  computeMemoryBudgets, DEFAULT_MEMORY_PRESET, isMemoryPreset, MEMORY_PRESET_KEY,
  type MemoryBudgets, type MemoryPreset,
} from '../utils/memoryPreset';
import { BASE_PREVIEW_CAP, probeMaxTextureSize, setKeepGpuBuffers, setPreviewCapCeiling } from '../utils/previewQuality';

let appliedPreset: MemoryPreset = DEFAULT_MEMORY_PRESET;
let totalRamBytes = 0;

export function getAppliedPreset(): MemoryPreset {
  return appliedPreset;
}

/** Installed RAM from main (os.totalmem). 0 when unavailable (non-Electron): High/Max then degrade to Balanced-like floors. */
export async function getTotalRamBytes(): Promise<number> {
  if (totalRamBytes > 0) return totalRamBytes;
  try {
    const info = await window.electronAPI?.getMemoryInfo?.();
    if (info && info.totalRamBytes > 0) totalRamBytes = info.totalRamBytes;
  } catch (e) {
    logger.warn('getMemoryInfo failed:', e);
  }
  return totalRamBytes;
}

export function budgetsFor(preset: MemoryPreset, ramBytes: number): MemoryBudgets {
  return computeMemoryBudgets(preset, ramBytes);
}

/** Apply `preset`'s live limits. Returns the budgets. */
export async function applyMemoryPreset(preset: MemoryPreset): Promise<MemoryBudgets> {
  const ram = await getTotalRamBytes();
  const budgets = computeMemoryBudgets(preset, ram);

  imageCacheService.setBaseBudget(budgets.baseCacheBytes);
  imageProcessingPipeline.setCacheBudget(budgets.pipelineBytes);
  const glMax = probeMaxTextureSize();
  const ceiling = preset === 'balanced' ? budgets.previewCapMax : Math.max(BASE_PREVIEW_CAP, Math.min(budgets.previewCapMax, glMax ?? budgets.previewCapMax));
  setPreviewCapCeiling(ceiling);
  setKeepGpuBuffers(budgets.keepGpuBuffers);
  try {
    await window.electronAPI?.setDiskCacheBudget?.(preset);
  } catch (e) {
    logger.warn('setDiskCacheBudget failed:', e);
  }
  appliedPreset = preset;
  return budgets;
}

export async function loadStoredPreset(): Promise<MemoryPreset> {
  try {
    const raw = await window.electronAPI?.storeGet?.(MEMORY_PRESET_KEY);
    if (isMemoryPreset(raw)) return raw;
  } catch (e) {
    logger.warn('Failed to load memory preset:', e);
  }
  return DEFAULT_MEMORY_PRESET;
}

/** App startup: apply the stored preset. Balanced is a no-op beyond defaults. */
export async function initMemoryPreset(): Promise<void> {
  const preset = await loadStoredPreset();
  await applyMemoryPreset(preset);
}
