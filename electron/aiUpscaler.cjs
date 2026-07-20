/**
 * Main-process AI super-resolution upscaler (Real-ESRGAN x4plus via onnxruntime-node + DirectML).
 *
 * onnxruntime-node is a native module, so (like LibRaw) it runs only in the Electron main process;
 * the renderer reaches it over IPC. The bundled ONNX has a FIXED 128x128 -> 512x512 (x4) input
 * (Task 1 spike — `.superpowers/sdd/ai-spike-findings.md`), so the image is covered by a grid of
 * 128x128 source windows (reflect-padded at borders), each run through the model and composited by
 * feathered weighted accumulation. For a requested scale of 2 the model's x4 tiles are box-downscaled
 * 2:1 BEFORE compositing, so the accumulation canvas is the TARGET size (never the larger 4x buffer).
 *
 * Model I/O contract (validated, Task 1):
 *   input  "image"          float32 NCHW [1,3,128,128], values 0..1, RGB
 *   output "upscaled_image" float32 NCHW [1,3,512,512], values 0..1, RGB
 */
'use strict';

const path = require('path');
const fs = require('fs');

const MODEL_TILE = 128; // model input side (px) — FIXED by the ONNX
const MODEL_SCALE = 4; // model output scale — FIXED
const MODEL_TILE_OUT = MODEL_TILE * MODEL_SCALE; // 512
const PAD = 16; // tile context margin (px); neighbours overlap by 2*PAD for seam blending
const TILE_TIMEOUT_MS = 30000; // a single 128->512 tile is <2.1s even on CPU; >30s = a hang

const MODEL_FILE = 'RealESRGAN_x4plus.onnx';

let ort = null;
let session = null;
let backend = null; // 'directml' | 'cpu' | null
let initPromise = null;

// ---- model location (dev vs packaged) -----------------------------------
function resolveModelPath() {
  const candidates = [];
  try {
    const { app } = require('electron');
    if (app && app.isPackaged && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'models', MODEL_FILE));
    }
  } catch (_) { /* not in electron (plain-node smoke) */ }
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'models', MODEL_FILE));
  candidates.push(path.join(__dirname, '..', 'resources', 'models', MODEL_FILE));
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[candidates.length - 1];
}

// ---- tiling (identical math to src/utils/tilePlan.ts) -------------------
function axisStarts(extent, pad) {
  if (extent <= MODEL_TILE) return [Math.floor((extent - MODEL_TILE) / 2)];
  const step = MODEL_TILE - 2 * pad;
  const lastStart = extent - MODEL_TILE + pad;
  const starts = [];
  for (let s = -pad; s < lastStart; s += step) starts.push(s);
  starts.push(lastStart);
  return starts;
}
function planTiles(width, height, pad) {
  const xs = axisStarts(width, pad);
  const ys = axisStarts(height, pad);
  const tiles = [];
  for (const sy of ys) for (const sx of xs) tiles.push({ sx, sy });
  return tiles;
}
function ramp(p, edge, band) {
  if (band <= 0) return 1;
  const d = Math.min(p, edge - 1 - p);
  return Math.max(0, Math.min(1, (d + 0.5) / band));
}

// reflect-101 index mirror (no edge-pixel repeat) for border padding
function reflect(i, n) {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let m = ((i % period) + period) % period;
  if (m < 0) m += period;
  return m < n ? m : period - m;
}

// ---- session init -------------------------------------------------------
/**
 * Backend detection by CONSTRUCTION, not timing (W5 R1, mirrors aiDeblur.cjs): create with
 * ['dml'] ONLY first — ORT throws at session init when the DirectML EP can't bind, so success
 * means DirectML genuinely runs the graph. The previous ['dml','cpu'] list let ORT silently
 * fall through to the CPU EP, and the timing probe (<500ms == DML) both misclassified under
 * GPU contention (see aiDeblur's header for the reproduced case) and — worse — still reported
 * the feature available on a CPU-bound session: a 20MP ×2 upscale auto-routed into ~2,000
 * tiles at ~2s each (>1h, uncancellable) while the UI claimed AI-on-GPU.
 * `create(modelPath, opts)` is parameterized so the EP-selection logic is unit-testable
 * without onnxruntime-node (aiUpscalerAvailability.test.ts).
 */
