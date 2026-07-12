/**
 * Shared keyboard-scope guard for document/window-level key listeners.
 *
 * `keyboardEventBlocked(e)` returns true when a GLOBAL keyboard shortcut must NOT
 * fire, because the keypress belongs to something more specific than the app
 * chrome. It is blocked when either:
 *   - the event target is a text-entry element (INPUT / TEXTAREA / contentEditable),
 *     so the keypress is text the user is typing, OR
 *   - a modal dialog is open — any element carrying `[aria-modal="true"]` is in the
 *     DOM — so the keypress belongs to the dialog and its own handlers.
 *
 * WHY THIS EXISTS — round-6's whole-branch review found this exact gap patched
 * PIECEMEAL three separate times: App's gallery-Del guard, GalleryView's rating
 * listener, and App's numpad-rating handler had each grown their own private
 * `[aria-modal="true"]` + input check, while FOUR other global listeners
 * (KeyboardShortcutsService, the numpad handler's siblings, the mask-Del handler,
 * and ThumbnailPanel's arrows/Esc — the last with no input check at all) still
 * fired beneath open dialogs. This is THE single source of truth: every
 * document-/window-level keydown listener that triggers an app action must
 * early-return on it, so the DOM query and the text-entry check live in one place.
 *
 * IMPORTANT for capture-phase listeners (e.g. KeyboardShortcutsService, App's
 * numpad handler): early-return on this BEFORE calling `preventDefault()` /
 * `stopPropagation()`, so a blocked event still reaches the dialog's (or the
 * focused input's) own handlers — otherwise typing "1" in a preset-name field
 * would be swallowed instead of inserted.
 *
 * NOTE: this covers the DOM part only. Guards that also compose non-DOM state
 * (e.g. App's gallery-Del `removeTargetIds !== null` React-state check, which
 * catches our own confirm dialog in the frame before its aria-modal node
 * commits) must AND that state with this helper, not replace it.
 */
export function keyboardEventBlocked(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  ) {
    return true;
  }
  return document.querySelector('[aria-modal="true"]') !== null;
}
