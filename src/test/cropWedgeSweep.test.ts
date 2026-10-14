/**
 * @jest-environment node
 */
/**
 * v1.40.0 Task 9a — "at a given rectified angle, the canvas shouldn't bleed
 * through". For ANY straighten angle, however the crop params got there, the
 * rendered crop must never contain fill pixels.
 *
 * Contracts under test:
 *  - the auto (inscribed) rect for every angle 0.1-45 deg x sizes x
 *    orientations x flips passes the pixel predicate (isPixelRectWedgeFree),
 *    and process() on a constant 0.5 image with fill 0 never emits a fill pixel
 *  - the owner's restored rect (which overshoots the rotated source by ~53px
 *    at native res) renders with 0 fill pixels at 1280 and 5200 widths — the
 *    render-time backstop (clampRectWedgeFree at the actual processing dims)
 *  - getOutputDimensions() == process() output dims for 500 random params
 *  - scale of the inscribed rect = cos + sin * max(W/H, H/W)
 */
jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { CropModule, CropParams } from '../modules/CropModule';
import {
  computeCropGeometry,
  isPixelRectWedgeFree,
  autoCropRectForRotation,
  clampRectWedgeFree,
  inscribedScale,
} from '../modules/cropGeometry';

const SIZES: Array<[number, number]> = [[5200, 3904], [3904, 5200], [1153, 867]];
const ORIENTATIONS = [0, 90, 180, 270];
const FLIPS: Array<[boolean, boolean]> = [[false, false], [true, false], [false, true], [true, true]];

function angles(): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 450; i++) out.push(Math.round(i) / 10); // 0.1 .. 45.0
  return out;
}

function baseParams(over: Partial<CropParams> = {}): CropParams {
  const m = new CropModule();
  return { ...m.getParams(), enabled: true, fillColor: [0, 0, 0, 1], ...over } as CropParams;
}

function constantImage(w: number, h: number, channels = 3, v = 0.5): Float32Array {
  return new Float32Array(w * h * channels).fill(v);
}

function renderMin(params: CropParams, w: number, h: number, channels = 3): { min: number; w: number; h: number; len: number } {
  const m = new CropModule();
  m.setParams(params);
  const out = m.process(constantImage(w, h, channels), { width: w, height: h, channels });
  let min = Infinity;
  for (let i = 0; i < out.length; i++) if (out[i] < min) min = out[i];
  const dims = m.getOutputDimensions(w, h);
  return { min, w: dims.width, h: dims.height, len: out.length };
}

describe('inscribed scale', () => {
  test('5 deg on 5200x3904 == cos + sin * (5200/3904)', () => {
    const r = 5 * Math.PI / 180;
    expect(inscribedScale(5200, 3904, 5)).toBeCloseTo(Math.cos(r) + Math.sin(r) * (5200 / 3904), 12);
    // Orientation-agnostic: the long/short ratio is what matters.
    expect(inscribedScale(3904, 5200, 5)).toBeCloseTo(Math.cos(r) + Math.sin(r) * (5200 / 3904), 12);
    expect(inscribedScale(5200, 3904, -5)).toBeCloseTo(Math.cos(r) + Math.sin(r) * (5200 / 3904), 12);
  });

  test('auto rect at 5 deg on 5200x3904 spans ~5200/scale source pixels', () => {
    const rect = autoCropRectForRotation(5200, 3904, 5);
    const geom = computeCropGeometry(baseParams({ angle: 5, ...rect }), 5200, 3904);
    const s = inscribedScale(5200, 3904, 5);
    expect(Math.abs(geom.outW - 5200 / s)).toBeLessThanOrEqual(4);
    expect(Math.abs(geom.outH - 3904 / s)).toBeLessThanOrEqual(4);
  });
});

