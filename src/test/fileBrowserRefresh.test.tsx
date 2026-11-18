/**
 * File Explorer always shows what is on disk (X1, 2026-11-18).
 *
 * The owner: "vitrine does not update the files in the File Explorer after opening the app".
 * Root causes pinned here (diagnosis R1-R5, C3/C4, M1):
 *  - an arrow re-expand or a folder-name click served the in-memory listing and never read
 *    the disk again (R1);
 *  - collapsing a folder unwatched it and re-expanding never watched it again (R2);
 *  - the watcher's filmstrip refresh was keyed on the tree's selected folder, which an
 *    arrow-expand also changes, so the wrong folder's list reached the filmstrip (R3/C4);
 *  - a gallery folder that lost its last image never cleared the filmstrip (R4);
 *  - a failed or timed-out read stored an empty listing that the cache then served (R5).
 */
import { render, fireEvent, waitFor, act, screen } from '@testing-library/react';
import { FileBrowser } from '../components/Layout/FileBrowser';
import { fileSystemService } from '../services/FileSystemService';
import type { FolderInfo, ImageFileInfo } from '../services/FileSystemService';

jest.mock('../services/FileSystemService', () => ({
  fileSystemService: {
    getSystemDrives: jest.fn(),
    getFolderContents: jest.fn(),
    setCurrentImages: jest.fn(),
    formatFileSize: jest.fn(() => '1 KB'),
  },
}));

type Listing = { folders: FolderInfo[]; images: ImageFileInfo[] };

const mockFss = fileSystemService as unknown as {
  getSystemDrives: jest.Mock;
  getFolderContents: jest.Mock;
  setCurrentImages: jest.Mock;
};

// Ids are base64 of the full path, as electron/main.cjs get-folder-contents builds them.
const b64 = (p: string) => Buffer.from(p).toString('base64');
const baseName = (p: string) => p.split('\\').filter(Boolean).pop() as string;
const folder = (p: string): FolderInfo => ({ id: b64(p), name: baseName(p), path: p, type: 'folder' });
const image = (p: string): ImageFileInfo => ({
  id: b64(p),
  name: baseName(p),
  path: p,
  size: 1000,
  format: 'JPG',
  type: 'image/jpeg',
  lastModified: 1,
  dateModified: new Date(1),
});

const ROOT = 'C:\\';
const A = 'C:\\A';
const AB = 'C:\\AB'; // shares the "C:\A" string prefix but is NOT inside A
const SUB = 'C:\\A\\Sub';
const DEEP = 'C:\\A\\Sub\\Deep';

const defaults = new Map<string, Listing>();
const once = new Map<string, Array<() => Promise<Listing>>>();

