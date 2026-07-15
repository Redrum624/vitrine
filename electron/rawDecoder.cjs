// RAW decoding pipeline for the Electron main process.
//
// Fallback chain (best quality first):
//   1. Native LibRaw `dcraw_emu.exe` — a true Bayer demosaic of the sensor data
//      (16-bit, camera white balance, sRGB primaries + gamma). This is the real
//      raw rendering: a balanced but ungraded starting point for editing.
//   2. libraw-wasm in a Node worker_thread — same true demosaic without the
//      native binary, used when the bundled exe/DLLs are unavailable. (Slower.)
//   3. Embedded JPEG extraction — the camera's processed preview, upscaled. Only
//      a last resort; it carries the in-camera Picture Mode grade and therefore
//      looks identical to the out-of-camera JPG.
//
// Every path returns the same contract:
//   { data: ArrayBuffer, width, height, channels, bitDepth }
// where `data` is tightly packed pixels in host (little-endian) byte order.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// dcraw_emu base flags — always emitted regardless of decode options.
//   -w              use the camera's as-shot white balance (balanced, gradeable)
//   -o 1            sRGB output primaries
//   -6              16-bit output
//   -g 2.4 12.92    sRGB transfer curve
//   (auto-brighten left ON — no -W — for a properly-exposed starting point)
const DCRAW_BASE_FLAGS = ['-w', '-o', '1', '-6', '-g', '2.4', '12.92'];

// Demosaic algorithm → dcraw_emu -q value.
const DEMOSAIC_Q = { ahd: '3', dcb: '4' };

// Highlight mode → dcraw_emu -H value (null = omit -H entirely).
const HIGHLIGHT_H = { off: null, blend: '2', reconstruct: '5' };

// Default decode options: DCB demosaic + blend highlights + camera match.
// cameraMatch fits the decode to the shot's own embedded camera JPEG (see
// cameraMatch.cjs) so a fresh open looks like the out-of-camera render. Saved
// edits from before this option existed carry no cameraMatch field and validate
// to undefined (false) — their look is untouched.
const DEFAULT_RAW_DECODE_OPTIONS = { demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true };

/**
 * Build the dcraw_emu CLI flag array from structured decode options.
 * Pure function — no I/O; directly unit-testable.
 *
 * @param {object} options  { demosaic: 'ahd'|'dcb', highlightMode: 'off'|'blend'|'reconstruct', cameraMatch?: boolean }
 * @returns {string[]} full flags array ready to spread before the input path
 */
function buildDcrawFlags(options) {
  const { demosaic = 'dcb', highlightMode = 'blend', cameraMatch = false } = options || {};
  const flags = [];

  // Demosaic quality (-q)
  flags.push('-q', DEMOSAIC_Q[demosaic] ?? DEMOSAIC_Q.dcb);

  // Highlight mode (-H) — omit entirely for 'off' (LibRaw default = clip)
  const hVal = HIGHLIGHT_H[highlightMode];
  if (hVal != null) {
    flags.push('-H', hVal);
  }

  // Camera match fits decode → embedded-JPEG afterwards; -W (disable
  // auto-brighten) gives that fit a stable, un-stretched input to map from.
  if (cameraMatch) {
    flags.push('-W');
  }

  // Base flags always present
  flags.push(...DCRAW_BASE_FLAGS);
  return flags;
}

// Legacy const kept for any external consumers that imported it directly.
// Reflects AHD+clip, the previous default.  New callers should use buildDcrawFlags.
const DCRAW_FLAGS = ['-q', '3', '-w', '-o', '1', '-6', '-g', '2.4', '12.92'];

