/**
 * Task P11 — Gallery Del-remove pure logic.
 *
 * Covers the destructive-path core that lives OUTSIDE the components so it can be
 * asserted in isolation: which photos leave the session list, how the open
 * (current) photo advances when it is itself removed (next → prev → clear), the
 * per-file trash-result → id mapping (incl. partial failure), and the
 * gallery-only Del scoping predicate.
 */
import {
  computeRemoval,
  trashImages,
  shouldHandleGalleryDelete,
  type TrashCapableApi,
} from '../utils/galleryRemove';
import type { ImageFileInfo } from '../services/FileSystemService';
import type { TrashItemResult } from '../types/electron';

const mk = (id: string): ImageFileInfo =>
  ({ id, path: `/p/${id}.jpg`, name: `${id}.jpg` } as unknown as ImageFileInfo);

const list = (...ids: string[]) => ids.map(mk);

describe('computeRemoval', () => {
  it('drops the removed ids from the list (session removal)', () => {
    const images = list('a', 'b', 'c', 'd');
    const r = computeRemoval(images, ['b', 'd'], null);
    expect(r.images.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('leaves the current photo untouched when it is not removed', () => {
    const images = list('a', 'b', 'c');
    const r = computeRemoval(images, ['a'], 'c');
    expect(r.currentChanged).toBe(false);
    expect(r.currentImage?.id).toBe('c');
    expect(r.images.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('advances the current photo to the NEXT survivor when the open photo is removed', () => {
    const images = list('a', 'b', 'c', 'd');
    const r = computeRemoval(images, ['b'], 'b');
    expect(r.currentChanged).toBe(true);
    expect(r.currentImage?.id).toBe('c');
  });

  it('advances to the next survivor skipping an adjacent removed photo', () => {
    const images = list('a', 'b', 'c', 'd');
    // remove b AND c while b is current → next survivor after b that is kept is d
    const r = computeRemoval(images, ['b', 'c'], 'b');
    expect(r.currentImage?.id).toBe('d');
  });

  it('falls back to the PREVIOUS survivor when the removed current photo was last', () => {
    const images = list('a', 'b', 'c');
    const r = computeRemoval(images, ['c'], 'c');
    expect(r.currentChanged).toBe(true);
    expect(r.currentImage?.id).toBe('b');
  });

  it('clears the canvas (null) when everything is removed', () => {
    const images = list('a', 'b');
    const r = computeRemoval(images, ['a', 'b'], 'a');
    expect(r.currentChanged).toBe(true);
    expect(r.currentImage).toBeNull();
    expect(r.images).toEqual([]);
  });

  it('is a no-op shape for an empty removal set', () => {
    const images = list('a', 'b');
    const r = computeRemoval(images, [], 'a');
    expect(r.currentChanged).toBe(false);
    expect(r.currentImage?.id).toBe('a');
    expect(r.images.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('trashImages', () => {
  const okAll = (paths: string[]): Promise<TrashItemResult[]> =>
    Promise.resolve(paths.map((p) => ({ path: p, ok: true })));

  it('calls the trash IPC once with every selected file path (per file)', async () => {
    const images = list('a', 'b', 'c');
    const trashItems = jest.fn(okAll);
    const api: TrashCapableApi = { trashItems };
    await trashImages(images, ['a', 'c'], api);
    expect(trashItems).toHaveBeenCalledTimes(1);
    expect(trashItems).toHaveBeenCalledWith(['/p/a.jpg', '/p/c.jpg']);
  });

  it('reports every id as trashed when all succeed', async () => {
    const images = list('a', 'b');
    const api: TrashCapableApi = { trashItems: okAll };
    const out = await trashImages(images, ['a', 'b'], api);
    expect(out.trashedIds).toEqual(['a', 'b']);
    expect(out.failedIds).toEqual([]);
    expect(out.failedNames).toEqual([]);
  });

  it('splits a partial failure into successes (removed) and failures (kept)', async () => {
    const images = list('a', 'b', 'c');
    const api: TrashCapableApi = {
      trashItems: (paths) =>
        Promise.resolve(
          paths.map((p) => ({ path: p, ok: p !== '/p/b.jpg', error: p === '/p/b.jpg' ? 'locked' : undefined })),
        ),
    };
    const out = await trashImages(images, ['a', 'b', 'c'], api);
    expect(out.trashedIds).toEqual(['a', 'c']);
    expect(out.failedIds).toEqual(['b']);
    expect(out.failedNames).toEqual(['b.jpg']);
  });

  it('treats a short/missing result entry as a failure', async () => {
    const images = list('a', 'b');
    const api: TrashCapableApi = { trashItems: () => Promise.resolve([{ path: '/p/a.jpg', ok: true }]) };
    const out = await trashImages(images, ['a', 'b'], api);
    expect(out.trashedIds).toEqual(['a']);
    expect(out.failedIds).toEqual(['b']);
  });

  it('does not call the IPC when nothing resolves to a real file', async () => {
    const trashItems = jest.fn(okAll);
    const out = await trashImages(list('a'), ['ghost'], { trashItems });
    expect(trashItems).not.toHaveBeenCalled();
    expect(out.trashedIds).toEqual([]);
  });
});

describe('shouldHandleGalleryDelete', () => {
  const base = {
    key: 'Delete',
    viewMode: 'gallery' as const,
    targetTagName: 'DIV',
    isContentEditable: false,
    dialogOpen: false,
    selectionCount: 2,
  };

  it('fires for Del in gallery with a non-empty selection', () => {
    expect(shouldHandleGalleryDelete(base)).toBe(true);
  });

  it('does NOT fire in develop view (gallery-scoped)', () => {
    expect(shouldHandleGalleryDelete({ ...base, viewMode: 'develop' })).toBe(false);
  });

  it('ignores keys other than Delete', () => {
    expect(shouldHandleGalleryDelete({ ...base, key: 'Backspace' })).toBe(false);
    expect(shouldHandleGalleryDelete({ ...base, key: 'x' })).toBe(false);
  });

  it('does not fire while typing in an input/textarea/contentEditable', () => {
    expect(shouldHandleGalleryDelete({ ...base, targetTagName: 'INPUT' })).toBe(false);
    expect(shouldHandleGalleryDelete({ ...base, targetTagName: 'TEXTAREA' })).toBe(false);
    expect(shouldHandleGalleryDelete({ ...base, isContentEditable: true })).toBe(false);
  });

  it('does not re-fire while the confirm dialog is already open', () => {
    expect(shouldHandleGalleryDelete({ ...base, dialogOpen: true })).toBe(false);
  });

  it('is a no-op with an empty selection', () => {
    expect(shouldHandleGalleryDelete({ ...base, selectionCount: 0 })).toBe(false);
  });
});
