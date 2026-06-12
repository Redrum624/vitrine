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

const {
  markSelfWrite,
  isSelfWrite,
  SELF_WRITE_TTL_MS,
  createFolderChangeDebouncer,
  _clearAll
} = require('../../electron/selfWriteRegistry.cjs');

describe('selfWriteRegistry (Layer A — main process)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _clearAll(); // the registry Map is a module-level singleton — isolate tests explicitly
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

describe('createFolderChangeDebouncer (watcher debounce vs self-write suppression)', () => {
  let emit: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    _clearAll();
    emit = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = () => createFolderChangeDebouncer({ delayMs: 100, emit });

  it('emits once after the debounce delay for a genuine external event', () => {
    const d = make();
    d.handleEvent('change', 'external.jpg');
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'change', filename: 'external.jpg' });
  });

  it('self-write events alone never emit', () => {
    markSelfWrite('D:\\Photos\\rated.jpg');
    const d = make();
    d.handleEvent('change', 'rated.jpg');
    d.handleEvent('change', 'rated.jpg');
    jest.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('a self-write event mid-window does not suppress a concurrent genuine event', () => {
    markSelfWrite('D:\\Photos\\rated.jpg');
    const d = make();
    d.handleEvent('rename', 'new-external.jpg'); // genuine event starts the window
    jest.advanceTimersByTime(50);
    d.handleEvent('change', 'rated.jpg'); // self-write arrives mid-window
    jest.advanceTimersByTime(50); // window elapses
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'rename', filename: 'new-external.jpg' });
  });

  it('self-write events do not delay (distort) a genuine emit by resetting the timer', () => {
    markSelfWrite('D:\\Photos\\rated.jpg');
    const d = make();
    d.handleEvent('change', 'external.jpg');
    jest.advanceTimersByTime(90);
    d.handleEvent('change', 'rated.jpg'); // must NOT restart the 100ms window
    jest.advanceTimersByTime(10); // original window elapses at t=100
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'change', filename: 'external.jpg' });
  });

  it('debounces a burst of genuine events into one emit carrying the last context', () => {
    const d = make();
    d.handleEvent('rename', 'a.jpg');
    jest.advanceTimersByTime(50);
    d.handleEvent('change', 'b.jpg');
    jest.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'change', filename: 'b.jpg' });
  });

  it('ignores events with empty/undefined filenames', () => {
    const d = make();
    d.handleEvent('change', '');
    d.handleEvent('change', undefined);
    jest.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('cancel() discards a pending emit (unwatch-folder mid-window)', () => {
    const d = make();
    d.handleEvent('change', 'external.jpg');
    d.cancel();
    jest.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
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
