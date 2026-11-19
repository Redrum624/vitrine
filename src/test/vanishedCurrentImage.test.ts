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

  it('a renamed open photo: the editor moves to the next photo of the OLD order, not to the new name', async () => {
    const a2 = img('a2.png'); // b.png renamed to a2.png sorts before c.png
    const r = await resolveVanishedCurrent({ previous: [A, B, C], refreshed: [A, a2, C], current: B, fileExists: gone });
    expect(r).toEqual({ changed: true, image: C });
  });

  it('changes nothing when another photo was opened while the disk was asked', async () => {
    const r = await resolveVanishedCurrent({
      previous: [A, B, C], refreshed: [A, C], current: B, fileExists: gone,
      latest: () => ({ currentId: C.id, images: [A, C] }),
    });
    expect(r).toEqual({ changed: false });
  });

  it('takes the neighbour from the list shown once the disk has answered', async () => {
    // A second refresh (c.png deleted too) arrived while the disk was asked.
    const r = await resolveVanishedCurrent({
      previous: [A, B, C], refreshed: [A, C], current: B, fileExists: gone,
      latest: () => ({ currentId: B.id, images: [A] }),
    });
    expect(r).toEqual({ changed: true, image: A });
  });

  it('changes nothing when the newest list has the photo again', async () => {
    const r = await resolveVanishedCurrent({
      previous: [A, B], refreshed: [A], current: B, fileExists: gone,
      latest: () => ({ currentId: B.id, images: [A, B] }),
    });
    expect(r).toEqual({ changed: false });
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
