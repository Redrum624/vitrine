/**
 * Single normalization point for "what format is this image, for display".
 *
 * The app has several producers of `ImageFileInfo.format`/`.type` (the main-process
 * folder scan, the browser-mode mock, `App.tsx`'s single-file-open and
 * batch-open helpers), and they don't agree on shape: some store a raw
 * extension ("jpg"), some an uppercased extension ("JPEG" — the literal
 * extension, not the display-friendly "JPG"), some a MIME type
 * ("image/jpeg"). Rather than reconciling every producer's storage format
 * (risking existing regression-tested field values — see
 * fileOpenSetsCurrentImage.test.ts), every UI surface that displays a format
 * label (StatusBar footer, GalleryView tile meta) routes through this one
 * function instead.
 */

/** Extensions with a display label that differs from their bare uppercased form. */
const EXTENSION_TO_DISPLAY_FORMAT: Record<string, string> = {
  jpg: 'JPG',
  jpeg: 'JPG',
  tif: 'TIFF',
  tiff: 'TIFF',
};

/**
 * Resolves a display-friendly format label (e.g. "JPG", "PNG", "ORF", "CR3")
 * from any of:
 *  - a bare extension, with or without a leading dot ("jpg", ".jpg")
 *  - a filename or full path ("IMG_0001.jpg", "C:\\pics\\photo.ORF")
 *  - a MIME-ish string ("image/jpeg")
 *
 * Unrecognized extensions fall back to an uppercased echo of themselves so an
 * unmapped/future format still renders sanely instead of disappearing.
 * Returns '' for empty/nullish input.
 */
export function getDisplayFormat(input: string | undefined | null): string {
  if (!input) return '';

  // MIME-ish strings ("image/jpeg") — take the subtype half.
  const afterSlash = input.includes('/') ? input.slice(input.lastIndexOf('/') + 1) : input;

  // Filenames/paths ("IMG_0001.jpg", "photo.ORF") and bare dotted extensions
  // (".jpg") — take the last dot-separated segment.
  const lastDot = afterSlash.lastIndexOf('.');
  const raw = lastDot === -1 ? afterSlash : afterSlash.slice(lastDot + 1);

  const ext = raw.trim().toLowerCase();
  if (!ext) return '';

  return EXTENSION_TO_DISPLAY_FORMAT[ext] ?? ext.toUpperCase();
}
