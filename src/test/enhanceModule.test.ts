import { enhanceModule } from '../modules/EnhanceModule';

const ctx = { width: 16, height: 16, channels: 4 };
const img = () => { const d = new Float32Array(16*16*4); for (let i=0;i<16*16;i++){ const v=(i%16)<8?0.3:0.7; d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=1; } return d; };

describe('EnhanceModule', () => {
  beforeEach(() => enhanceModule.resetParams());
  it('has id "enhance"', () => expect(enhanceModule.getId()).toBe('enhance'));
  it('isIdentity truth table', () => {
    enhanceModule.setParams({ enabled: true, sharpen: true, upscale: false }); expect(enhanceModule.isIdentity()).toBe(false);
    enhanceModule.setParams({ upscale: true }); expect(enhanceModule.isIdentity()).toBe(true);
    enhanceModule.setParams({ upscale: false, sharpen: false }); expect(enhanceModule.isIdentity()).toBe(true);
    enhanceModule.setParams({ sharpen: true, enabled: false }); expect(enhanceModule.isIdentity()).toBe(true);
  });
  it('passthrough when upscale is on', () => {
    enhanceModule.setParams({ enabled: true, sharpen: true, upscale: true });
    const input = img(); const out = enhanceModule.process(input, ctx);
    expect(Array.from(out)).toEqual(Array.from(input)); expect(out).not.toBe(input);
  });
  it('modifies pixels when sharpen is active', () => {
    enhanceModule.setParams({ enabled: true, sharpen: true, upscale: false });
    const input = img(); const out = enhanceModule.process(input, ctx);
    let diff = 0; for (let i = 0; i < input.length; i++) diff += Math.abs(out[i] - input[i]);
    expect(diff).toBeGreaterThan(0);
  });
});
