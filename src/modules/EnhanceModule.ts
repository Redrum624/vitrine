import { DEFAULT_ENHANCE_PARAMS, EnhanceParams, enhanceImage } from '../utils/enhanceChain';

type Ctx = { width: number; height: number; channels: number };

export class EnhanceModule {
  private params: EnhanceParams = { ...DEFAULT_ENHANCE_PARAMS };
  getId(): string { return 'enhance'; }
  getName(): string { return 'Enhance'; }
  getParams(): EnhanceParams { return { ...this.params }; }
  setParams(p: Partial<EnhanceParams>): void { this.params = { ...this.params, ...p }; }
  resetParams(): void { this.params = { ...DEFAULT_ENHANCE_PARAMS }; }
  isIdentity(): boolean { const p = this.params; return !(p.enabled && p.sharpen && !p.upscale); }
  process(input: Float32Array, ctx: Ctx): Float32Array {
    const p = this.params;
    if (!p.enabled || !p.sharpen || p.upscale) return new Float32Array(input);
    return enhanceImage(input, ctx.width, ctx.height, { ...p, upscale: false }).enhanced;
  }
}
export const enhanceModule = new EnhanceModule();
