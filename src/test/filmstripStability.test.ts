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
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { sameImageList } from '../utils/imageList';
import type { ImageFileInfo } from '../services/FileSystemService';

const {
  markSelfWrite,
  markSelfWriteIfExists,
  isSelfWrite,
  SELF_WRITE_TTL_MS,
  DEFAULT_MAX_WAIT_MS,
  createFolderChangeDebouncer,
  createFolderWatcher,
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

  // T10 (M3): fs.watch reports an overflow / unknown change with no filename. It is an
  // external change (it replaced the old "ignores events with empty/undefined filenames").
  it('an event without a filename counts as an external change and emits once', () => {
    const d = make();
    d.handleEvent('change', '');
    d.handleEvent('change', undefined);
    d.handleEvent('rename', null);
    jest.advanceTimersByTime(1000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'rename', filename: null });
  });

  // T11 (M5): a trailing-only debounce never emits under a continuous stream.
  it('a continuous stream still emits, each emit no later than maxWaitMs after its first pending event', () => {
    const emits: number[] = [];
    emit.mockImplementation(() => { emits.push(Date.now()); });
    const d = createFolderChangeDebouncer({ delayMs: 100, emit }); // default maxWaitMs
    const eventTimes: number[] = [];
    for (let t = 0; t < 3000; t += 50) {
      eventTimes.push(Date.now());
      d.handleEvent('change', `f${t}.jpg`);
      jest.advanceTimersByTime(50);
    }
    expect(emits.length).toBeGreaterThanOrEqual(2);
    let previousEmit = -Infinity;
    for (const at of emits) {
      const firstPending = eventTimes.find((t) => t >= previousEmit) as number;
      expect(at - firstPending).toBeLessThanOrEqual(DEFAULT_MAX_WAIT_MS);
      previousEmit = at;
    }
  });

  // T12: the maximum wait must not turn self-write events into emits.
  it('a continuous stream of self-write events alone never emits, past the maximum wait', () => {
    markSelfWrite('D:\\Photos\\rated.jpg');
    const d = make();
    for (let t = 0; t < 2000; t += 50) {
      d.handleEvent('change', 'rated.jpg');
      jest.advanceTimersByTime(50);
    }
    jest.advanceTimersByTime(2000);
    expect(emit).not.toHaveBeenCalled();
  });

  // T13 (M2): only an overwrite is marked; a file the app creates (a new export) must show up.
  it('a marked overwrite is swallowed while a newly created file (not marked) emits once', () => {
    const exists = (p: string) => p === 'D:\\Photos\\old.jpg';
    markSelfWriteIfExists('D:\\Photos\\old.jpg', exists);
    markSelfWriteIfExists('D:\\Photos\\new-export.jpg', exists);
    expect(isSelfWrite('old.jpg')).toBe(true);
    expect(isSelfWrite('new-export.jpg')).toBe(false);
    const d = make();
    d.handleEvent('change', 'old.jpg');
    jest.advanceTimersByTime(500);
    expect(emit).not.toHaveBeenCalled();
    d.handleEvent('rename', 'new-export.jpg');
    d.handleEvent('change', 'new-export.jpg');
    jest.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ eventType: 'change', filename: 'new-export.jpg' });
  });

  it('cancel() discards a pending emit (unwatch-folder mid-window)', () => {
    const d = make();
    d.handleEvent('change', 'external.jpg');
    d.cancel();
    jest.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
  });
});

