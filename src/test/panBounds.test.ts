// Regression: zoomed panning was locked horizontally (but not vertically) for
// height-constrained photos because the clamp bounded pan against the photo
// REGION's width instead of the canvas's own box. The pan viewport is the
// canvas element (the zoomed draw is clipped by it), so bounds derive from the
// canvas dimensions alone.
import { computePanBounds, clampPan } from '../utils/panBounds';

describe('computePanBounds', () => {
  it('allows panning in BOTH axes when zoomed in (the reported bug)', () => {
    // Portrait photo fitted to a 1408x790 region: canvas ≈ 592x790.
    // Old container-based math: maxPanX = max(0, (592*2 - 1408)/2) = 0 → locked.
    const { maxPanX, maxPanY } = computePanBounds(592, 790, 2);
    expect(maxPanX).toBeGreaterThan(0); // horizontal must be pannable
    expect(maxPanY).toBeGreaterThan(0);
    expect(maxPanX).toBe((592 * 2 - 592) / 2); // 296
    expect(maxPanY).toBe((790 * 2 - 790) / 2); // 395
  });

  it('scales bounds linearly with zoom', () => {
    expect(computePanBounds(1000, 800, 1.5).maxPanX).toBe(250);
    expect(computePanBounds(1000, 800, 3).maxPanX).toBe(1000);
  });

  it('returns zero bounds at or below 100% zoom', () => {
    expect(computePanBounds(1000, 800, 1)).toEqual({ maxPanX: 0, maxPanY: 0 });
    expect(computePanBounds(1000, 800, 0.5)).toEqual({ maxPanX: 0, maxPanY: 0 });
  });

  it('returns zero bounds for degenerate canvas sizes', () => {
    expect(computePanBounds(0, 0, 2)).toEqual({ maxPanX: 0, maxPanY: 0 });
  });
});

describe('clampPan', () => {
  it('clamps symmetrically to ±maxPan', () => {
    expect(clampPan(500, 296)).toBe(296);
    expect(clampPan(-500, 296)).toBe(-296);
    expect(clampPan(100, 296)).toBe(100);
  });
});
