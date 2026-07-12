import { enhanceImage, DEFAULT_ENHANCE_PARAMS, EnhanceParams } from '../utils/enhanceChain';

const W = 16, H = 16;
const img = () => { const d = new Float32Array(W*H*4); for (let i=0;i<W*H;i++){ const x=i%W; const v=x<W/2?0.3:0.7; d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=1; } return d; };
const P = (o: Partial<EnhanceParams>): EnhanceParams => ({ ...DEFAULT_ENHANCE_PARAMS, ...o });

describe('enhanceImage', () => {
  it('same resolution when upscale is off', () => {
    const r = enhanceImage(img(), W, H, P({ sharpen: true, upscale: false }));
    expect(r.width).toBe(W); expect(r.height).toBe(H); expect(r.enhanced.length).toBe(W*H*4);
  });
  it('scales dimensions when upscale is on', () => {
    const r = enhanceImage(img(), W, H, P({ sharpen: false, upscale: true, scale: 2 }));
    expect(r.width).toBe(W*2); expect(r.height).toBe(H*2);
    expect(r.enhanced.length).toBe(W*2*H*2*4); expect(r.base.length).toBe(W*2*H*2*4);
  });
  it('preserves alpha and never NaNs', () => {
    const r = enhanceImage(img(), W, H, P({ sharpen: true }));
    for (let i = 3; i < r.enhanced.length; i += 4) expect(r.enhanced[i]).toBeCloseTo(1, 5);
    for (const v of r.enhanced) expect(Number.isNaN(v)).toBe(false);
  });
  it('upscale base is the clean resize, distinct from the enhanced result', () => {
    const r = enhanceImage(img(), W, H, P({ upscale: true, scale: 2 }));
    let diff = 0; for (let i = 0; i < r.enhanced.length; i++) diff += Math.abs(r.enhanced[i] - r.base[i]);
    expect(diff).toBeGreaterThan(0); // base = clean Lanczos; enhanced has CAS/chroma applied
  });
  it('bypasses denoise and deblur when their params are zero (no NaN, dims unchanged)', () => {
    const r = enhanceImage(img(), W, H, P({ denoiseStrength: 0, rlIters: 0, upscale: false }));
    expect(r.width).toBe(W); expect(r.height).toBe(H);
    for (const v of r.enhanced) expect(Number.isNaN(v)).toBe(false);
  });
});
