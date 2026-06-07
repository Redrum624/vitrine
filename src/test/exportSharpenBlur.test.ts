/**
 * Regression test for ExportService output-sharpening blur.
 *
 * Bug: gaussianBlur() ran only a single horizontal pass (no vertical pass), so the
 * unsharp mask sharpened only vertical edges — directionally-biased sharpening on
 * (nearly) every export, since output sharpening is enabled by default. The blur
 * must spread energy in BOTH axes (separable box blur in X and Y).
 */
import { ExportService } from '../services/ExportService';

describe('ExportService output-sharpening blur', () => {
  test('gaussianBlur spreads in both axes (regression: horizontal-only pass)', () => {
    const svc = new ExportService();
    const w = 5, h = 5;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 1; // opaque

    // Single bright center pixel.
    const center = (2 * w + 2) * 4;
    data[center] = 1; data[center + 1] = 1; data[center + 2] = 1;

    // gaussianBlur is private; exercise it directly for the regression.
    const blurred: Float32Array = (svc as unknown as {
      gaussianBlur(d: Float32Array, w: number, h: number, r: number): Float32Array;
    }).gaussianBlur(data, w, h, 1.5);

    const at = (y: number, x: number, ch = 0) => blurred[(y * w + x) * 4 + ch];

    const horizNeighbor = at(2, 1); // same row, left of center
    const vertNeighbor = at(1, 2);  // same column, above center

    expect(horizNeighbor).toBeGreaterThan(0); // horizontal spread (already worked)
    expect(vertNeighbor).toBeGreaterThan(0);  // vertical spread (the fix)
    // Separable box blur is isotropic for a symmetric input.
    expect(Math.abs(vertNeighbor - horizNeighbor)).toBeLessThan(0.05);
    expect(at(2, 2)).toBeLessThan(1); // center energy spread out
  });
});
