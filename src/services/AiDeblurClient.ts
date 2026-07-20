/**
 * Renderer-side wrapper around the main-process AI motion deblur (NAFNet IPC). Mirrors
 * AiUpscaleClient exactly, with two deliberate differences:
 *
 * - `isAvailable()` resolves TRUE only when the main process bound DirectML (aiDeblur.cjs gates on
 *   `backend === 'directml'`). There is NO deterministic fallback for motion deblur, so a CPU-only
 *   machine reports unavailable and the Enhance panel HIDES the control (spike policy) instead of
 *   offering a multi-minute path. Cached after the first resolution.
 * - `run()` never changes dimensions (the result is the same size as the input).
 *
 * Degrades gracefully when `window.electronAPI` is absent (web/jsdom): unavailable + run rejects.
 */

export interface AiDeblurResult {
  data: Uint8Array;
  width: number;
  height: number;
  backend: string | null;
  /** Tiles whose model output failed the runner's garbage tripwire and kept their input pixels
   *  (W4 — see electron/aiDeblur.cjs tileOutputSane). Absent from older mains ⇒ treated as 0. */
  skippedTiles?: number;
}

export type AiDeblurProgress = (p: { done: number; total: number }) => void;

export class AiDeblurClient {
  private availabilityPromise: Promise<boolean> | null = null;

  isAvailable(): Promise<boolean> {
    if (!this.availabilityPromise) {
      const api = window.electronAPI;
      this.availabilityPromise = api
        ? api.aiDeblurAvailable().catch(() => false)
        : Promise.resolve(false);
    }
    return this.availabilityPromise;
  }

  async run(
    rgba: Uint8Array,
    width: number,
    height: number,
    onProgress?: AiDeblurProgress,
  ): Promise<AiDeblurResult> {
    const api = window.electronAPI;
    if (!api?.aiDeblur) throw new Error('AI motion deblur is not available in this environment');
    const unsubscribe = onProgress ? api.onAiDeblurProgress(onProgress) : undefined;
    try {
      return await api.aiDeblur(rgba, width, height);
    } finally {
      unsubscribe?.();
    }
  }

  /** Clear the cached capability (mainly for tests / after an environment change). */
  resetCache(): void {
    this.availabilityPromise = null;
  }
}

export const aiDeblurClient = new AiDeblurClient();
