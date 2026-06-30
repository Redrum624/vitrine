/**
 * AI Upscale de-risking spike (Phase-2 Task 1).
 *
 * Resolves three unknowns:
 *   1. Does onnxruntime-node ship a DirectML (GPU) execution provider on this platform?
 *   2. Does the native module load under THIS Electron's Node ABI?
 *   3. Can a RealESRGAN_x4plus ONNX model load + run a 64x64 -> 256x256 inference?
 *
 * Run plainly:        node scripts/ai-spike.cjs
 * Run under Electron:  npx electron scripts/ai-spike.cjs   (tests the Electron ABI)
 *
 * Honest spike: it prints what it actually observes. No fabricated success.
 */
'use strict';

const path = require('path');
const fs = require('fs');

function line(s) { process.stdout.write(String(s) + '\n'); }
function header(s) { line('\n==== ' + s + ' ===='); }

const isElectron = !!process.versions.electron;

header('RUNTIME');
line('process.versions.node     = ' + process.versions.node);
line('process.versions.electron = ' + (process.versions.electron || '(plain node)'));
line('process.versions.modules  = ' + process.versions.modules + '  (NODE_MODULE_VERSION / ABI)');
line('process.platform/arch      = ' + process.platform + '/' + process.arch);

let ort;
try {
  ort = require('onnxruntime-node');
  line('require(onnxruntime-node) : OK');
} catch (err) {
  line('require(onnxruntime-node) : FAILED');
  line('  ' + (err && err.stack ? err.stack : err));
  line('\nVERDICT: native module failed to load under ' + (isElectron ? 'Electron' : 'node') +
       ' ABI ' + process.versions.modules + '. If this is an ABI/NODE_MODULE_VERSION mismatch, run:');
  line('  npx @electron/rebuild -f -w onnxruntime-node');
  process.exit(2);
}

header('ONNXRUNTIME-NODE INFO');
try {
  line('ort version = ' + require('onnxruntime-node/package.json').version);
} catch (_) { /* best-effort diagnostic */ }

// Supported backends (the real evidence for DML availability at runtime).
header('SUPPORTED BACKENDS (runtime evidence for DirectML)');
let backends = null;
try {
  // binding.listSupportedBackends() returns [{ name, bundled }]
  const binding = require('onnxruntime-node/dist/binding.js').binding;
  if (binding && typeof binding.listSupportedBackends === 'function') {
    backends = binding.listSupportedBackends();
    line('binding.listSupportedBackends() = ' + JSON.stringify(backends));
  } else {
    line('binding.listSupportedBackends not found on this build');
  }
} catch (err) {
  line('listSupportedBackends() error: ' + (err && err.message ? err.message : err));
}

// Inspect the shipped native dir for the DirectML.dll (file-level evidence).
header('SHIPPED NATIVE BINARIES (file-level evidence)');
try {
  const napiDir = path.join(
    path.dirname(require.resolve('onnxruntime-node/package.json')),
    'bin', 'napi-v6', process.platform, process.arch
  );
  if (fs.existsSync(napiDir)) {
    const files = fs.readdirSync(napiDir);
    line(napiDir + ':');
    for (const f of files) line('  ' + f);
    line('DirectML.dll present = ' + files.includes('DirectML.dll'));
  } else {
    line('napi dir not found: ' + napiDir);
  }
} catch (err) {
  line('native-dir inspect error: ' + (err && err.message ? err.message : err));
}

line('\nInferenceSession available = ' + (ort && ort.InferenceSession ? 'yes' : 'no'));

// ---- Model section ------------------------------------------------------
const MODEL_PATH = path.join(__dirname, '..', 'resources', 'models', 'RealESRGAN_x4plus.onnx');

