import { resolveVanishedCurrent } from '../utils/galleryRemove';
import type { ImageFileInfo } from '../services/FileSystemService';

// The photo open in the editor was deleted (or renamed) on disk: a refresh of the filmstrip's
// folder no longer lists it. The editor then moves to a neighbour, as Gallery's Del does.
const img = (name: string): ImageFileInfo => ({
  id: `id-${name}`, name, path: `C:\\photos\\${name}`, size: 1, type: 'image/png', dateModified: new Date(0),
} as unknown as ImageFileInfo);
const A = img('a.png');
const B = img('b.png');
const C = img('c.png');
const gone = async () => false;
const there = async () => true;

describe('resolveVanishedCurrent', () => {
  it('moves to the next photo when the open one left the list and its file is gone', async () => {
    const b2 = { ...C };
    const r = await resolveVanishedCurrent({ previous: [A, B, C], refreshed: [A, b2], current: B, fileExists: gone });
    expect(r).toEqual({ changed: true, image: b2 });
    expect(r.changed && r.image).toBe(b2); // the object of the NEW list
  });

  it('falls back to the previous photo when the open one was last', async () => {
    const r = await resolveVanishedCurrent({ previous: [A, B, C], refreshed: [A, B], current: C, fileExists: gone });
    expect(r).toEqual({ changed: true, image: B });
  });

  it('skips neighbours that are gone too', async () => {
    const r = await resolveVanishedCurrent({ previous: [A, B, C], refreshed: [A], current: B, fileExists: gone });
    expect(r).toEqual({ changed: true, image: A });
  });

  it('shows the first photo of the new list when no earlier neighbour is left', async () => {
    const r = await resolveVanishedCurrent({ previous: [A, B], refreshed: [C], current: B, fileExists: gone });
    expect(r).toEqual({ changed: true, image: C });
  });

  it('clears the editor when the folder lost its last photo', async () => {
    const r = await resolveVanishedCurrent({ previous: [A], refreshed: [], current: A, fileExists: gone });
    expect(r).toEqual({ changed: true, image: null });
  });

  it('keeps the open photo when it is still listed, and does not ask the disk', async () => {
    const fileExists = jest.fn(gone);
    const r = await resolveVanishedCurrent({ previous: [A, B], refreshed: [A, B, C], current: B, fileExists });
    expect(r).toEqual({ changed: false });
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('keeps the open photo when its file still exists (another folder was opened, or a file being rewritten)', async () => {
    const fileExists = jest.fn(there);
    const r = await resolveVanishedCurrent({ previous: [A, B], refreshed: [C], current: B, fileExists });
    expect(r).toEqual({ changed: false });
    expect(fileExists).toHaveBeenCalledWith(B.path);
  });

  it('keeps a photo that was never in the filmstrip list (opened by File > Open)', async () => {
    const fileExists = jest.fn(gone);
    const r = await resolveVanishedCurrent({ previous: [A], refreshed: [], current: B, fileExists });
    expect(r).toEqual({ changed: false });
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('keeps the open photo when nothing is open or the disk cannot be asked', async () => {
    expect(await resolveVanishedCurrent({ previous: [A], refreshed: [], current: null, fileExists: gone })).toEqual({ changed: false });
    expect(await resolveVanishedCurrent({ previous: [A], refreshed: [], current: A, fileExists: undefined })).toEqual({ changed: false });
    const failing = async () => { throw new Error('ipc'); };
    expect(await resolveVanishedCurrent({ previous: [A], refreshed: [], current: A, fileExists: failing })).toEqual({ changed: false });
  });
});
