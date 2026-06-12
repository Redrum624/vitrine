import type { ImageFileInfo } from '../services/FileSystemService';

/**
 * True when two image lists contain the same files in the same order
 * (compared by id + path; size/mtime changes don't count — a rating write
 * bumps them without changing the list). Used to KEEP the existing array
 * reference when a folder-watcher reload returns an identical file list:
 * swapping in a fresh array instance re-runs every effect keyed on `images`
 * (ThumbnailPanel) and resets the filmstrip scroll position.
 */
export function sameImageList(a: ImageFileInfo[], b: ImageFileInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].path !== b[i].path) return false;
  }
  return true;
}
