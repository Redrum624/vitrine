// Geometry half of camera match: resample the decode into the camera JPEG's frame.
//
// cameraMatch.cjs measures the radial coefficient k that lines the embedded
// preview up with the decode (the camera bakes lens-distortion correction into
// its JPEG; the decode is the uncorrected sensor image). The colour fit only
// needs that to pair cells correctly, but leaving the decode uncorrected means
// the picture visibly changes shape when full quality replaces the preview. This
// applies the same model to the pixels, so the full-quality image has the
// camera's geometry as well as its colour.
//
// The ~20MP Catmull-Rom resample takes about 4 s on one thread, so it is split
// into row strips across worker threads over shared memory. This file is its own
// worker script, and runs from app.asar.unpacked in a packaged build (see
// package.json asarUnpack) because worker_threads cannot load from the asar.

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');

const LUT_SIZE = 2048;
const MAX_THREADS = 8;

/**
 * cameraMatch.warpPoint maps a decode point p to the preview point q = p·(1 + k·ρp²),
 * with ρ the radius normalised so the frame corner is 1. Resampling needs the
 * inverse: for an output (preview-frame) radius ρq, the decode radius ρp. Returns
 * ρp/ρq tabulated over ρq² in [0,1] (LUT_SIZE + 2 entries, so i+1 is always valid).
 */
function buildInverseRadialLut(k) {
  const lut = new Float64Array(LUT_SIZE + 2);
  for (let i = 0; i < lut.length; i++) {
    const t = Math.sqrt(Math.min(1, i / LUT_SIZE));
    if (t === 0) { lut[i] = 1; continue; }
    let r = t;
    for (let it = 0; it < 12; it++) r -= (r + k * r * r * r - t) / (1 + 3 * k * r * r);
    lut[i] = r / t;
  }
  return lut;
}

/**
 * Resample packed 16-bit RGB through the inverse of distortion k (Catmull-Rom).
 * Only k > 0 is supported — the corrected frame is then a crop of the decode, so
 * every output pixel has a source. Fills rows [yStart, yEnd) of dst (default: a
 * new buffer, all rows) and returns it.
 */
function undistortRGB16(src, width, height, k, dst = new Uint16Array(src.length), yStart = 0, yEnd = height) {
  const lut = buildInverseRadialLut(k);
  const aspect = width / height;
  const norm = (aspect * aspect + 1) / 4;
  const maxX = width - 1, maxY = height - 1;
  const stride = width * 3;
  for (let y = yStart; y < yEnd; y++) {
    const qy = (y + 0.5) / height - 0.5;
    const qy2 = qy * qy;
    let o = y * stride;
    for (let x = 0; x < width; x++, o += 3) {
      const qx = (x + 0.5) / width - 0.5;
      const xa = qx * aspect;
      const lt = ((xa * xa + qy2) / norm) * LUT_SIZE;
      const li = lt | 0;
      const s = lut[li] + (lut[li + 1] - lut[li]) * (lt - li);
      const sx = (qx * s + 0.5) * width - 0.5;
      const sy = (qy * s + 0.5) * height - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const tx = sx - ix, ty = sy - iy;

      const wx0 = ((-tx + 2) * tx - 1) * tx * 0.5;
      const wx1 = ((3 * tx - 5) * tx * tx + 2) * 0.5;
      const wx2 = ((-3 * tx + 4) * tx + 1) * tx * 0.5;
      const wx3 = (tx - 1) * tx * tx * 0.5;
      const wy0 = ((-ty + 2) * ty - 1) * ty * 0.5;
      const wy1 = ((3 * ty - 5) * ty * ty + 2) * 0.5;
      const wy2 = ((-3 * ty + 4) * ty + 1) * ty * 0.5;
      const wy3 = (ty - 1) * ty * ty * 0.5;

      const x0 = (ix - 1 < 0 ? 0 : ix - 1 > maxX ? maxX : ix - 1) * 3;
      const x1 = (ix < 0 ? 0 : ix > maxX ? maxX : ix) * 3;
      const x2 = (ix + 1 < 0 ? 0 : ix + 1 > maxX ? maxX : ix + 1) * 3;
      const x3 = (ix + 2 < 0 ? 0 : ix + 2 > maxX ? maxX : ix + 2) * 3;
      const r0 = (iy - 1 < 0 ? 0 : iy - 1 > maxY ? maxY : iy - 1) * stride;
      const r1 = (iy < 0 ? 0 : iy > maxY ? maxY : iy) * stride;
      const r2 = (iy + 1 < 0 ? 0 : iy + 1 > maxY ? maxY : iy + 1) * stride;
      const r3 = (iy + 2 < 0 ? 0 : iy + 2 > maxY ? maxY : iy + 2) * stride;

      for (let c = 0; c < 3; c++) {
        const v =
          wy0 * (wx0 * src[r0 + x0 + c] + wx1 * src[r0 + x1 + c] + wx2 * src[r0 + x2 + c] + wx3 * src[r0 + x3 + c]) +
          wy1 * (wx0 * src[r1 + x0 + c] + wx1 * src[r1 + x1 + c] + wx2 * src[r1 + x2 + c] + wx3 * src[r1 + x3 + c]) +
          wy2 * (wx0 * src[r2 + x0 + c] + wx1 * src[r2 + x1 + c] + wx2 * src[r2 + x2 + c] + wx3 * src[r2 + x3 + c]) +
          wy3 * (wx0 * src[r3 + x0 + c] + wx1 * src[r3 + x1 + c] + wx2 * src[r3 + x2 + c] + wx3 * src[r3 + x3 + c]);
        dst[o + c] = v < 0 ? 0 : v > 65535 ? 65535 : v + 0.5 | 0;
      }
    }
  }
  return dst;
}

