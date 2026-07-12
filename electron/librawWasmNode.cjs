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

// Demosaic algorithm → libraw-wasm userQual value (mirrors -q in dcraw_emu).
const WASM_DEMOSAIC_QUAL = { ahd: 3, dcb: 4 };

// Highlight mode → libraw-wasm `highlight` integer value.
// LibRaw C++ field: libraw_output_params_t.highlight (0=clip, 2=blend, 5=reconstruct).
// The wasm binding exposes C++ struct fields using the same key names; `highlight`
// is already one word so it requires no camelCase transformation (unlike user_qual→userQual).
// NOTE: if the bundled wasm ignores this key it degrades gracefully to LibRaw's default
// (clip, same as 'off') — callers are warned below when options are non-default.
const WASM_HIGHLIGHT = { off: 0, blend: 2, reconstruct: 5 };

// Warn-once latch: an unknown highlightMode is a static config/programming error, not a per-file
// condition — buildWasmOptions runs once PER DECODED FILE, so warning every call spams the log
// (potentially thousands of identical lines across a batch). Surface it once per process.
let warnedUnknownHighlight = false;

// Per-call watchdog. A hung wasm worker (never posts a response) would leave the pending
// promise unresolved forever, so decodeRawWithWasm's `finally { worker.terminate() }` would
// never run and the worker thread would leak. Bounding each request/response with a reject
// -on-timeout guarantees the finally always fires. 60s is generous vs the ~10s typical decode.
const DEFAULT_CALL_TIMEOUT_MS = 60000;

/**
 * Build the libraw-wasm options object from structured decode options.
 * Pure mapping — no I/O.
 *
 * @param {object} options  { demosaic: 'ahd'|'dcb', highlightMode: 'off'|'blend'|'reconstruct' }
 * @param {object} log
 */
function buildWasmOptions(options, log) {
  const { demosaic = 'dcb', highlightMode = 'blend' } = options || {};

  const userQual = WASM_DEMOSAIC_QUAL[demosaic] ?? WASM_DEMOSAIC_QUAL.dcb;
  const highlightVal = WASM_HIGHLIGHT[highlightMode] ?? null;

  const opts = {
    userQual,
    useCameraWb: true,
    outputColor: 1,
    outputBps: 16,
  };

  if (highlightVal !== null) {
    // Pass through — wasm binding accepts `highlight` per libraw_output_params_t.
    // If this key is silently ignored by the bundled wasm build, the image decodes
    // correctly at the cost of using LibRaw's default clip mode.
    opts.highlight = highlightVal;
    if (highlightVal !== 0) {
      // Non-default: surface a single log line so it's visible if wasm ignores it.
      (log || console).log(
        `[libraw-wasm] highlight mode: ${highlightMode} (wasm key "highlight"=${highlightVal}; ` +
        `honoured only if bundled wasm exposes libraw_output_params_t.highlight)`
      );
    }
  } else if (!warnedUnknownHighlight) {
    warnedUnknownHighlight = true;
    (log || console).warn(`[libraw-wasm] Unknown highlightMode "${highlightMode}", using LibRaw default (clip).`);
  }

  return opts;
}

async function decodeRawWithWasm(filePath, log = console, options, callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
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
    // Watchdog: if the worker never answers, reject so the finally{} below terminates it.
    const timer = setTimeout(() => {
      pending = null;
      rej(new Error(`libraw-wasm call "${fn}" timed out after ${callTimeoutMs}ms`));
    }, callTimeoutMs);
    // Wrap so settling (either via the worker 'message'/'error'/'exit' handlers above or
    // the timeout itself) always clears the timer — no dangling timers across calls.
    pending = {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); rej(e); },
    };
    const transfer = args
      .map((a) => (ArrayBuffer.isView(a) ? a.buffer : a instanceof ArrayBuffer ? a : null))
      .filter(Boolean);
    worker.postMessage({ fn, args }, transfer);
  });

  try {
    // Allow the Emscripten runtime to boot before the first call.
    await new Promise((r) => setTimeout(r, 1200));

    const raw = fs.readFileSync(filePath);
    await call('open', new Uint8Array(raw), buildWasmOptions(options, log));
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

module.exports = { decodeRawWithWasm, resolveWorkerJs, buildWasmOptions };
