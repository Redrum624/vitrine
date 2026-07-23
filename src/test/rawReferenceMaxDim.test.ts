/**
 * Task R4 (v1.37.0): RAW reference loads at pane resolution, not gallery-thumb size.
 *
 * Bug: the reference compare pane (drag a filmstrip photo onto the left pane;
 * App.tsx handleReferenceDrop) loads the image via the shared thumbnail IPC
 * `read-image-as-data-url`. For RAW extensions that handler extracts the embedded
 * JPEG and hard-resized it into a 512×512 box (sized for gallery tiles), so a RAW
 * reference rendered as a ~512px postage stamp in a half-workspace pane.
 *
 * Fix: the IPC accepts `{ maxDim? }` (default 512 — existing gallery/filmstrip
 * callers unchanged), the RAW branch resizes into a maxDim box and caches under a
 * size-aware key, and handleReferenceDrop requests maxDim 2560 (covers the pane at
 * realistic window sizes while still sourcing the embedded JPEG — no full RAW decode).
 *
 * Memory policy (brief item 5): rawThumbCache is COUNT-based (2000 entries), sized
 * for ~100KB gallery thumbs. A 2560px JPEG data-URL is ~1-3MB, so 2000 of those
 * would be gigabytes — reference-sized entries (maxDim > 512) are therefore NOT
 * cached at all (a reference drop is a one-shot user action; re-decoding the
 * embedded JPEG on a repeat drop is cheap). `resolveRawThumbRequest` encodes that
 * policy as pure, unit-testable logic in electron/rawThumbPolicy.cjs.
 *
 * main.cjs / preload.cjs require('electron') at module scope, which isn't available
 * under Jest — so (matching the repo's precedent in mainRawFormatsConsolidation.test.ts
 * and fileOpenSetsCurrentImage.test.ts) the handler/preload/App plumbing is asserted
 * against the files' source text, while the extracted policy module is exercised for real.
 */
import fs from 'fs';
import path from 'path';

const rawThumbPolicy = require('../../electron/rawThumbPolicy.cjs') as {
  RAW_THUMB_DEFAULT_DIM: number;
  resolveRawThumbRequest: (
    filePath: string,
    options?: { maxDim?: unknown } | null
  ) => { maxDim: number; cacheable: boolean; cacheKey: string };
};

const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');

describe('rawThumbPolicy.resolveRawThumbRequest (pure policy)', () => {
  const { resolveRawThumbRequest, RAW_THUMB_DEFAULT_DIM } = rawThumbPolicy;
  const FILE = 'C:\\pics\\raw\\P9190024.ORF';

  it('defaults to the 512 gallery-thumb box when no options are passed', () => {
    expect(RAW_THUMB_DEFAULT_DIM).toBe(512);
    for (const options of [undefined, null, {}]) {
      const r = resolveRawThumbRequest(FILE, options as never);
      expect(r.maxDim).toBe(512);
      expect(r.cacheable).toBe(true);
      expect(r.cacheKey).toBe(`512:${FILE}`);
    }
  });

  it('an explicit maxDim 512 shares the default cache key (no duplicate entries)', () => {
    const explicit = resolveRawThumbRequest(FILE, { maxDim: 512 });
    const implicit = resolveRawThumbRequest(FILE);
    expect(explicit.cacheKey).toBe(implicit.cacheKey);
    expect(explicit.cacheable).toBe(true);
  });

  it('reference-sized requests (maxDim > 512) get a size-aware key and are NOT cacheable', () => {
    const r = resolveRawThumbRequest(FILE, { maxDim: 2560 });
    expect(r.maxDim).toBe(2560);
    expect(r.cacheable).toBe(false);
    expect(r.cacheKey).toBe(`2560:${FILE}`);
    // Size-aware keys mean a 2560 request can never collide with a cached 512 thumb.
    expect(r.cacheKey).not.toBe(resolveRawThumbRequest(FILE).cacheKey);
  });

  it('smaller-than-default boxes stay cacheable under their own key', () => {
    const r = resolveRawThumbRequest(FILE, { maxDim: 256 });
    expect(r.maxDim).toBe(256);
    expect(r.cacheable).toBe(true);
    expect(r.cacheKey).toBe(`256:${FILE}`);
  });

  it('floors fractional maxDim', () => {
    const r = resolveRawThumbRequest(FILE, { maxDim: 1024.7 });
    expect(r.maxDim).toBe(1024);
    expect(r.cacheable).toBe(false);
  });

  it('falls back to the default for invalid maxDim values', () => {
    for (const bad of [0, -7, NaN, Infinity, -Infinity, '2560', true, [], {}]) {
      const r = resolveRawThumbRequest(FILE, { maxDim: bad });
      expect(r.maxDim).toBe(512);
      expect(r.cacheable).toBe(true);
      expect(r.cacheKey).toBe(`512:${FILE}`);
    }
  });
});

