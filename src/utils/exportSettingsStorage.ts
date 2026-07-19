/**
 * Export-settings memory (v1.29.1, user request): the Export dialog remembers
 * the last-used settings across sessions instead of resetting to defaults on
 * every open. Persisted in localStorage next to the presets store.
 *
 * Only DURABLE preferences are saved — never per-image values: `width`/
 * `height`/`resize` (seeded from the open image; restoring them would silently
 * resize a different photo), `filename` (per-export), `metadata` (per-photo
 * EXIF block). `suffix` is intentionally excluded too — it must follow the
 * app's branding default, not a value frozen the day it was saved.
 */
import type { ExportOptions } from '../services/ExportService';
import { logger } from './Logger';

export const EXPORT_SETTINGS_KEY = 'photo_editor_export_settings';

/** Durable, cross-image preference fields. */
const PERSISTED_FIELDS = [
  'format', 'quality', 'compression', 'progressive', 'compressionLevel',
  'lossless', 'resizeMode', 'maintainAspectRatio', 'colorSpace', 'bitDepth',
  'preserveMetadata', 'includeProcessingHistory', 'outputSharpening',
] as const;

type PersistedKey = typeof PERSISTED_FIELDS[number];

export interface StoredExportSettings {
  options: Partial<Pick<ExportOptions, PersistedKey>>;
  outputDirectory?: string;
}

export function saveExportSettings(options: ExportOptions, outputDirectory: string | undefined): void {
  try {
    const subset: Record<string, unknown> = {};
    for (const key of PERSISTED_FIELDS) {
      if (options[key] !== undefined) subset[key] = options[key];
    }
    const payload: StoredExportSettings = { options: subset, outputDirectory: outputDirectory || undefined };
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(payload));
  } catch (e) {
    logger.warn('Failed to save export settings:', e);
  }
}

/**
 * Load saved settings MERGED over the given defaults. Unknown/malformed fields
 * are dropped (whitelist); enum fields are checked against allowed values so a
 * corrupt or stale payload can never seed an invalid export.
 */
export function loadExportSettings(defaults: ExportOptions): { options: ExportOptions; outputDirectory: string } {
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_KEY);
    if (!raw) return { options: { ...defaults }, outputDirectory: '' };
    const parsed = JSON.parse(raw) as StoredExportSettings;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.options !== 'object' || !parsed.options) {
      return { options: { ...defaults }, outputDirectory: '' };
    }

    const src = parsed.options as Record<string, unknown>;
    const out: ExportOptions = { ...defaults };
    const enums: Record<string, unknown[]> = {
      format: ['jpeg', 'png', 'tiff', 'webp'],
      compression: ['none', 'lzw', 'zip', 'jpeg'],
      resizeMode: ['fit', 'fill', 'stretch', 'crop'],
      colorSpace: ['srgb', 'adobergb', 'prophoto', 'rec2020'],
      bitDepth: [8, 16],
    };
    for (const key of PERSISTED_FIELDS) {
      const v = src[key];
      if (v === undefined) continue;
      if (enums[key] && !enums[key].includes(v)) continue;
      if (key === 'quality' && (typeof v !== 'number' || v < 0 || v > 100)) continue;
      if (key === 'outputSharpening' && (typeof v !== 'object' || v === null)) continue;
      (out as unknown as Record<string, unknown>)[key] = v;
    }
    const dir = typeof parsed.outputDirectory === 'string' ? parsed.outputDirectory : '';
    return { options: out, outputDirectory: dir };
  } catch (e) {
    logger.warn('Failed to load export settings:', e);
    return { options: { ...defaults }, outputDirectory: '' };
  }
}