describe('auto rect sweep — every angle x size x orientation x flips is wedge-free', () => {
  test('pixel predicate holds for 0.1-45 deg (geometry, all combos)', () => {
    const failures: string[] = [];
    for (const [w, h] of SIZES) {
      for (const orientation of ORIENTATIONS) {
        const swapped = orientation === 90 || orientation === 270;
        const frameW = swapped ? h : w;
        const frameH = swapped ? w : h;
        for (const [flipHorizontal, flipVertical] of FLIPS) {
          for (const sign of [1, -1]) {
            for (const a of angles()) {
              const angle = sign * a;
              const rect = autoCropRectForRotation(frameW, frameH, angle);
              const geom = computeCropGeometry(
                baseParams({ angle, orientation, flipHorizontal, flipVertical, ...rect }), w, h,
              );
              if (!isPixelRectWedgeFree(geom)) failures.push(`${w}x${h} o${orientation} f${+flipHorizontal}${+flipVertical} ${angle}`);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  test('CropModule.calculateAutoCropForRotation (the module seam) is wedge-free too', () => {
    const m = new CropModule();
    const failures: string[] = [];
    for (const [w, h] of SIZES) {
      for (const a of angles()) {
        const rect = m.calculateAutoCropForRotation(w, h, a);
        const geom = computeCropGeometry(baseParams({ angle: a, ...rect }), w, h);
        if (!isPixelRectWedgeFree(geom)) failures.push(`${w}x${h} ${a}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  test('process() emits 0 fill pixels on 1153x867 across angles x orientations x flips', () => {
    const [w, h] = [1153, 867];
    // Flips never change geometry (the predicate sweep above covers all four);
    // two combos keep this real-pixel pass affordable under ts-jest.
    const sample = [0.1, 0.83659, 45];
    for (const orientation of ORIENTATIONS) {
      const swapped = orientation === 90 || orientation === 270;
      for (const [flipHorizontal, flipVertical] of [FLIPS[0], FLIPS[3]]) {
        for (const angle of sample) {
          const rect = autoCropRectForRotation(swapped ? h : w, swapped ? w : h, angle);
          const p = baseParams({ angle, orientation, flipHorizontal, flipVertical, resampleMethod: 'nearest', ...rect });
          const r = renderMin(p, w, h);
          if (!(r.min > 0.49)) throw new Error(`fill at o${orientation} f${+flipHorizontal}${+flipVertical} ${angle}deg (min ${r.min})`);
        }
      }
    }
  });

  // Bicubic runs ~100x slower under ts-jest than in the app bundle, so it gets a
  // small frame; the fill predicate is method-independent.
  test('bicubic and bilinear also emit 0 fill pixels (auto rect)', () => {
    for (const [resampleMethod, w, h] of [['bicubic', 240, 181], ['bilinear', 1153, 867]] as const) {
      for (const angle of [0.1, 3, -7.5, 45]) {
        const rect = autoCropRectForRotation(w, h, angle);
        const r = renderMin(baseParams({ angle, resampleMethod, ...rect }), w, h);
        expect(r.min).toBeGreaterThan(0.49);
      }
    }
  });
});

describe("owner's restored rect (x .08855 y .02023 w .91145 h .90364, angle .83659)", () => {
  const owner = { x: 0.08855, y: 0.02023, width: 0.91145, height: 0.90364, angle: 0.83659 };

  test('raw rect is NOT wedge-free at native res (the reported bleed)', () => {
    const geom = computeCropGeometry(baseParams(owner), 5200, 3904);
    expect(isPixelRectWedgeFree(geom)).toBe(false);
  });

  test('renders with 0 fill pixels at 1280 width', () => {
    const r = renderMin(baseParams({ ...owner, resampleMethod: 'bilinear' }), 1280, 961);
    expect(r.min).toBeGreaterThan(0.49);
    expect(r.len).toBe(r.w * r.h * 3);
  });

  test('renders with 0 fill pixels at 5200 width', () => {
    const r = renderMin(baseParams({ ...owner, resampleMethod: 'nearest' }), 5200, 3904);
    expect(r.min).toBeGreaterThan(0.49);
    expect(r.len).toBe(r.w * r.h * 3);
  });

  test('clamp keeps the rect centre and only shrinks it', () => {
    const rect = { x: owner.x, y: owner.y, width: owner.width, height: owner.height };
    const c = clampRectWedgeFree(rect, 5200, 3904, baseParams({ angle: owner.angle }), 'center');
    expect(c.width).toBeLessThan(rect.width);
    expect(c.height).toBeLessThan(rect.height);
    expect(c.x + c.width / 2).toBeCloseTo(rect.x + rect.width / 2, 9);
    expect(c.y + c.height / 2).toBeCloseTo(rect.y + rect.height / 2, 9);
    expect(c.width / c.height).toBeCloseTo(rect.width / rect.height, 9);
    expect(isPixelRectWedgeFree(computeCropGeometry(baseParams({ angle: owner.angle, ...c }), 5200, 3904))).toBe(true);
  });
});

describe('getOutputDimensions == process() output dims', () => {
  test('500 random params', () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 0x9a9a;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const methods = ['nearest', 'bilinear'] as const;
    for (let i = 0; i < 500; i++) {
      const w = 8 + Math.floor(rnd() * 90);
      const h = 8 + Math.floor(rnd() * 90);
      const width = 0.01 + rnd() * 0.99;
      const height = 0.01 + rnd() * 0.99;
      const params = baseParams({
        x: rnd() * (1 - width), y: rnd() * (1 - height), width, height,
        angle: rnd() < 0.2 ? 0 : (rnd() * 90 - 45),
        orientation: ORIENTATIONS[Math.floor(rnd() * 4)],
        flipHorizontal: rnd() < 0.5, flipVertical: rnd() < 0.5,
        resampleMethod: methods[Math.floor(rnd() * 2)],
      });
      const m = new CropModule();
      m.setParams(params);
      const out = m.process(constantImage(w, h, 4), { width: w, height: h, channels: 4 });
      const dims = m.getOutputDimensions(w, h);
      if (out.length !== dims.width * dims.height * 4) {
        throw new Error(`case ${i}: ${JSON.stringify(params)} ${w}x${h} -> len ${out.length} vs ${dims.width}x${dims.height}`);
      }
    }
  });
});
