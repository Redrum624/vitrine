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
 * Floating filmstrip dock (Task 6): bottom offset, hugs content, centered on the
 * alignment axis. Thumbs are 88px tall; with the dock's 10px vertical padding
 * (10 + 88 + 10 = 108) and this 24px bottom offset, the dock's top edge sits at
 * 132px from the workspace bottom — 18px inside PHOTO_INSET_BOTTOM (150), which
 * is the spec's minimum photo clearance.
 */
export const DOCK_BOTTOM = 24;

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

/**
 * Right inset when the floating right column (histogram/module card) is
 * HIDDEN — i.e. `viewMode === 'develop' && !selectedTool && !histogramVisible`
 * is false in App.tsx, the same gate that renders the column itself. The
 * column no longer needs clearing, but the floating icon rail (IconSidebar)
 * still does, so the photo can't simply match the left inset (24) — that
 * would sit the photo's edge under the rail.
 *
 * Rail box width: 42px button tile + 8px horizontal padding ×2 + 1px
 * `.glass-chrome` border ×2 = 60 (see IconSidebar.tsx's `railBtn` + the rail
 * container's `padding: '10px 8px'`). The rail's left edge sits at
 * RAIL_OFFSET + RAIL_BOX_WIDTH from the workspace's right edge; clearing it
 * by PHOTO_RAIL_CLEARANCE (18 — more generous than the column's 8, since the
 * rail buttons scale 1.06 on hover without reflowing the static layout box)
 * gives the no-column right inset. This is the closest a derived value gets
 * to "matching the left inset's 24px visual weight" without violating the
 * no-overlap invariant (a literal 24 would sit 56px under the rail).
 */
export const RAIL_BOX_WIDTH = 60; // 42 (button) + 8*2 (h-padding) + 1*2 (border) — IconSidebar.tsx
export const PHOTO_RAIL_CLEARANCE = 18;
export const PHOTO_INSET_RIGHT_NO_COLUMN = RAIL_OFFSET + RAIL_BOX_WIDTH + PHOTO_RAIL_CLEARANCE; // 98

/** Selects the right inset for the current right-column visibility (the same
 *  `selectedTool || histogramVisible` gate App.tsx uses to render the column). */
export function getPhotoInsetRight(columnVisible: boolean): number {
  return columnVisible ? PHOTO_INSET_RIGHT : PHOTO_INSET_RIGHT_NO_COLUMN;
}

/** Drop shadow applied to the letterboxed photo (spec §3). */
export const PHOTO_SHADOW = '0 40px 120px rgba(0, 0, 0, 0.7)';

/**
 * Gallery grid insets (Task 7, 5a): left/right/bottom clear the workspace edge by
 * the same 24px every other floating chrome piece uses; top is taller (72) to
 * clear the window-centered toolbar pill (no alignment axis in this view).
 */
export const GALLERY_GRID_INSET = 24;
export const GALLERY_GRID_INSET_TOP = 72;

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
