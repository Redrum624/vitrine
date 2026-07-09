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
