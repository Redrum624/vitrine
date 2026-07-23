/**
 * v1.37.0 R2 Part B — CropModule.wedgeFreeCropPatch: the pure extraction of
 * CropModuleComponent.ensureWedgeFreeCrop's math (v1.34.2), so the component
 * AND Auto All's headless auto-straighten share ONE wedge-free-crop source
 * (no logic fork). Contracts mirror the component behavior exactly:
 *  - |angle| < 0.01 → no inscribe; keep an existing crop, else reset the rect
 *  - unknown frame dims → angle-only patch
 *  - no user crop → the largest inscribed auto-crop for the angle
 *  - existing crop → INTERSECT it with the inscribed rect
 *  - orientation 90/270 → inscribed math runs on the ROTATED frame's dims
 */
import { CropModule } from '../modules/CropModule';

const IMG_W = 4000;
const IMG_H = 3000;

function freshModule(params: Record<string, unknown> = {}): CropModule {
  const m = new CropModule();
  m.setOriginalDimensions(IMG_W, IMG_H);
  if (Object.keys(params).length) m.setParams(params);
  return m;
}

describe('CropModule.wedgeFreeCropPatch', () => {
  test('angle ~0 with no crop → full-rect reset (angle cleared, enabled)', () => {
    const m = freshModule();
    expect(m.wedgeFreeCropPatch(0, IMG_W, IMG_H)).toEqual({
      x: 0, y: 0, width: 1.0, height: 1.0, angle: 0, enabled: true,
    });
  });

  test('angle ~0 with an existing crop → angle cleared, RECT PRESERVED', () => {
    const m = freshModule({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
    expect(m.wedgeFreeCropPatch(0.005, IMG_W, IMG_H)).toEqual({ angle: 0, enabled: true });
  });

  test('unknown frame dims → angle-only patch', () => {
    const m = freshModule();
    expect(m.wedgeFreeCropPatch(3, 0, 0)).toEqual({ angle: 3, enabled: true });
  });

  test('no crop + real angle → the largest inscribed auto-crop for that angle', () => {
    const m = freshModule();
    const auto = m.calculateAutoCropForRotation(IMG_W, IMG_H, 3);
    expect(m.wedgeFreeCropPatch(3, IMG_W, IMG_H)).toEqual({ angle: 3, enabled: true, ...auto });
  });

  test('existing crop + real angle → intersection of the crop with the inscribed rect', () => {
    const rect = { x: 0.1, y: 0.15, width: 0.6, height: 0.5 };
    const m = freshModule(rect);
    const auto = m.calculateAutoCropForRotation(IMG_W, IMG_H, 4);
    const patch = m.wedgeFreeCropPatch(4, IMG_W, IMG_H);

    const x1 = Math.max(rect.x, auto.x);
    const y1 = Math.max(rect.y, auto.y);
    const x2 = Math.min(rect.x + rect.width, auto.x + auto.width);
    const y2 = Math.min(rect.y + rect.height, auto.y + auto.height);
    expect(patch).toEqual({
      angle: 4, enabled: true,
      x: x1, y: y1,
      width: Math.max(0.05, x2 - x1),
      height: Math.max(0.05, y2 - y1),
    });
  });

  test('orientation 90 → inscribed rect computed on the SWAPPED frame dims', () => {
    const m = freshModule({ orientation: 90 });
    const autoSwapped = m.calculateAutoCropForRotation(IMG_H, IMG_W, 3); // rotated frame
    expect(m.wedgeFreeCropPatch(3, IMG_W, IMG_H)).toEqual({ angle: 3, enabled: true, ...autoSwapped });
  });

  test('intersection never collapses below the 0.05 minimum', () => {
    // A sliver crop in the far corner barely overlaps the centered inscribed rect.
    const m = freshModule({ x: 0.97, y: 0.97, width: 0.03, height: 0.03 });
    const patch = m.wedgeFreeCropPatch(5, IMG_W, IMG_H) as { width: number; height: number };
    expect(patch.width).toBeGreaterThanOrEqual(0.05);
    expect(patch.height).toBeGreaterThanOrEqual(0.05);
  });
});