function setListing(p: string, folders: string[], images: string[]) {
  defaults.set(p, { folders: folders.map(folder), images: images.map(image) });
}
function queueOnce(p: string, responder: () => Promise<Listing>) {
  const q = once.get(p) ?? [];
  q.push(responder);
  once.set(p, q);
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function installElectronAPI() {
  const api = {
    onFolderChanged: jest.fn(),
    removeAllListeners: jest.fn(),
    watchFolder: jest.fn().mockResolvedValue({ success: true }),
    unwatchFolder: jest.fn().mockResolvedValue({ success: true }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}
type Api = ReturnType<typeof installElectronAPI>;

const readsOf = (p: string) => mockFss.getFolderContents.mock.calls.filter((c) => c[0] === p).length;
const callsWith = (fn: jest.Mock, p: string) => fn.mock.calls.filter((c) => c[0] === p).length;
const names = (list: ImageFileInfo[]) => list.map((i) => i.name);

// Folder names render in a <span>; image names in a <div>.
const folderLabel = (name: string) => screen.getByText(name, { selector: 'span' });
// The header row is span -> name area -> row; the arrow is the row's first child.
const arrowOf = (name: string) => folderLabel(name).parentElement!.parentElement!.firstElementChild as HTMLElement;
const clickArrow = (name: string) => fireEvent.click(arrowOf(name));
const clickName = (name: string) => fireEvent.click(folderLabel(name));

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function fireFolderChanged(api: Api, data: { folderPath: string; eventType: string; filename: string | null }) {
  const cb = api.onFolderChanged.mock.calls[0][0] as (d: typeof data) => void;
  await act(async () => { cb(data); });
  await flush();
}

async function mountTree(props: Parameters<typeof FileBrowser>[0] = {}) {
  const utils = render(<FileBrowser {...props} />);
  await screen.findByText('C:', { selector: 'span' });
  clickArrow('C:');
  await screen.findByText('A', { selector: 'span' });
  await flush();
  return utils;
}

describe('FileBrowser — the File Explorer re-reads the disk', () => {
  beforeEach(() => {
    defaults.clear();
    once.clear();
    mockFss.getSystemDrives.mockResolvedValue([{ id: 'driveC', name: 'C:', path: ROOT, type: 'drive' }]);
    setListing(ROOT, [A, AB], []);
    setListing(A, [SUB], ['C:\\A\\a1.jpg']);
    setListing(AB, [], ['C:\\AB\\ab1.jpg']);
    setListing(SUB, [DEEP], ['C:\\A\\Sub\\s1.jpg']);
    setListing(DEEP, [], []);
    mockFss.getFolderContents.mockImplementation((p: string) => {
      const q = once.get(p);
      if (q && q.length) return q.shift()!();
      return Promise.resolve(defaults.get(p) ?? { folders: [], images: [] });
    });
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('labels the arrow "Expand folder" / "Collapse folder"', async () => {
    installElectronAPI();
    render(<FileBrowser />);
    await screen.findByText('C:', { selector: 'span' });
    expect(arrowOf('C:').getAttribute('aria-label')).toBe('Expand folder');
    clickArrow('C:');
    await screen.findByText('A', { selector: 'span' });
    expect(arrowOf('C:').getAttribute('aria-label')).toBe('Collapse folder');
  });

  it('T1 arrow expand, collapse, expand: reads and watches the folder again and shows a new file', async () => {
    const api = installElectronAPI();
    await mountTree();

    clickArrow('A');
    await screen.findByText('a1.jpg');
    await flush();
    clickArrow('A'); // collapse
    await waitFor(() => expect(screen.queryByText('a1.jpg')).toBeNull());

    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\a2.jpg']); // a file added on disk meanwhile
    clickArrow('A'); // expand again
    await screen.findByText('a2.jpg');

    expect(readsOf(A)).toBe(2);
    expect(callsWith(api.watchFolder, A)).toBe(2);
  });

  it('T2 a folder-name click on the same folder twice hands the gallery the second listing', async () => {
    installElectronAPI();
    const onFolderSelected = jest.fn();
    const onImageSelected = jest.fn();
    await mountTree({ onFolderSelected, onImageSelected });

    clickName('A');
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    expect(names(onFolderSelected.mock.calls[0][0])).toEqual(['a1.jpg']);

    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\a2.jpg']);
    clickName('A');
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(2));
    expect(names(onFolderSelected.mock.calls[1][0])).toEqual(['a1.jpg', 'a2.jpg']);
    // Click semantics unchanged: the first image is selected.
    expect(onImageSelected).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'a1.jpg' }));
  });

  it('T3 a watcher reload feeds the filmstrip only for the folder it shows, never selects an image', async () => {
    const api = installElectronAPI();
    const onFolderSelected = jest.fn();
    const onImageSelected = jest.fn();
    await mountTree({ onFolderSelected, onImageSelected });

    clickName('A'); // A goes to the filmstrip
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    clickArrow('AB'); // only browse AB in the tree
    await screen.findByText('ab1.jpg');
    await waitFor(() => expect(callsWith(api.watchFolder, AB)).toBe(1));
    await flush();
    onFolderSelected.mockClear();
    onImageSelected.mockClear();

    setListing(AB, [], ['C:\\AB\\ab1.jpg', 'C:\\AB\\ab2.jpg']);
    await fireFolderChanged(api, { folderPath: AB, eventType: 'rename', filename: 'ab2.jpg' });
    await waitFor(() => expect(readsOf(AB)).toBe(2));
    await flush();
    expect(onFolderSelected).not.toHaveBeenCalled();

    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\a3.jpg']);
    await fireFolderChanged(api, { folderPath: A, eventType: 'rename', filename: 'a3.jpg' });
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    expect(names(onFolderSelected.mock.calls[0][0])).toEqual(['a1.jpg', 'a3.jpg']);
    expect(onImageSelected).not.toHaveBeenCalled();
  });

  it('T4 the gallery folder losing its last image empties the filmstrip', async () => {
    const api = installElectronAPI();
    const onFolderSelected = jest.fn();
    await mountTree({ onFolderSelected });

    clickName('A');
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(callsWith(api.watchFolder, A)).toBe(1));
    await flush();
    onFolderSelected.mockClear();

    setListing(A, [SUB], []);
    await fireFolderChanged(api, { folderPath: A, eventType: 'rename', filename: 'a1.jpg' });
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledWith([]));
  });

  it('T5 a rejected read keeps the previous rows, and the next open reads again', async () => {
    installElectronAPI();
    await mountTree();

    clickArrow('A');
    await screen.findByText('a1.jpg');
    await flush();
    clickArrow('A'); // collapse

    queueOnce(A, () => Promise.reject(new Error('EIO')));
    clickArrow('A'); // expand: this read fails
    // The read starts synchronously in the click. No waitFor here: RTL turns the act
    // environment off inside waitFor, so a failure handled there would be committed only
    // after the assertion below (seen with a break that stores an empty listing).
    expect(readsOf(A)).toBe(2);
    await flush();
    expect(screen.getByText('a1.jpg')).toBeTruthy();

    clickArrow('A'); // collapse
    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\c1.jpg']);
    clickArrow('A'); // expand: reads again
    await screen.findByText('c1.jpg');
    expect(readsOf(A)).toBe(3);
  });

  it('T5b a read that never settles times out after 5 s and keeps the previous rows; the next open reads again', async () => {
    jest.useFakeTimers();
    installElectronAPI();
    await mountTree();

    clickArrow('A');
    await screen.findByText('a1.jpg');
    await flush();
    clickArrow('A'); // collapse

    queueOnce(A, () => new Promise<Listing>(() => { /* never settles */ }));
    clickArrow('A'); // expand: this read hangs
    await flush();
    expect(readsOf(A)).toBe(2);
    expect(screen.getByText('a1.jpg')).toBeTruthy();

    await act(async () => { jest.advanceTimersByTime(5000); });
    await flush();
    expect(screen.getByText('a1.jpg')).toBeTruthy();

    clickArrow('A'); // collapse
    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\c1.jpg']);
    clickArrow('A'); // expand: reads again
    await screen.findByText('c1.jpg');
    expect(readsOf(A)).toBe(3);
  });

  it('T6 a re-expand shows the cached rows at once, and a stale slow read never overwrites a newer one', async () => {
    installElectronAPI();
    await mountTree();

    clickArrow('A');
    await screen.findByText('a1.jpg');
    await flush();
    clickArrow('A'); // collapse

    const slow = deferred<Listing>();
    queueOnce(A, () => slow.promise);
    clickArrow('A'); // expand: read 2 pending
    // The cached rows are on screen before the pending read resolves, with no spinner.
    expect(screen.getByText('a1.jpg')).toBeTruthy();
    expect(arrowOf('A').querySelector('.animate-spin')).toBeNull();
    await flush();
    expect(readsOf(A)).toBe(2);

    clickArrow('A'); // collapse
    setListing(A, [SUB], ['C:\\A\\a1.jpg', 'C:\\A\\new1.jpg']);
    clickArrow('A'); // expand: read 3 resolves first
    await screen.findByText('new1.jpg');
    expect(readsOf(A)).toBe(3);

    await act(async () => { slow.resolve({ folders: [folder(SUB)], images: [image('C:\\A\\a1.jpg'), image('C:\\A\\old1.jpg')] }); });
    await flush();
    expect(screen.queryByText('old1.jpg')).toBeNull();
    expect(screen.getByText('new1.jpg')).toBeTruthy();
  });

  it('T7 window focus re-reads each expanded folder and the gallery folder once; nothing after unmount', async () => {
    installElectronAPI();
    const onFolderSelected = jest.fn();
    const onImageSelected = jest.fn();
    const { unmount } = await mountTree({ onFolderSelected, onImageSelected });

    clickArrow('A');
    await screen.findByText('a1.jpg');
    clickName('AB'); // gallery folder, also expanded
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    await flush();
    mockFss.getFolderContents.mockClear();
    onImageSelected.mockClear();

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    await waitFor(() => expect(mockFss.getFolderContents).toHaveBeenCalledTimes(3));
    await flush();
    const read = mockFss.getFolderContents.mock.calls.map((c) => c[0]).sort();
    expect(read).toEqual([A, AB, ROOT].sort());
    expect(onImageSelected).not.toHaveBeenCalled();

    unmount();
    mockFss.getFolderContents.mockClear();
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(mockFss.getFolderContents).not.toHaveBeenCalled();
  });

  it('T8 collapsing a parent unwatches and collapses its expanded children (path prefix, not id prefix)', async () => {
    const api = installElectronAPI();
    await mountTree();

    clickArrow('A');
    await screen.findByText('Sub', { selector: 'span' });
    clickArrow('Sub');
    await screen.findByText('Deep', { selector: 'span' });
    clickArrow('AB');
    await screen.findByText('ab1.jpg');
    await waitFor(() => expect(callsWith(api.watchFolder, AB)).toBe(1));
    await flush();
    api.unwatchFolder.mockClear();

    clickArrow('A'); // collapse A
    await flush();
    const unwatched = api.unwatchFolder.mock.calls.map((c) => c[0]);
    expect(unwatched).toEqual(expect.arrayContaining([A, SUB]));
    expect(unwatched).not.toContain(AB); // "C:\AB" starts with "C:\A" but is a sibling

    clickArrow('A'); // re-expand A: Sub stays collapsed
    await flush();
    expect(screen.getByText('Sub', { selector: 'span' })).toBeTruthy();
    expect(screen.queryByText('Deep', { selector: 'span' })).toBeNull();
    await flush();

    // A drive root path already ends in a separator.
    api.unwatchFolder.mockClear();
    clickArrow('C:');
    await flush();
    expect(api.unwatchFolder.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([ROOT, A, AB]));
  });

  it("T9 a 'removed' event drops the folder: rows gone, unwatched, the filmstrip emptied", async () => {
    const api = installElectronAPI();
    const onFolderSelected = jest.fn();
    await mountTree({ onFolderSelected });

    clickName('A');
    await waitFor(() => expect(onFolderSelected).toHaveBeenCalledTimes(1));
    await screen.findByText('a1.jpg');
    await waitFor(() => expect(callsWith(api.watchFolder, A)).toBe(1));
    await flush();
    onFolderSelected.mockClear();
    mockFss.getFolderContents.mockClear();
    queueOnce(A, () => Promise.reject(new Error('ENOENT')));

    await fireFolderChanged(api, { folderPath: A, eventType: 'removed', filename: null });
    await waitFor(() => expect(screen.queryByText('a1.jpg')).toBeNull());
    expect(onFolderSelected).toHaveBeenCalledWith([]);

    // No longer watched: a later event for that path reads nothing.
    await fireFolderChanged(api, { folderPath: A, eventType: 'rename', filename: 'x.jpg' });
    expect(readsOf(A)).toBe(0);
  });
});

describe('fileSystemService.getFolderContents (the real service)', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('rejects when the Electron IPC call fails, so the caller can keep the previous listing', async () => {
    const real = jest.requireActual('../services/FileSystemService') as typeof import('../services/FileSystemService');
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getFolderContents: jest.fn().mockRejectedValue(new Error('EPERM')),
    };
    await expect(real.fileSystemService.getFolderContents('C:\\X')).rejects.toThrow('EPERM');
  });
});
