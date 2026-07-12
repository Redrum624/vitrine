import {
  planTiles,
  blendWeight,
  axisStartsForTest,
  MODEL_TILE,
  MODEL_SCALE,
  MODEL_TILE_OUT,
} from '../utils/tilePlan';

// The bundled Real-ESRGAN x4plus ONNX has a FIXED 128x128 -> 512x512 (x4) input (Task 1 spike).
// tilePlan therefore emits fixed 128x128 source windows that overlap by 2*pad for seam blending.

describe('model constants', () => {
  it('match the validated ONNX I/O contract', () => {
    expect(MODEL_TILE).toBe(128);
    expect(MODEL_SCALE).toBe(4);
    expect(MODEL_TILE_OUT).toBe(512);
  });
});

describe('planTiles', () => {
  it('returns a single centered window when the image fits in one model tile', () => {
    const t = planTiles(100, 80, 16);
    expect(t.length).toBe(1);
    // window centered so the image sits inside the 128x128 input (reflect-padded by the caller)
    expect(t[0]).toEqual({ sx: Math.floor((100 - 128) / 2), sy: Math.floor((80 - 128) / 2) });
    expect(t[0].sx).toBeLessThanOrEqual(0);
    expect(t[0].sy).toBeLessThanOrEqual(0);
  });

  it('exact 128 image is a single window at origin', () => {
    const t = planTiles(128, 128, 16);
    expect(t).toEqual([{ sx: 0, sy: 0 }]);
  });

  it('steps by (MODEL_TILE - 2*pad) and stays flush to the far edge', () => {
    const pad = 16;
    const step = MODEL_TILE - 2 * pad; // 96
    const xs = axisStartsForTest(1100, pad);
    // first window starts pad before the origin (left context)
    expect(xs[0]).toBe(-pad);
    // interior windows advance by exactly `step`
    expect(xs[1] - xs[0]).toBe(step);
    // last window is flush so its right edge reaches the image edge (+pad context)
    expect(xs[xs.length - 1]).toBe(1100 - MODEL_TILE + pad);
  });

  it('produces a full 2D grid (xCount * yCount windows)', () => {
    const tiles = planTiles(1100, 700, 16);
    const xs = axisStartsForTest(1100, 16);
    const ys = axisStartsForTest(700, 16);
    expect(tiles.length).toBe(xs.length * ys.length);
  });

  it('covers EVERY output pixel with total blend weight > 0 (no seams/holes)', () => {
    // Small image so the simulation is cheap but exercises multiple tiles + all four edges.
    const W = 200, H = 150, pad = 16;
    const tiles = planTiles(W, H, pad);
    expect(tiles.length).toBeGreaterThan(1);
    const W4 = W * MODEL_SCALE, H4 = H * MODEL_SCALE;
    const wsum = new Float64Array(W4 * H4);
    for (const t of tiles) {
      const baseX = t.sx * MODEL_SCALE, baseY = t.sy * MODEL_SCALE;
      for (let ly = 0; ly < MODEL_TILE_OUT; ly++) {
        const Y = baseY + ly;
        if (Y < 0 || Y >= H4) continue;
        for (let lx = 0; lx < MODEL_TILE_OUT; lx++) {
          const X = baseX + lx;
          if (X < 0 || X >= W4) continue;
          wsum[Y * W4 + X] += blendWeight(lx, ly, pad);
        }
      }
    }
    let minW = Infinity;
    for (let i = 0; i < wsum.length; i++) if (wsum[i] < minW) minW = wsum[i];
    expect(minW).toBeGreaterThan(0); // every real output pixel is covered
  });
});

describe('blendWeight', () => {
  it('is 1 at the tile centre', () => {
    expect(blendWeight(MODEL_TILE_OUT / 2, MODEL_TILE_OUT / 2, 16)).toBeCloseTo(1, 5);
  });

  it('ramps below 1 inside the feather band near an edge', () => {
    expect(blendWeight(1, MODEL_TILE_OUT / 2, 16)).toBeLessThan(1);
    expect(blendWeight(MODEL_TILE_OUT / 2, 1, 16)).toBeLessThan(1);
  });

  it('is symmetric and separable', () => {
    const a = blendWeight(10, 300, 16);
    const b = blendWeight(MODEL_TILE_OUT - 1 - 10, 300, 16);
    expect(a).toBeCloseTo(b, 6);
  });

  it('stays within [0,1] everywhere along an edge scan', () => {
    for (let p = 0; p < MODEL_TILE_OUT; p++) {
      const w = blendWeight(p, MODEL_TILE_OUT / 2, 16);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('pad=0 disables feathering (weight 1 everywhere)', () => {
    expect(blendWeight(0, 0, 0)).toBe(1);
    expect(blendWeight(255, 7, 0)).toBe(1);
  });
});
