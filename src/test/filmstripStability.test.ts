/**
 * Regression tests for "rating a picture resets the filmstrip scroll".
 *
 * Rating writes (xmp:Rating embedded or .xmp sidecar) modify a file inside the
 * watched folder -> fs.watch fires -> 'folder-changed' -> FileBrowser reloads
 * -> setAvailableImages(new array) -> ThumbnailPanel effects keyed on `images`
 * re-run and the strip scrolls back to the start. Two-layer fix:
 *   A) electron/selfWriteRegistry.cjs — the main process marks its own writes
 *      and the folder watcher swallows the resulting events.
 *   B) sameImageList(a, b) — the renderer keeps the existing images array
 *      reference when a watcher reload returns an identical file list.
 */
import { sameImageList } from '../utils/imageList';
import type { ImageFileInfo } from '../services/FileSystemService';

const { markSelfWrite, isSelfWrite, SELF_WRITE_TTL_MS } = require('../../electron/selfWriteRegistry.cjs');

describe('selfWriteRegistry (Layer A — main process)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flags a marked file as a self-write within the TTL window', () => {
    markSelfWrite('D:\\Photos\\P1010001.jpg');
    expect(isSelfWrite('P1010001.jpg')).toBe(true);
  });

  it('no longer flags the file after the TTL expires', () => {
    markSelfWrite('D:\\Photos\\P1010002.jpg');
    jest.advanceTimersByTime(SELF_WRITE_TTL_MS + 1);
    expect(isSelfWrite('P1010002.jpg')).toBe(false);
  });

  it('does not flag files that were never marked', () => {
    markSelfWrite('D:\\Photos\\mine.jpg');
    expect(isSelfWrite('external.jpg')).toBe(false);
  });

  it('matches the .xmp sidecar written for RAW ratings', () => {
    markSelfWrite('D:\\Photos\\P1010003.xmp');
    expect(isSelfWrite('P1010003.xmp')).toBe(true);
  });

  it('is case-insensitive (Windows filenames)', () => {
    markSelfWrite('D:\\Photos\\IMG_0001.JPG');
    expect(isSelfWrite('img_0001.jpg')).toBe(true);
  });

  it('matches the atomic-write temp sibling (<name>.tmp-<ts>) from writeImageMetadata', () => {
    markSelfWrite('D:\\Photos\\P1010004.jpg');
    expect(isSelfWrite('P1010004.jpg.tmp-1718000000000')).toBe(true);
  });

  it('handles fs.watch filenames that include a relative subpath', () => {
    markSelfWrite('D:\\Photos\\sub\\P1010005.jpg');
    expect(isSelfWrite('sub\\P1010005.jpg')).toBe(true);
  });

  it('returns false for empty/undefined filenames', () => {
    expect(isSelfWrite('')).toBe(false);
    expect(isSelfWrite(undefined)).toBe(false);
  });
});

describe('sameImageList (Layer B — renderer)', () => {
  const img = (path: string, extra: Partial<ImageFileInfo> = {}): ImageFileInfo => ({
    id: Buffer.from(path).toString('base64'),
    name: path.split(/[\\/]/).pop() || path,
    path,
    size: 1000,
    format: 'JPG',
    type: 'image/jpeg',
    lastModified: 1718000000000,
    dateModified: new Date(1718000000000),
    ...extra
  });

  it('treats identical lists (fresh object instances) as the same', () => {
    const a = [img('D:\\Photos\\a.jpg'), img('D:\\Photos\\b.jpg')];
    const b = [img('D:\\Photos\\a.jpg'), img('D:\\Photos\\b.jpg')];
    expect(sameImageList(a, b)).toBe(true);
  });

  it('ignores metadata-only changes (size/mtime bumped by a rating write)', () => {
    const a = [img('D:\\Photos\\a.jpg')];
    const b = [img('D:\\Photos\\a.jpg', { size: 1042, lastModified: 1718000099999 })];
    expect(sameImageList(a, b)).toBe(true);
  });

  it('detects an added file', () => {
    const a = [img('D:\\Photos\\a.jpg')];
    const b = [img('D:\\Photos\\a.jpg'), img('D:\\Photos\\b.jpg')];
    expect(sameImageList(a, b)).toBe(false);
  });

  it('detects a removed file', () => {
    const a = [img('D:\\Photos\\a.jpg'), img('D:\\Photos\\b.jpg')];
    const b = [img('D:\\Photos\\a.jpg')];
    expect(sameImageList(a, b)).toBe(false);
  });

  it('detects a replaced file', () => {
    const a = [img('D:\\Photos\\a.jpg')];
    const b = [img('D:\\Photos\\c.jpg')];
    expect(sameImageList(a, b)).toBe(false);
  });

  it('detects reordering', () => {
    const a = [img('D:\\Photos\\a.jpg'), img('D:\\Photos\\b.jpg')];
    const b = [img('D:\\Photos\\b.jpg'), img('D:\\Photos\\a.jpg')];
    expect(sameImageList(a, b)).toBe(false);
  });

  it('treats two empty lists as the same', () => {
    expect(sameImageList([], [])).toBe(true);
  });
});
