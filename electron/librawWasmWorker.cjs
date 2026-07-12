// Worker-thread bootstrap that runs the Emscripten libraw-wasm scripts under a
// browser-like global shim, so they execute inside Node worker_threads (Electron
// main process) instead of a browser.
//
// The SAME file bootstraps two layers:
//   - the high-level wrapper  public/libraw/worker.js  (open/metadata/imageData)
//   - the nested em-pthread    public/libraw/libraw.js  workers it spawns
// Both are selected purely by `workerData.scriptPath`. The `globalThis.Worker`
// shim below maps the Emscripten `new Worker(new URL("libraw.js"))` calls onto
// further worker_threads running this same bootstrap.
//
// Ported from the verified spike at scripts/spike-libraw-node.mjs.

const { Worker, parentPort, workerData } = require('node:worker_threads');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');

(async () => {
  const { scriptPath, name } = workerData;
  const listeners = { message: [] };

  const selfObj = {
    name: name || '',
    location: { href: pathToFileURL(scriptPath).href },
    postMessage: (msg, transfer) => parentPort.postMessage({ __emMsg: msg }, transfer),
    addEventListener: (type, cb) => { (listeners[type] ||= []).push(cb); },
    removeEventListener: (type, cb) => {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== cb);
    },
    set onmessage(cb) { selfObj.__onmessage = cb; },
    get onmessage() { return selfObj.__onmessage; },
    set onerror(cb) { selfObj.__onerror = cb; },
    get onerror() { return selfObj.__onerror; },
    set onunhandledrejection(_cb) {},
    importScripts: () => {},
    alert: () => {},
  };

  // Route parent messages into self.onmessage / addEventListener('message') hooks.
  parentPort.on('message', (m) => {
    const data = (m && typeof m === 'object' && '__emMsg' in m) ? m.__emMsg : m;
    const ev = { data };
    if (typeof selfObj.__onmessage === 'function') selfObj.__onmessage(ev);
    for (const cb of (listeners.message || [])) cb(ev);
  });

  globalThis.self = selfObj;
  globalThis.location = selfObj.location;
  globalThis.postMessage = selfObj.postMessage;
  globalThis.addEventListener = selfObj.addEventListener;
  globalThis.removeEventListener = selfObj.removeEventListener;
  Object.defineProperty(globalThis, 'onmessage', {
    set(cb) { selfObj.onmessage = cb; }, get() { return selfObj.onmessage; }, configurable: true,
  });
  // Emscripten detects a worker context via `typeof WorkerGlobalScope !== "undefined"`.
  globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};

  // fetch() / XHR shims so Emscripten can load libraw.wasm by URL from disk.
  globalThis.fetch = async (url) => {
    const p = String(url).startsWith('file:') ? fileURLToPath(url) : String(url);
    const buf = readFileSync(p);
    return {
      ok: true,
      url: String(url),
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
  globalThis.XMLHttpRequest = class {
    open(_m, u) { this._u = u; }
    send() {
      const p = String(this._u).startsWith('file:') ? fileURLToPath(this._u) : String(this._u);
      const buf = readFileSync(p);
      this.response = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  };

  // Nested em-pthread workers resolve to worker_threads running this bootstrap.
  globalThis.Worker = class ShimWorker {
    constructor(url, opts = {}) {
      const target = url instanceof URL ? fileURLToPath(url) : String(url);
      const child = new Worker(__filename, {
        workerData: { role: 'em', scriptPath: target, name: opts.name || '' },
      });
      this._child = child;
      this._listeners = { message: [], error: [] };
      child.on('message', (m) => {
        const data = (m && typeof m === 'object' && '__emMsg' in m) ? m.__emMsg : m;
        const ev = { data };
        if (typeof this.onmessage === 'function') this.onmessage(ev);
        for (const cb of this._listeners.message) cb(ev);
      });
      child.on('error', (err) => {
        const ev = { message: err.message, filename: target, lineno: 0, error: err };
        if (typeof this.onerror === 'function') this.onerror(ev);
        for (const cb of this._listeners.error) cb(ev);
      });
    }
    postMessage(msg, transfer) { this._child.postMessage({ __emMsg: msg }, transfer); }
    addEventListener(type, cb) { (this._listeners[type] ||= []).push(cb); }
    removeEventListener(type, cb) {
      if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== cb);
    }
    terminate() { this._child.terminate(); }
    set onmessage(cb) { this._onmessage = cb; }
    get onmessage() { return this._onmessage; }
    set onerror(cb) { this._onerror = cb; }
    get onerror() { return this._onerror; }
  };

  // Load the actual Emscripten ESM script (worker.js or libraw.js). It wires up
  // its own self.onmessage, then we keep the thread alive to service requests.
  await import(pathToFileURL(scriptPath).href);
  await new Promise(() => {});
})().catch((e) => {
  try { parentPort.postMessage({ __emErr: e && e.message ? e.message : String(e) }); } catch (_) { /* parent gone */ }
});
