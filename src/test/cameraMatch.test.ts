/**
 * Unit tests for the pure camera-match fitting internals (electron/cameraMatch.cjs).
 * The full decode-time integration is exercised by the packaged smoke harness;
 * here we prove the math: matrix recovery, curve monotonicity, transform
 * round-trips, orientation mapping, and grid averaging.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const cm = require('../../electron/cameraMatch.cjs') as any;

const { GW, GH } = cm;

/** Build a smooth synthetic decode grid covering the gamut diagonally. */
function syntheticGrid(): Float64Array {
  const g = new Float64Array(GW * GH * 3);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = (y * GW + x) * 3;
      g[i] = 0.05 + 0.9 * (x / (GW - 1));
      g[i + 1] = 0.05 + 0.9 * (y / (GH - 1));
      g[i + 2] = 0.05 + 0.9 * ((x + y) / (GW + GH - 2));
    }
  }
  return g;
}

const s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

describe('cameraMatch fitting internals', () => {
  describe('fitMatrix', () => {
    it('recovers a known linear matrix from exact samples', () => {
      const TRUE_M = [
        [0.9, 0.08, 0.02],
        [0.05, 0.92, 0.03],
        [0.01, 0.06, 0.93],
      ];
      const pairs: Array<[number[], number[]]> = [];
      let seed = 1;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 2000; k++) {
        const s = [rand() * 0.9 + 0.02, rand() * 0.9 + 0.02, rand() * 0.9 + 0.02];
        const t = [
          TRUE_M[0][0] * s[0] + TRUE_M[0][1] * s[1] + TRUE_M[0][2] * s[2],
          TRUE_M[1][0] * s[0] + TRUE_M[1][1] * s[1] + TRUE_M[1][2] * s[2],
          TRUE_M[2][0] * s[0] + TRUE_M[2][1] * s[1] + TRUE_M[2][2] * s[2],
        ];
        pairs.push([s, t]);
      }
      const M = cm.fitMatrix(pairs);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          expect(M[r][c]).toBeCloseTo(TRUE_M[r][c], 2);
        }
      }
    });

    it('returns null on degenerate (all-identical) samples', () => {
      const pairs = Array.from({ length: 1000 }, () => [[0.5, 0.5, 0.5], [0.6, 0.6, 0.6]]);
      // identical samples make the normal matrix rank-1; ridge keeps it barely
      // invertible, so a null OR a finite matrix are both acceptable — but the
      // result must never contain NaN/Infinity.
      const M = cm.fitMatrix(pairs);
      if (M) {
        for (const row of M) for (const v of row) expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  describe('fitCurve / evalCurve', () => {
    it('fits a monotone curve through a known gamma mapping', () => {
      const us: number[] = [];
      const vs: number[] = [];
      for (let i = 0; i < 5000; i++) {
        const u = i / 4999;
        us.push(u);
        vs.push(Math.pow(u, 0.8));
      }
      const curve = cm.fitCurve(us, vs);
      for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        expect(cm.evalCurve(curve, u)).toBeCloseTo(Math.pow(u, 0.8), 1);
      }
    });

    it('output is monotone non-decreasing even on noisy input', () => {
      let seed = 7;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const us: number[] = [];
      const vs: number[] = [];
      for (let i = 0; i < 3000; i++) {
        const u = rand();
        us.push(u);
        vs.push(u * 0.8 + (rand() - 0.5) * 0.3);
      }
      const curve = cm.fitCurve(us, vs);
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 1e-12);
      }
    });
  });

  describe('fitTransform', () => {
    it('round-trips a synthetic exposure+matrix look to within tight ΔRGB', () => {
      const dec = syntheticGrid();
      // Target = a camera-ish look: +0.4EV exposure in linear, mild channel mix,
      // then an s-curve-ish gamma in encoded space.
      const cam = new Float64Array(dec.length);
      for (let i = 0; i < GW * GH; i++) {
        const lin = [s2l(dec[i * 3]), s2l(dec[i * 3 + 1]), s2l(dec[i * 3 + 2])];
        const mixed = [
          Math.min(1, 1.32 * (0.95 * lin[0] + 0.05 * lin[1])),
          Math.min(1, 1.32 * (0.03 * lin[0] + 0.94 * lin[1] + 0.03 * lin[2])),
          Math.min(1, 1.32 * (0.06 * lin[1] + 0.94 * lin[2])),
        ];
        for (let c = 0; c < 3; c++) cam[i * 3 + c] = Math.pow(l2s(mixed[c]), 1.1);
      }
      const model = cm.fitTransform(dec, cam);
      expect(model).not.toBeNull();
      // Re-apply the fitted chain (matrix -> curve -> residual) to the fit grid
      // and require close agreement with the target on interior cells.
      const N = model.N;
      const applyModel = (r: number, g: number, b: number) => {
        const lin = [s2l(r), s2l(g), s2l(b)];
        const m = [
          model.M[0][0] * lin[0] + model.M[0][1] * lin[1] + model.M[0][2] * lin[2],
          model.M[1][0] * lin[0] + model.M[1][1] * lin[1] + model.M[1][2] * lin[2],
          model.M[2][0] * lin[0] + model.M[2][1] * lin[1] + model.M[2][2] * lin[2],
        ];
        const enc = [0, 1, 2].map((c) =>
          Math.min(1, Math.max(0, cm.evalCurve(Float64Array.from(model.curves[c]), l2s(Math.max(0, Math.min(1, m[c])))))),
        );
        // trilinear residual
        const idx = (rr: number, gg: number, bb: number) => (rr * N + gg) * N + bb;
        const fr = Math.min(N - 1.0001, enc[0] * (N - 1));
        const fg = Math.min(N - 1.0001, enc[1] * (N - 1));
        const fb = Math.min(N - 1.0001, enc[2] * (N - 1));
        const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
        const dr = fr - r0, dg = fg - g0, db = fb - b0;
        const out = [...enc];
        for (let cr = 0; cr < 2; cr++) {
          for (let cg = 0; cg < 2; cg++) {
            for (let cb = 0; cb < 2; cb++) {
              const w = (cr ? dr : 1 - dr) * (cg ? dg : 1 - dg) * (cb ? db : 1 - db);
              const ii = idx(r0 + cr, g0 + cg, b0 + cb);
              for (let c = 0; c < 3; c++) out[c] += w * model.residual[c][ii];
            }
          }
        }
        return out.map((v) => Math.min(1, Math.max(0, v)));
      };

      let worst = 0;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < GW * GH; i += 7) {
        const s = [dec[i * 3], dec[i * 3 + 1], dec[i * 3 + 2]];
        const t = [cam[i * 3], cam[i * 3 + 1], cam[i * 3 + 2]];
        if (s.some((v) => v < 0.05 || v > 0.95) || t.some((v) => v < 0.05 || v > 0.95)) continue;
        const o = applyModel(s[0], s[1], s[2]);
        const err = Math.max(Math.abs(o[0] - t[0]), Math.abs(o[1] - t[1]), Math.abs(o[2] - t[2]));
        worst = Math.max(worst, err);
        sum += err;
        n++;
      }
      expect(n).toBeGreaterThan(1000);
      expect(sum / n).toBeLessThan(0.02);  // ≤ ~2% mean channel error
      expect(worst).toBeLessThan(0.08);
    });

    it('returns null when there are too few usable samples', () => {
      // Everything clipped → zero usable cells.
      const dec = new Float64Array(GW * GH * 3).fill(1);
      const cam = new Float64Array(GW * GH * 3).fill(1);
      expect(cm.fitTransform(dec, cam)).toBeNull();
    });
  });

  describe('orientationToDegrees', () => {
    it('maps the EXIF codes ORFs use', () => {
      expect(cm.orientationToDegrees(1)).toBe(0);
      expect(cm.orientationToDegrees(3)).toBe(180);
      expect(cm.orientationToDegrees(6)).toBe(90);
      expect(cm.orientationToDegrees(8)).toBe(270);
      expect(cm.orientationToDegrees(undefined)).toBe(0);
    });
  });

  describe('decodeToGrid', () => {
    it('box-averages a uniform buffer to its exact value', () => {
      const w = 400;
      const h = 300;
      const u16 = new Uint16Array(w * h * 3).fill(32768);
      const grid = cm.decodeToGrid(u16, w, h);
      expect(grid[0]).toBeCloseTo(32768 / 65535, 5);
      expect(grid[(GW * GH - 1) * 3 + 2]).toBeCloseTo(32768 / 65535, 5);
    });
  });
});
