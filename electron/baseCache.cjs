// Disk-persisted base cache (L2) for decoded RAW bases — Electron main process.
//
// The in-memory base cache (ImageCacheService, L1) dies with the process, so every new session
// pays the full ~4.3s native LibRaw decode per RAW again. This module persists a decoded base —
// the raw decode-IPC payload buffer VERBATIM (`decode-raw-file`'s { data, width, height,
// channels, bitDepth } shape) — to disk, keyed by (file path, decode options), so a SECOND
// session's cold open gets full quality from a fast NVMe read (~1s) instead of the slow decode.
//
// Layout (under `app.getPath('userData')/base-cache/`):
//   <sha1(path)>-<optionsHash>.bin   the raw decoded buffer, packed pixels, host byte order
//   <sha1(path)>-<optionsHash>.json  sidecar: width/height/channels/bitDepth + decode options +
//                                     source mtimeMs/size (for invalidation) + lastAccess (LRU)
//
// Coherence is sacred: an entry is valid ONLY for the exact (path, mtimeMs, size, demosaic,
// highlightMode) it was decoded with. mtime/size are re-checked against the live source file on
// every read (mismatch → delete + miss). The demosaic/highlightMode are baked into the entry KEY,
// so a decode with different options can never alias a stale entry.
//
// Index: an in-memory Map<key, {size, lastAccess}> rebuilt by a dir scan at startup (init). Budget
// ~2GB, LRU-evicted by lastAccess at WRITE time. The PREVIEW is never disk-cached (only the full
// decode routes through here — see RawImageService.decodeRawFile). Pure helpers are exported for
// unit tests; the fs layer mirrors rawDecoder.cjs's plain-module style.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024; // ~2 GB

// Default decode options — kept in sync with rawDecoder.cjs / types/electron.ts (DCB + blend).
const DEFAULT_OPTIONS = { demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true };

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — directly unit-testable)
// ---------------------------------------------------------------------------

/**
 * Stable short hash of the decode options that affect the pixels. Only demosaic + highlightMode
 * change the decoded base, so those alone form the options component of the cache key. Falls back
 * to DEFAULT_OPTIONS for an undefined/partial input so a missing-options open keys the same entry
 * a default-options open does.
 * @param {{demosaic?: string, highlightMode?: string}} [options]
 * @returns {string} 8-hex-char digest
 */
function optionsHash(options) {
  const demosaic = (options && options.demosaic) || DEFAULT_OPTIONS.demosaic;
  const highlightMode = (options && options.highlightMode) || DEFAULT_OPTIONS.highlightMode;
  // cameraMatch mirrors decodeRawFile's resolution exactly: an ABSENT options
  // object falls back to the default (match ON), but an options object WITHOUT
  // the field means false (e.g. options persisted before the field existed) —
  // `|| DEFAULT` here would alias two different pixel outputs to one key.
  const cameraMatch = options ? !!options.cameraMatch : DEFAULT_OPTIONS.cameraMatch;
  // NOTE: the camera-match FIT PARAMETERS (lattice size, smoothing, weighting in
  // cameraMatch.cjs) are pixel provenance too, but are not part of this key. If
  // they ever change in a release, bump the `cm:` tag (e.g. `cm2:`) so stale
  // cached bases fitted with the old parameters miss instead of being served.
  return crypto.createHash('sha1').update(`${demosaic}|${highlightMode}|cm:${cameraMatch ? 1 : 0}`).digest('hex').slice(0, 8);
}

/**
 * Filesystem-safe entry base name for (path, options): `<sha1(path)>-<optionsHash>`. sha1(path)
 * neutralises separators/spaces/length; the options hash makes the key options-coherent.
 * @param {string} filePath
 * @param {{demosaic?: string, highlightMode?: string}} [options]
 * @returns {string}
 */
function entryName(filePath, options) {
  const pathHash = crypto.createHash('sha1').update(String(filePath)).digest('hex');
  return `${pathHash}-${optionsHash(options)}`;
}

/**
 * Whether a sidecar is still valid for the current source file: the recorded source mtimeMs AND
 * size must both match the live stat. Any change to either (re-edit, replace, resave) → stale.
 * @param {{sourceMtimeMs?: number, sourceSize?: number}|null} meta
 * @param {{mtimeMs: number, size: number}|null} stat
 * @returns {boolean}
 */
function sidecarIsValid(meta, stat) {
  if (!meta || !stat) return false;
  return meta.sourceMtimeMs === stat.mtimeMs && meta.sourceSize === stat.size;
}

