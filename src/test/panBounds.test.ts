// Viewport-canvas model (Task R5): the zoomed image ("content" = fit × zoom) is
// centered inside a "viewport" box (the canvas element, which grows up to the photo
// region) and pans within it. Bounds = half the content overhang beyond the viewport,
// floored at 0 per axis. Superset of the earlier pan-clamp regression: horizontal
// panning must be possible whenever the content is wider than the viewport.
import { computePanBounds, clampPan } from '../utils/panBounds';

describe('computePanBounds (content vs viewport)', () => {
  it('bounds are half the content overhang beyond the viewport, per axis', () => {
    // content 2370×1580 inside a 1408×790 viewport (a 3:2 photo zoomed 2× in a wide region)
    const { maxPanX, maxPanY } = computePanBounds(2370, 1580, 1408, 790);
    expect(maxPanX).toBe((2370 - 1408) / 2); // 481
    expect(maxPanY).toBe((1580 - 790) / 2); // 395
    expect(maxPanX).toBeGreaterThan(0);
    expect(maxPanY).toBeGreaterThan(0);
  });

  it('floors an axis to 0 when content is NOT larger than the viewport there', () => {
    // Portrait zoomed 2× but still narrower than the wide region: content 1184 ≤ viewport
    // 1184 in X (no pan), but taller than the viewport in Y (pannable).
    const { maxPanX, maxPanY } = computePanBounds(1184, 1580, 1184, 790);
    expect(maxPanX).toBe(0); // fully visible horizontally → centered, no pan
    expect(maxPanY).toBe((1580 - 790) / 2); // 395
  });

  it('returns zero bounds when content fits the viewport in both axes (zoom ≤ fit)', () => {
    // At zoom ≤ 1 the viewport equals the fit-rect and content ≤ fit in both axes.
    expect(computePanBounds(1185, 790, 1185, 790)).toEqual({ maxPanX: 0, maxPanY: 0 });
    expect(computePanBounds(600, 400, 1185, 790)).toEqual({ maxPanX: 0, maxPanY: 0 });
  });

  it('never returns a negative bound', () => {
    const { maxPanX, maxPanY } = computePanBounds(100, 100, 400, 400);
    expect(maxPanX).toBe(0);
    expect(maxPanY).toBe(0);
  });
});

describe('clampPan', () => {
  it('clamps symmetrically to ±maxPan', () => {
    expect(clampPan(500, 296)).toBe(296);
    expect(clampPan(-500, 296)).toBe(-296);
    expect(clampPan(100, 296)).toBe(100);
  });

  it('clamps to 0 when there is no room to pan', () => {
    expect(clampPan(250, 0)).toBeCloseTo(0, 10);
    expect(clampPan(-250, 0)).toBeCloseTo(0, 10);
  });
});
