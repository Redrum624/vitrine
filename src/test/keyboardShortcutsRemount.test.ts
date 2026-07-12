/**
 * Round-6 P10: behavioral companion to keyboardShortcutsSingleRegistration.test.ts.
 *
 * That suite statically asserts App.tsx's keyboard-init effect is mount-only (so an image/tool
 * switch never tears the service down and re-registers — the per-open churn bug). It cannot run
 * a full <App/> render, so the *behavior* is verified here at the service level against the
 * DEFAULT shortcut set (createDefaultShortcuts) — the exact list App re-registers. This pins two
 * guarantees the static test can only imply:
 *   1. destroy() then re-register (the App cleanup→setup cycle) leaves the shortcuts firing —
 *      register() re-attaches the document listener destroy() removed.
 *   2. re-registering the SAME shortcut id is idempotent — it does NOT double-fire (the map keys
 *      by chord, so a re-run without destroy overwrites rather than duplicating).
 *
 * ratingShortcuts.test.ts covers the same resilience for the number-key rating shortcuts; this
 * covers the default file/edit/view set.
 */
import {
  KeyboardShortcutsService,
  createDefaultShortcuts,
} from '../services/KeyboardShortcutsService';

describe('KeyboardShortcutsService — default-set re-registration (App remount cycle)', () => {
  let service: KeyboardShortcutsService;
  let onOpen: jest.Mock;
  let onUndo: jest.Mock;

  const register = () => {
    onOpen = jest.fn();
    onUndo = jest.fn();
    createDefaultShortcuts({ onOpen, onUndo }).forEach((s) => service.register(s));
  };

  beforeEach(() => {
    service = new KeyboardShortcutsService();
    register();
  });

  afterEach(() => {
    service.destroy();
  });

  it('fires a default shortcut (Ctrl+O) through the document listener', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('still fires after destroy() + re-register — the App cleanup→setup cycle re-attaches the listener', () => {
    service.destroy();
    register(); // fresh callbacks, same chords — mirrors the effect re-running
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('re-registering the same chord without destroy() is idempotent (fires exactly once, no double-register)', () => {
    // Register the whole default set a second time WITHOUT destroying — the map keys by chord,
    // so Ctrl+O is overwritten, not duplicated. A duplicate listener/entry would fire onOpen twice.
    register();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
