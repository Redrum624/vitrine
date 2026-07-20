/**
 * Main-process AI motion deblur (NAFNet-GoPro-width32 via onnxruntime-node + DirectML).
 *
 * onnxruntime-node is a native module, so (like LibRaw and the Real-ESRGAN upscaler) it runs only
 * in the Electron main process; the renderer reaches it over IPC. Unlike Real-ESRGAN this model has
 * a DYNAMIC HxW input and does NOT change dimensions (outScale 1) — it removes camera-shake / motion
 * blur. The image is covered by a grid of fixed-size source windows (reflect-padded at borders) —
 * 1536px with a 128px feather on DirectML, 768/40 on any fallback path (see tileConfigFor) — each
 * run through the model and composited by feathered weighted accumulation into a same-size
 * canvas (cloned from aiUpscaler.cjs's overlapped tiling, ratio===1).
 *
 * Model I/O contract (validated by the S3 spike — .superpowers/sdd/raw-deblur-spike-findings.md):
 *   input  (dynamic name, [0])  float32 NCHW [1,3,H,W], values 0..1, RGB
 *   output (dynamic name, [0])  float32 NCHW [1,3,H,W], values 0..1, RGB — same size
 *
 * HARD 384px INPUT FLOOR (load-bearing, NOT defensive): NAFNet-GoPro's TLC (test-time local
 * converter) window makes inputs below 384px on either axis INVALID — on CPU they THROW, on DML they
 * SILENTLY RETURN GARBAGE (output range ±50,000 vs a sane −23..+24). Both tile configs are ≥384 by
 * construction so every emitted tile is valid, and `deblur()` DECLINES whole images below 384 on
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

const MODEL_TILE = 768; // FALLBACK model input side (px) for any non-DML path — throughput sweet spot (spike: ~268 ms/tile on DML)
const MIN_INPUT = 384; // HARD floor: below this NAFNet's TLC window is invalid (CPU throws / DML garbage)
const PAD = 40; // FALLBACK tile context margin (px); neighbours overlap by 2*PAD
// W4 seam fix (2026-07-20): NAFNet's receptive field is effectively unbounded (TLC 384 + U-Net x16),
// so INDEPENDENT windows deconvolve a long motion streak differently on each side of a boundary —
// a 40px feather cannot hide the disagreement and the result showed double-edge ghost seams on a
// 768 grid (any streak longer than ~40px guarantees it). On DirectML — the only backend the feature
// is offered on (isAvailable gates on it) — the model is dynamic-shape, so we run 1536px windows
// with a 128px feather instead: ~1/4 the tiles at ~4x the pixels each (similar total time) and far
// larger agreement zones. 768/40 stays as the fallback for any non-DML path (none is reachable
// through the app today; the gate is deliberately NOT widened here).
const DML_MODEL_TILE = 1536; // DirectML window side (px)
const DML_PAD = 128; // DirectML feather/context margin (px)
const OUT_SCALE = 1; // deblur does NOT change dimensions (accumulation canvas = source size)
const TILE_TIMEOUT_MS = 90000; // a 768 tile is ~0.27s / a 1536 tile ~4x that on DML; >90s = a hang (CPU path never reaches here)

/** Tile window + feather pad for a given backend. DirectML gets the large seam-safe windows. */
function tileConfigFor(backend) {
  return backend === 'directml'
    ? { tile: DML_MODEL_TILE, pad: DML_PAD }
    : { tile: MODEL_TILE, pad: PAD };
}

// W4 per-tile output tripwire (live-probed 2026-07-20 on P9190023.JPG, DirectML): NAFNet
// DETERMINISTICALLY blows up on some valid-size windows — bright/high-contrast content produced
// tile outputs up to ±28.75 (re-runs byte-identical) while every healthy tile stayed within
// [-0.13 .. 0.94] for this 0..1 model. Composited, those tiles render as full-saturation
// checkerboard blobs — the user's "breaks the photo". The bounds sit an order of magnitude above
// the healthy envelope and well below the garbage floor (min observed garbage magnitude 3.9;
// sub-384 garbage reaches ±50k), so a flagged tile is never a false positive on real content.
// A flagged tile falls back to its INPUT window (no deblur locally) — losing local deblur beats
// compositing garbage into the baked base.
const TILE_SANE_LO = -1;
const TILE_SANE_HI = 2;
function tileOutputSane(od) {
  for (let i = 0; i < od.length; i++) {
    const v = od[i];
    if (!(v >= TILE_SANE_LO && v <= TILE_SANE_HI)) return false; // NaN fails the comparison too
  }
  return true;
}

const MODEL_FILE = 'NAFNet-GoPro-width32.onnx';

