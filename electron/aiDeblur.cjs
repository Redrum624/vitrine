/**
 * Main-process AI motion deblur (NAFNet-GoPro-width32 via onnxruntime-node + DirectML).
 *
 * onnxruntime-node is a native module, so (like LibRaw and the Real-ESRGAN upscaler) it runs only
 * in the Electron main process; the renderer reaches it over IPC. Unlike Real-ESRGAN this model has
 * a DYNAMIC HxW input and does NOT change dimensions (outScale 1) — it removes camera-shake / motion
 * blur. The image is covered by a grid of fixed 768x768 source windows (reflect-padded at borders),
 * each run through the model and composited by feathered weighted accumulation into a same-size
 * canvas (cloned from aiUpscaler.cjs's overlapped tiling, ratio===1).
 *
 * Model I/O contract (validated by the S3 spike — .superpowers/sdd/raw-deblur-spike-findings.md):
 *   input  (dynamic name, [0])  float32 NCHW [1,3,H,W], values 0..1, RGB
 *   output (dynamic name, [0])  float32 NCHW [1,3,H,W], values 0..1, RGB — same size
 *
 * HARD 384px INPUT FLOOR (load-bearing, NOT defensive): NAFNet-GoPro's TLC (test-time local
 * converter) window makes inputs below 384px on either axis INVALID — on CPU they THROW, on DML they
 * SILENTLY RETURN GARBAGE (output range ±50,000 vs a sane −23..+24). MODEL_TILE is 768 (≥384 by
 * construction) so every emitted tile is valid, and `deblur()` DECLINES whole images below 384 on
 * either axis before touching the session. See the MIN_INPUT assertion below and aiDeblurPlanner.test.
 *
 * AVAILABILITY is DirectML-gated: a CPU-only backend deblurs a 24 MP frame in ~3–4 min (vs ~16–25 s
 * on DML), so `isAvailable()` reports true ONLY when the session bound to DirectML. There is no
 * deterministic fallback for motion deblur (the RL Deblur slider targets defocus, a different blur),
 * so a CPU-only machine simply HIDES the control (the renderer policy) rather than offering a
 * multi-minute path. This differs from aiUpscaler, whose CPU path is an acceptable Lanczos-parity
 * fallback.
 *
 * WHOLE-FRAME / AI-ROUTE ONLY: this NEVER enters the tiled CPU worker pipeline (tiledPipeline.ts).
 * NAFNet's receptive field is effectively unbounded (TLC window 384 + U-Net ×16 downsampling); no
 * finite moduleApron bounds it, so it must run whole-frame in the main process exactly like
 * Real-ESRGAN. The moduleApron formula and its enhance-kernel coupling stay untouched.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const MODEL_TILE = 768; // model input side (px) — throughput sweet spot (spike: ~268 ms/tile on DML)
const MIN_INPUT = 384; // HARD floor: below this NAFNet's TLC window is invalid (CPU throws / DML garbage)
const PAD = 40; // tile context margin (px); neighbours overlap by 2*PAD — motion streaks are long, be generous
const OUT_SCALE = 1; // deblur does NOT change dimensions (accumulation canvas = source size)
const TILE_TIMEOUT_MS = 90000; // a single 768 tile is ~0.27s on DML; >90s = a hang (CPU path never reaches here)

const MODEL_FILE = 'NAFNet-GoPro-width32.onnx';

// Load-bearing invariant: the fixed tile size MUST satisfy the model's minimum input, so the planner
// can NEVER emit a sub-floor tile. If a future edit lowers MODEL_TILE below MIN_INPUT this throws at
// module load rather than shipping silent-garbage tiles (see the spike's Gate 2).
if (MODEL_TILE < MIN_INPUT) {
  throw new Error(`aiDeblur: MODEL_TILE (${MODEL_TILE}) must be >= MIN_INPUT (${MIN_INPUT})`);
}

let ort = null;
let session = null;
let backend = null; // 'directml' | 'cpu' | null
let initPromise = null;

// ---- model location (dev vs packaged) — identical resolution to aiUpscaler.cjs ----------
function resolveModelPath() {
  const candidates = [];
  try {
    const { app } = require('electron');
    if (app && app.isPackaged && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'models', MODEL_FILE));
    }
  } catch (_) { /* not in electron (plain-node probe) */ }
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'models', MODEL_FILE));
  candidates.push(path.join(__dirname, '..', 'resources', 'models', MODEL_FILE));
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[candidates.length - 1];
}