(async () => {
  header('MODEL');
  if (!fs.existsSync(MODEL_PATH)) {
    line('Model NOT present at ' + MODEL_PATH);
    line('Skipping session/inference test (no model). The DirectML/ABI findings above stand on their own.');
    line('\nVERDICT(partial): onnxruntime-node loaded; supported backends printed above. Provide a model to test inference.');
    return;
  }
  line('Model found: ' + MODEL_PATH + ' (' + fs.statSync(MODEL_PATH).size + ' bytes)');

  // Try EP order ['dml','cpu'] first; if it throws, fall back to ['cpu'].
  const tryCreate = async (eps) => {
    const t0 = Date.now();
    const s = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: eps });
    return { session: s, ms: Date.now() - t0 };
  };

  let session = null;
  let epUsed = null;
  for (const eps of [['dml', 'cpu'], ['cpu']]) {
    try {
      header('CREATE SESSION executionProviders=' + JSON.stringify(eps));
      const { session: s, ms } = await tryCreate(eps);
      session = s;
      epUsed = eps;
      line('Session created OK in ' + ms + 'ms with EP request ' + JSON.stringify(eps));
      break;
    } catch (err) {
      line('Session create with ' + JSON.stringify(eps) + ' FAILED: ' + (err && err.message ? err.message : err));
    }
  }
  if (!session) {
    line('\nVERDICT: model present but NO EP could create a session. BLOCKED.');
    return;
  }

  header('MODEL I/O');
  line('inputNames  = ' + JSON.stringify(session.inputNames));
  line('outputNames = ' + JSON.stringify(session.outputNames));
  try {
    const im = session.inputMetadata || (session.handler && session.handler.inputMetadata);
    if (im) line('inputMetadata = ' + JSON.stringify(im));
    const om = session.outputMetadata || (session.handler && session.handler.outputMetadata);
    if (om) line('outputMetadata = ' + JSON.stringify(om));
  } catch (_) { /* best-effort diagnostic */ }

  // Determine the input spatial dims. Some exports are DYNAMIC (-1) -> we pick 64;
  // some (e.g. the Qualcomm export) are FIXED (e.g. 128) -> we MUST match them.
  let W = 64, H = 64;
  try {
    const im = session.inputMetadata || (session.handler && session.handler.inputMetadata);
    const meta = Array.isArray(im) ? im[0] : null;
    const shp = meta && meta.shape;
    if (shp && shp.length === 4) {
      const sh = Number(shp[2]), sw = Number(shp[3]);
      if (Number.isFinite(sh) && sh > 0) H = sh;
      if (Number.isFinite(sw) && sw > 0) W = sw;
      line('input spatial dims from metadata: H=' + (Number.isFinite(sh) && sh > 0 ? sh : 'dynamic') +
           ' W=' + (Number.isFinite(sw) && sw > 0 ? sw : 'dynamic') + ' -> using ' + W + 'x' + H);
    }
  } catch (_) { /* best-effort diagnostic */ }

  // NCHW float32 0..1 gradient input (RealESRGAN x4plus convention).
  header('INFERENCE ' + W + 'x' + H + ' -> expect ' + (W * 4) + 'x' + (H * 4));
  const C = 3;
  const chw = new Float32Array(C * H * W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = x / (W - 1), g = y / (H - 1), b = ((x + y) % 64) / 63;
      chw[0 * H * W + y * W + x] = r;
      chw[1 * H * W + y * W + x] = g;
      chw[2 * H * W + y * W + x] = b;
    }
  }
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', chw, [1, C, H, W]);
  const feeds = {}; feeds[inputName] = tensor;
  try {
    const t0 = Date.now();
    const out = await session.run(feeds);
    const ms = Date.now() - t0;
    const outName = session.outputNames[0];
    const o = out[outName];
    line('run() OK in ' + ms + 'ms');
    line('output dims  = ' + JSON.stringify(o.dims));
    line('output dtype = ' + o.type);
    const d = o.data;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    line('output min/max/mean = ' + mn.toFixed(4) + ' / ' + mx.toFixed(4) + ' / ' + (sum / d.length).toFixed(4));
    const scaleW = o.dims[3] / W, scaleH = o.dims[2] / H;
    line('inferred scale = ' + scaleW + 'x (W) , ' + scaleH + 'x (H)');
    line('\nVERDICT: inference RAN. EP requested=' + JSON.stringify(epUsed) +
         '. (Note: requested DML does NOT guarantee DML actually bound — check above + GPU activity.)');
  } catch (err) {
    line('run() FAILED: ' + (err && err.stack ? err.stack : err));
    line('\nVERDICT: session created but inference failed — see error.');
  }
})();
