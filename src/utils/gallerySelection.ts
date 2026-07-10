import type { ImageFileInfo } from '../services/FileSystemService';
import { getDisplayFormat } from './imageFormat';
import { RAW_EXTENSIONS } from './rawExtensions';

/**
 * Shared, pure helpers used by BOTH the filmstrip dock (`ThumbnailPanel`) and the
 * Gallery grid (`GalleryView`, Task 7) so the two views' selection/filter/format
 * logic can never drift apart. Kept dependency-free (no component imports) to
 * avoid circular imports — components import FROM here, never the reverse.
 */

// ─── RAW detection (moved from ThumbnailPanel so both views share one definition) ──

// Re-exported for back-compat with any existing imports of this module's RAW_EXTENSIONS;
// the canonical list now lives in `./rawExtensions` (see that file for why it's a union,
// not the narrower list this module used to define on its own).
export { RAW_EXTENSIONS };

export const isRawImage = (img: ImageFileInfo): boolean =>
  RAW_EXTENSIONS.includes((img.name.split('.').pop() || '').toLowerCase());

// ─── Rating filter (shared by the dock, the footer, and the gallery grid) ─────────

/** `ratingFilter` 0 = All; 1-5 = keep only images rated >= N. Matches the exact
 * predicate ThumbnailPanel used inline before this was extracted. */
export function filterImagesByRating(
  images: ImageFileInfo[],
  ratings: Record<string, number>,
  ratingFilter: number,
): ImageFileInfo[] {
  if (ratingFilter === 0) return images;
  return images.filter((img) => (ratings[img.id] || 0) >= ratingFilter);
}

// ─── Gallery sort ("Sort: Capture time" toolbar chip) ──────────────────────────────

/**
 * Sorts by `dateModified` (file mtime) — ImageFileInfo has no EXIF capture-time
 * field, so this IS the "capture time / date fallback file date" the brief allows.
 * `ascending` false (default) = newest first.
 */
export function sortImagesByDate(images: ImageFileInfo[], ascending: boolean): ImageFileInfo[] {
  const timeOf = (img: ImageFileInfo): number => {
    if (img.dateModified instanceof Date) return img.dateModified.getTime();
    return img.lastModified ?? 0;
  };
  return [...images].sort((a, b) => (ascending ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));
}

// ─── Shared click selection semantics (ThumbnailPanel's dock AND the Gallery grid) ─

export interface ClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface SelectionSnapshot {
  selectedImageIds: string[];
  selectionAnchorId: string | null;
}

export interface SelectionHandlers<T extends { id: string }> {
  setSelection: (ids: string[], anchorId?: string | null) => void;
  toggleImageSelection: (id: string) => void;
  /** Loads the image to the canvas (Develop's "current" image). */
  onImageSelect: (image: T) => void;
  /** Kicks off (or no-ops if already cached/in-flight) the thumbnail fetch for `image`. */
  loadThumbnail?: (image: T) => void;
}

/**
 * Shared click semantics for a filmstrip/grid thumbnail: shift+click = contiguous
 * range from the anchor (indexed against `orderedList`, the caller's currently
 * displayed — filtered/sorted — order); ctrl/cmd+click = toggle membership without
 * touching the canvas; plain click = load to canvas + collapse the selection to
 * just this image (re-clicking the SOLE already-selected image clears it instead).
 *
 * Extracted verbatim from ThumbnailPanel's original inline `handleThumbnailClick`
 * (Task 6) so the Gallery grid (Task 7) reuses the exact same semantics rather than
 * re-implementing them.
 */
export function handleImageClick<T extends { id: string }>(
  image: T,
  modifiers: ClickModifiers,
  orderedList: T[],
  fallbackAnchorId: string | null | undefined,
  selection: SelectionSnapshot,
  handlers: SelectionHandlers<T>,
): void {
  const selectedSet = new Set(selection.selectedImageIds ?? []);

  if (modifiers.shiftKey) {
    const anchorId = selection.selectionAnchorId ?? fallbackAnchorId ?? image.id;
    const aIdx = orderedList.findIndex((i) => i.id === anchorId);
    const bIdx = orderedList.findIndex((i) => i.id === image.id);
    if (aIdx === -1 || bIdx === -1) {
      handlers.setSelection([image.id], image.id);
      return;
    }
    const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
    const rangeIds = orderedList.slice(lo, hi + 1).map((i) => i.id);
    handlers.setSelection(rangeIds, anchorId);
    return;
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    handlers.toggleImageSelection(image.id);
    return;
  }

  if (selectedSet.size === 1 && selectedSet.has(image.id)) {
    handlers.setSelection([], null);
    return;
  }

  handlers.onImageSelect(image);
  handlers.loadThumbnail?.(image);
  handlers.setSelection([image.id], image.id);
}

// ─── Folder chip / footer formatting (Toolbar's folder chip + StatusBar's gallery footer) ─

/** Strips the trailing filename from a full file path, returning its parent
 * directory. Handles both POSIX and Windows separators (the Electron main
 * process returns Windows-style paths). */
export function getParentFolderPath(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx === -1 ? filePath : filePath.slice(0, idx);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Toolbar's Gallery folder chip (top-left, mirrors the Develop filename chip
 * idiom): `path · N images · N selected`. */
export function formatGalleryFolderChip(images: ImageFileInfo[], selectedCount: number): string {
  if (images.length === 0) return `0 images · ${selectedCount} selected`;
  const path = getParentFolderPath(images[0].path);
  return `${path} · ${images.length} image${images.length === 1 ? '' : 's'} · ${selectedCount} selected`;
}

/** StatusBar's gallery-mode left content: `path · N images · N RAW · total size`. */
export function formatGalleryFooterLeft(images: ImageFileInfo[]): string {
  if (images.length === 0) return 'No folder open';
  const path = getParentFolderPath(images[0].path);
  const rawCount = images.filter(isRawImage).length;
  const totalSize = images.reduce((sum, img) => sum + (img.size || 0), 0);
  return `${path} · ${images.length} image${images.length === 1 ? '' : 's'} · ${rawCount} RAW · ${formatBytes(totalSize)}`;
}

/** Gallery tile's meta line: `W × H · FMT` once dimensions are known (either
 * `image.dimensions` or `dimensionsOverride` — the shared `imageDimensions`
 * store map GalleryView/ThumbnailPanel populate lazily from a thumbnail decode,
 * see Task B2); falls back to the format alone before that (same fallback
 * FileBrowser already uses for its own file-row subtitle). The format label is
 * derived from the file extension via `getDisplayFormat`, never the raw
 * `format`/`type` string, so a MIME-ish or over-literal value ("image/jpeg",
 * "JPEG") always renders as the clean "JPG". */
export function formatGalleryTileMeta(
  image: ImageFileInfo,
  dimensionsOverride?: { width: number; height: number },
): string {
  const dims = dimensionsOverride ?? image.dimensions;
  const parts: string[] = [];
  if (dims) parts.push(`${dims.width} × ${dims.height}`);
  parts.push(getDisplayFormat(image.format || image.name));
  return parts.join(' · ');
}
