/**
 * Enhance preferences memory (v1.32.0, user request): the Enhance panel's
 * settings (sharpen/upscale toggles, scale, detail sliders, chroma clean, and
 * the Noise Reduction toggle/strength) are remembered across pictures and
 * sessions. Precedence mirrors the RAW decode defaults: a photo's own saved
 * per-image enhance state always wins; these prefs only seed a panel that is
 * still at factory defaults. The per-image `enabled` flag and durable bake
 * intents are NOT prefs — applying is always an explicit per-photo action.
 *
 * Persisted through the MAIN-PROCESS durable store (storeGet/storeSet), never
 * localStorage — a renderer localStorage write was live-proven to vanish when
 * the app quits shortly after. Saves are debounced (slider drags fire per
 * tick); the trailing snapshot wins.
 */
import { logger } from './Logger';

export const ENHANCE_PREFS_KEY = 'enhancePrefs';
const SAVE_DEBOUNCE_MS = 400;

export interface EnhancePrefs {
  sharpen?: boolean;
  upscale?: boolean;
  scale?: 2 | 4;
  denoiseStrength?: number;
  psfSigma?: number;
  rlIters?: number;
  alpha?: number;
  hpSigma?: number;
  sharpness?: number;
  chromaClean?: boolean;
  nrEnabled?: boolean;
  nrStrength?: number;
}

const BOOL_KEYS: (keyof EnhancePrefs)[] = ['sharpen', 'upscale', 'chromaClean', 'nrEnabled'];
const NUM_KEYS: (keyof EnhancePrefs)[] = ['denoiseStrength', 'psfSigma', 'rlIters', 'alpha', 'hpSigma', 'sharpness', 'nrStrength'];

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: EnhancePrefs | null = null;

export function saveEnhancePrefs(prefs: EnhancePrefs): void {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.storeSet) return;
    pending = prefs;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const payload = pending;
      pending = null;
      if (!payload) return;
      void window.electronAPI!.storeSet(ENHANCE_PREFS_KEY, payload)
        .catch((e) => logger.warn('Failed to save enhance prefs:', e));
    }, SAVE_DEBOUNCE_MS);
  } catch (e) {
    logger.warn('Failed to save enhance prefs:', e);
  }
}

/**
 * Flush a pending debounced save immediately (C4 finding 7): change-then-quit inside the
 * 400ms window lost the trailing snapshot — the exact tail-loss class this util exists to
 * prevent. Fire-and-forget is fine at quit time: the IPC invoke reaches the main process
 * synchronously, and main completes the durable-store write even if the window closes.
 */
export function flushPendingEnhancePrefs(): void {
  try {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const payload = pending;
    pending = null;
    if (!payload) return;
    if (typeof window === 'undefined' || !window.electronAPI?.storeSet) return;
    void window.electronAPI.storeSet(ENHANCE_PREFS_KEY, payload)
      .catch((e) => logger.warn('Failed to save enhance prefs:', e));
  } catch (e) {
    logger.warn('Failed to save enhance prefs:', e);
  }
}

// Quit-time safety net — registered once at module load (this module is a renderer-only util;
// `window` exists everywhere it is imported, and the guard keeps non-DOM contexts safe).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingEnhancePrefs);
}

/** Validated prefs, or null when unset/corrupt/no-Electron. */
export async function loadEnhancePrefs(): Promise<EnhancePrefs | null> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.storeGet) return null;
    const raw = await window.electronAPI.storeGet(ENHANCE_PREFS_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    const out: EnhancePrefs = {};
    for (const k of BOOL_KEYS) {
      if (typeof src[k] === 'boolean') (out as Record<string, unknown>)[k] = src[k];
    }
    for (const k of NUM_KEYS) {
      const v = src[k];
      if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, unknown>)[k] = v;
    }
    if (src.scale === 2 || src.scale === 4) out.scale = src.scale;
    return Object.keys(out).length ? out : null;
  } catch (e) {
    logger.warn('Failed to load enhance prefs:', e);
    return null;
  }
}
