/**
 * Canonical RAW file-extension lists — single source of truth for both RAW
 * *detection* (does this file look like a RAW photo, for UI purposes: the
 * gallery/filmstrip RAW badge, the RAW count in the gallery footer, the
 * RawDecodePanel visibility gate) and RAW *decode routing* (should this file
 * be sent through `RawImageService`'s LibRaw decode pipeline in
 * `ImageService.loadImage`, vs. treated as a regular sharp/browser-decodable
 * image).
 *
 * These used to be two independently-maintained arrays —
 * `gallerySelection.RAW_EXTENSIONS` (UI detection) and a private
 * `RAW_EXTENSIONS` inside `RawImageService` (decode routing) — that had
 * drifted apart in BOTH directions, not just one:
 *   - the UI list included `.nrw` (Nikon) and `.srw` (Samsung), which the
 *     decode-routing list lacked entirely (those files were silently
 *     misrouted to the regular-image path, which cannot decode raw sensor
 *     data, and would have failed to open);
 *   - the decode-routing list included several older/rarer formats LibRaw
 *     natively supports — Minolta `.mrw`, Kodak `.dcr`/`.k25`/`.kdc`, Epson
 *     `.erf`, Mamiya `.mef`, Leaf `.mos`, Leica `.rwl` — that the UI list
 *     never had, because they predate/sit outside today's common "RAW badge"
 *     set of extensions people expect to see flagged in a gallery.
 *
 * Neither array was a subset of the other, so naively replacing one with the
 * other would have silently regressed real behavior: forcing RawImageService
 * onto the narrower UI list would have dropped decode routing for the eight
 * legacy formats above (files that work today would stop opening); forcing
 * the UI list onto the old decode list would have left `.nrw`/`.srw` files
 * without a RAW badge. RAW_EXTENSIONS below is the UNION of both — the true
 * canonical superset — so there is exactly ONE list, consumed by both
 * `gallerySelection.isRawImage` and `RawImageService.isRawFile`, and no
 * currently-working format loses support.
 */
export const RAW_EXTENSIONS = [
  'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'dng', 'raf', 'rw2',
  'pef', 'srw', 'x3f', 'raw', 'mrw', 'dcr', 'k25', 'kdc', 'erf', 'mef', 'mos',
  'rwl',
];

/**
 * Dot-prefixed twin of `RAW_EXTENSIONS`, for consumers (like
 * `RawImageService.isRawFile`) that match against
 * `filePath.substring(filePath.lastIndexOf('.'))` rather than a bare
 * extension. Same set, same decision above — not a narrower "decodable"
 * slice of it.
 */
export const RAW_EXTENSIONS_DOTTED = RAW_EXTENSIONS.map((ext) => `.${ext}`);
