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

// dcraw_emu flags — a neutral "developed" raw: camera white balance applied so
// the image is balanced and gradeable, but WITHOUT the in-camera Picture Mode
// (contrast/saturation) grade.
//   -q 3            AHD demosaic (high quality)
//   -w              use the camera's as-shot white balance (balanced, gradeable)
//   -o 1            sRGB output primaries
//   -6              16-bit output
//   -g 2.4 12.92    sRGB transfer curve
//   (auto-brighten left ON — no -W — for a properly-exposed starting point)
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
async function decodeNative(filePath, log) {
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
    await execFileAsync(bin, [...DCRAW_FLAGS, tmpIn], {
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

/** Placeholder for the libraw-wasm/Node fallback — wired up in Phase 2. */
async function decodeWasm(filePath, log) {
  const { decodeRawWithWasm } = require('./librawWasmNode.cjs');
  return decodeRawWithWasm(filePath, log);
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
 */
async function decodeRawFile(filePath, log = console) {
  try {
    return await decodeNative(filePath, log);
  } catch (nativeError) {
    log.warn(`Native dcraw_emu decode failed (${nativeError.message}); trying libraw-wasm/Node`);
    try {
      return await decodeWasm(filePath, log);
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
  parsePpm16,
  resolveLibrawBin,
  sweepStaleRawTmpDirs,
  DCRAW_FLAGS,
};