async function createSessionByConstruction(create, modelPath) {
  try {
    return { session: await create(modelPath, { executionProviders: ['dml'] }), backend: 'directml' };
  } catch (_) {
    try {
      return { session: await create(modelPath, { executionProviders: ['cpu'] }), backend: 'cpu' };
    } catch (_2) {
      return { session: null, backend: null };
    }
  }
}

/**
 * AI upscale is offered ONLY on a DirectML-bound session (chain-audit F3). A CPU-EP session is
 * kept for diagnostics (getBackend) but reports unavailable, so EnhanceService's router falls
 * back to the deterministic Lanczos path instead of the >1h CPU tile crawl.
 */
function availableFor(sess, be) { return !!sess && be === 'directml'; }

async function ensureSession() {
  if (session) return session;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const modelPath = resolveModelPath();
    if (!fs.existsSync(modelPath)) { backend = null; return null; }
    ort = require('onnxruntime-node');
    const r = await createSessionByConstruction((p, o) => ort.InferenceSession.create(p, o), modelPath);
    if (!r.session) { backend = null; return null; }
    session = r.session;
    backend = r.backend;
    // Warmup primes the graph so the first real tile doesn't pay compile/upload costs. A THROW
    // here means the session can't run at all: reclassify to cpu (gates the feature off) rather
    // than advertise a broken DML (same recovery as aiDeblur).
    try {
      const probe = new Float32Array(3 * MODEL_TILE * MODEL_TILE);
      const feeds = {}; feeds[session.inputNames[0]] = new ort.Tensor('float32', probe, [1, 3, MODEL_TILE, MODEL_TILE]);
      await session.run(feeds);
    } catch (_) {
      backend = 'cpu';
    }
    return session;
  })();
  return initPromise;
}

async function isAvailable() {
  try {
    await ensureSession();
    return availableFor(session, backend);
  } catch (_) { return false; }
}
function getBackend() { return backend; }

// ---- inference ----------------------------------------------------------
// Fill a 128x128 NCHW float32 (0..1) input from an RGBA source, reflect-padding at borders.
function fillTileInput(chw, rgba, width, height, sx, sy) {
  const plane = MODEL_TILE * MODEL_TILE;
  for (let ly = 0; ly < MODEL_TILE; ly++) {
    const syy = reflect(sy + ly, height);
    const row = syy * width;
    for (let lx = 0; lx < MODEL_TILE; lx++) {
      const sxx = reflect(sx + lx, width);
      const si = (row + sxx) * 4;
      const di = ly * MODEL_TILE + lx;
      chw[di] = rgba[si] / 255;
      chw[plane + di] = rgba[si + 1] / 255;
      chw[2 * plane + di] = rgba[si + 2] / 255;
    }
  }
}

function runWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Upscale a Uint8 RGBA image by `scale` (2 or 4). Calls onProgress({done,total}) after each tile.
 * Returns { data: Uint8Array (RGBA), width, height } at the TARGET size.
 */
