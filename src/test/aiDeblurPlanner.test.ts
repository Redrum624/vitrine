/**
 * Contract tests for the AI motion-deblur tile planner + the HARD 384px input floor
 * (electron/aiDeblur.cjs). Imported via require so ts-jest treats it as CommonJS. Requiring the
 * module loads only `path`+`fs` (onnxruntime-node is required lazily inside ensureSession, which the
 * sub-floor reject path never reaches), so these run in jsdom without the native runtime.
 *
 * The floor is LOAD-BEARING, not defensive: below 384px NAFNet-GoPro's TLC window is invalid — CPU
 * throws, DirectML silently returns garbage (spike Gate 2). The planner must therefore never emit a
 * sub-384 tile, and whole images below 384 on either axis must be declined before any inference.
 */
const mod = require('../../electron/aiDeblur.cjs') as {
  planTiles: (w: number, h: number, pad?: number, tile?: number) => Array<{ sx: number; sy: number }>;
  deblur: (rgba: Uint8Array, w: number, h: number, onProgress?: unknown) => Promise<unknown>;
  tileConfigFor: (backend: string | null) => { tile: number; pad: number };
  tileOutputSane: (od: Float32Array) => boolean;
  TILE_SANE_LO: number;
  TILE_SANE_HI: number;
  accumulateTile: (
    accum: Float32Array, wsum: Float32Array, od: Float32Array,
    tile: number, band: number, baseX: number, baseY: number, Wt: number, Ht: number,
  ) => void;
  MODEL_TILE: number;
  MIN_INPUT: number;
  PAD: number;
  DML_MODEL_TILE: number;
  DML_PAD: number;
};

describe('aiDeblur — 384px floor + tile planner', () => {
  it('MIN_INPUT is 384 and the fixed tile size satisfies it (no planner can emit a sub-floor tile)', () => {
    expect(mod.MIN_INPUT).toBe(384);
    // The load-bearing invariant: every emitted tile is exactly MODEL_TILE px, so MODEL_TILE >= 384
    // guarantees the planner NEVER produces an input NAFNet would garble.
    expect(mod.MODEL_TILE).toBeGreaterThanOrEqual(mod.MIN_INPUT);
  });

  it('planTiles covers a range of image sizes; every emitted tile is a full MODEL_TILE window (>= 384)', () => {
    for (const [w, h] of [[384, 384], [500, 700], [768, 768], [2000, 1500], [6000, 4000]] as const) {
      const tiles = mod.planTiles(w, h);
      expect(tiles.length).toBeGreaterThanOrEqual(1);
      // Each tile's input window is MODEL_TILE x MODEL_TILE (reflect-padded at borders); the planner
      // returns only start coordinates, so the effective per-tile input dimension is the constant
      // MODEL_TILE — asserted >= MIN_INPUT here so a future tile-size change can't slip below 384.
      expect(mod.MODEL_TILE).toBeGreaterThanOrEqual(384);
    }
  });

  it('a 384px image plans exactly one centered tile; a 2000px image plans a multi-tile grid', () => {
    expect(mod.planTiles(384, 384)).toHaveLength(1);
    expect(mod.planTiles(2000, 2000).length).toBeGreaterThan(1);
  });

  it('deblur() DECLINES a sub-384 image with a clear notice and NEVER reaches inference (no IPC)', async () => {
    // 200x200 — both axes below the floor.
    await expect(mod.deblur(new Uint8Array(200 * 200 * 4), 200, 200)).rejects.toThrow(/384/);
    // 383 on one axis is still below the floor (strict >= 384).
    await expect(mod.deblur(new Uint8Array(383 * 500 * 4), 383, 500)).rejects.toThrow(/384/);
    await expect(mod.deblur(new Uint8Array(500 * 383 * 4), 500, 383)).rejects.toThrow(/384/);
  });
});