// M1/M7: deleting a watched folder makes fs.watch on Windows deliver ~160,000 events in 2 s,
// all with a filename and no 'error' (diagnosis M1, measured). The watcher must notice the
// folder is gone, close itself, leave the registry and tell the renderer once.
describe('createFolderWatcher (watch-folder: a vanished folder or a watcher error)', () => {
  const FOLDER = 'D:\\Shoot';

  function fakeWatch() {
    const watcher = Object.assign(new EventEmitter(), { close: jest.fn() });
    let listener: (eventType: string, filename: string | null) => void = () => {};
    const watchFn = jest.fn((_p: string, _opts: unknown, cb: typeof listener) => { listener = cb; return watcher; });
    return { watcher, watchFn, fire: (t: string, f: string | null) => listener(t, f) };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    _clearAll();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers itself and forwards a change while the folder exists', () => {
    const { watchFn, fire } = fakeWatch();
    const send = jest.fn();
    const watchers = new Map();
    const handle = createFolderWatcher({ folderPath: FOLDER, watchers, watchFn, existsFn: () => true, send, delayMs: 100 });
    expect(watchers.get(FOLDER)).toBe(handle);
    expect(watchFn).toHaveBeenCalledWith(FOLDER, { persistent: false }, expect.any(Function));
    fire('rename', 'new.jpg');
    jest.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ folderPath: FOLDER, eventType: 'rename', filename: 'new.jpg' });
  });

  it("a vanished folder under an endless event storm: closes the watcher, leaves the map, sends exactly one 'removed'", () => {
    const { watcher, watchFn, fire } = fakeWatch();
    const send = jest.fn();
    const watchers = new Map();
    let present = true;
    createFolderWatcher({ folderPath: FOLDER, watchers, watchFn, existsFn: () => present, send, delayMs: 100 });

    present = false; // deleted in Windows Explorer
    const sentAt: number[] = [];
    send.mockImplementation(() => { sentAt.push(Date.now()); });
    const stormStart = Date.now();
    for (let t = 0; t < 3000; t++) { // one event per ms for 3 s
      fire('rename', 'x.jpg');
      jest.advanceTimersByTime(1);
    }
    jest.advanceTimersByTime(5000);

    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watchers.has(FOLDER)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ folderPath: FOLDER, eventType: 'removed', filename: null });
    expect(sentAt[0] - stormStart).toBeLessThanOrEqual(DEFAULT_MAX_WAIT_MS);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("an 'error' from the watcher does the same, once", () => {
    const { watcher, watchFn } = fakeWatch();
    const send = jest.fn();
    const watchers = new Map();
    createFolderWatcher({ folderPath: FOLDER, watchers, watchFn, existsFn: () => true, send, delayMs: 100 });

    watcher.emit('error', new Error('EPERM'));
    watcher.emit('error', new Error('EPERM'));
    jest.advanceTimersByTime(5000);

    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watchers.has(FOLDER)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ folderPath: FOLDER, eventType: 'removed', filename: null });
  });

  it('an explicit close (unwatch-folder) sends nothing and leaves the map', () => {
    const { watcher, watchFn, fire } = fakeWatch();
    const send = jest.fn();
    const watchers = new Map();
    const handle = createFolderWatcher({ folderPath: FOLDER, watchers, watchFn, existsFn: () => true, send, delayMs: 100 });
    fire('change', 'a.jpg');
    handle._debouncer.cancel();
    handle.close();
    fire('change', 'b.jpg');
    jest.advanceTimersByTime(5000);
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watchers.has(FOLDER)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

// electron/main.cjs requires('electron') at module scope (not loadable under Jest), so its
// wiring is checked on the source text, as in showItemInFolderIpc.test.ts.
describe('electron/main.cjs — watcher and self-write wiring', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'main.cjs'), 'utf8');
  const handlerBody = (channel: string) => {
    const start = mainSource.indexOf(`ipcMain.handle('${channel}'`);
    expect(start).toBeGreaterThan(-1);
    const next = mainSource.indexOf('ipcMain.handle(', start + 1);
    return mainSource.slice(start, next === -1 ? undefined : next);
  };

  it('write-file and write-image-file mark only an overwrite, so a created file shows up', () => {
    for (const channel of ['write-file', 'write-image-file']) {
      const body = handlerBody(channel);
      expect(body).toMatch(/markSelfWriteIfExists\(safeFilePath\)/);
      expect(body).not.toMatch(/\bmarkSelfWrite\(/);
    }
  });

  it('write-image-metadata and write-image-rating still mark every write', () => {
    expect(handlerBody('write-image-metadata')).toMatch(/\bmarkSelfWrite\(safeFilePath\)/);
    expect(handlerBody('write-image-rating')).toMatch(/\bmarkSelfWrite\(sidecar\)/);
    expect(handlerBody('write-image-rating')).toMatch(/\bmarkSelfWrite\(safeFilePath\)/);
  });

  it('watch-folder builds its watcher with createFolderWatcher over the folderWatchers map', () => {
    const body = handlerBody('watch-folder');
    expect(body).toMatch(/createFolderWatcher\(\{/);
    expect(body).toMatch(/watchers:\s*folderWatchers/);
    expect(body).toMatch(/existsFn:\s*fs\.existsSync/);
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
