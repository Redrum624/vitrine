import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';

function flatField(width: number, height: number, value: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 1;
  }
  return data;
}

function edgeField(width: number, height: number): Float32Array {
  // Left half black, right half white — a hard vertical edge for the blur to soften.
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? 0 : 1;
      const i = (y * width + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 1;
    }
  }
  return data;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe('Lens Corrections: Blur + Film Grain (non-destructive)', () => {
  const W = 24, H = 24;

  it('blur softens an edge only when enabled', () => {
    const m = new LensCorrectionsModule();
    const input = edgeField(W, H);

    // Disabled → unchanged
    const off = m.processImage(input, W, H);
    expect(maxAbsDiff(off, input)).toBe(0);

    // Enabled → the edge column neighbourhood changes
    m.setParams({ blur: { enabled: true, radius: 3 } });
    const blurred = m.processImage(input, W, H);
    expect(maxAbsDiff(blurred, input)).toBeGreaterThan(0.05);

    // A pixel just left of the edge should brighten (white bleeds in).
    const y = 12;
    const justLeft = (y * W + (W / 2 - 1)) * 4;
    expect(blurred[justLeft]).toBeGreaterThan(input[justLeft]);
  });

  it('film grain perturbs pixels deterministically', () => {
    const m = new LensCorrectionsModule();
    const input = flatField(W, H, 0.5); // midtone — grain is strongest here

    m.setParams({ filmGrain: { enabled: true, amount: 60, size: 1 } });
    const a = m.processImage(input, W, H);
    const b = m.processImage(input, W, H);

    // Grain changed the image…
    expect(maxAbsDiff(a, input)).toBeGreaterThan(0.001);
    // …and is identical across runs (fixed seed → no shimmer between preview/export).
    expect(maxAbsDiff(a, b)).toBe(0);
  });

  it('wrapper isEnabled derives from sections (no dead top-level flag)', () => {
    const w = new LensCorrectionsPipelineModule();
    expect(w.isEnabled).toBe(false);
    expect((w.getParams() as { enabled: boolean }).enabled).toBe(false);

    w.setParameters({
      lensCorrectionsParams: {
        ...w.getParameters().lensCorrectionsParams,
        blur: { enabled: true, radius: 5 },
      },
    });

    expect(w.isEnabled).toBe(true);
    expect((w.getParams() as { enabled: boolean }).enabled).toBe(true);
  });
});
