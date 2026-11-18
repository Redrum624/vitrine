/**
 * "Open Folder" makes the opened folder the File Explorer's gallery folder (X2, 2026-11-18).
 *
 * Diagnosis C9/R10: the Welcome screen's and the Gallery toolbar's "Open Folder" listed the
 * folder once and handed the images to the filmstrip; FileBrowser never heard of it, so the
 * folder was not watched, never refreshed, and the tree still marked another folder.
 * App now passes `openFolderRequest`; FileBrowser reveals the folder in the tree (walking
 * down from the longest matching root, ids taken from the listings) or, when the walk cannot
 * reach it, tracks it outside the tree. Either way it is watched and feeds the filmstrip.
 */
import { render, fireEvent, act, screen } from '@testing-library/react';
import { FileBrowser, type OpenFolderRequest } from '../components/Layout/FileBrowser';
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
const mockFss = fileSystemService as unknown as { getSystemDrives: jest.Mock; getFolderContents: jest.Mock };

// Ids are base64 of the full path, as electron/main.cjs get-folder-contents builds them.
const b64 = (p: string) => Buffer.from(p).toString('base64');
const baseName = (p: string) => p.split('\\').filter(Boolean).pop() as string;
const folder = (p: string): FolderInfo => ({ id: b64(p), name: baseName(p), path: p, type: 'folder' });
const image = (p: string): ImageFileInfo => ({
  id: b64(p), name: baseName(p), path: p, size: 1000, format: 'JPG', type: 'image/jpeg',
  lastModified: 1, dateModified: new Date(1),
});

const ROOT = 'C:\\';
const A = 'C:\\A';
const B = 'C:\\A\\B';
const D = 'C:\\D';
const MISSING = 'C:\\A\\Missing';
const NAS = '\\\\nas\\share\\photos';

const defaults = new Map<string, Listing>();
const once = new Map<string, Array<() => Promise<Listing>>>();
const setListing = (p: string, folders: string[], images: string[]) =>
  defaults.set(p, { folders: folders.map(folder), images: images.map(image) });
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

const folderLabel = (name: string) => screen.getByText(name, { selector: 'span' });
const rowOf = (name: string) => folderLabel(name).parentElement!.parentElement as HTMLElement;
const arrowOf = (name: string) => rowOf(name).firstElementChild as HTMLElement;

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}
async function fireFolderChanged(api: Api, folderPath: string) {
  const cb = api.onFolderChanged.mock.calls[0][0] as (d: { folderPath: string; eventType: string; filename: string | null }) => void;
  await act(async () => { cb({ folderPath, eventType: 'rename', filename: 'new.jpg' }); });
  await flush();
}
async function focusWindow() {
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await flush();
}

const onImageSelected = jest.fn();
const onFolderSelected = jest.fn();

async function mountBrowser() {
  const utils = render(<FileBrowser onImageSelected={onImageSelected} onFolderSelected={onFolderSelected} />);
  await screen.findByText('C:', { selector: 'span' });
  await flush();
  const open = async (request: OpenFolderRequest) => {
    utils.rerender(
      <FileBrowser onImageSelected={onImageSelected} onFolderSelected={onFolderSelected} openFolderRequest={request} />,
    );
    await flush();
  };
  return { ...utils, open };
}

