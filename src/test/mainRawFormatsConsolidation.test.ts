/**
 * Task L4, Part B.3: electron/main.cjs used to independently maintain THREE local `rawFormats`
 * arrays (read-image-as-data-url, write-image-rating, read-image-rating) that had drifted apart —
 * the read-image-as-data-url preview list was missing '.sr2'/'.srf'/'.x3f', so RAW files with
 * those extensions silently got no embedded-preview thumbnail even though rating read/write
 * already recognized them as RAW. Consolidated into one module-level `RAW_FORMATS` constant.
 *
 * main.cjs requires('electron') at module scope, which isn't available under Jest, so (matching
 * the repo's own precedent for source invariants that can't be exercised by importing/running the
 * module — see fileOpenSetsCurrentImage.test.ts's static-source assertions on App.tsx) this
 * inspects the file's source text directly rather than requiring it.
 */
import fs from 'fs';
import path from 'path';

const mainSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'electron', 'main.cjs'),
  'utf8'
);

describe('electron/main.cjs — RAW_FORMATS consolidation (Task L4)', () => {
  it('defines exactly one shared RAW_FORMATS constant (no more per-handler local arrays)', () => {
    const constDeclarations = mainSource.match(/const RAW_FORMATS\s*=/g) || [];
    expect(constDeclarations).toHaveLength(1);

    // The old per-handler local arrays are gone — no more `const rawFormats = [...]` anywhere.
    const localArrays = mainSource.match(/const rawFormats\s*=/g) || [];
    expect(localArrays).toHaveLength(0);
  });

  it('the shared list closes the sr2/srf/x3f preview gap (present for ALL three RAW-handling call sites)', () => {
    const constMatch = mainSource.match(/const RAW_FORMATS\s*=\s*\[([\s\S]*?)\];/);
    expect(constMatch).not.toBeNull();
    const listBody = constMatch![1];

    for (const ext of ['.sr2', '.srf', '.x3f']) {
      expect(listBody).toContain(`'${ext}'`);
    }
  });

  it('read-image-as-data-url, write-image-rating, and read-image-rating all reference RAW_FORMATS', () => {
    const handlerNames = ['read-image-as-data-url', 'write-image-rating', 'read-image-rating'];

    for (const handlerName of handlerNames) {
      const handlerIndex = mainSource.indexOf(`ipcMain.handle('${handlerName}'`);
      expect(handlerIndex).toBeGreaterThan(-1);
      // The handler body ends at the next `ipcMain.handle(` (or EOF) — a generous, simple bound
      // that's robust to internal formatting.
      const nextHandlerIndex = mainSource.indexOf(`ipcMain.handle(`, handlerIndex + 1);
      const handlerBody = mainSource.slice(handlerIndex, nextHandlerIndex === -1 ? undefined : nextHandlerIndex);

      expect(handlerBody).toMatch(/RAW_FORMATS\.includes\(ext\)/);
    }
  });

  it('cross-references src/utils/rawExtensions.ts in a comment (documented duplication, not a silent fork)', () => {
    expect(mainSource).toMatch(/src\/utils\/rawExtensions\.ts/);
  });
});
