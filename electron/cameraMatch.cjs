// "Camera match" render intent — fit the decoded RAW to the camera's own render.
//
// Every RAW carries its manufacturer-rendered ground truth: the full-size embedded
// JPEG preview (the same pixels the camera would have written as an out-of-camera
// JPG, including picture mode, adaptive gradation, and white-balance nuance). A
// single global "look" transform cannot reproduce that — the in-camera processing
// is per-shot adaptive (measured: a global corpus fit plateaus at ΔE76 ≈ 16 vs the
// camera render, while a per-image fit reaches ΔE76 ≈ 3-5). So this module fits a
// compact color transform PER IMAGE, at decode time, against that image's own
// embedded preview, then applies it to the full-resolution decode:
//
//   1. Downsample both the decode and the (orientation-aligned) preview to a
//      coarse analysis grid — cell averages, so demosaic/sharpening/NR detail
//      differences cancel and only color/tone structure remains.
//   2. Fit, on usable (unclipped) cells: a ridge-regularised 3x3 matrix in
//      linear-sRGB, then per-channel monotone tone curves (binned means + PAVA),
//      then a small residual 3D LUT (9³, Laplacian-smoothed) for the hue/sat
//      structure the separable model can't express.
//   3. Apply the fitted chain to the full-res 16-bit buffer in a worker thread
//      (the ~20MP loop would otherwise block the main process for seconds).
//
// Fail-open contract: this is an enhancement pass — ANY failure (no usable
// preview, degenerate fit, worker error) logs and returns the ORIGINAL decode
// unchanged. A camera-match failure must never fail the open itself.
//
// The transform maps decode→camera-render for whatever decode it is given, so it
// works on both the native dcraw rung (fed -W for a stable, un-auto-brightened
// input) and the wasm rung (which keeps LibRaw's auto-bright — the fit simply
// absorbs it). It is deliberately NOT applied to the embedded-JPEG fallback rung,
// which already IS the camera render.

const { Worker } = require('worker_threads');
const path = require('path');
const { findEmbeddedJpegs, readOrientation } = require('./embeddedPreview.cjs');

// Analysis grid. 200x150 ≈ 30k cells → ~20-28k usable fit samples on a typical
// photo; each cell averages ~500 source pixels, so per-pixel detail differences
// (sharpening halos, noise reduction) wash out of the fit target.
const GW = 200;
const GH = 150;

// Fit hyper-parameters (validated on a 56-image corpus + the 4-photo comparison
// set; N13/λ0.5 with perceptual weighting matched or improved every case over
// N9/λ1.0 unweighted).
const CURVE_KNOTS = 33;
const RESIDUAL_N = 13;       // residual LUT lattice nodes per axis
const RESIDUAL_LAMBDA = 0.5; // Laplacian smoothing weight
const RESIDUAL_ITERS = 150;  // Jacobi iterations
const MIN_FIT_SAMPLES = 500; // below this the fit is not trustworthy — skip

// ---------------------------------------------------------------------------
// Color helpers (sRGB transfer)
// ---------------------------------------------------------------------------
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

// ---------------------------------------------------------------------------
// Grid builders
// ---------------------------------------------------------------------------

/**
 * Box-average a packed 16-bit RGB buffer into a GWxGH float grid (0..1).
 * @param {Uint16Array} u16 packed RGB, host byte order
 */
function decodeToGrid(u16, width, height) {
  const grid = new Float64Array(GW * GH * 3);
  const cnt = new Float64Array(GW * GH);
  // Sample every 2nd row/col — plenty for cell averages, half the work.
  for (let y = 0; y < height; y += 2) {
    const gy = Math.min(GH - 1, Math.floor((y / height) * GH));
    for (let x = 0; x < width; x += 2) {
      const gx = Math.min(GW - 1, Math.floor((x / width) * GW));
      const o = (y * width + x) * 3;
      const gi = gy * GW + gx;
      grid[gi * 3] += u16[o] / 65535;
      grid[gi * 3 + 1] += u16[o + 1] / 65535;
      grid[gi * 3 + 2] += u16[o + 2] / 65535;
      cnt[gi]++;
    }
  }
  for (let i = 0; i < GW * GH; i++) {
    const c = cnt[i] || 1;
    grid[i * 3] /= c;
    grid[i * 3 + 1] /= c;
    grid[i * 3 + 2] /= c;
  }
  return grid;
}

