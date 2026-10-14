import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { vignetteFactor, VIGNETTE_MIDPOINT_MIN, VIGNETTE_MIDPOINT_MAX } from '../utils/vignetteMath';
import { FRAG_VIGNETTE } from '../shaders/sources';

const W = 300, H = 200; // 3:2

function flat(): Float32Array {
  const d = new Float32Array(W * H * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 0.5; d[i + 1] = 0.5; d[i + 2] = 0.5; d[i + 3] = 1; }
  return d;
}
function run(amount: number, midpoint = 1.0, roundness = 0, feather = 50): Float32Array {
  const m = new LensCorrectionsModule();
  m.setParams({
    vignetting: { enabled: true, amount, midpoint, roundness, feather },
    distortion: { enabled: false, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1 },
    chromaticAberration: { enabled: false, redCyan: 0, blueMagenta: 0, purple: { amount: 0, hue: 300, range: 10 }, green: { amount: 0, hue: 60, range: 10 } },
    blur: { enabled: false, radius: 0 },
    filmGrain: { enabled: false, amount: 0, size: 1 },
  });
  return m.processImage(flat(), W, H);
}
const px = (d: Float32Array, x: number, y: number) => d[(y * W + x) * 4];

describe('creative vignette (v1.40.0)', () => {
  it('+50 at default midpoint darkens the corner to <=0.6 of centre and the edge midpoint below 0.95', () => {
    const d = run(50);
    const centre = px(d, W / 2, H / 2);
    expect(centre).toBeCloseTo(0.5, 5);
    expect(px(d, 0, 0) / centre).toBeLessThanOrEqual(0.6);
    expect(px(d, 0, H / 2) / centre).toBeLessThan(0.95);
    expect(px(d, W / 2, 0) / centre).toBeLessThan(0.95);
  });

  it('-50 brightens the edges', () => {
    const d = run(-50);
    expect(px(d, 0, 0)).toBeGreaterThan(0.5 * 1.3);
    expect(px(d, W / 2, H / 2)).toBeCloseTo(0.5, 5);
  });

  it('the CPU module and the GPU-self-check CPU replica agree (lockstep)', () => {
    const cpu = run(40, 0.8, 20, 30);
    const rep = webGLImageProcessor.vignettingCPU(flat(), W, H, 0.4, 0.8, 0.2, 0.3);
    let max = 0;
    for (let i = 0; i < cpu.length; i++) max = Math.max(max, Math.abs(cpu[i] - rep[i]));
    expect(max).toBeLessThan(1e-6);
  });

  it('the factor stays finite and within [0, 2] at every slider extreme', () => {
    for (const amount of [-100, -50, 0, 50, 100]) {
      for (const midpoint of [0, 0.1, VIGNETTE_MIDPOINT_MIN, 1, VIGNETTE_MIDPOINT_MAX, 2, 5]) {
        for (const feather of [0, 50, 100]) {
          for (const nd of [0, 0.25, 0.5, 0.7, 1, 1.5, 3]) {
            const f = vignetteFactor(nd, amount / 100, midpoint, feather / 100);
            expect(Number.isFinite(f)).toBe(true);
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it('the shader source uses the same falloff constants as the CPU (fs = mid*0.5, fe = mid, clamp 0.5..1.5)', () => {
    expect(FRAG_VIGNETTE).toContain('clamp(u_midpoint, 0.5, 1.5)');
    expect(FRAG_VIGNETTE).toMatch(/fs\s*=\s*mid\s*\*\s*0\.5/);
    expect(FRAG_VIGNETTE).toMatch(/fe\s*=\s*mid\b/);
    expect(FRAG_VIGNETTE).toContain('1.0 - s * ff');
  });
});