// W4 seam fix (2026-07-20): NAFNet's receptive field is effectively unbounded, so independent
// 768px windows with a 40px feather deconvolve long motion streaks DIFFERENTLY on each side of a
// window boundary — double-edge ghost seams on a 768 grid. On DirectML (the only backend the
// feature is offered on — the model is dynamic-shape) the windows are raised to 1536px with a
// 128px feather: far larger agreement zones, similar total time (~4x pixels/tile, ~1/4 the tiles).
describe('aiDeblur — DirectML tile config (W4 seam fix)', () => {
  it('DirectML runs 1536px windows with a 128px feather; any non-DML path keeps 768/40', () => {
    expect(mod.tileConfigFor('directml')).toEqual({ tile: 1536, pad: 128 });
    expect(mod.tileConfigFor('cpu')).toEqual({ tile: 768, pad: 40 });
    expect(mod.tileConfigFor(null)).toEqual({ tile: 768, pad: 40 });
    expect(mod.DML_MODEL_TILE).toBe(1536);
    expect(mod.DML_PAD).toBe(128);
  });

  it('both tile configs satisfy the 384 floor and a positive tiling step (tile > 2*pad)', () => {
    for (const backend of ['directml', 'cpu', null]) {
      const { tile, pad } = mod.tileConfigFor(backend as string | null);
      expect(tile).toBeGreaterThanOrEqual(mod.MIN_INPUT);
      expect(tile).toBeGreaterThan(2 * pad);
    }
  });

  it('the DML plan at 20MP is ~20 tiles (vs 30 with 768/40) and still covers every pixel', () => {
    const W = 5472, H = 3648; // 20 MP
    const dml = mod.tileConfigFor('directml');
    const tiles = mod.planTiles(W, H, dml.pad, dml.tile);
    expect(tiles.length).toBeLessThanOrEqual(24);
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    // Full coverage: every output pixel falls inside at least one tile window.
    const coveredX = new Uint8Array(W);
    const coveredY = new Uint8Array(H);
    for (const t of tiles) {
      for (let x = Math.max(0, t.sx); x < Math.min(W, t.sx + dml.tile); x++) coveredX[x] = 1;
      for (let y = Math.max(0, t.sy); y < Math.min(H, t.sy + dml.tile); y++) coveredY[y] = 1;
    }
    expect(coveredX.every((v) => v === 1)).toBe(true);
    expect(coveredY.every((v) => v === 1)).toBe(true);
  });

  // W4 live probe (2026-07-20, P9190023.JPG on DirectML): NAFNet DETERMINISTICALLY emits garbage
  // on some valid-size windows — bright/high-contrast content blew activations up to ±28.75 while
  // every healthy tile stayed within [-0.13 .. 0.94] (a 0..1-input model). The garbage rendered as
  // full-saturation checkerboard blobs — the user's "breaks the photo". Re-runs reproduce the same
  // values (not a transient DML glitch), so the runner's only safe move is a per-tile tripwire:
  // out-of-range output ⇒ keep the INPUT window (no deblur locally) instead of compositing acid.
  it('tileOutputSane accepts healthy ranges and rejects the live-probed garbage ranges', () => {
    expect(mod.TILE_SANE_LO).toBeLessThan(0);
    expect(mod.TILE_SANE_HI).toBeGreaterThan(1);
    // Healthy live ranges pass.
    expect(mod.tileOutputSane(Float32Array.from([-0.128, 0.0, 0.5, 0.94]))).toBe(true);
    // The three live garbage tiles fail (max magnitude 3.9 / 14.0 / 28.75).
    expect(mod.tileOutputSane(Float32Array.from([0.2, 3.91, 0.4]))).toBe(false);
    expect(mod.tileOutputSane(Float32Array.from([-9.86, 0.1, 14.013]))).toBe(false);
    expect(mod.tileOutputSane(Float32Array.from([-19.013, 28.75]))).toBe(false);
    // Non-finite output is never sane.
    expect(mod.tileOutputSane(Float32Array.from([0.5, NaN]))).toBe(false);
  });

  it('feathered accumulation is size-agnostic: constant tiles composite to a constant frame (wsum > 0 everywhere, no seams)', () => {
    // Simulate the real accumulation with the REAL helper at the NEW tile/pad on a frame that
    // exercises interior seams on both axes, then normalize exactly like deblur() does. A constant
    // model output must reproduce a constant frame — any wsum hole or feather mismatch would show
    // as a deviation at the window boundaries.
    const W = 2000, H = 1700;
    const { tile, pad } = mod.tileConfigFor('directml');
    const band = pad; // OUT_SCALE is 1
    const accum = new Float32Array(W * H * 3);
    const wsum = new Float32Array(W * H);
    const od = new Float32Array(3 * tile * tile).fill(0.5);
    for (const t of mod.planTiles(W, H, pad, tile)) {
      mod.accumulateTile(accum, wsum, od, tile, band, t.sx, t.sy, W, H);
    }
    let minW = Infinity;
    let maxDev = 0;
    for (let i = 0; i < W * H; i++) {
      if (wsum[i] < minW) minW = wsum[i];
      const w = wsum[i] || 1;
      for (let c = 0; c < 3; c++) maxDev = Math.max(maxDev, Math.abs(accum[i * 3 + c] / w - 0.5));
    }
    expect(minW).toBeGreaterThan(0);
    expect(maxDev).toBeLessThan(1e-6);
  });
});