/**
 * Decode the embedded preview JPEG to the same GWxGH grid, rotated to match the
 * decode's orientation (dcraw applies the sensor flip; the stored preview pixels
 * are unrotated — comparing them unaligned poisons the whole fit).
 */
async function previewToGrid(previewJpeg, rotateDeg) {
  const sharp = require('sharp');
  let img = sharp(previewJpeg);
  if (rotateDeg) img = img.rotate(rotateDeg);
  const { data } = await img.resize(GW, GH, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const grid = new Float64Array(GW * GH * 3);
  for (let i = 0; i < GW * GH * 3; i++) grid[i] = data[i] / 255;
  return grid;
}

// ---------------------------------------------------------------------------
// Fitting (pure — unit-tested directly)
// ---------------------------------------------------------------------------

/** Cells where any channel clips (in either source) distort the fit — drop them. */
const usableCell = (s, t) =>
  s[0] > 0.005 && s[0] < 0.995 && s[1] > 0.005 && s[1] < 0.995 && s[2] > 0.005 && s[2] < 0.995 &&
  t[0] > 0.005 && t[0] < 0.995 && t[1] > 0.005 && t[1] < 0.995 && t[2] > 0.005 && t[2] < 0.995;

/** Least-squares 3x3 matrix (linear domain), ridge-regularised for conditioning. */
function fitMatrix(pairs) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [s, t] of pairs) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        A[i][j] += s[i] * s[j];
        B[i][j] += t[i] * s[j];
      }
    }
  }
  for (let i = 0; i < 3; i++) A[i][i] += 1e-4; // ridge
  const [a, b, c, d, e, f, g, h, i] = [A[0][0], A[0][1], A[0][2], A[1][0], A[1][1], A[1][2], A[2][0], A[2][1], A[2][2]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) for (let k = 0; k < 3; k++) M[r][cc] += B[r][k] * inv[k][cc];
  return M;
}

const applyM = (M, s) => [
  M[0][0] * s[0] + M[0][1] * s[1] + M[0][2] * s[2],
  M[1][0] * s[0] + M[1][1] * s[1] + M[1][2] * s[2],
  M[2][0] * s[0] + M[2][1] * s[1] + M[2][2] * s[2],
];

/**
 * Monotone tone curve via binned conditional means + PAVA (pool adjacent
 * violators). Returns the knot array; evaluate with evalCurve.
 */
function fitCurve(us, vs, knots = CURVE_KNOTS) {
  const sum = new Float64Array(knots);
  const cnt = new Float64Array(knots);
  for (let k = 0; k < us.length; k++) {
    const b = Math.min(knots - 1, Math.max(0, Math.round(us[k] * (knots - 1))));
    sum[b] += vs[k];
    cnt[b]++;
  }
  const y = new Float64Array(knots);
  let last = 0;
  for (let b = 0; b < knots; b++) {
    y[b] = cnt[b] ? sum[b] / cnt[b] : last;
    last = y[b];
  }
  const level = [];
  for (let b = 0; b < knots; b++) {
    let v = y[b], wt = Math.max(cnt[b], 1e-6), n = 1;
    while (level.length && level[level.length - 1][0] > v) {
      const [pv, pw, pn] = level.pop();
      v = (pv * pw + v * wt) / (pw + wt);
      wt += pw;
      n += pn;
    }
    level.push([v, wt, n]);
  }
  const curve = new Float64Array(knots);
  let b2 = 0;
  for (const [v, , n] of level) for (let k = 0; k < n; k++) curve[b2++] = v;
  return curve;
}