describe('electron/main.cjs — read-image-as-data-url maxDim plumbing (source assertions)', () => {
  const mainSource = readSource('electron', 'main.cjs');
  const handlerIndex = mainSource.indexOf("ipcMain.handle('read-image-as-data-url'");
  const nextHandlerIndex = mainSource.indexOf('ipcMain.handle(', handlerIndex + 1);
  const handlerBody = mainSource.slice(
    handlerIndex,
    nextHandlerIndex === -1 ? undefined : nextHandlerIndex
  );

  it('the handler accepts an options argument after filePath', () => {
    expect(handlerIndex).toBeGreaterThan(-1);
    expect(handlerBody).toMatch(
      /ipcMain\.handle\('read-image-as-data-url',\s*async\s*\(event,\s*filePath,\s*options\)/
    );
  });

  it('resolves maxDim/cacheable/cacheKey through the shared rawThumbPolicy module', () => {
    expect(mainSource).toMatch(/require\('\.\/rawThumbPolicy\.cjs'\)/);
    expect(handlerBody).toMatch(/resolveRawThumbRequest\(filePath,\s*options\)/);
  });

  it('both RAW resize sites (embedded preview + sharp fallback) use maxDim, not a hardcoded 512 box', () => {
    expect(handlerBody).not.toMatch(/resize\(\s*512\s*,\s*512/);
    const maxDimResizes = handlerBody.match(/\.resize\(maxDim,\s*maxDim,\s*\{\s*fit:\s*'inside'/g) || [];
    expect(maxDimResizes.length).toBe(2);
  });

  it('cache reads and writes are keyed by the size-aware cacheKey and gated on cacheable', () => {
    expect(handlerBody).toMatch(/rawThumbCache\.get\(cacheKey\)/);
    // No remaining bare-filePath cache access.
    expect(handlerBody).not.toMatch(/rawThumbCache\.get\(filePath\)/);
    expect(handlerBody).not.toMatch(/cacheRawThumb\(filePath,/);
    // Every cache write goes through cacheRawThumb(cacheKey, ...) behind the cacheable gate.
    expect(handlerBody).toMatch(/cacheable\s*\?\s*cacheRawThumb\(cacheKey,/);
    const ungatedWrites = handlerBody.match(/cacheRawThumb\(/g) || [];
    const gatedWrites = handlerBody.match(/cacheable\s*\?\s*cacheRawThumb\(cacheKey,/g) || [];
    expect(gatedWrites.length).toBe(ungatedWrites.length);
  });
});

describe('electron/preload.cjs — readImageAsDataURL forwards options (source assertion)', () => {
  it('passes the options argument through to the IPC invoke', () => {
    const preloadSource = readSource('electron', 'preload.cjs');
    expect(preloadSource).toMatch(
      /readImageAsDataURL:\s*\(filePath,\s*options\)\s*=>\s*ipcRenderer\.invoke\('read-image-as-data-url',\s*filePath,\s*options\)/
    );
  });
});

describe('src/types/electron.ts — readImageAsDataURL type accepts optional maxDim (source assertion)', () => {
  it('declares the backwards-compatible options parameter', () => {
    const typesSource = readSource('src', 'types', 'electron.ts');
    expect(typesSource).toMatch(
      /readImageAsDataURL:\s*\(filePath:\s*string,\s*options\?:\s*\{\s*maxDim\?:\s*number\s*\}\)/
    );
  });
});

describe('src/App.tsx — handleReferenceDrop requests a pane-resolution decode (source assertion)', () => {
  it('passes maxDim 2560 to readImageAsDataURL inside the reference drop handler', () => {
    const appSource = readSource('src', 'App.tsx');
    const dropIndex = appSource.indexOf('const handleReferenceDrop');
    expect(dropIndex).toBeGreaterThan(-1);
    // Bound the handler body by the next top-level handler declaration after it.
    const endIndex = appSource.indexOf('const handleImageSelected', dropIndex);
    const dropBody = appSource.slice(dropIndex, endIndex === -1 ? undefined : endIndex);
    expect(dropBody).toMatch(/readImageAsDataURL\(path,\s*\{\s*maxDim:\s*2560\s*\}\)/);
  });
});
