// Short-lived registry of files the app itself writes, so the folder watcher
// (watch-folder in main.cjs) can tell self-triggered fs.watch events apart
// from genuine external changes. Without it, writing a star rating (or
// exporting into the open folder) fires 'folder-changed', the renderer
// reloads the folder and the filmstrip scrolls back to the first thumbnail.
const path = require('path');

// How long after markSelfWrite() a change event for that file is swallowed.
// Generous enough to cover sharp re-encode + the watcher's 100ms debounce.
const SELF_WRITE_TTL_MS = 3000;

const selfWrites = new Map(); // lowercased basename -> Date.now() at mark time

// Call BEFORE writing a file into a (potentially) watched folder.
function markSelfWrite(filePath) {
  selfWrites.set(path.basename(String(filePath)).toLowerCase(), Date.now());
}

// True if `filename` (as reported by fs.watch — may include a relative
// subpath) was marked less than SELF_WRITE_TTL_MS ago. Expired entries are
// pruned on each call. The atomic-write temp sibling `<name>.tmp-<ts>` used
// by imageWriter.cjs writeImageMetadata matches its final name.
function isSelfWrite(filename) {
  if (!filename) return false;
  const now = Date.now();
  for (const [key, ts] of selfWrites) {
    if (now - ts > SELF_WRITE_TTL_MS) selfWrites.delete(key);
  }
  const name = path.basename(String(filename)).toLowerCase().replace(/\.tmp-\d+$/, '');
  return selfWrites.has(name);
}

// Debounce decision logic for the folder watcher (watch-folder in main.cjs),
// extracted here so the self-write/external interplay is unit-testable.
// Invariant: an emit happens iff at least one NON-self-write event occurred in
// the debounce window; self-write events alone never emit, and they never
// suppress, delay or replace the context of a genuine external event (they do
// not start, reset or clear the timer).
function createFolderChangeDebouncer({ delayMs = 100, emit, isSelf = isSelfWrite } = {}) {
  let timer = null;
  let pending = null; // last NON-self-write event seen in the current window

  return {
    handleEvent(eventType, filename) {
      if (!filename) return;
      if (isSelf(filename)) return; // self-writes never touch the window
      pending = { eventType, filename };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const evt = pending;
        pending = null;
        if (evt) emit(evt);
      }, delayMs);
    },
    // Discard any pending emit (called when the folder is unwatched).
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    }
  };
}

// Test-only: reset the module-level singleton Map between tests.
function _clearAll() {
  selfWrites.clear();
}

module.exports = {
  markSelfWrite,
  isSelfWrite,
  SELF_WRITE_TTL_MS,
  createFolderChangeDebouncer,
  _clearAll
};
