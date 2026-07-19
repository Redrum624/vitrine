/**
 * Export-settings memory (v1.29.1) — the Export dialog remembers last-used
 * settings across sessions. Contract: durable preferences round-trip; per-image
 * fields (resize dims, filename) and the branding suffix are NEVER persisted;
 * corrupt/stale payloads degrade to defaults field-by-field.
 */
import { saveExportSettings, loadExportSettings, EXPORT_SETTINGS_KEY } from '../utils/exportSettingsStorage';
import { exportService, ExportOptions } from '../services/ExportService';

const defaults = (): ExportOptions => exportService.getDefaultOptions();

describe('exportSettingsStorage', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips durable preferences', () => {
    const opts = {
      ...defaults(),
      format: 'tiff' as const,
      quality: 77,
      bitDepth: 16 as const,
      colorSpace: 'adobergb' as const,
      compression: 'lzw' as const,
    };
    saveExportSettings(opts, 'D:\\exports');
    const loaded = loadExportSettings(defaults());
    expect(loaded.options.format).toBe('tiff');
    expect(loaded.options.quality).toBe(77);
    expect(loaded.options.bitDepth).toBe(16);
    expect(loaded.options.colorSpace).toBe('adobergb');
    expect(loaded.options.compression).toBe('lzw');
    expect(loaded.outputDirectory).toBe('D:\\exports');
  });

  test('never persists per-image fields or the suffix', () => {
    const opts = {
      ...defaults(),
      width: 1234,
      height: 567,
      filename: 'oneoff.jpg',
      suffix: '_FROZEN',
      resize: { width: 800 },
    };
    saveExportSettings(opts, undefined);
    const stored = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY)!);
    expect(stored.options.width).toBeUndefined();
    expect(stored.options.height).toBeUndefined();
    expect(stored.options.filename).toBeUndefined();
    expect(stored.options.suffix).toBeUndefined();
    expect(stored.options.resize).toBeUndefined();

    const loaded = loadExportSettings(defaults());
    expect(loaded.options.width).toBe(defaults().width);
    expect(loaded.options.filename).toBeUndefined();
    expect(loaded.options.suffix).toBe(defaults().suffix);
  });

  test('drops invalid enum values and out-of-range quality from a corrupt payload', () => {
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({
      options: { format: 'bmp', quality: 400, bitDepth: 12, colorSpace: 'srgb' },
      outputDirectory: 42,
    }));
    const loaded = loadExportSettings(defaults());
    expect(loaded.options.format).toBe(defaults().format);   // 'bmp' rejected
    expect(loaded.options.quality).toBe(defaults().quality); // 400 rejected
    expect(loaded.options.bitDepth).toBe(defaults().bitDepth); // 12 rejected
    expect(loaded.options.colorSpace).toBe('srgb');          // valid value kept
    expect(loaded.outputDirectory).toBe('');                 // non-string rejected
  });

  test('malformed JSON degrades to defaults', () => {
    localStorage.setItem(EXPORT_SETTINGS_KEY, '{not json');
    const loaded = loadExportSettings(defaults());
    expect(loaded.options).toEqual(defaults());
    expect(loaded.outputDirectory).toBe('');
  });

  test('empty storage returns defaults', () => {
    const loaded = loadExportSettings(defaults());
    expect(loaded.options).toEqual(defaults());
    expect(loaded.outputDirectory).toBe('');
  });
});