/** This script on the real filesystem (same asar rule as cameraMatch.workerScriptPath). */
function scriptPath() {
  const asar = `${path.sep}app.asar${path.sep}`;
  return __filename.includes(asar) ? __filename.replace(asar, `${path.sep}app.asar.unpacked${path.sep}`) : __filename;
}

/**
 * undistortRGB16 across worker threads. Takes the decode's ArrayBuffer (packed
 * 16-bit RGB) and resolves with a new ArrayBuffer of the same size.
 */
function undistortParallel(dataArrayBuffer, width, height, k) {
  const bytes = dataArrayBuffer.byteLength;
  const srcSab = new SharedArrayBuffer(bytes);
  const dstSab = new SharedArrayBuffer(bytes);
  new Uint16Array(srcSab).set(new Uint16Array(dataArrayBuffer));
  const threads = Math.max(1, Math.min(MAX_THREADS, os.availableParallelism() - 1));
  const rows = Math.ceil(height / threads);
  const workers = [];
  const strips = [];
  for (let y = 0; y < height; y += rows) {
    strips.push(new Promise((resolve, reject) => {
      const worker = new Worker(scriptPath(), {
        workerData: { undistort: { srcSab, dstSab, width, height, k, yStart: y, yEnd: Math.min(height, y + rows) } },
      });
      workers.push(worker);
      worker.once('message', (msg) => (msg && msg.ok ? resolve() : reject(new Error((msg && msg.error) || 'undistort worker failed'))));
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`undistort worker exited with code ${code}`)); });
    }));
  }
  return Promise.all(strips)
    .then(() => {
      const out = new Uint16Array(bytes / 2);
      out.set(new Uint16Array(dstSab));
      return out.buffer;
    })
    .finally(() => { for (const w of workers) w.terminate(); });
}

if (!isMainThread && workerData && workerData.undistort) {
  try {
    const { srcSab, dstSab, width, height, k, yStart, yEnd } = workerData.undistort;
    undistortRGB16(new Uint16Array(srcSab), width, height, k, new Uint16Array(dstSab), yStart, yEnd);
    parentPort.postMessage({ ok: true });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
}

module.exports = { buildInverseRadialLut, undistortRGB16, undistortParallel, LUT_SIZE };
