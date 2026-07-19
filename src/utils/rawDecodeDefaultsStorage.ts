/**
 * RAW Decode defaults memory (v1.31.0, user request): the last decode options
 * the user actively chose (committed by a successful re-decode in the RAW
 * Decode panel) become the DEFAULT for RAW files that have no per-image saved
 * options — across pictures AND across sessions. Per-image persistence is
 * untouched: a photo you already opened keeps ITS OWN saved options; this only
 * replaces the factory fallback (DCB / blend / camera match) for never-opened
 * files.
 *
 * Persisted through the MAIN-PROCESS durable store (storeGet/storeSet — the
 * same %APPDATA% JSON store the per-image edits live in), NOT localStorage:
 * live-diagnosed that a renderer localStorage write can be LOST when the app
 * quits shortly after (S1 wrote the key, S2 launch read null). The main-process
 * write survives any renderer teardown.
 */
import { DEFAULT_RAW_DECODE_OPTIONS, type RawDecodeOptions } from '../types/electron';
import { isValidRawDecodeOptions } from '../services/EditPersistenceService';
import { logger } from './Logger';

export const RAW_DECODE_DEFAULTS_KEY = 'rawDecodeDefaults';

export function saveRawDecodeDefaults(options: RawDecodeOptions): void {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.storeSet) return;
    const payload: RawDecodeOptions = {
      demosaic: options.demosaic,
      highlightMode: options.highlightMode,
      // Persist an EXPLICIT boolean: absent means "pre-feature look" in the
      // per-image store, but as a user default the choice is always concrete.
      cameraMatch: !!options.cameraMatch,
    };
    void window.electronAPI.storeSet(RAW_DECODE_DEFAULTS_KEY, payload)
      .catch((e) => logger.warn('Failed to save RAW decode defaults:', e));
  } catch (e) {
    logger.warn('Failed to save RAW decode defaults:', e);
  }
}

/** The user's saved defaults, or the factory defaults when unset/corrupt. */
export async function loadRawDecodeDefaults(): Promise<RawDecodeOptions> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.storeGet) {
      return { ...DEFAULT_RAW_DECODE_OPTIONS };
    }
    const saved = await window.electronAPI.storeGet(RAW_DECODE_DEFAULTS_KEY);
    // Same validator the per-image persistence uses — one source of truth for
    // what a legal decode-options shape is.
    if (isValidRawDecodeOptions(saved)) return { ...saved };
  } catch (e) {
    logger.warn('Failed to load RAW decode defaults:', e);
  }
  return { ...DEFAULT_RAW_DECODE_OPTIONS };
}