describe('FileBrowser — Open Folder makes the opened folder the gallery folder', () => {
  let api: Api;

  beforeEach(() => {
    defaults.clear();
    once.clear();
    mockFss.getSystemDrives.mockResolvedValue([{ id: 'driveC', name: 'C:', path: ROOT, type: 'drive' }]);
    setListing(ROOT, [A, D], []);
    setListing(A, [B], ['C:\\A\\a1.jpg']);
    setListing(B, [], ['C:\\A\\B\\b1.jpg']);
    setListing(D, [], ['C:\\D\\d1.jpg']);
    setListing(MISSING, [], ['C:\\A\\Missing\\m1.jpg']);
    setListing(NAS, [], [`${NAS}\\p1.jpg`]);
    mockFss.getFolderContents.mockImplementation((p: string) => {
      const q = once.get(p);
      if (q && q.length) return q.shift()!();
      return Promise.resolve(defaults.get(p) ?? { folders: [], images: [] });
    });
    api = installElectronAPI();
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    jest.clearAllMocks();
  });

  const dialogImages = (p: string) => defaults.get(p)!.images;

  async function expectRevealedB() {
    // C: > A > B expanded (each child row rendered), B selected (and its image rows shown).
    expect(screen.getByText('A', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('B', { selector: 'span' })).toBeTruthy();
    expect(arrowOf('C:').getAttribute('aria-label')).toBe('Collapse folder');
    expect(arrowOf('A').getAttribute('aria-label')).toBe('Collapse folder');
    expect(arrowOf('B').getAttribute('aria-label')).toBe('Collapse folder');
    expect(rowOf('B').style.backgroundColor).toBe('var(--vt-raised)');
    expect(screen.getByText('b1.jpg')).toBeTruthy();
    expect(callsWith(api.watchFolder, B)).toBe(1);
    // The dialog already fed this list: the identical first listing is not fed again.
    expect(onFolderSelected).not.toHaveBeenCalled();
    expect(onImageSelected).not.toHaveBeenCalled();

    setListing(B, [], ['C:\\A\\B\\b1.jpg', 'C:\\A\\B\\b2.jpg']);
    await fireFolderChanged(api, B);
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected).toHaveBeenCalledWith([image('C:\\A\\B\\b1.jpg'), image('C:\\A\\B\\b2.jpg')]);
    expect(onImageSelected).not.toHaveBeenCalled();
  }

  test('4. a reachable folder is revealed, selected, watched and refreshed', async () => {
    const { open } = await mountBrowser();
    await open({ path: B, seq: 1, images: dialogImages(B) });
    await expectRevealedB();
  });

  test('5. the request path matches case-insensitively, with / or \\ and a trailing separator', async () => {
    const { open } = await mountBrowser();
    await open({ path: 'c:/a/b/', seq: 1, images: dialogImages(B) });
    await expectRevealedB();
  });

  test.each([
    ['no root is a prefix (network path)', NAS, `${NAS}\\p2.jpg`],
    ['an ancestor does not list it', MISSING, 'C:\\A\\Missing\\m2.jpg'],
  ])('6. unreachable (%s): tracked outside the tree, then a name click takes over', async (_label, path, added) => {
    const { open } = await mountBrowser();
    await open({ path, seq: 1, images: dialogImages(path) });
    expect(callsWith(api.watchFolder, path)).toBe(1);
    expect(onFolderSelected).not.toHaveBeenCalled();

    // Its watcher event feeds the filmstrip.
    const first = dialogImages(path);
    setListing(path, [], [...first.map((i) => i.path), added]);
    await fireFolderChanged(api, path);
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected).toHaveBeenLastCalledWith([...first, image(added)]);

    // The window-focus re-read reads it once.
    const before = readsOf(path);
    await focusWindow();
    expect(readsOf(path) - before).toBe(1);

    // A later folder-name click on a tree folder unwatches it and takes over.
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('D', { selector: 'span' });
    await flush();
    fireEvent.click(folderLabel('D'));
    await flush();
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\D\\d1.jpg')]);
    expect(callsWith(api.unwatchFolder, path)).toBe(1);
    onFolderSelected.mockClear();
    setListing(path, [], [added]);
    await fireFolderChanged(api, path);
    expect(onFolderSelected).not.toHaveBeenCalled();
    expect(onImageSelected).toHaveBeenCalledTimes(1); // the name click's own select-first
  });

  test('6c. collapsing the ancestor in the tree does not unwatch a folder tracked outside it', async () => {
    const { open } = await mountBrowser();
    await open({ path: MISSING, seq: 1, images: dialogImages(MISSING) });
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    await flush();
    fireEvent.click(arrowOf('A'));
    await flush();
    fireEvent.click(arrowOf('A')); // collapse A: releases A and the tree folders inside it
    await flush();
    expect(callsWith(api.unwatchFolder, A)).toBe(1);
    expect(callsWith(api.unwatchFolder, MISSING)).toBe(0);
    setListing(MISSING, [], ['C:\\A\\Missing\\m1.jpg', 'C:\\A\\Missing\\m2.jpg']);
    await fireFolderChanged(api, MISSING);
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\A\\Missing\\m1.jpg'), image('C:\\A\\Missing\\m2.jpg')]);
  });

  test('6d. a failed ancestor read: tracked outside; the tree holding the same path never unwatches it early', async () => {
    queueOnce(A, () => Promise.reject(new Error('EIO: i/o error'))); // the walk's read of A fails
    const { open, unmount } = await mountBrowser();
    await open({ path: B, seq: 1, images: dialogImages(B) });
    expect(callsWith(api.watchFolder, B)).toBe(1);

    // Later the tree lists B and the user expands and collapses it: main keeps ONE watcher
    // per path, so the path must stay watched while the outside tracking still needs it.
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    await flush();
    fireEvent.click(arrowOf('A'));
    await screen.findByText('B', { selector: 'span' });
    await flush();
    fireEvent.click(arrowOf('B'));
    await flush();
    fireEvent.click(arrowOf('B'));
    await flush();
    expect(callsWith(api.unwatchFolder, B)).toBe(0);
    setListing(B, [], ['C:\\A\\B\\b1.jpg', 'C:\\A\\B\\b2.jpg']);
    await fireFolderChanged(api, B);
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\A\\B\\b1.jpg'), image('C:\\A\\B\\b2.jpg')]);

    // Both hold the path again; unmount unwatches it once.
    fireEvent.click(arrowOf('B'));
    await flush();
    unmount();
    expect(callsWith(api.unwatchFolder, B)).toBe(1);
  });

  test('7a. the same folder opened twice is re-read the second time', async () => {
    const { open } = await mountBrowser();
    await open({ path: B, seq: 1, images: dialogImages(B) });
    expect(readsOf(B)).toBe(1);
    await open({ path: B, seq: 2, images: dialogImages(B) });
    expect(readsOf(B)).toBe(2);
    expect(callsWith(api.watchFolder, B)).toBe(1);
    expect(onFolderSelected).not.toHaveBeenCalled();
  });

  test('7b. two folders opened back to back: only the second ends as gallery folder; the first is not watched', async () => {
    const held = deferred<Listing>();
    queueOnce(ROOT, () => held.promise); // walk 1's read of C:\ hangs
    const { open } = await mountBrowser();
    await open({ path: B, seq: 1, images: dialogImages(B) });
    await open({ path: D, seq: 2, images: dialogImages(D) });
    await act(async () => { held.resolve(defaults.get(ROOT)!); });
    await flush();

    expect(callsWith(api.watchFolder, B)).toBe(0);
    expect(callsWith(api.watchFolder, A)).toBe(0);
    expect(rowOf('D').style.backgroundColor).toBe('var(--vt-raised)');
    expect(screen.queryByText('B', { selector: 'span' })).toBeNull();

    setListing(D, [], ['C:\\D\\d1.jpg', 'C:\\D\\d2.jpg']);
    await fireFolderChanged(api, D);
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\D\\d1.jpg'), image('C:\\D\\d2.jpg')]);
    setListing(B, [], ['C:\\A\\B\\b9.jpg']);
    await fireFolderChanged(api, B);
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
  });

  test('7c. a name click during a walk abandons it: the late walk does not take the gallery', async () => {
    const held = deferred<Listing>();
    queueOnce(A, () => held.promise); // the walk's read of A hangs
    const { open } = await mountBrowser();
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('D', { selector: 'span' });
    await flush();
    await open({ path: B, seq: 1, images: dialogImages(B) });
    fireEvent.click(folderLabel('D'));
    await flush();
    await act(async () => { held.resolve(defaults.get(A)!); });
    await flush();
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\D\\d1.jpg')]);
    expect(callsWith(api.watchFolder, B)).toBe(0);
    expect(rowOf('D').style.backgroundColor).toBe('var(--vt-raised)');
  });

  test('7d. while a walk runs, the previous gallery folder no longer feeds the filmstrip', async () => {
    const { open } = await mountBrowser();
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    await flush();
    fireEvent.click(folderLabel('A')); // A is the gallery folder
    await flush();
    onFolderSelected.mockClear();
    const held = deferred<Listing>();
    queueOnce(ROOT, () => held.promise); // the walk to D waits on C:\
    await open({ path: D, seq: 1, images: dialogImages(D) });

    setListing(A, [B], ['C:\\A\\a1.jpg', 'C:\\A\\a2.jpg']);
    await fireFolderChanged(api, A); // the filmstrip shows D now: A's list must not reach it
    expect(onFolderSelected).not.toHaveBeenCalled();

    await act(async () => { held.resolve(defaults.get(ROOT)!); });
    await flush();
    setListing(D, [], ['C:\\D\\d1.jpg', 'C:\\D\\d2.jpg']);
    await fireFolderChanged(api, D);
    expect(onFolderSelected).toHaveBeenCalledTimes(1);
    expect(onFolderSelected).toHaveBeenLastCalledWith([image('C:\\D\\d1.jpg'), image('C:\\D\\d2.jpg')]);
  });

  test('9. unmount unwatches the tree folders and the folder tracked outside the tree', async () => {
    const { open, unmount } = await mountBrowser();
    fireEvent.click(arrowOf('C:'));
    await screen.findByText('A', { selector: 'span' });
    await flush();
    await open({ path: NAS, seq: 1, images: dialogImages(NAS) });
    const removeListener = jest.spyOn(window, 'removeEventListener');
    unmount();
    expect(callsWith(api.unwatchFolder, ROOT)).toBe(1);
    expect(callsWith(api.unwatchFolder, NAS)).toBe(1);
    expect(api.removeAllListeners).toHaveBeenCalledWith('folder-changed');
    expect(removeListener.mock.calls.some((c) => String(c[0]) === 'focus')).toBe(true);
    removeListener.mockRestore();
  });
});
