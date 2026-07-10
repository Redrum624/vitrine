/**
 * "Glass · Sectioned" shell geometry (Task 5).
 *
 * All floating chrome (toolbar pill, right column, icon rail, filename chip) and
 * the photo region are positioned from these named constants — never magic
 * numbers sprinkled inline. The photo-region insets are DERIVED from the chrome
 * sizes so nothing ever overlaps the photo (spec §3, 1920×1080 reference).
 *
 * Coordinates are workspace-relative (the full-bleed `--canvas-bg` region that
 * lives between the 38px menu bar and the 32px footer).
 */

// Window chrome heights the workspace sits between (kept here so the geometry is
// self-documenting; the actual bars are laid out by flexbox, not these values).
export const MENU_BAR_HEIGHT = 38;
export const FOOTER_HEIGHT = 32;

/** Top offset shared by the toolbar pill, the right column and the filename chip. */
export const CHROME_TOP = 16;
/** Filename chip left offset. */
export const CHIP_LEFT = 24;

/** Floating right column (histogram card + module card). */
export const RIGHT_COLUMN_OFFSET = 88; // distance from the workspace right edge
export const RIGHT_COLUMN_WIDTH = 392;
export const RIGHT_COLUMN_GAP = 24; // vertical gap between the histogram and module cards
export const RIGHT_COLUMN_BOTTOM = 24; // clearance above the dock so the module card can scroll

/** Floating icon rail (right edge, vertically centered). */
export const RAIL_OFFSET = 20; // distance from the workspace right edge

/**
 * Photo-region insets (workspace-relative). The right inset must fully CLEAR the
 * floating right column so nothing ever overlaps the photo (spec §3's hard rule):
 * column offset (88) + column width (392) + an 8px clearance = 488. (The spec's
 * illustrative "− 40 overlap allowance → 440" assumes the photo always letterboxes
 * narrower than the region; at narrow/short windows a width-filling photo would
 * then sit under the column, so we clear it outright instead.) Top clears the 16px
 * pill top + ~44px pill height + an ~8px gap. Bottom reserves room for the
 * filmstrip dock (Task 6).
 */
const PHOTO_COLUMN_CLEARANCE = 8;
export const PHOTO_INSET_LEFT = 24;
export const PHOTO_INSET_RIGHT = RIGHT_COLUMN_OFFSET + RIGHT_COLUMN_WIDTH + PHOTO_COLUMN_CLEARANCE; // 488
export const PHOTO_INSET_TOP = 68;
export const PHOTO_INSET_BOTTOM = 150;

/** Drop shadow applied to the letterboxed photo (spec §3). */
export const PHOTO_SHADOW = '0 40px 120px rgba(0, 0, 0, 0.7)';

export interface FilenameChipInfo {
  name: string;
  current: number; // 1-based position
  total: number;
  zoom: number; // fraction (1 = 100%)
}

/**
 * Composes the floating filename chip label: `name · i of N · zoom%`
 * (e.g. `download.png · 1 of 2 · 100%`).
 */
export function formatFilenameChip({ name, current, total, zoom }: FilenameChipInfo): string {
  return `${name} · ${current} of ${total} · ${Math.round(zoom * 100)}%`;
}
