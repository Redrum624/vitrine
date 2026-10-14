/**
 * Memory preset (v1.40.0): ONE user-facing control that scales the app's memory budgets.
 *
 *   balanced  today's exact limits (700 MB RAW base cache, 500 MB pipeline cache, 2 GB disk
 *             cache, 4096 px preview cap, default JS heap) for ANY installed RAM.
 *   high/max  scale with the installed RAM (os.totalmem() read in main, never assumed).
 *
 * No JS-heap setting: measured on Electron 43, js-flags --max-old-space-size above ~3.5 GB does
 * not raise the renderer heap limit (the default is already 3586 MB; V8 pointer-compression cap),
 * so it would be a no-op. Big pixel buffers are typed arrays (off-heap) and ARE governed by the
 * budgets below.
 *
 * Pure: preset + total RAM in, budgets out. electron/memoryPresetMain.cjs mirrors the disk number for the
 * main process; a parity test keeps both in step.
 */

export type MemoryPreset = 'balanced' | 'high' | 'max';
export const MEMORY_PRESET_KEY = 'memoryPreset';
export const DEFAULT_MEMORY_PRESET: MemoryPreset = 'balanced';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Today's values, verbatim (ImageCacheService, ImageProcessingPipeline, baseCache.cjs, previewQuality). */
export const BALANCED_BASE_CACHE_BYTES = 700 * MB;
export const BALANCED_PIPELINE_BYTES = 500 * MB;
export const BALANCED_DISK_CACHE_BYTES = 2 * GB;
export const BALANCED_PREVIEW_CAP = 4096;
/** Preview-cap ceiling for High/Max before the device's GL maxTextureSize clamp is applied. */
export const UNBOUNDED_PREVIEW_CAP = 16384;

export interface MemoryBudgets {
  preset: MemoryPreset;
  baseCacheBytes: number;
  pipelineBytes: number;
  diskCacheBytes: number;
  /** Preview-cap ceiling in px (clamped further by the device's GL max texture size at apply time). */
  previewCapMax: number;
  /** Keep resident GPU intermediate buffers allocated between frames. */
  keepGpuBuffers: boolean;
}

export function isMemoryPreset(v: unknown): v is MemoryPreset {
  return v === 'balanced' || v === 'high' || v === 'max';
}

export function computeMemoryBudgets(preset: MemoryPreset, totalRamBytes: number): MemoryBudgets {
  if (preset === 'balanced') {
    return {
      preset,
      baseCacheBytes: BALANCED_BASE_CACHE_BYTES,
      pipelineBytes: BALANCED_PIPELINE_BYTES,
      diskCacheBytes: BALANCED_DISK_CACHE_BYTES,
      previewCapMax: BALANCED_PREVIEW_CAP,
      keepGpuBuffers: false,
    };
  }
  const ram = Math.max(0, totalRamBytes || 0);
  const high = preset === 'high';
  const baseCacheBytes = Math.round(Math.min(ram * (high ? 0.25 : 0.4), (high ? 4 : 8) * GB));
  // Never below today's Balanced figure (tiny-RAM machines: a "High" that shrinks would be absurd).
  const base = Math.max(baseCacheBytes, BALANCED_BASE_CACHE_BYTES);
  return {
    preset,
    baseCacheBytes: base,
    pipelineBytes: Math.round(BALANCED_PIPELINE_BYTES * (base / BALANCED_BASE_CACHE_BYTES)),
    diskCacheBytes: (high ? 4 : 8) * GB,
    previewCapMax: UNBOUNDED_PREVIEW_CAP,
    keepGpuBuffers: true,
  };
}

export function formatBytesShort(bytes: number): string {
  return bytes >= GB ? `${+(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** One line per budget for the Settings readout. */
export function describeBudgets(b: MemoryBudgets): string[] {
  return [
    `RAW cache ${formatBytesShort(b.baseCacheBytes)} in memory, ${formatBytesShort(b.diskCacheBytes)} on disk`,
    `Pipeline cache ${formatBytesShort(b.pipelineBytes)}`,
    `Preview up to ${b.preset === 'balanced' ? `${b.previewCapMax} px` : 'full resolution (GPU limit)'}`,
  ];
}
