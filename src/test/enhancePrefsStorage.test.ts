/**
 * Enhance preferences memory (v1.32.0) — durable-store persistence for the
 * Enhance panel's settings. Contract: debounced save writes the TRAILING
 * snapshot; load validates field-by-field (types, scale enum) and returns null
 * for unset/corrupt/no-Electron.
 */
import { saveEnhancePrefs, loadEnhancePrefs, ENHANCE_PREFS_KEY } from '../utils/enhancePrefsStorage';

describe('enhancePrefsStorage', () => {
  let mem: Record<string, unknown>;

  beforeEach(() => {
    jest.useFakeTimers();
    mem = {};
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      storeGet: jest.fn(async (k: string) => (k in mem ? mem[k] : null)),
      storeSet: jest.fn(async (k: string, v: unknown) => { mem[k] = v; return true; }),
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  test('debounced save writes the trailing snapshot only', async () => {
    saveEnhancePrefs({ sharpness: 0.1 });
    saveEnhancePrefs({ sharpness: 0.5 });
    saveEnhancePrefs({ sharpness: 0.9, scale: 4 });
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    const api = (window as unknown as { electronAPI: { storeSet: jest.Mock } }).electronAPI;
    expect(api.storeSet).toHaveBeenCalledTimes(1);
    expect(mem[ENHANCE_PREFS_KEY]).toEqual({ sharpness: 0.9, scale: 4 });
  });

  test('round-trips a full snapshot', async () => {
    const prefs = {
      sharpen: true, upscale: false, scale: 2 as const,
      denoiseStrength: 30, psfSigma: 1.1, rlIters: 10,
      alpha: 0.7, hpSigma: 1.4, sharpness: 0.6, chromaClean: false,
      nrEnabled: true, nrStrength: 65,
    };
    saveEnhancePrefs(prefs);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(await loadEnhancePrefs()).toEqual(prefs);
  });

  test('drops invalid fields and keeps valid ones', async () => {
    mem[ENHANCE_PREFS_KEY] = { sharpness: 'high', scale: 3, nrStrength: 55, chromaClean: 'yes', sharpen: true };
    expect(await loadEnhancePrefs()).toEqual({ sharpen: true, nrStrength: 55 });
  });

  test('unset store yields null', async () => {
    expect(await loadEnhancePrefs()).toBeNull();
  });

  test('no electronAPI yields null and save is a no-op', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(() => saveEnhancePrefs({ sharpness: 0.5 })).not.toThrow();
    expect(await loadEnhancePrefs()).toBeNull();
  });
});