// ---- tiling (identical math to aiUpscaler.cjs / src/utils/tilePlan.ts) -------------------
function axisStarts(extent, pad) {
  if (extent <= MODEL_TILE) return [Math.floor((extent - MODEL_TILE) / 2)];
  const step = MODEL_TILE - 2 * pad;
  const lastStart = extent - MODEL_TILE + pad;
  const starts = [];
  for (let s = -pad; s < lastStart; s += step) starts.push(s);
  starts.push(lastStart);
  return starts;
}
function planTiles(width, height, pad = PAD) {
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
async function ensureSession() {
  if (session) return session;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const modelPath = resolveModelPath();
    if (!fs.existsSync(modelPath)) { backend = null; return null; }
    ort = require('onnxruntime-node');
    // Backend detection by CONSTRUCTION, not timing: create with ['dml'] ONLY first — ORT
    // throws at session init when the DirectML EP can't bind (no device / unsupported ops;
    // the spike's opset-21 model reproduced exactly that hard-fail). Success = DirectML is
    // genuinely running the graph. The v1 timing heuristic (warmup < 900ms == DML)
    // misclassified under GPU contention — right after a GPU enhance-chain apply the warmup
    // exceeded the threshold on a REAL DML session and the feature hid itself (round-8
    // review LOW #4, reproduced live by the v1.20.0 packaged smoke).
    let created = null;
    try {
      created = await ort.InferenceSession.create(modelPath, { executionProviders: ['dml'] });
      backend = 'directml';
    } catch (_) {
      try {
        created = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
        backend = 'cpu';
      } catch (_2) { created = null; backend = null; }
    }
    if (!created) return null;
    session = created;
    // Warmup at MIN_INPUT (>= 384 or NAFNet throws/garbles) — primes the graph so the first
    // real tile doesn't pay compile/upload costs. A THROW here means the session can't run
    // at all: reclassify to cpu (hides the feature) rather than advertise a broken DML.
    try {
      const probe = new Float32Array(3 * MIN_INPUT * MIN_INPUT);
      const feeds = {}; feeds[session.inputNames[0]] = new ort.Tensor('float32', probe, [1, 3, MIN_INPUT, MIN_INPUT]);
      await session.run(feeds);
    } catch (_) {
      backend = 'cpu';
    }
    return session;
  })();
  return initPromise;
}

/**
 * AI motion deblur is available ONLY on a DirectML-bound session. CPU-only is treated as
 * unavailable (the ~3–4 min/24 MP path is not offered — the control hides). See the header note.
 */
async function isAvailable() {
  try {
    await ensureSession();
    return !!session && backend === 'directml';
  } catch (_) {
    return false;
  }
}
function getBackend() { return backend; }

// ---- inference ----------------------------------------------------------
// Fill a 768x768 NCHW float32 (0..1) input from an RGBA source, reflect-padding at borders.
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
 * Motion-deblur a Uint8 RGBA image WHOLE-FRAME (same dimensions). Calls onProgress({done,total})
 * after each tile. Returns { data: Uint8Array (RGBA), width, height } at the SOURCE size.
 *
 * Declines images below MIN_INPUT (384) on either axis BEFORE any session work — this is the hard
 * floor from Gate 2, not a defensive nicety (sub-384 inputs silently corrupt on DML).
 */
async function deblur(rgba, width, height, onProgress) {
  if (width < MIN_INPUT || height < MIN_INPUT) {
    throw new Error(
      `AI motion deblur needs at least ${MIN_INPUT}px on each side (got ${width}x${height}).`,
    );
  }
  const s = await ensureSession();
  if (!s) throw new Error('AI motion deblur unavailable (model or session could not be created)');

  const band = PAD * OUT_SCALE; // feather band (= PAD, since outScale 1)
  const Wt = width * OUT_SCALE, Ht = height * OUT_SCALE;

  const accum = new Float32Array(Wt * Ht * 3);
  const wsum = new Float32Array(Wt * Ht);

  const tiles = planTiles(width, height, PAD);
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const chw = new Float32Array(3 * MODEL_TILE * MODEL_TILE);
  const plane = MODEL_TILE * MODEL_TILE;

  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    fillTileInput(chw, rgba, width, height, t.sx, t.sy);
    const feeds = {}; feeds[inputName] = new ort.Tensor('float32', chw, [1, 3, MODEL_TILE, MODEL_TILE]);
    const out = await runWithTimeout(s.run(feeds), TILE_TIMEOUT_MS, 'AI deblur tile');
    const od = out[outputName].data; // Float32 NCHW [1,3,768,768], 0..1

    const baseX = t.sx * OUT_SCALE, baseY = t.sy * OUT_SCALE;
    for (let ly = 0; ly < MODEL_TILE; ly++) {
      const Y = baseY + ly; if (Y < 0 || Y >= Ht) continue;
      const wy = ramp(ly, MODEL_TILE, band);
      for (let lx = 0; lx < MODEL_TILE; lx++) {
        const X = baseX + lx; if (X < 0 || X >= Wt) continue;
        const w = wy * ramp(lx, MODEL_TILE, band);
        const op = ly * MODEL_TILE + lx;
        const cp = Y * Wt + X;
        accum[cp * 3] += od[op] * w;
        accum[cp * 3 + 1] += od[plane + op] * w;
        accum[cp * 3 + 2] += od[2 * plane + op] * w;
        wsum[cp] += w;
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

// planTiles / MODEL_TILE / MIN_INPUT are exported for the planner-floor contract test.
module.exports = { isAvailable, getBackend, deblur, planTiles, MODEL_TILE, MIN_INPUT, PAD };
