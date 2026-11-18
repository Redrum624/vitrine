// Short-lived registry of files the app itself writes, so the folder watcher
// (watch-folder in main.cjs) can tell self-triggered fs.watch events apart
// from genuine external changes. Without it, writing a star rating (or
// overwriting an export in the open folder) fires 'folder-changed', the renderer
// reloads the folder and the filmstrip scrolls back to the first thumbnail.
// A file the app CREATES is not marked (markSelfWriteIfExists): it must appear.
const fs = require('fs');
const path = require('path');

// How long after markSelfWrite() a change event for that file is swallowed.
// Generous enough to cover sharp re-encode + the watcher's 100ms debounce.
const SELF_WRITE_TTL_MS = 3000;

const selfWrites = new Map(); // lowercased basename -> Date.now() at mark time

// Call BEFORE writing a file into a (potentially) watched folder.
function markSelfWrite(filePath) {
  selfWrites.set(path.basename(String(filePath)).toLowerCase(), Date.now());
}

// Mark only an OVERWRITE (the target exists before the write). A file the app
// creates (a new export, a Save As) is a real change to the folder's listing:
// its watcher event must reach the renderer so the new file shows up (M2).
// Overwrites stay suppressed: the listing does not change, and forwarding the
// event would only reload the folder. Call BEFORE writing.
function markSelfWriteIfExists(filePath, existsFn = fs.existsSync) {
  if (existsFn(filePath)) markSelfWrite(filePath);
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

// Longest a pending change may wait for its emit under a continuous event
// stream. DESIGN VALUE, not a measurement: ten debounce delays (10 x 100 ms).
// It bounds how long a busy folder (a copy in progress, or the ~160,000
// events/2 s storm fs.watch delivers after the folder is deleted, diagnosis
// M1) can go without a refresh.
const DEFAULT_MAX_WAIT_MS = 1000;

// Debounce decision logic for the folder watcher (watch-folder in main.cjs),
// extracted here so the self-write/external interplay is unit-testable.
// Invariant: an emit happens iff at least one NON-self-write event occurred in
// the debounce window; self-write events alone never emit, and they never
// suppress, delay or replace the context of a genuine external event (they do
// not start, reset or clear the timer). An event with no filename (fs.watch
// overflow / unknown change) counts as external (M3). The emit happens
// `delayMs` after the last event, and never later than `maxWaitMs` after the
// first pending one, so a continuous stream still emits (M5).
function createFolderChangeDebouncer({ delayMs = 100, maxWaitMs = DEFAULT_MAX_WAIT_MS, emit, isSelf = isSelfWrite } = {}) {
  let timer = null;    // trailing timer, restarted by each external event
  let maxTimer = null; // started by the first pending event, never restarted
  let pending = null;  // last NON-self-write event seen in the current window

  function clearTimers() {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
  }

  function flush() {
    clearTimers();
    const evt = pending;
    pending = null;
    if (evt) emit(evt);
  }

  return {
    handleEvent(eventType, filename) {
      if (filename && isSelf(filename)) return; // self-writes never touch the window
      pending = { eventType, filename: filename || null };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
      if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
    },
    // Discard any pending emit (called when the folder is unwatched).
    cancel() {
      clearTimers();
      pending = null;
    }
  };
}

// One fs.watch handle for `folderPath`, registered in `watchers` (main.cjs
// folderWatchers) under its path. It removes itself from `watchers` on close.
// When the folder is gone (checked before each emit) or the watcher reports
// 'error', it cancels its debouncer, closes the handle and sends ONE
// { folderPath, eventType: 'removed', filename: null } (M1/M7): fs.watch on a
// deleted folder never stops on its own, so closing is what ends the storm.
// The returned handle keeps the { _debouncer, close() } shape that
// unwatch-folder and closeAllFolderWatchers already use. Throws if watchFn does.
function createFolderWatcher({ folderPath, watchers, watchFn = fs.watch, existsFn = fs.existsSync, send, delayMs = 100, maxWaitMs = DEFAULT_MAX_WAIT_MS }) {
  let closed = false;
  let watcher = null;
  let handle = null;

  const debouncer = createFolderChangeDebouncer({
    delayMs,
    maxWaitMs,
    emit: ({ eventType, filename }) => {
      if (closed) return;
      if (!existsFn(folderPath)) {
        gone();
        return;
      }
      send({ folderPath, eventType, filename });
    }
  });

  function close() {
    if (closed) return;
    closed = true;
    debouncer.cancel();
    try {
      if (watcher) watcher.close();
    } catch (error) {
      console.warn(`Failed to close folder watcher ${folderPath}:`, error && error.message);
    }
    if (watchers && watchers.get(folderPath) === handle) watchers.delete(folderPath);
  }

  function gone() {
    if (closed) return;
    close();
    send({ folderPath, eventType: 'removed', filename: null });
  }

  watcher = watchFn(folderPath, { persistent: false }, (eventType, filename) => {
    if (!closed) debouncer.handleEvent(eventType, filename);
  });
  watcher.on('error', (error) => {
    console.warn(`Folder watcher error for ${folderPath}:`, error && error.message);
    gone();
  });

  handle = { _debouncer: debouncer, close };
  if (watchers) watchers.set(folderPath, handle);
  return handle;
}

// Test-only: reset the module-level singleton Map between tests.
function _clearAll() {
  selfWrites.clear();
}

module.exports = {
  markSelfWrite,
  markSelfWriteIfExists,
  isSelfWrite,
  SELF_WRITE_TTL_MS,
  DEFAULT_MAX_WAIT_MS,
  createFolderChangeDebouncer,
  createFolderWatcher,
  _clearAll
};
