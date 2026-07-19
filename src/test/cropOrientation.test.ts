/**
 * 90°-step orientation in Crop & Transform (v1.34.0, user request: the ±1°
 * nudge arrows became 90° rotation buttons). Contracts:
 *  - pixel mapping is exact for 90/180/270 (lossless remap, no resampling)
 *  - 90/270 swap the output dimensions (process AND getOutputDimensions)
 *  - four 90° steps come back to the identity
 *  - orientation participates in the adapter's isNoOp (GPU eligibility gate)
 *  - absent orientation (pre-v1.34 saved edits) behaves as 0
 */
import { CropModule } from '../modules/CropModule';
import { CropPipelineModule } from '../modules/CropPipelineModule';

// 3x2 RGBA image with distinct per-pixel red values:
//   [1 2 3]
//   [4 5 6]
const W = 3;
const H = 2;
function grid(): Float32Array {
  const d = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = i + 1; d[i * 4 + 3] = 1; }
  return d;
}
const reds = (buf: Float32Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf[i]);
  return out;
};

function processWith(orientation: number): { out: Float32Array; ctx: { width: number; height: number; channels: number } } {
  const m = new CropModule();
  m.setParams({ enabled: true, x: 0, y: 0, width: 1, height: 1, orientation });
  const ctx = { width: W, height: H, channels: 4 };
  return { out: m.process(grid(), ctx), ctx };
}

describe('CropModule orientation', () => {
  test('90° CW maps pixels exactly and swaps dims', () => {
    const { out } = processWith(90);
    // CW: [1 2 3] / [4 5 6] → [4 1] / [5 2] / [6 3]  (2 wide, 3 tall)
    expect(reds(out)).toEqual([4, 1, 5, 2, 6, 3]);
  });

  test('180° maps pixels exactly, dims unchanged', () => {
    const { out } = processWith(180);
    expect(reds(out)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test('270° CW (90° CCW) maps pixels exactly', () => {
    const { out } = processWith(270);
    // CCW: → [3 6] / [2 5] / [1 4]
    expect(reds(out)).toEqual([3, 6, 2, 5, 1, 4]);
  });

  test('getOutputDimensions swaps for 90/270, not for 180', () => {
    const m = new CropModule();
    m.setParams({ enabled: true, x: 0, y: 0, width: 1, height: 1, orientation: 90 });
    expect(m.getOutputDimensions(W, H)).toEqual({ width: H, height: W });
    m.setParams({ orientation: 180 });
    expect(m.getOutputDimensions(W, H)).toEqual({ width: W, height: H });
    m.setParams({ orientation: 270 });
    expect(m.getOutputDimensions(W, H)).toEqual({ width: H, height: W });
  });

  test('four 90° steps return the identity', () => {
    const m = new CropModule();
    m.setParams({ enabled: true, x: 0, y: 0, width: 1, height: 1, orientation: 360 });
    expect(m.normalizedOrientation()).toBe(0);
    const ctx = { width: W, height: H, channels: 4 };
    expect(reds(m.process(grid(), ctx))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('absent orientation (older saved edits) behaves as 0', () => {
    const m = new CropModule();
    m.setParams({ enabled: true, x: 0, y: 0, width: 1, height: 1 });
    expect(m.normalizedOrientation()).toBe(0);
  });

  test('adapter isNoOp is FALSE with an orientation set (blocks the GPU path)', () => {
    const adapter = new CropPipelineModule();
    adapter.setCropRegion(0, 0, 1, 1); // full-frame rect
    expect(adapter.isNoOp()).toBe(true);
    adapter.getCropModule().setParams({ orientation: 90 });
    expect(adapter.isNoOp()).toBe(false);
    adapter.getCropModule().setParams({ orientation: 0 });
    expect(adapter.isNoOp()).toBe(true);
  });

  test("the 'original' aspect lock follows the ROTATED frame under 90/270", () => {
    const m = new CropModule();
    m.setOriginalDimensions(3200, 2400);
    m.setParams({ aspectRatio: 'original' });
    expect(m.getAspectRatioValue()).toBeCloseTo(3200 / 2400, 5);
    m.setParams({ orientation: 90 });
    expect(m.getAspectRatioValue()).toBeCloseTo(2400 / 3200, 5);
    m.setParams({ orientation: 180 });
    expect(m.getAspectRatioValue()).toBeCloseTo(3200 / 2400, 5);
    m.setParams({ orientation: 270 });
    expect(m.getAspectRatioValue()).toBeCloseTo(2400 / 3200, 5);
  });

  test('orientation composes with a crop rect (rect applies to the ROTATED frame)', () => {
    const m = new CropModule();
    // 90° CW of 3x2 → 2x3; crop the top half (2x1... height 1/3 → 1 row)
    m.setParams({ enabled: true, x: 0, y: 0, width: 1, height: 1 / 3, orientation: 90 });
    const ctx = { width: W, height: H, channels: 4 };
    const out = m.process(grid(), ctx);
    expect(reds(out)).toEqual([4, 1]); // first row of the rotated frame
    expect(m.getOutputDimensions(W, H)).toEqual({ width: 2, height: 1 });
  });
});
