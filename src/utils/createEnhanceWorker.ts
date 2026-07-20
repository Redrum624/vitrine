/**
 * Creates the enhance worker in a way that survives PACKAGING — the exact
 * createPipelineWorker pattern (see src/workers/createPipelineWorker.ts for the
 * full two-trap story, both verified live on the packaged exe, 2026-07-20):
 *
 *  1. `?worker&url` makes Vite bundle the entry as a real self-contained worker
 *     chunk (iife — pinned in vite.config.ts) and hands us its URL. (The old
 *     inline `new Worker(new URL(...))` pattern here DID compile the chunk, but
 *     trap 2 still applied.)
 *  2. Chromium refuses ALL worker scripts on file:// pages — module AND classic
 *     (W1 Probe B: the compiled enhance chunk itself failed with an
 *     empty-message error event). fetch() of the same URL succeeds, so under
 *     file:// we fetch the compiled chunk once and boot from a blob: URL (CSP
 *     worker-src already allows blob:). Until W4 this left the packaged enhance
 *     worker DEAD — every EnhanceWorkerClient run crashed at boot.
 *
 * On the dev server (http://localhost) the URL is the dev-transformed module,
 * which must be loaded directly as a module worker — a blob copy would break
 * its relative imports.
 *
 * Isolated into its own file ON PURPOSE: ts-jest cannot resolve the
 * `?worker&url` specifier, so jest maps this module to a stub (see
 * jest.config.cjs moduleNameMapper).
 */
import enhanceWorkerChunkUrl from '../workers/enhance.worker?worker&url';

let blobUrl: string | null = null;

export async function createEnhanceWorker(): Promise<Worker> {
  if (globalThis.location?.protocol !== 'file:') {
    // Dev server / http preview: load the URL directly as a module worker.
    return new Worker(enhanceWorkerChunkUrl, { type: 'module' });
  }
  if (!blobUrl) {
    const response = await fetch(enhanceWorkerChunkUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch enhance worker chunk (HTTP ${response.status})`);
    }
    const code = await response.text();
    // One blob URL serves every boot; it lives for the session.
    blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  return new Worker(blobUrl);
}
