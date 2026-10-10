/**
 * Docked shell geometry (Safelight).
 *
 * The window is a native-style docked layout — nothing floats over the photo:
 *
 *   ┌ title bar (menus · Gallery|Develop · caption buttons) ────────────────┐
 *   │ command bar (filename · actions · zoom)    │ inspector │ tool strip   │
 *   │ canvas (the photo, PHOTO_INSET on all sides)│ (histogram│ (module tabs │
 *   │ filmstrip                                  │ + module) │  + toggles)  │
 *   └ status bar ───────────────────────────────────────────────────────────┘
 *
 * Every bar is laid out by flexbox; these constants are the few fixed sizes
 * the components share, plus the breathing room the photo keeps inside the
 * canvas area. Because the inspector and tool strip are docked OUTSIDE the
 * canvas area, the photo can never sit under them at any window size.
 */

// Window chrome heights (documentation of the flexbox layout, not positioning).
export const MENU_BAR_HEIGHT = 40;
export const COMMAND_BAR_HEIGHT = 44;
export const FOOTER_HEIGHT = 32;

/** Docked inspector (histogram + the selected module), right of the canvas. */
export const INSPECTOR_WIDTH = 340;
/** Docked tool strip (module tabs, histogram + settings toggles), far right. */
export const TOOL_STRIP_WIDTH = 52;

/**
 * Photo-region insets inside the canvas area (workspace-relative). Uniform on
 * all four sides: the chrome is docked around the canvas, so the photo only
 * needs breathing room, not clearance.
 */
export const PHOTO_INSET = 24;
export const PHOTO_INSET_LEFT = PHOTO_INSET;
export const PHOTO_INSET_RIGHT = PHOTO_INSET;
export const PHOTO_INSET_TOP = PHOTO_INSET;
export const PHOTO_INSET_BOTTOM = PHOTO_INSET;

/**
 * Right inset of the photo region. Kept as a function (it used to depend on
 * whether the floating right column was open); with the inspector docked
 * outside the canvas area the inset is the same either way.
 */
export function getPhotoInsetRight(_columnVisible: boolean): number {
  return PHOTO_INSET_RIGHT;
}

/** Soft separation between the photo and the graphite surround. */
export const PHOTO_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.45), 0 12px 36px rgba(0, 0, 0, 0.35)';

/** Gallery grid insets inside the canvas area (the command bar sits above it). */
export const GALLERY_GRID_INSET = 20;
export const GALLERY_GRID_INSET_TOP = 16;

export interface FilenameChipInfo {
  name: string;
  current: number; // 1-based position
  total: number;
  zoom: number; // fraction (1 = 100%)
}

/**
 * Composes the full filename label: `name · i of N · zoom%`
 * (e.g. `download.png · 1 of 2 · 100%`).
 */
export function formatFilenameChip({ name, current, total, zoom }: FilenameChipInfo): string {
  return `${name} · ${current} of ${total} · ${Math.round(zoom * 100)}%`;
}

/**
 * The command bar's filename label: `name · i of N`. Zoom is left out — the
 * command bar's zoom cluster already shows it.
 */
export function formatFilenameLabel({ name, current, total }: Omit<FilenameChipInfo, 'zoom'>): string {
  return `${name} · ${current} of ${total}`;
}
