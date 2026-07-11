/**
 * The AdjustmentPanel module-preview path used to shrink with a nearest-neighbour
 * "every Nth pixel" sampler, which aliases high-frequency content. boxDownsampleRGBA
 * replaces it with an area-averaged box downsample. The load-bearing proof: a black/white
 * checkerboard shrunk 2× collapses to mid-grey (0.5) — nearest-neighbour would yield a
 * pattern of pure 0.0 / 1.0 pixels instead.
 */
import { boxDownsampleRGBA } from '../utils/imageDownsample';

/** RGBA checkerboard where pixel (x,y) = (x+y)%2, every channel equal, alpha = 1. */
function checkerboard(w: number, h: number, channels: number): Float32Array {
  const data = new Float32Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (x + y) % 2; // 0 or 1
      const i = (y * w + x) * channels;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      if (channels === 4) data[i + 3] = 1;
    }
  }
  return data;
}

describe('boxDownsampleRGBA — area-averaged downsampling', () => {
  it('collapses a 2× checkerboard to mid-grey (0.5) — nearest-neighbour would give 0/1', () => {
    const src = checkerboard(4, 4, 4);
    const out = boxDownsampleRGBA(src, 4, 4, 2, 2, 4);

    expect(out.length).toBe(2 * 2 * 4);
    // Every destination pixel averages a 2×2 block = two black + two white = 0.5.
    for (let p = 0; p < 4; p++) {
      expect(out[p * 4]).toBeCloseTo(0.5, 6);
      expect(out[p * 4 + 1]).toBeCloseTo(0.5, 6);
      expect(out[p * 4 + 2]).toBeCloseTo(0.5, 6);
      expect(out[p * 4 + 3]).toBeCloseTo(1, 6); // alpha averaged (all 1)
    }
  });

  it('nearest-neighbour reference (what the old code did) would NOT average', () => {
    // Sanity anchor: dropping to a single source pixel per cell yields a pure 0 or 1,
    // proving the box result (0.5 above) is genuinely an average, not a coincidence.
    const src = checkerboard(4, 4, 4);
    const scaleX = 4 / 2;
    const scaleY = 4 / 2;
    const nn: number[] = [];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const sx = Math.floor(x * scaleX);
        const sy = Math.floor(y * scaleY);
        nn.push(src[(sy * 4 + sx) * 4]);
      }
    }
    // Old sampler: pure 0/1, never 0.5.
    nn.forEach(v => expect(v === 0 || v === 1).toBe(true));
  });

  it('averages a 2×2 block of distinct values to their mean', () => {
    // Single 2×2 → 1×1: R values 0, 0.2, 0.4, 0.6 average to 0.3.
    const src = new Float32Array([
      0.0, 0, 0, 1, 0.2, 0, 0, 1,
      0.4, 0, 0, 1, 0.6, 0, 0, 1,
    ]);
    const out = boxDownsampleRGBA(src, 2, 2, 1, 1, 4);
    expect(out[0]).toBeCloseTo(0.3, 6);
  });

  it('promotes a 3-channel (RGB) source to RGBA with alpha 1', () => {
    // 2×2 RGB solid mid-grey → 1×1, alpha filled to 1.
    const src = new Float32Array([
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    ]);
    const out = boxDownsampleRGBA(src, 2, 2, 1, 1, 3);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[3]).toBeCloseTo(1, 6);
  });

  it('leaves a solid colour unchanged after downsampling', () => {
    const w = 8;
    const h = 6;
    const src = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      src[i * 4] = 0.7; src[i * 4 + 1] = 0.3; src[i * 4 + 2] = 0.1; src[i * 4 + 3] = 1;
    }
    const out = boxDownsampleRGBA(src, w, h, 4, 3, 4);
    for (let p = 0; p < 4 * 3; p++) {
      expect(out[p * 4]).toBeCloseTo(0.7, 6);
      expect(out[p * 4 + 1]).toBeCloseTo(0.3, 6);
      expect(out[p * 4 + 2]).toBeCloseTo(0.1, 6);
    }
  });
});
