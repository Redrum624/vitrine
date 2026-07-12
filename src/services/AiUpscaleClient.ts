/**
 * Renderer-side wrapper around the main-process AI upscaler (Task 3/4 IPC).
 *
 * - `isAvailable()` is cached after the first resolution (capability doesn't change at runtime).
 * - `run()` subscribes to per-tile progress for the duration of the call and unsubscribes after.
 * - Degrades gracefully when `window.electronAPI` is absent (web/jsdom): unavailable + run rejects,
 *   so EnhanceService can route to the deterministic path.
 */

export interface AiUpscaleResult {
  data: Uint8Array;
  width: number;
  height: number;
  backend: string | null;
}

export type AiUpscaleProgress = (p: { done: number; total: number }) => void;

export class AiUpscaleClient {
  private availabilityPromise: Promise<boolean> | null = null;

  isAvailable(): Promise<boolean> {
    if (!this.availabilityPromise) {
      const api = window.electronAPI;
      this.availabilityPromise = api
        ? api.aiUpscaleAvailable().catch(() => false)
        : Promise.resolve(false);
    }
    return this.availabilityPromise;
  }

  async run(
    rgba: Uint8Array,
    width: number,
    height: number,
    scale: 2 | 4,
    onProgress?: AiUpscaleProgress,
  ): Promise<AiUpscaleResult> {
    const api = window.electronAPI;
    if (!api?.aiUpscale) throw new Error('AI upscale is not available in this environment');
    const unsubscribe = onProgress ? api.onAiUpscaleProgress(onProgress) : undefined;
    try {
      return await api.aiUpscale(rgba, width, height, scale);
    } finally {
      unsubscribe?.();
    }
  }

  /** Clear the cached capability (mainly for tests / after an environment change). */
  resetCache(): void {
    this.availabilityPromise = null;
  }
}

export const aiUpscaleClient = new AiUpscaleClient();
