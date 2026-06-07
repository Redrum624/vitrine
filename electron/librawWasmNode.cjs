// libraw-wasm decode driver for the Electron main process.
//
// Runs the libraw-wasm Emscripten module inside a fresh Node worker_thread (one
// per file) via librawWasmWorker.cjs, drives its open/metadata/imageData API, and
// returns the standard decoder contract { data, width, height, channels, bitDepth }.
//
// This is the middle rung of the fallback chain (between the native dcraw_emu
// binary and the embedded-JPEG extractor). It produces a true demosaic without
// the native binary, at the cost of being noticeably slower (~10s/file).

const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');

/** Locate public/libraw/worker.js across dev and packaged layouts. */
function resolveWorkerJs() {
  const candidates = [
    // Packaged: public/libraw is shipped via extraResources -> resources/libraw
    process.resourcesPath ? path.join(process.resourcesPath, 'libraw', 'worker.js') : null,
    // Dev
    path.join(__dirname, '..', 'public', 'libraw', 'worker.js'),
    // Built web bundle (vite copies public/* into dist/)
    path.join(__dirname, '..', 'dist', 'libraw', 'worker.js'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// Mirror the native dcraw_emu rendering: camera white balance, sRGB primaries,
// 16-bit, high-quality demosaic (balanced, gradeable — no in-camera grade).
const WASM_OPTIONS = {
  userQual: 3,
  useCameraWb: true,
  outputColor: 1,
  outputBps: 16,
};

async function decodeRawWithWasm(filePath, log = console) {
  const workerJs = resolveWorkerJs();
  if (!workerJs) throw new Error('libraw-wasm worker.js not found');

  const bootstrap = path.join(__dirname, 'librawWasmWorker.cjs');
  const worker = new Worker(bootstrap, {
    workerData: { role: 'worker', scriptPath: workerJs, name: '' },
  });

  // Strictly-sequential request/response (open -> metadata -> imageData).
  let pending = null;
  const reject = (err) => { if (pending) { const p = pending; pending = null; p.reject(err); } };
  worker.on('message', (m) => {
    if (m && typeof m === 'object' && '__emErr' in m) { reject(new Error(m.__emErr)); return; }
    const data = (m && typeof m === 'object' && '__emMsg' in m) ? m.__emMsg : m;
    if (pending) {
      const p = pending;
      pending = null;
      p.resolve(data && typeof data === 'object' && 'out' in data ? data.out : data);
    }
  });
  worker.on('error', reject);
  worker.on('exit', (code) => reject(new Error(`libraw-wasm worker exited (code ${code})`)));

  const call = (fn, ...args) => new Promise((resolve, rej) => {
    pending = { resolve, reject: rej };
    const transfer = args
      .map((a) => (ArrayBuffer.isView(a) ? a.buffer : a instanceof ArrayBuffer ? a : null))
      .filter(Boolean);
    worker.postMessage({ fn, args }, transfer);
  });

  try {
    // Allow the Emscripten runtime to boot before the first call.
    await new Promise((r) => setTimeout(r, 1200));

    const raw = fs.readFileSync(filePath);
    await call('open', new Uint8Array(raw), WASM_OPTIONS);
    const meta = await call('metadata', false);
    const img = await call('imageData');

    let pixels = null;
    let width = meta && meta.width;
    let height = meta && meta.height;
    if (img instanceof Uint8Array) {
      pixels = img;
    } else if (img && img.data) {
      pixels = img.data instanceof Uint8Array
        ? img.data
        : ArrayBuffer.isView(img.data)
          ? new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
          : null;
      width = img.width || width;
      height = img.height || height;
    }
    if (!pixels || !pixels.length || !width || !height) {
      throw new Error('libraw-wasm returned no usable pixels');
    }

    const bytesPerPx = pixels.length / (width * height);
    let channels = 3;
    let bitDepth = 8;
    if (bytesPerPx === 3) { channels = 3; bitDepth = 8; }
    else if (bytesPerPx === 4) { channels = 4; bitDepth = 8; }
    else if (bytesPerPx === 6) { channels = 3; bitDepth = 16; }
    else if (bytesPerPx === 8) { channels = 4; bitDepth = 16; }
    else throw new Error(`libraw-wasm unexpected bytes/pixel: ${bytesPerPx}`);

    // libraw-wasm pixel data is already host (little-endian) order — no swap.
    const data = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength);
    log.log(`RAW decode (libraw-wasm/Node): ${width}x${height} ${bitDepth}-bit ${channels}ch from ${filePath}`);
    return { data, width, height, channels, bitDepth };
  } finally {
    worker.terminate();
  }
}

module.exports = { decodeRawWithWasm, resolveWorkerJs };
