/**
 * Q2 — the Enhance panel's Chroma-noise / Detail / Sharpen sliders must apply on the AI
 * (Real-ESRGAN) upscale route, not just the deterministic Lanczos route. Two layers:
 *   A. enhanceAiUpscaled (pure) — the finishing pass applied to the AI output at final res.
 *   B. EnhanceService.applyUpscale — the AI branch actually runs that finish on the model output.
 */
import { enhanceAiUpscaled, enhanceImage, DEFAULT_ENHANCE_PARAMS, EnhanceParams } from '../utils/enhanceChain';
import { rgbaToYCrCb } from '../utils/enhanceColor';

// ── Fixtures / metrics ──────────────────────────────────────────────────────
// A luma-uniform coloured region carrying per-pixel CHROMA noise, so chroma denoise has real
// work and its effect is measurable as a drop in chroma variance.
function makeChromaNoisy(w: number, h: number): Float32Array {
  const rgba = new Float32Array(w * h * 4);
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < w * h; i++) {
    const n1 = (rnd() - 0.5) * 0.35;
    const n2 = (rnd() - 0.5) * 0.35;
    // constant luma ~0.5, noise pushed into the colour channels (chroma noise)
    rgba[i * 4] = clamp(0.5 + n1);
    rgba[i * 4 + 1] = clamp(0.5 - n1 * 0.5 + n2 * 0.5);
    rgba[i * 4 + 2] = clamp(0.5 + n2);
    rgba[i * 4 + 3] = 1;
  }
  return rgba;
}
function makeEdgeDetail(w: number, h: number): Float32Array {
  const rgba = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = ((x >> 2) + (y >> 2)) % 2 === 0 ? 0.35 : 0.7; // 4px checker = luma detail
    rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 1;
  }
  return rgba;
}
const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function chromaVariance(rgba: Float32Array): number {
  const { cr, cb } = rgbaToYCrCb(rgba);
  const mean = (a: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const varOf = (a: Float32Array, m: number) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; } return s / a.length; };
  return varOf(cr, mean(cr)) + varOf(cb, mean(cb));
}
function bytesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function maxAbsDelta(a: Float32Array, b: Float32Array): number {
  let m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m;
}

const NEUTRAL: EnhanceParams = {
  ...DEFAULT_ENHANCE_PARAMS, upscale: false, enabled: true, sharpen: true,
  denoiseStrength: 0, alpha: 0, sharpness: 0, chromaClean: false, hpSigma: 1.2,
};

describe('enhanceAiUpscaled — finishing pass on the AI output', () => {
  const W = 48, H = 48;

  it('is a byte-identical pass-through when every slider is neutral (no silent alteration)', () => {
    const ai = makeChromaNoisy(W, H);
    const out = enhanceAiUpscaled(ai, W, H, { ...NEUTRAL });
    expect(out).toBe(ai);                 // same reference — nothing ran
    expect(bytesEqual(ai, out)).toBe(true);
  });

  it('Chroma-noise slider (denoiseStrength>0) REDUCES chroma variance — same direction as the deterministic route', () => {
    const ai = makeChromaNoisy(W, H);
    const off = enhanceAiUpscaled(ai.slice(), W, H, { ...NEUTRAL, denoiseStrength: 0 });
    const on = enhanceAiUpscaled(ai.slice(), W, H, { ...NEUTRAL, denoiseStrength: 10 });
    expect(bytesEqual(off, on)).toBe(false);                       // slider has an effect
    expect(chromaVariance(on)).toBeLessThan(chromaVariance(off));  // AI route: denoise smooths chroma

    // Deterministic route (enhanceImage, upscale:false) moves in the SAME direction.
    const detOff = enhanceImage(ai.slice(), W, H, { ...NEUTRAL, denoiseStrength: 0 }).enhanced;
    const detOn = enhanceImage(ai.slice(), W, H, { ...NEUTRAL, denoiseStrength: 10 }).enhanced;
    expect(chromaVariance(detOn)).toBeLessThan(chromaVariance(detOff));
  });

  it('Detail radius (hpSigma) changes the AI-route output — and it is live on the deterministic route too', () => {
    const ai = makeEdgeDetail(W, H);
    // Detail stage active (alpha>0); vary only hpSigma.
    const p = { ...NEUTRAL, alpha: 0.8 };
    const lo = enhanceAiUpscaled(ai.slice(), W, H, { ...p, hpSigma: 0.5 });
    const hi = enhanceAiUpscaled(ai.slice(), W, H, { ...p, hpSigma: 3.0 });
    expect(bytesEqual(lo, hi)).toBe(false);
    expect(maxAbsDelta(lo, hi)).toBeGreaterThan(0.005);

    // The deterministic route's hpSigma is live too (RL on → lumaGraft(hpSigma)).
    const detLo = enhanceImage(ai.slice(), W, H, { ...DEFAULT_ENHANCE_PARAMS, upscale: false, enabled: true, sharpen: true, hpSigma: 0.5 }).enhanced;
    const detHi = enhanceImage(ai.slice(), W, H, { ...DEFAULT_ENHANCE_PARAMS, upscale: false, enabled: true, sharpen: true, hpSigma: 3.0 }).enhanced;
    expect(bytesEqual(detLo, detHi)).toBe(false);
  });

  it('Sharpen slider (sharpness) changes the AI-route output', () => {
    const ai = makeEdgeDetail(W, H);
    const soft = enhanceAiUpscaled(ai.slice(), W, H, { ...NEUTRAL, sharpness: 0.1 });
    const hard = enhanceAiUpscaled(ai.slice(), W, H, { ...NEUTRAL, sharpness: 1.0 });
    expect(bytesEqual(soft, hard)).toBe(false);
    expect(maxAbsDelta(soft, hard)).toBeGreaterThan(0.005);
  });
});