async function upscale(rgba, width, height, scale, onProgress) {
  const s = await ensureSession();
  if (!s) throw new Error('AI upscaler unavailable (model or session could not be created)');
  if (scale !== 2 && scale !== 4) throw new Error('AI upscale scale must be 2 or 4, got ' + scale);

  const outScale = scale;
  const ratio = outScale / MODEL_SCALE; // 1 for x4, 0.5 for x2 (box-downscale each tile)
  const tileOut = MODEL_TILE * outScale; // 512 (x4) or 256 (x2)
  const band = PAD * outScale; // feather band in target space
  const Wt = width * outScale, Ht = height * outScale;

  const accum = new Float32Array(Wt * Ht * 3);
  const wsum = new Float32Array(Wt * Ht);

  const tiles = planTiles(width, height, PAD);
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const chw = new Float32Array(3 * MODEL_TILE * MODEL_TILE);
  const outPlane = MODEL_TILE_OUT * MODEL_TILE_OUT;

  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    fillTileInput(chw, rgba, width, height, t.sx, t.sy);
    const feeds = {}; feeds[inputName] = new ort.Tensor('float32', chw, [1, 3, MODEL_TILE, MODEL_TILE]);
    const out = await runWithTimeout(s.run(feeds), TILE_TIMEOUT_MS, 'AI upscale tile');
    const od = out[outputName].data; // Float32 NCHW [1,3,512,512], 0..1

    const baseX = t.sx * outScale, baseY = t.sy * outScale;
    if (ratio === 1) {
      // x4: composite the 512x512 tile directly
      for (let ly = 0; ly < tileOut; ly++) {
        const Y = baseY + ly; if (Y < 0 || Y >= Ht) continue;
        const wy = ramp(ly, tileOut, band);
        for (let lx = 0; lx < tileOut; lx++) {
          const X = baseX + lx; if (X < 0 || X >= Wt) continue;
          const w = wy * ramp(lx, tileOut, band);
          const op = ly * MODEL_TILE_OUT + lx;
          const cp = Y * Wt + X;
          accum[cp * 3] += od[op] * w;
          accum[cp * 3 + 1] += od[outPlane + op] * w;
          accum[cp * 3 + 2] += od[2 * outPlane + op] * w;
          wsum[cp] += w;
        }
      }
    } else {
      // x2: box-downscale each 2x2 block of the 512 output -> a 256 tile, then composite
      for (let ly = 0; ly < tileOut; ly++) {
        const Y = baseY + ly; if (Y < 0 || Y >= Ht) continue;
        const wy = ramp(ly, tileOut, band);
        const o0 = (ly * 2) * MODEL_TILE_OUT, o1 = (ly * 2 + 1) * MODEL_TILE_OUT;
        for (let lx = 0; lx < tileOut; lx++) {
          const X = baseX + lx; if (X < 0 || X >= Wt) continue;
          const w = wy * ramp(lx, tileOut, band);
          const a = o0 + lx * 2, b = o1 + lx * 2;
          const r = (od[a] + od[a + 1] + od[b] + od[b + 1]) * 0.25;
          const g = (od[outPlane + a] + od[outPlane + a + 1] + od[outPlane + b] + od[outPlane + b + 1]) * 0.25;
          const bl = (od[2 * outPlane + a] + od[2 * outPlane + a + 1] + od[2 * outPlane + b] + od[2 * outPlane + b + 1]) * 0.25;
          const cp = Y * Wt + X;
          accum[cp * 3] += r * w;
          accum[cp * 3 + 1] += g * w;
          accum[cp * 3 + 2] += bl * w;
          wsum[cp] += w;
        }
      }
    }
    if (onProgress) { try { onProgress({ done: ti + 1, total: tiles.length }); } catch (_) { /* ignore */ } }
  }

  const data = new Uint8Array(Wt * Ht * 4);
  for (let i = 0; i < Wt * Ht; i++) {
    const w = wsum[i] || 1;
    const o = i * 4, a = i * 3;
    data[o] = clamp255(accum[a] / w);
    data[o + 1] = clamp255(accum[a + 1] / w);
    data[o + 2] = clamp255(accum[a + 2] / w);
    data[o + 3] = 255;
  }
  return { data, width: Wt, height: Ht };
}

function clamp255(v01) {
  const v = Math.round(v01 * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

module.exports = {
  isAvailable, getBackend, upscale,
  // test seams (aiUpscalerAvailability.test.ts)
  createSessionByConstruction, availableFor,
};