/**
 * LRU eviction selection (pure): given the OTHER index entries and the incoming entry's size,
 * choose the keys to evict — oldest lastAccess first — so that
 * (sum(remaining) + incomingSize) <= budget. Returns [] when the incoming entry already fits.
 * @param {{key: string, size: number, lastAccess: number}[]} entries
 * @param {number} incomingSize
 * @param {number} budget
 * @returns {string[]} keys to evict, oldest-first
 */
function selectEvictions(entries, incomingSize, budget) {
  let total = entries.reduce((s, e) => s + e.size, 0);
  if (total + incomingSize <= budget) return [];
  const oldestFirst = [...entries].sort((a, b) => a.lastAccess - b.lastAccess);
  const evict = [];
  for (const e of oldestFirst) {
    if (total + incomingSize <= budget) break;
    evict.push(e.key);
    total -= e.size;
  }
  return evict;
}

/**
 * Return the underlying ArrayBuffer of a Node Buffer WITHOUT copying when the Buffer spans its
 * entire backing store — the common case for a large `fs.readFile` (Node gives reads at/above the
 * pool threshold a DEDICATED, non-pooled allocation with byteOffset 0 and byteLength ===
 * buffer.byteLength). A disk-cache hit is ~122MB, so skipping the `.slice()` there avoids a
 * pointless second ~122MB copy on every hit. Only slice (copy) when the Buffer is a partial view
 * over a shared/pooled ArrayBuffer, where handing back the whole backing store would expose
 * unrelated bytes (and the wrong byteLength).
 * @param {Buffer} buf
 * @returns {ArrayBuffer}
 */
function bufferToArrayBuffer(buf) {
  return buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    ? buf.buffer
    : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ---------------------------------------------------------------------------
// Stateful fs layer (in-memory index over the on-disk entries)
// ---------------------------------------------------------------------------

let cacheDir = null;
let budgetBytes = DEFAULT_BUDGET_BYTES;
const index = new Map(); // key -> { size, lastAccess }

function binPathFor(key) { return path.join(cacheDir, key + '.bin'); }
function jsonPathFor(key) { return path.join(cacheDir, key + '.json'); }

function safeUnlinkSync(p) {
  try { fs.unlinkSync(p); } catch (_) { /* best-effort */ }
}
async function safeUnlink(p) {
  try { await fs.promises.unlink(p); } catch (_) { /* best-effort */ }
}

/**
 * Point the cache at `dir` and rebuild the in-memory index by scanning it. Called once at app
 * startup (after app is ready, so userData exists). Orphaned/corrupt sidecars and stray .bin files
 * with no matching sidecar are swept. Never throws. Returns the number of valid entries indexed.
 * @param {string} dir
 * @param {{budget?: number}} [opts]
 * @returns {number}
 */
function init(dir, opts = {}) {
  cacheDir = dir;
  budgetBytes = opts.budget || DEFAULT_BUDGET_BYTES;
  index.clear();
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const names = fs.readdirSync(cacheDir);
    const jsonKeys = new Set();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const key = name.slice(0, -'.json'.length);
      try {
        const meta = JSON.parse(fs.readFileSync(jsonPathFor(key), 'utf8'));
        const st = fs.statSync(binPathFor(key)); // the .bin must exist to count the entry
        index.set(key, { size: st.size, lastAccess: meta.lastAccess || 0 });
        jsonKeys.add(key);
      } catch (_) {
        // Orphaned/corrupt sidecar (or missing .bin) → drop both, best-effort.
        safeUnlinkSync(jsonPathFor(key));
        safeUnlinkSync(binPathFor(key));
      }
    }
    // Sweep stray .bin files whose sidecar never committed (crash between the two renames).
    for (const name of names) {
      if (!name.endsWith('.bin')) continue;
      const key = name.slice(0, -'.bin'.length);
      if (!jsonKeys.has(key)) safeUnlinkSync(path.join(cacheDir, name));
    }
    // Sweep *.tmp orphans (crash BEFORE either rename — write() stages both files as
    // <key>.<ext>.<rnd>.tmp first). They're ~122MB each, invisible to the LRU budget, and no
    // in-flight write survives a restart, so any .tmp at init time is garbage by definition.
    for (const name of names) {
      if (name.endsWith('.tmp')) safeUnlinkSync(path.join(cacheDir, name));
    }
  } catch (_) {
    /* best-effort — a broken cache dir must never break startup */
  }
  return index.size;
}

async function remove(key) {
  index.delete(key);
  if (!cacheDir) return;
  await safeUnlink(binPathFor(key));
  await safeUnlink(jsonPathFor(key));
}

/**
 * Read a persisted base for (path, options), or null on a miss. Invalidates (deletes) the entry
 * when the live source file's mtime/size no longer match the sidecar, or when the stored buffer is
 * torn (byte length ≠ declared geometry). Returns the SAME shape the `decode-raw-file` IPC returns
 * ({ data, width, height, channels, bitDepth }) so the renderer swap path is byte-identical.
 * @param {string} filePath
 * @param {{demosaic?: string, highlightMode?: string}} [options]
 * @returns {Promise<{data: ArrayBuffer, width: number, height: number, channels: number, bitDepth: number}|null>}
 */
