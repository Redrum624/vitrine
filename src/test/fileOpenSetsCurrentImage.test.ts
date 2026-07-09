/**
 * Unit test for the "File > Open" (electron-file-open) currentImage wiring.
 *
 * Bug: opening an image via File > Open / Ctrl+O / the 'electron-file-open'
 * relay decoded and displayed the image but never updated App.tsx's local
 * `currentImage` state, so the StatusBar kept showing "No image loaded" (it
 * reads that local state, not the Zustand store's `currentImage`).
 *
 * `handleFileOpen` is a closure registered inside a `useEffect` in App.tsx and
 * is not itself exported (rendering the full App component graph to exercise
 * it is impractical - see the ~30 service/module dependencies at the top of
 * App.tsx). `imageFileInfoFromOpenedPath` is the pure, side-effect-free piece
 * of the fix: it builds the exact ImageFileInfo object handleFileOpen passes
 * to `setCurrentImage`, mirroring the shape handleFileImport already builds
 * for its own per-file entries (see App.tsx). This test exercises that piece
 * directly.
 */
import fs from 'fs';
import path from 'path';
import { imageFileInfoFromOpenedPath } from '../App';

describe('imageFileInfoFromOpenedPath', () => {
  test('builds an ImageFileInfo with id/name/path populated from the opened file path', () => {
    const info = imageFileInfoFromOpenedPath('C:/pics/vacation/beach.jpg');

    expect(info.name).toBe('beach.jpg');
    expect(info.path).toBe('C:/pics/vacation/beach.jpg');
    expect(info.id).toBeTruthy();
    expect(info.format).toBe('jpg');
    expect(info.type).toBe('jpg');
    expect(info.dateModified).toBeInstanceOf(Date);
  });

  test('handles Windows-style backslash paths', () => {
    const info = imageFileInfoFromOpenedPath('C:\\pics\\raw\\photo.ORF');

    expect(info.name).toBe('photo.ORF');
    expect(info.format).toBe('orf');
    expect(info.type).toBe('orf');
  });
});

/**
 * Regression test for the double-decode bug: `handleFileOpen` (the closure
 * registered for the 'electron-file-open' window event) used to call
 * `imageService.loadImage(filePath)` directly AND set `currentImage`, and the
 * latter triggers Canvas's own reactive `loadImage` effect
 * (Canvas.tsx: `currentImage.path !== displayImage?.path` -> `loadImage` ->
 * `imageService.loadImage` again). Every RAW file opened via File > Open /
 * Ctrl+O was decoded twice through a full LibRaw roundtrip.
 *
 * `handleFileOpen` is an unexported closure defined inside a `useEffect` in
 * `App()` (see the file-level comment on the tests above for why rendering
 * the full `<App />` tree to exercise it end-to-end is impractical: ~20 child
 * components and ~15 services, several doing real WebGL/canvas work in
 * effects, with no existing precedent for a full-App-render test anywhere in
 * this suite). So this test cannot spy on `imageService.loadImage` and count
 * real invocations end-to-end. Instead, per the fallback allowed for this
 * fix, it statically asserts the handler's own source no longer contains a
 * direct call to `imageService.loadImage` (the single change that eliminates
 * the second decode) while still routing through `setCurrentImage`, which is
 * what lets Canvas's reactive effect perform the one real decode - mirroring
 * `handleImageSelected` (App.tsx), the sibling that already relies solely on
 * the reactive path.
 */
describe('handleFileOpen (single-decode regression)', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

  // Extracts the brace-balanced body of a `const <name> = ... => { ... };`
  // closure from the App.tsx source so the assertion targets the handler
  // itself, not an unrelated call elsewhere in the file.
  function extractConstArrowBody(source: string, constName: string): string {
    const declMarker = `const ${constName} = `;
    const declIndex = source.indexOf(declMarker);
    if (declIndex === -1) {
      throw new Error(`Could not find "${declMarker}" in App.tsx - has it been renamed?`);
    }
    const braceStart = source.indexOf('{', declIndex);
    if (braceStart === -1) {
      throw new Error(`Could not find the opening brace for ${constName} in App.tsx`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(braceStart, i + 1);
      }
    }
    throw new Error(`Could not find the matching closing brace for ${constName} in App.tsx`);
  }

  test('does not call imageService.loadImage directly (relies on Canvas reactive load like handleImageSelected)', () => {
    const body = extractConstArrowBody(appSource, 'handleFileOpen');

    expect(body).not.toMatch(/imageService\.loadImage\(/);
  });

  test('still sets currentImage from the opened path so Canvas\'s reactive effect fires', () => {
    const body = extractConstArrowBody(appSource, 'handleFileOpen');

    expect(body).toMatch(/setCurrentImage\(imageFileInfoFromOpenedPath\(filePath\)\)/);
  });
});
