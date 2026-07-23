/**
 * Pure sizing/caching policy for the `read-image-as-data-url` RAW-preview branch
 * (Task R4, v1.37.0). Extracted from main.cjs so it's unit-testable under node-env
 * jest (main.cjs requires('electron') at module scope) — same precedent as
 * writePathPolicy.cjs / baseCache.cjs. Tested by src/test/rawReferenceMaxDim.test.ts.
 *
 * Why: the handler used to hard-resize every RAW embedded preview into a 512×512
 * gallery-thumb box, so a RAW dropped on the reference compare pane rendered as a
 * ~512px postage stamp in a half-workspace pane. Callers can now request a larger
 * box (the reference pane asks for 2560); gallery/filmstrip callers pass nothing
 * and keep the 512 default.
 *
 * Cache policy: rawThumbCache in main.cjs is COUNT-bounded (2000 entries), sized
 * for ~100KB gallery thumbs — 2000 reference-sized entries (~1-3MB data-URLs at
 * 2560px) would be gigabytes. So entries larger than the default box are NOT
 * cached (`cacheable: false`): a reference drop is a one-shot user action and
 * re-extracting the embedded JPEG on a repeat drop is cheap. Keys are size-aware
 * (`${maxDim}:${filePath}`) so a large request can never be served a stale 512
 * thumb, and differently-sized cacheable entries never collide.
 */

const RAW_THUMB_DEFAULT_DIM = 512;

/**
 * @param {string} filePath absolute path of the RAW file
 * @param {{ maxDim?: unknown } | null | undefined} options renderer-supplied options
 * @returns {{ maxDim: number, cacheable: boolean, cacheKey: string }}
 */
function resolveRawThumbRequest(filePath, options) {
  const requested = options && typeof options === 'object' ? options.maxDim : undefined;
  const maxDim =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : RAW_THUMB_DEFAULT_DIM;
  return {
    maxDim,
    cacheable: maxDim <= RAW_THUMB_DEFAULT_DIM,
    cacheKey: `${maxDim}:${filePath}`,
  };
}

module.exports = { RAW_THUMB_DEFAULT_DIM, resolveRawThumbRequest };