function evalCurve(curve, u) {
  const K = curve.length;
  const t = Math.min(1, Math.max(0, u)) * (K - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(K - 1, i0 + 1);
  return curve[i0] + (curve[i1] - curve[i0]) * (t - i0);
}

/**
 * Residual 3D LUT: encoded post-(matrix+curves) RGB → additive residual toward
 * the target, on an N³ lattice with Laplacian smoothing (Jacobi relaxation).
 * Optional per-sample weights: pass 1/(Y+0.05)-style perceptual weights so dark
 * regions — where equal encoded error is far more visible — pull the fit as
 * hard as bright ones (plain encoded-RGB least squares underweights shadows).
 * Returns three flat Float64Array node grids (r/g/b residuals).
 */
function fitResidualLUT(samples, N = RESIDUAL_N, lambda = RESIDUAL_LAMBDA, iters = RESIDUAL_ITERS, weights = null) {
  const n3 = N * N * N;
  const wSum = new Float64Array(n3);
  const tSum = [new Float64Array(n3), new Float64Array(n3), new Float64Array(n3)];
  const idx = (r, g, b) => (r * N + g) * N + b;
  for (let k = 0; k < samples.length; k++) {
    const [s, t] = samples[k];
    const sw = weights ? weights[k] : 1;
    const fr = Math.min(N - 1.0001, Math.max(0, s[0] * (N - 1)));
    const fg = Math.min(N - 1.0001, Math.max(0, s[1] * (N - 1)));
    const fb = Math.min(N - 1.0001, Math.max(0, s[2] * (N - 1)));
    const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
    const dr = fr - r0, dg = fg - g0, db = fb - b0;
    for (let cr = 0; cr < 2; cr++) {
      for (let cg = 0; cg < 2; cg++) {
        for (let cb = 0; cb < 2; cb++) {
          const w = (cr ? dr : 1 - dr) * (cg ? dg : 1 - dg) * (cb ? db : 1 - db) * sw;
          if (w < 1e-8) continue;
          const ii = idx(r0 + cr, g0 + cg, b0 + cb);
          wSum[ii] += w;
          for (let c = 0; c < 3; c++) tSum[c][ii] += w * (t[c] - s[c]);
        }
      }
    }
  }
  const lut = [new Float64Array(n3), new Float64Array(n3), new Float64Array(n3)];
  for (let it = 0; it < iters; it++) {
    for (let c = 0; c < 3; c++) {
      const cur = lut[c];
      const next = new Float64Array(n3);
      for (let r = 0; r < N; r++) {
        for (let g = 0; g < N; g++) {
          for (let b = 0; b < N; b++) {
            const ii = idx(r, g, b);
            let nb = 0, nbSum = 0;
            if (r > 0) { nb++; nbSum += cur[idx(r - 1, g, b)]; }
            if (r < N - 1) { nb++; nbSum += cur[idx(r + 1, g, b)]; }
            if (g > 0) { nb++; nbSum += cur[idx(r, g - 1, b)]; }
            if (g < N - 1) { nb++; nbSum += cur[idx(r, g + 1, b)]; }
            if (b > 0) { nb++; nbSum += cur[idx(r, g, b - 1)]; }
            if (b < N - 1) { nb++; nbSum += cur[idx(r, g, b + 1)]; }
            next[ii] = (tSum[c][ii] + lambda * nbSum) / (wSum[ii] + lambda * nb + 1e-9);
          }
        }
      }
      lut[c] = next;
    }
  }
  return lut;
}

/**
 * Fit the full transform from grid pairs. Returns a plain serializable model
 * ({ M, curves, residual, N }) or null when the data can't support a fit.
 */
function fitTransform(decGrid, camGrid) {
  const pairs = [];
  for (let i = 0; i < GW * GH; i++) {
    const s = [decGrid[i * 3], decGrid[i * 3 + 1], decGrid[i * 3 + 2]];
    const t = [camGrid[i * 3], camGrid[i * 3 + 1], camGrid[i * 3 + 2]];
    if (usableCell(s, t)) pairs.push([[s2l(s[0]), s2l(s[1]), s2l(s[2])], [s2l(t[0]), s2l(t[1]), s2l(t[2])]]);
  }
  if (pairs.length < MIN_FIT_SAMPLES) return null;

  const M = fitMatrix(pairs);
  if (!M) return null;

  const us = [[], [], []];
  const vs = [[], [], []];
  for (const [s, t] of pairs) {
    const m = applyM(M, s);
    for (let c = 0; c < 3; c++) {
      us[c].push(l2s(Math.max(0, Math.min(1, m[c]))));
      vs[c].push(l2s(t[c]));
    }
  }
  const curves = [0, 1, 2].map((c) => fitCurve(us[c], vs[c]));

  // Residual samples: post-A encoded → target encoded, over ALL cells (the
  // residual LUT is smoothing-regularised, clipped cells included is fine).
  // Weighted perceptually: 1/(Y_target+0.05) so shadow-region residuals — the
  // most visible ones — aren't drowned out by equal-encoded-error highlights.
  const rsamples = [];
  const rweights = [];
  for (let i = 0; i < GW * GH; i++) {
    const s = [decGrid[i * 3], decGrid[i * 3 + 1], decGrid[i * 3 + 2]];
    const t = [camGrid[i * 3], camGrid[i * 3 + 1], camGrid[i * 3 + 2]];
    const m = applyM(M, [s2l(s[0]), s2l(s[1]), s2l(s[2])]);
    const a = [0, 1, 2].map((c) => Math.min(1, Math.max(0, evalCurve(curves[c], l2s(Math.max(0, Math.min(1, m[c])))))));
    rsamples.push([a, t]);
    const Y = 0.2126 * s2l(t[0]) + 0.7152 * s2l(t[1]) + 0.0722 * s2l(t[2]);
    rweights.push(1 / (Y + 0.05));
  }
  const residual = fitResidualLUT(rsamples, RESIDUAL_N, RESIDUAL_LAMBDA, RESIDUAL_ITERS, rweights);

  return {
    M,
    curves: curves.map((c) => Array.from(c)),
    residual: residual.map((r) => Array.from(r)),
    N: RESIDUAL_N,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** EXIF orientation code → degrees for sharp.rotate (only the codes ORFs use). */
function orientationToDegrees(code) {
  if (code === 6) return 90;
  if (code === 8) return 270;
  if (code === 3) return 180;
  return 0;
}

/** Largest embedded JPEG ≥ 200KB (full-size previews; thumbnails are ~10KB). */
function extractLargestPreview(orfBuf) {
  const jpegs = findEmbeddedJpegs(orfBuf);
  let best = null;
  for (const j of jpegs) {
    if (!best || j.length > best.length) best = j;
  }
  return best && best.length >= 200 * 1024 ? orfBuf.subarray(best.offset, best.offset + best.length) : null;
}

/**
 * Fit + apply "camera match" to a decoded RAW. Returns the SAME shape as the
 * decode ({ data, width, height, channels, bitDepth }) — either transformed
 * pixels, or the input untouched when matching isn't possible (fail-open).
 *
 * @param {{data: ArrayBuffer, width: number, height: number, channels: number, bitDepth?: number}} decoded
 * @param {Buffer} orfBuf the original RAW file contents
 * @param {Console} log
 */
async function applyCameraMatch(decoded, orfBuf, log = console) {
  try {
    if (!decoded || decoded.channels !== 3 || decoded.bitDepth !== 16) {
      log.warn('camera-match: unsupported decode shape — skipping');
      return decoded;
    }
    const preview = extractLargestPreview(orfBuf);
    if (!preview) {
      log.warn('camera-match: no usable embedded preview — skipping');
      return decoded;
    }
    const u16 = new Uint16Array(decoded.data);
    const decGrid = decodeToGrid(u16, decoded.width, decoded.height);
    const rotateDeg = decoded.height > decoded.width ? orientationToDegrees(readOrientation(orfBuf)) : 0;
    const camGrid = await previewToGrid(preview, rotateDeg);
    const model = fitTransform(decGrid, camGrid);
    if (!model) {
      log.warn('camera-match: fit not possible (too few usable samples) — skipping');
      return decoded;
    }
    const t0 = Date.now();
    const data = await runApplyWorker(decoded.data, model);
    log.log(`camera-match: fitted and applied in ${Date.now() - t0}ms (${decoded.width}x${decoded.height})`);
    return { ...decoded, data };
  } catch (err) {
    log.warn(`camera-match failed (${err.message}) — using unmatched decode`);
    return decoded;
  }
}

/** Run the full-res apply loop in a worker thread; transfers the buffer both ways. */
function runApplyWorker(dataArrayBuffer, model) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'cameraMatchWorker.cjs'), {
      workerData: { model },
    });
    worker.once('message', (msg) => {
      worker.terminate();
      if (msg && msg.ok) resolve(msg.data);
      else reject(new Error((msg && msg.error) || 'camera-match worker failed'));
    });
    worker.once('error', (err) => {
      worker.terminate();
      reject(err);
    });
    worker.postMessage({ data: dataArrayBuffer }, [dataArrayBuffer]);
  });
}

module.exports = {
  applyCameraMatch,
  // pure internals exported for unit tests
  fitTransform,
  fitMatrix,
  fitCurve,
  evalCurve,
  fitResidualLUT,
  decodeToGrid,
  orientationToDegrees,
  extractLargestPreview,
  GW,
  GH,
};
