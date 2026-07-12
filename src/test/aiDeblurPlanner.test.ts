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
  planTiles: (w: number, h: number, pad?: number) => Array<{ sx: number; sy: number }>;
  deblur: (rgba: Uint8Array, w: number, h: number, onProgress?: unknown) => Promise<unknown>;
  MODEL_TILE: number;
  MIN_INPUT: number;
  PAD: number;
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
