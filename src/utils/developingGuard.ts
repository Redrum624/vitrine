import { useAppStore } from '../stores/appStore';

/**
 * Blocks pixel-analysis and print actions while a progressive RAW open's background full
 * decode is still running (`developing`). During that window `imageService.getCurrentImage()`
 * returns the camera-graded embedded PREVIEW, not the neutral full-res base — any handler that
 * reads `.data` directly and bakes stats into persisted params (or prints low-res pixels) would
 * wrongly apply once the full decode swaps in (L3 review round 1, important #1/#2; round 2
 * extended this to the six per-module Auto (⚡) actions that read the preview directly and
 * bypassed the toolbar/menu gate entirely).
 *
 * Returns true (blocked — caller must no-op) after showing an info notification; false when it's
 * safe for the caller to proceed. The flag is read AT CALL TIME (`useAppStore.getState()`), not
 * subscribed, so callers don't need to be reactive components — this makes the guard usable from
 * plain event handlers in any module component, not just App.tsx.
 *
 * Lives in its own module (not App.tsx) so module components can import it without pulling in
 * the top-level App component; App.tsx re-exports it for its own round-1 call sites and any
 * existing external imports.
 */
export function guardDeveloping(showInfo: (title: string, message: string) => void, action: string): boolean {
  if (useAppStore.getState().developing) {
    showInfo(action, 'Full quality still developing — try again in a moment');
    return true;
  }
  return false;
}
