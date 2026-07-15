// Worker-thread apply loop for the camera-match transform (see cameraMatch.cjs).
//
// Applies { 3x3 linear matrix -> per-channel monotone curve -> residual 3D LUT }
// to a packed 16-bit RGB buffer. Runs here because the ~20MP pixel loop takes
// seconds and must not block the main process. The buffer is transferred in and
// back (zero-copy); the fitted model arrives via workerData (small arrays).
//
// Hot-loop strategy: the per-channel scalar chain u16 -> linear -> matrix ->
// encode -> curve is collapsed ahead of time into lookup tables:
//   - S2L:   65536-entry u16 -> linear float
//   - ENC[c]: 4096-bin table over matrix output m in [0,1] -> curve_c(l2s(m))
// leaving only 3 dot products + 3 table reads + one trilinear residual per pixel.

const { parentPort, workerData } = require('worker_threads');

const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const s2lScalar = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function evalCurve(curve, u) {
  const K = curve.length;
  const t = Math.min(1, Math.max(0, u)) * (K - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(K - 1, i0 + 1);
  return curve[i0] + (curve[i1] - curve[i0]) * (t - i0);
}

const { model } = workerData;
const M = model.M;
const N = model.N;
const residual = model.residual.map((r) => Float64Array.from(r));

// u16 -> linear table
const S2L = new Float64Array(65536);
for (let i = 0; i < 65536; i++) S2L[i] = s2lScalar(i / 65535);

// per-channel: matrix-output (linear, clamped 0..1) -> final encoded (post-curve)
const ENC_BINS = 4096;
const ENC = [new Float64Array(ENC_BINS), new Float64Array(ENC_BINS), new Float64Array(ENC_BINS)];
for (let c = 0; c < 3; c++) {
  const curve = Float64Array.from(model.curves[c]);
  for (let i = 0; i < ENC_BINS; i++) {
    const m = i / (ENC_BINS - 1);
    ENC[c][i] = Math.min(1, Math.max(0, evalCurve(curve, l2s(m))));
  }
}

parentPort.once('message', ({ data }) => {
  try {
    const px = new Uint16Array(data);
    const n = px.length / 3;
    const Nm1 = N - 1;
    const M00 = M[0][0], M01 = M[0][1], M02 = M[0][2];
    const M10 = M[1][0], M11 = M[1][1], M12 = M[1][2];
    const M20 = M[2][0], M21 = M[2][1], M22 = M[2][2];
    const R0 = residual[0], R1 = residual[1], R2 = residual[2];

    for (let p = 0; p < n; p++) {
      const o = p * 3;
      const lr = S2L[px[o]];
      const lg = S2L[px[o + 1]];
      const lb = S2L[px[o + 2]];

      // matrix (linear), clamp to [0,1], then encoded+curve via table
      let mr = M00 * lr + M01 * lg + M02 * lb;
      let mg = M10 * lr + M11 * lg + M12 * lb;
      let mb = M20 * lr + M21 * lg + M22 * lb;
      mr = mr < 0 ? 0 : mr > 1 ? 1 : mr;
      mg = mg < 0 ? 0 : mg > 1 ? 1 : mg;
      mb = mb < 0 ? 0 : mb > 1 ? 1 : mb;
      let er = ENC[0][(mr * (ENC_BINS - 1)) | 0];
      let eg = ENC[1][(mg * (ENC_BINS - 1)) | 0];
      let eb = ENC[2][(mb * (ENC_BINS - 1)) | 0];

      // residual trilinear
      const fr = er * Nm1, fg = eg * Nm1, fb = eb * Nm1;
      let r0 = fr | 0; if (r0 >= Nm1) r0 = Nm1 - 1;
      let g0 = fg | 0; if (g0 >= Nm1) g0 = Nm1 - 1;
      let b0 = fb | 0; if (b0 >= Nm1) b0 = Nm1 - 1;
      const dr = fr - r0, dg = fg - g0, db = fb - b0;
      const i000 = (r0 * N + g0) * N + b0;
      const i001 = i000 + 1;
      const i010 = i000 + N;
      const i011 = i010 + 1;
      const i100 = i000 + N * N;
      const i101 = i100 + 1;
      const i110 = i100 + N;
      const i111 = i110 + 1;
      const w000 = (1 - dr) * (1 - dg) * (1 - db);
      const w001 = (1 - dr) * (1 - dg) * db;
      const w010 = (1 - dr) * dg * (1 - db);
      const w011 = (1 - dr) * dg * db;
      const w100 = dr * (1 - dg) * (1 - db);
      const w101 = dr * (1 - dg) * db;
      const w110 = dr * dg * (1 - db);
      const w111 = dr * dg * db;

      er += w000 * R0[i000] + w001 * R0[i001] + w010 * R0[i010] + w011 * R0[i011] +
            w100 * R0[i100] + w101 * R0[i101] + w110 * R0[i110] + w111 * R0[i111];
      eg += w000 * R1[i000] + w001 * R1[i001] + w010 * R1[i010] + w011 * R1[i011] +
            w100 * R1[i100] + w101 * R1[i101] + w110 * R1[i110] + w111 * R1[i111];
      eb += w000 * R2[i000] + w001 * R2[i001] + w010 * R2[i010] + w011 * R2[i011] +
            w100 * R2[i100] + w101 * R2[i101] + w110 * R2[i110] + w111 * R2[i111];

      px[o] = (er < 0 ? 0 : er > 1 ? 1 : er) * 65535 + 0.5 | 0;
      px[o + 1] = (eg < 0 ? 0 : eg > 1 ? 1 : eg) * 65535 + 0.5 | 0;
      px[o + 2] = (eb < 0 ? 0 : eb > 1 ? 1 : eb) * 65535 + 0.5 | 0;
    }

    parentPort.postMessage({ ok: true, data }, [data]);
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
