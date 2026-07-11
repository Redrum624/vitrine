import type { ImageFileInfo } from '../services/FileSystemService';
import type { TrashItemResult } from '../types/electron';

/**
 * Pure, component-free helpers for the Gallery "Del removes selection" flow
 * (Task P11). Kept out of the components so the destructive-path logic — which
 * photos leave the session list, how the open (current) photo advances when it
 * itself is removed, and how a per-file trash result maps back to ids — is unit
 * testable in isolation. Components import FROM here; nothing here imports a
 * component (mirrors gallerySelection.ts's rationale).
 */

export interface RemovalResult {
  /** The folder listing with the removed ids filtered out (new array). */
  images: ImageFileInfo[];
  /** The image the canvas should show after the removal: unchanged when the
   *  current photo survived; the next-then-previous survivor when it was
   *  removed; null when nothing is left. */
  currentImage: ImageFileInfo | null;
  /** True only when the current photo was among those removed (so the caller
   *  knows to actually swap the canvas, rather than leave it untouched). */
  currentChanged: boolean;
}

/**
 * Computes the new folder listing and the new "current" image after removing
 * `idsToRemove` from `images`.
 *
 * Current-photo handling when the OPEN photo is itself removed: advance to the
 * next surviving photo AFTER it in the (pre-removal) list; if there is none,
 * fall back to the nearest surviving photo BEFORE it; if the list is now empty,
 * clear the canvas (null). When the current photo is NOT being removed it stays
 * put (currentChanged=false) and the caller need not touch the canvas.
 */
export function computeRemoval(
  images: ImageFileInfo[],
  idsToRemove: string[],
  currentImageId: string | null,
): RemovalResult {
  const removeSet = new Set(idsToRemove);
  const survivors = images.filter((img) => !removeSet.has(img.id));

  const currentRemoved = currentImageId != null && removeSet.has(currentImageId);
  if (!currentRemoved) {
    // Current survived (or there is no current) — keep whatever it was pointing
    // at, resolved against the survivor list so the returned object is the live one.
    const currentImage =
      currentImageId != null ? survivors.find((i) => i.id === currentImageId) ?? null : null;
    return { images: survivors, currentImage, currentChanged: false };
  }

  const idx = images.findIndex((i) => i.id === currentImageId);
  let next: ImageFileInfo | null = null;
  for (let j = idx + 1; j < images.length; j++) {
    if (!removeSet.has(images[j].id)) {
      next = images[j];
      break;
    }
  }
  if (!next) {
    for (let j = idx - 1; j >= 0; j--) {
      if (!removeSet.has(images[j].id)) {
        next = images[j];
        break;
      }
    }
  }
  return { images: survivors, currentImage: next, currentChanged: true };
}

export interface TrashOutcome {
  /** Ids whose file was successfully moved to the OS trash (drop these). */
  trashedIds: string[];
  /** Ids whose file could NOT be trashed (keep these in the list). */
  failedIds: string[];
  /** Display names of the failed files, for the error toast. */
  failedNames: string[];
}

/** Minimal slice of the electron API this helper needs — keeps the helper
 *  testable against a plain mock without depending on the full ElectronAPI. */
export interface TrashCapableApi {
  trashItems: (filePaths: string[]) => Promise<TrashItemResult[]>;
}

/**
 * Moves the selected images' files to the OS Recycle Bin via the main-process
 * `trash-items` IPC and maps the per-file result back to image ids. Results are
 * zipped by index against the paths sent (the handler preserves order); any
 * missing/false entry is treated as a failure so a partial batch cleanly splits
 * into successes (removed by the caller) and failures (kept in the list + toast).
 */
export async function trashImages(
  images: ImageFileInfo[],
  idsToRemove: string[],
  api: TrashCapableApi,
): Promise<TrashOutcome> {
  const targets = idsToRemove
    .map((id) => images.find((i) => i.id === id))
    .filter((i): i is ImageFileInfo => !!i);

  const trashedIds: string[] = [];
  const failedIds: string[] = [];
  const failedNames: string[] = [];

  if (targets.length === 0) return { trashedIds, failedIds, failedNames };

  const results = await api.trashItems(targets.map((t) => t.path));
  targets.forEach((t, i) => {
    const r = results?.[i];
    if (r && r.ok) {
      trashedIds.push(t.id);
    } else {
      failedIds.push(t.id);
      failedNames.push(t.name);
    }
  });
  return { trashedIds, failedIds, failedNames };
}

/**
 * Pure predicate for the gallery-scoped Del handler: whether a keydown should
 * open the remove-confirm dialog. Gallery-view-only, Del only, never while an
 * input/textarea/contentEditable or the dialog itself has focus, and a no-op
 * with an empty selection. Extracted so the "gallery only, not develop"
 * scoping is unit-testable without mounting App.
 */
export function shouldHandleGalleryDelete(params: {
  key: string;
  viewMode: 'develop' | 'gallery';
  targetTagName?: string | null;
  isContentEditable?: boolean;
  dialogOpen: boolean;
  selectionCount: number;
}): boolean {
  const { key, viewMode, targetTagName, isContentEditable, dialogOpen, selectionCount } = params;
  if (key !== 'Delete') return false;
  if (viewMode !== 'gallery') return false;
  const tag = (targetTagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || isContentEditable) return false;
  if (dialogOpen) return false;
  if (selectionCount === 0) return false;
  return true;
}