async function read(filePath, options) {
  if (!cacheDir) return null;
  const key = entryName(filePath, options);

  let meta;
  try {
    meta = JSON.parse(await fs.promises.readFile(jsonPathFor(key), 'utf8'));
  } catch (_) {
    return null; // no sidecar → miss
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    // Source temporarily unavailable (removable/network drive): treat as a miss but do NOT delete —
    // the entry may still be valid when the source returns. LRU handles reclamation if not.
    return null;
  }

  if (!sidecarIsValid(meta, stat)) {
    await remove(key); // invalidation on read
    return null;
  }

  let buf;
  try {
    buf = await fs.promises.readFile(binPathFor(key));
  } catch (_) {
    await remove(key);
    return null;
  }

  // Guard a truncated/torn buffer against the declared geometry.
  const bytesPerSample = meta.bitDepth === 16 ? 2 : 1;
  const expected = meta.width * meta.height * meta.channels * bytesPerSample;
  if (buf.byteLength !== expected) {
    await remove(key);
    return null;
  }

  // Touch lastAccess (LRU) in the index and persist it (fire-and-forget — a lost touch only skews
  // eviction ordering slightly, never correctness).
  const now = Date.now();
  index.set(key, { size: buf.byteLength, lastAccess: now });
  meta.lastAccess = now;
  fs.promises.writeFile(jsonPathFor(key), JSON.stringify(meta)).catch(() => {});

  const data = bufferToArrayBuffer(buf);
  return { data, width: meta.width, height: meta.height, channels: meta.channels, bitDepth: meta.bitDepth };
}

/**
 * Persist a freshly-decoded base for (path, options). Atomic (temp file + rename, .json committed
 * LAST as the marker). LRU-evicts the oldest entries at write time to keep the total under budget.
 * Fire-and-forget from the caller: any failure is swallowed so a write error never breaks a decode.
 * @param {string} filePath
 * @param {{demosaic?: string, highlightMode?: string}} [options]
 * @param {{data: ArrayBuffer, width: number, height: number, channels: number, bitDepth: number}} payload
 * @returns {Promise<void>}
 */
async function write(filePath, options, payload) {
  if (!cacheDir || !payload || !payload.data) return;
  const buf = Buffer.from(payload.data); // view over the IPC-cloned ArrayBuffer — read-only here
  const size = buf.byteLength;
  if (size <= 0 || size > budgetBytes) return; // an entry larger than the whole budget can't fit

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    return; // can't record provenance → skip the write (a decode without a readable source is odd)
  }

  const key = entryName(filePath, options);

  // Evict the oldest OTHER entries (never the one we're rewriting) until this write fits the budget.
  const others = [];
  for (const [k, v] of index.entries()) {
    if (k !== key) others.push({ key: k, size: v.size, lastAccess: v.lastAccess });
  }
  for (const evictKey of selectEvictions(others, size, budgetBytes)) {
    await remove(evictKey);
  }

  const now = Date.now();
  const meta = {
    width: payload.width,
    height: payload.height,
    channels: payload.channels,
    bitDepth: payload.bitDepth,
    options: {
      demosaic: (options && options.demosaic) || DEFAULT_OPTIONS.demosaic,
      highlightMode: (options && options.highlightMode) || DEFAULT_OPTIONS.highlightMode,
      cameraMatch: options ? !!options.cameraMatch : DEFAULT_OPTIONS.cameraMatch,
    },
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
    lastAccess: now,
  };

  const rnd = crypto.randomBytes(6).toString('hex');
  const tmpBin = binPathFor(key) + '.' + rnd + '.tmp';
  const tmpJson = jsonPathFor(key) + '.' + rnd + '.tmp';
  try {
    await fs.promises.writeFile(tmpBin, buf);
    await fs.promises.writeFile(tmpJson, JSON.stringify(meta));
    await fs.promises.rename(tmpBin, binPathFor(key)); // pixels first
    await fs.promises.rename(tmpJson, jsonPathFor(key)); // sidecar last = commit marker
    index.set(key, { size, lastAccess: now });
  } catch (_) {
    await safeUnlink(tmpBin);
    await safeUnlink(tmpJson);
  }
}

module.exports = {
  // Pure helpers
  optionsHash,
  entryName,
  sidecarIsValid,
  selectEvictions,
  bufferToArrayBuffer,
  // fs layer
  init,
  read,
  write,
  remove,
  DEFAULT_BUDGET_BYTES,
  DEFAULT_OPTIONS,
};
