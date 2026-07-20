/**
 * Creates the CPU pipeline worker in a way that survives PACKAGING.
 *
 * Two packaging traps, both verified live on the packaged exe (2026-07-20):
 *
 *  1. Vite only detects a worker entry when `new URL(...)` sits INLINE inside
 *     `new Worker(...)` (or via a `?worker` import). The previous split — URL
 *     in pipelineWorkerUrl.ts, `new Worker()` in WebWorkerImageProcessor —
 *     defeated that detection, so Vite emitted the RAW pipeline.worker.ts
 *     SOURCE as an asset and the packaged app asked Chromium to execute
 *     uncompiled TypeScript. `?worker&url` makes Vite bundle the entry as a
 *     real worker chunk (iife — pinned in vite.config.ts) and hands us its URL.
 *
 *  2. Chromium refuses ALL worker scripts on file:// pages — module AND
 *     classic, inside or outside app.asar — with an empty-message error event
 *     (the file-access-from-files rule). fetch() of the same URL succeeds, so
 *     under file:// we fetch the compiled chunk once and boot every pool
 *     worker from a blob: URL (CSP worker-src already allows blob:). The iife
 *     chunk is self-contained, so it runs identically from a blob.
 *
 * On the dev server (http://localhost) the URL is the dev-transformed module,
 * which must be loaded directly as a module worker — a blob copy would break
 * its relative imports.
 *
 * Isolated into its own file ON PURPOSE (same reason as createEnhanceWorker):
 * ts-jest cannot resolve the `?worker&url` specifier, so jest maps this module
 * to a stub (see jest.config.cjs moduleNameMapper).
 */
import pipelineWorkerChunkUrl from './pipeline.worker?worker&url';

let blobUrl: string | null = null;

export async function createPipelineWorker(): Promise<Worker> {
  if (globalThis.location?.protocol !== 'file:') {
    // Dev server / http preview: load the URL directly as a module worker.
    return new Worker(pipelineWorkerChunkUrl, { type: 'module' });
  }
  if (!blobUrl) {
    const response = await fetch(pipelineWorkerChunkUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch pipeline worker chunk (HTTP ${response.status})`);
    }
    const code = await response.text();
    // One blob URL serves every worker in the pool; it lives for the session.
    blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  return new Worker(blobUrl);
}
