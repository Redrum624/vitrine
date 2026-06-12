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

module.exports = { markSelfWrite, isSelfWrite, SELF_WRITE_TTL_MS };