// Load-bearing invariant: EVERY tile config MUST satisfy the model's minimum input, so the planner
// can NEVER emit a sub-floor tile — and its step (tile - 2*pad) must stay positive or axisStarts
// loops forever. If a future edit breaks either, this throws at module load rather than shipping
// silent-garbage tiles (see the spike's Gate 2).
for (const [t, p, label] of [[MODEL_TILE, PAD, 'fallback'], [DML_MODEL_TILE, DML_PAD, 'directml']]) {
  if (t < MIN_INPUT) {
    throw new Error(`aiDeblur: ${label} tile (${t}) must be >= MIN_INPUT (${MIN_INPUT})`);
  }
  if (t <= 2 * p) {
    throw new Error(`aiDeblur: ${label} tile (${t}) must exceed 2*pad (${2 * p}) for a positive step`);
  }
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

// ---- tiling (identical math to aiUpscaler.cjs / src/utils/tilePlan.ts, tile parametrized) ----
function axisStarts(extent, pad, tile) {
  if (extent <= tile) return [Math.floor((extent - tile) / 2)];
  const step = tile - 2 * pad;
  const lastStart = extent - tile + pad;
  const starts = [];
  for (let s = -pad; s < lastStart; s += step) starts.push(s);
  starts.push(lastStart);
  return starts;
}
function planTiles(width, height, pad = PAD, tile = MODEL_TILE) {
  const xs = axisStarts(width, pad, tile);
  const ys = axisStarts(height, pad, tile);
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
// Fill a tile x tile NCHW float32 (0..1) input from an RGBA source, reflect-padding at borders.
function fillTileInput(chw, rgba, width, height, sx, sy, tile) {
  const plane = tile * tile;
  for (let ly = 0; ly < tile; ly++) {
    const syy = reflect(sy + ly, height);
    const row = syy * width;
    for (let lx = 0; lx < tile; lx++) {
      const sxx = reflect(sx + lx, width);
      const si = (row + sxx) * 4;
      const di = ly * tile + lx;
      chw[di] = rgba[si] / 255;
      chw[plane + di] = rgba[si + 1] / 255;
      chw[2 * plane + di] = rgba[si + 2] / 255;
    }
  }
}

/**
 * Feathered weighted accumulation of one model-output tile into the whole-frame canvas.
 * Pure (no session state) and size-agnostic — the weight is ramp(distance-to-tile-edge)/band on
 * each axis and wsum records exactly the weights applied, so the final accum/wsum normalization
 * reproduces a constant tile field as a constant frame for ANY tile/band combination (verified by
 * aiDeblurPlanner.test's seam-free composition test).
 */
function accumulateTile(accum, wsum, od, tile, band, baseX, baseY, Wt, Ht) {
  const plane = tile * tile;
  for (let ly = 0; ly < tile; ly++) {
    const Y = baseY + ly; if (Y < 0 || Y >= Ht) continue;
    const wy = ramp(ly, tile, band);
    for (let lx = 0; lx < tile; lx++) {
      const X = baseX + lx; if (X < 0 || X >= Wt) continue;
      const w = wy * ramp(lx, tile, band);
      const op = ly * tile + lx;
      const cp = Y * Wt + X;
      accum[cp * 3] += od[op] * w;
      accum[cp * 3 + 1] += od[plane + op] * w;
      accum[cp * 3 + 2] += od[2 * plane + op] * w;
      wsum[cp] += w;
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

  // Backend-dependent window: DirectML (the only offered backend) runs the large seam-safe
  // 1536/128 windows; anything else keeps the original 768/40 (see tileConfigFor's doc).
  const { tile, pad } = tileConfigFor(backend);
  const band = pad * OUT_SCALE; // feather band (= pad, since outScale 1)
  const Wt = width * OUT_SCALE, Ht = height * OUT_SCALE;

  const accum = new Float32Array(Wt * Ht * 3);
  const wsum = new Float32Array(Wt * Ht);

  const tiles = planTiles(width, height, pad, tile);
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const chw = new Float32Array(3 * tile * tile);

  let skippedTiles = 0;
  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    fillTileInput(chw, rgba, width, height, t.sx, t.sy, tile);
    const feeds = {}; feeds[inputName] = new ort.Tensor('float32', chw, [1, 3, tile, tile]);
    const out = await runWithTimeout(s.run(feeds), TILE_TIMEOUT_MS, 'AI deblur tile');
    let od = out[outputName].data; // Float32 NCHW [1,3,tile,tile], 0..1

    // Per-tile tripwire (see tileOutputSane): a garbled window falls back to its INPUT pixels
    // (chw still holds this tile's input in the same CHW layout) — locally un-deblurred, never acid.
    if (!tileOutputSane(od)) {
      skippedTiles++;
      od = chw;
    }
    accumulateTile(accum, wsum, od, tile, band, t.sx * OUT_SCALE, t.sy * OUT_SCALE, Wt, Ht);
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
  return { data, width: Wt, height: Ht, skippedTiles };
}

function clamp255(v01) {
  const v = Math.round(v01 * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// planTiles / tile constants / tileConfigFor / accumulateTile / tileOutputSane are exported for
// the planner-floor + seam-free composition + garbage-tripwire contract tests (aiDeblurPlanner.test.ts).
module.exports = {
  isAvailable, getBackend, deblur, planTiles, tileConfigFor, accumulateTile, tileOutputSane,
  MODEL_TILE, MIN_INPUT, PAD, DML_MODEL_TILE, DML_PAD, TILE_SANE_LO, TILE_SANE_HI,
};