/** Resolve the bundled dcraw_emu.exe in both dev and packaged layouts. */
function resolveLibrawBin() {
  const candidates = [
    // Packaged: electron-builder copies vendor/ under resources/ (extraResources)
    process.resourcesPath ? path.join(process.resourcesPath, 'vendor', 'libraw', 'dcraw_emu.exe') : null,
    // Dev: repo-relative (electron/ -> ../vendor/libraw)
    path.join(__dirname, '..', 'vendor', 'libraw', 'dcraw_emu.exe'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function isWhitespace(b) {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

/**
 * Parse a binary 16-bit PPM (P6, maxval 65535) into host-endian uint16 RGB.
 * PPM stores 16-bit samples big-endian; we byte-swap so the renderer can read
 * the buffer directly as a Uint16Array.
 */
function parsePpm16(buf) {
  if (buf[0] !== 0x50 || buf[1] !== 0x36) {
    throw new Error('Not a P6 PPM');
  }
  let pos = 2;
  const tokens = [];
  while (tokens.length < 3) {
    while (pos < buf.length && isWhitespace(buf[pos])) pos++;
    if (buf[pos] === 0x23) {
      // comment line — skip to EOL
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      continue;
    }
    const start = pos;
    while (pos < buf.length && !isWhitespace(buf[pos])) pos++;
    tokens.push(buf.toString('ascii', start, pos));
  }
  const width = parseInt(tokens[0], 10);
  const height = parseInt(tokens[1], 10);
  const maxval = parseInt(tokens[2], 10);
  if (maxval !== 65535) {
    throw new Error(`Expected 16-bit PPM (maxval 65535), got ${maxval}`);
  }
  pos += 1; // exactly one whitespace byte separates the header from binary data

  const expected = width * height * 3 * 2;
  const pixels = buf.subarray(pos, pos + expected);
  if (pixels.length !== expected) {
    throw new Error(`PPM pixel data short: got ${pixels.length}, expected ${expected}`);
  }
  pixels.swap16(); // big-endian -> host little-endian, in place
  const data = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + expected);
  return { data, width, height };
}

/** Primary decoder: true demosaic via the bundled native LibRaw binary. */
async function decodeNative(filePath, log, options) {
  const bin = resolveLibrawBin();
  if (!bin) {
    throw new Error('dcraw_emu.exe not found in vendor/libraw');
  }

  // dcraw_emu writes "<input>.ppm" next to its input. Work in a temp dir so we
  // never write into the user's photo folder (which may also be read-only).
  const tmpDir = path.join(os.tmpdir(), `photoapp-raw-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpIn = path.join(tmpDir, `input${path.extname(filePath) || '.raw'}`);
  const tmpOut = `${tmpIn}.ppm`;

  try {
    fs.copyFileSync(filePath, tmpIn);
    const resolvedOpts = options || DEFAULT_RAW_DECODE_OPTIONS;
    await execFileAsync(bin, [...buildDcrawFlags(resolvedOpts), tmpIn], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024, // only diagnostic text on stdout; pixels go to the .ppm
    });
    if (!fs.existsSync(tmpOut)) {
      throw new Error('dcraw_emu produced no PPM output');
    }
    const { data, width, height } = parsePpm16(fs.readFileSync(tmpOut));
    log.log(`RAW decode (native dcraw_emu): ${width}x${height} 16-bit from ${filePath}`);
    return { data, width, height, channels: 3, bitDepth: 16 };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort temp cleanup */
    }
  }
}

/** Libraw-wasm/Node fallback — middle rung of the decode chain. */
async function decodeWasm(filePath, log, options) {
  const { decodeRawWithWasm } = require('./librawWasmNode.cjs');
  return decodeRawWithWasm(filePath, log, options);
}

/**
 * Last-resort decoder: extract the embedded JPEG preview and upscale it. This is
 * the camera's already-graded rendering (looks like the out-of-camera JPG).
 */
async function decodeEmbeddedJpeg(filePath, log) {
  const sharp = require('sharp');
  const buf = await fs.promises.readFile(filePath);

  // 1. Read sensor dimensions from TIFF/IFD header (tag 256=width, 257=height)
  let sensorWidth = 0, sensorHeight = 0;
  try {
    const le = buf[0] === 0x49; // 'II' = little-endian
    const r16 = le ? (o) => buf[o] | (buf[o + 1] << 8) : (o) => (buf[o] << 8) | buf[o + 1];
    const r32 = le
      ? (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
      : (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    const ifd0 = r32(4);
    const n = r16(ifd0);
    for (let i = 0; i < Math.min(n, 40); i++) {
      const off = ifd0 + 2 + i * 12;
      const tag = r16(off);
      if (tag === 256) sensorWidth = r32(off + 8);
      if (tag === 257) sensorHeight = r32(off + 8);
    }
  } catch (_) { /* ignore parse errors */ }

  // 2. Find the largest embedded JPEG, bounding each by PARSING its marker structure
  //    (a naive FF D8 .. FF D9 scan grabs false markers inside entropy-coded data).
  const { findEmbeddedJpegs } = require('./embeddedPreview.cjs');
  const jpegs = findEmbeddedJpegs(buf);
  const bestStart = jpegs.length ? jpegs[0].offset : -1;
  const bestSize = jpegs.length ? jpegs[0].length : 0;

  let pixelBuffer, info;

  if (bestSize > 50000) {
    const jpeg = buf.slice(bestStart, bestStart + bestSize);
    let pipeline = sharp(jpeg, { failOn: 'none' });

    if (sensorWidth > 0 && sensorHeight > 0) {
      const meta = await sharp(jpeg, { failOn: 'none' }).metadata();
      if (meta.width < sensorWidth || meta.height < sensorHeight) {
        // Respect orientation: if JPEG is landscape but sensor is portrait (or vice versa), swap
        let targetW = sensorWidth, targetH = sensorHeight;
        if ((meta.width > meta.height) !== (sensorWidth > sensorHeight)) {
          targetW = sensorHeight;
          targetH = sensorWidth;
        }
        pipeline = pipeline.resize(targetW, targetH, {
          kernel: sharp.kernel.lanczos3,
          fit: 'fill',
        });
        log.log(`RAW decode: upscaling ${meta.width}x${meta.height} -> ${targetW}x${targetH}`);
      }
    }

    const result = await pipeline.raw().toBuffer({ resolveWithObject: true });
    pixelBuffer = result.data;
    info = result.info;
    log.log(`RAW decode (embedded JPEG): ${info.width}x${info.height} (${info.channels}ch) from ${filePath}`);
  } else {
    const result = await sharp(filePath, { failOn: 'none' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (sensorWidth > 0 && sensorHeight > 0 && result.info.width < sensorWidth) {
      let targetW = sensorWidth, targetH = sensorHeight;
      if ((result.info.width > result.info.height) !== (sensorWidth > sensorHeight)) {
        targetW = sensorHeight; targetH = sensorWidth;
      }
      const upscaled = await sharp(result.data, {
        raw: { width: result.info.width, height: result.info.height, channels: result.info.channels },
      }).resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
        .raw().toBuffer({ resolveWithObject: true });
      pixelBuffer = upscaled.data;
      info = upscaled.info;
      log.log(`RAW decode: upscaled DNG ${result.info.width}x${result.info.height} -> ${info.width}x${info.height}`);
    } else {
      pixelBuffer = result.data;
      info = result.info;
    }
    log.log(`RAW decode (Sharp direct): ${info.width}x${info.height} from ${filePath}`);
  }

  const data = pixelBuffer.buffer.slice(
    pixelBuffer.byteOffset,
    pixelBuffer.byteOffset + pixelBuffer.byteLength,
  );
  return { data, width: info.width, height: info.height, channels: info.channels, bitDepth: 8 };
}

/**
 * Fast progressive-open preview: extract the LARGEST embedded JPEG, orient it upright, and
 * DOWNSCALE it to fit `maxDim` — returning packed 8-bit RGB pixels. This is the camera's
 * already-graded preview (options-independent), decoded in a few hundred ms vs. the ~4.3s
 * native LibRaw demosaic — so the editor can paint a meaningful image near-instantly while
 * the full 16-bit decode runs in the background (see ImageService progressive open).
 *
 * Unlike `decodeEmbeddedJpeg` (the LAST-RESORT rung, which UPSCALES to full sensor dims), this
 * never enlarges: `withoutEnlargement: true` keeps the transfer tiny (~9MB at 2048px vs 122MB
 * for the full 16-bit buffer) and the sharp resize cheap. Throws when no usable embedded JPEG
 * exists, so the caller falls back to a full-decode-first open.
 *
 * @param {string} filePath
 * @param {number} [maxDim=2048]  longest-edge cap for the preview
 * @param {object} [log]
 * @returns {Promise<{data: ArrayBuffer, width, height, channels: 3, bitDepth: 8}>}
 */
async function decodeEmbeddedPreview(filePath, maxDim = 2048, log = console) {
  const sharp = require('sharp');
  const { findEmbeddedJpegs, rawDataStart, readOrientation, applyExifOrientation } = require('./embeddedPreview.cjs');

  const fd = await fs.promises.open(filePath, 'r');
  let jpeg = null;
  let containerOrientation = 1;
  try {
    const stat = await fd.stat();
    const headSize = Math.min(stat.size, 256 * 1024);
    const head = Buffer.allocUnsafe(headSize);
    await fd.read(head, 0, headSize, 0);

    // Embedded preview JPEGs sit BEFORE the raw sensor strip; cap the scan there so we never
    // read the (large) sensor data. Fall back to a bounded 8MB / 12MB window if the cap is unknown.
    const cap = rawDataStart(head) || 8 * 1024 * 1024;
    const scanSize = Math.min(stat.size, cap, 12 * 1024 * 1024);
    const buf = Buffer.allocUnsafe(scanSize);
    await fd.read(buf, 0, scanSize, 0);

    // ORF's embedded preview carries no orientation of its own — take it from the RAW container's IFD0.
    containerOrientation = readOrientation(head);

    const jpegs = findEmbeddedJpegs(buf);
    // Take the largest embedded JPEG that is clearly a real preview (not a tiny 160px thumbnail).
    // Relies on findEmbeddedJpegs' descending sort — see comment there — so the first entry
    // past the size threshold is the largest candidate.
    const best = jpegs.find((j) => j.length > 50000);
    if (best) jpeg = Buffer.from(buf.subarray(best.offset, best.offset + best.length));
  } finally {
    await fd.close();
  }

  if (!jpeg) {
    throw new Error(`No embedded preview JPEG found for ${path.basename(filePath)}`);
  }

  // Orient upright (prefer the JPEG's OWN EXIF orientation; else the container's), then DOWNSCALE
  // to fit maxDim. `removeAlpha` guarantees packed 3-channel RGB (matches the renderer's 3ch path).
  const previewOri = await sharp(jpeg, { failOn: 'none' })
    .metadata().then((m) => m.orientation || 0).catch(() => 0);
  let pipe = sharp(jpeg, { failOn: 'none' });
  if (previewOri > 1) {
    pipe = pipe.rotate(); // auto-orient from the preview's own EXIF
  } else if (containerOrientation > 1) {
    pipe = applyExifOrientation(pipe, containerOrientation);
  }

  const { data, info } = await pipe
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  log.log(`RAW preview (embedded JPEG): ${info.width}x${info.height} (${info.channels}ch) from ${filePath}`);
  const out = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return { data: out, width: info.width, height: info.height, channels: 3, bitDepth: 8 };
}

const RAW_TMP_DIR_RE = /^photoapp-raw-[0-9a-f]+$/;

/**
 * Purge stale `photoapp-raw-*` temp dirs left behind when the per-decode
 * best-effort cleanup in decodeNative never ran (crash / kill mid-decode).
 * Called once at app startup. Only dirs older than `maxAgeMs` are removed so a
 * decode running in another window/session is never swept. Returns the number
 * of dirs removed; never throws.
 */
function sweepStaleRawTmpDirs({ baseDir = os.tmpdir(), maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  let removed = 0;
  try {
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(baseDir)) {
      if (!RAW_TMP_DIR_RE.test(name)) continue;
      const dir = path.join(baseDir, name);
      try {
        const st = fs.statSync(dir);
        if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch (_) {
        /* best-effort per dir */
      }
    }
  } catch (_) {
    /* best-effort sweep */
  }
  return removed;
}

/**
 * Decode a RAW file to packed pixels, trying each engine in order of quality and
 * degrading gracefully. Throws only if every path fails.
 *
 * @param {string} filePath
 * @param {object} [log]     logger (defaults to console)
 * @param {object} [options] { demosaic, highlightMode } — defaults to DEFAULT_RAW_DECODE_OPTIONS
 */
async function decodeRawFile(filePath, log = console, options) {
  const resolvedOpts = options || DEFAULT_RAW_DECODE_OPTIONS;

  // Camera match post-pass: applied to the true-demosaic rungs only. The
  // embedded-JPEG fallback rung already IS the camera render — matching it to
  // itself would be a no-op at best. Fail-open: any camera-match failure
  // returns the unmatched decode (see cameraMatch.cjs).
  const maybeMatch = async (decoded) => {
    if (!resolvedOpts.cameraMatch) return decoded;
    try {
      const { applyCameraMatch } = require('./cameraMatch.cjs');
      const orfBuf = await fs.promises.readFile(filePath);
      return await applyCameraMatch(decoded, orfBuf, log);
    } catch (err) {
      // Fail-open at this level too: a camera-match hiccup (e.g. the source
      // file vanished between decode and re-read) must not discard a decode
      // that already succeeded, and must not cascade to the next rung.
      log.warn(`camera-match post-pass failed (${err.message}) — using unmatched decode`);
      return decoded;
    }
  };

  try {
    return await maybeMatch(await decodeNative(filePath, log, resolvedOpts));
  } catch (nativeError) {
    log.warn(`Native dcraw_emu decode failed (${nativeError.message}); trying libraw-wasm/Node`);
    try {
      return await maybeMatch(await decodeWasm(filePath, log, resolvedOpts));
    } catch (wasmError) {
      log.warn(`libraw-wasm/Node decode failed (${wasmError.message}); falling back to embedded JPEG`);
      return await decodeEmbeddedJpeg(filePath, log);
    }
  }
}

module.exports = {
  decodeRawFile,
  decodeNative,
  decodeWasm,
  decodeEmbeddedJpeg,
  decodeEmbeddedPreview,
  parsePpm16,
  resolveLibrawBin,
  sweepStaleRawTmpDirs,
  buildDcrawFlags,
  DEFAULT_RAW_DECODE_OPTIONS,
  // Legacy export — previous AHD+clip default; kept for backward compat.
  DCRAW_FLAGS,
};
