import { DEFAULT_ENHANCE_PARAMS, EnhanceParams, enhanceImage } from '../utils/enhanceChain';

type Ctx = { width: number; height: number; channels: number; edgeMaskGlobalMax?: number; kernelScale?: number };

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
    // ctx.edgeMaskGlobalMax is set only on the tiled CPU worker path → edgeMask normalises by the
    // full-image max (seam-free). Undefined on the whole-image path → edgeMask uses its buffer max.
    // ctx.kernelScale (v1.36.0 C5): the pass's processing/native long-edge ratio — sub-native
    // previews scale the sharpen kernels down for WYSIWYG vs export; absent → 1 (native semantics).
    return enhanceImage(input, ctx.width, ctx.height, { ...p, upscale: false }, ctx.edgeMaskGlobalMax, ctx.kernelScale ?? 1).enhanced;
  }
}
export const enhanceModule = new EnhanceModule();
