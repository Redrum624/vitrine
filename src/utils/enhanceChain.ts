import { rgbaToYCrCb, yCrCbToRgba } from './enhanceColor';
import { cas, cleanChroma, lumaGraft } from './enhanceOps';
import { denoiseChroma, rlDeconvLuma } from './enhanceRestore';
import { lanczosResizeLinear } from './lanczos';

export interface EnhanceParams {
  enabled: boolean; sharpen: boolean; upscale: boolean; scale: 2 | 4;
  denoiseStrength: number; psfSigma: number; rlIters: number;
  alpha: number; hpSigma: number; sharpness: number; chromaClean: boolean;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}
export const DEFAULT_ENHANCE_PARAMS: EnhanceParams = {
  enabled: false, sharpen: true, upscale: false, scale: 2,
  denoiseStrength: 0, psfSigma: 1.0, rlIters: 12,
  alpha: 0.8, hpSigma: 1.2, sharpness: 0.4, chromaClean: true,
};
export interface EnhanceResult { enhanced: Float32Array; base: Float32Array; width: number; height: number; }

export function enhanceImage(rgba: Float32Array, w: number, h: number, p: EnhanceParams): EnhanceResult {
  // 0+1 native res: denoise chroma, RL-deconv deblur + luma graft
  const ycc = rgbaToYCrCb(rgba);
  let { y, cr, cb } = ycc; const a = ycc.a;
  if (p.denoiseStrength > 0) { const d = denoiseChroma(cr, cb, y, w, h, p.denoiseStrength); cr = d.cr; cb = d.cb; }
  if (p.rlIters > 0 && p.psfSigma > 0) {
    const restored = rlDeconvLuma(y, w, h, p.psfSigma, p.rlIters);
    y = lumaGraft(y, restored, w, h, p.alpha, p.hpSigma);
  }
  let cur = yCrCbToRgba({ y, cr, cb, a }); let cw = w, ch = h;
  let base: Float32Array;

  // 2 upscale (Lanczos linear). base = clean Lanczos of the ORIGINAL input (Before/After ref).
  if (p.upscale && p.scale > 1) {
    const dw = Math.round(w * p.scale), dh = Math.round(h * p.scale);
    cur = lanczosResizeLinear(cur, cw, ch, dw, dh).data;
    base = lanczosResizeLinear(rgba, w, h, dw, dh).data;
    cw = dw; ch = dh;
  } else {
    base = cur.slice();
  }

  // NOTE: `sharpen`/`upscale` in EnhanceParams are CALLER-level toggles, not gates here.
  // EnhanceModule.process() only invokes enhanceImage for the same-resolution sharpen path
  // (passing upscale:false); EnhanceService forces sharpen:true for the upscale path.
  // enhanceImage ALWAYS applies the finishing CAS + chroma cleanup — per spec, the finish
  // is always-on regardless of toggles.

  // 3 finish: CAS on luma + chroma clean at final res
  const fin = rgbaToYCrCb(cur);
  const fy = cas(fin.y, cw, ch, p.sharpness);
  let fcr = fin.cr, fcb = fin.cb;
  if (p.chromaClean) { const c = cleanChroma(fcr, fcb, cw, ch); fcr = c.cr; fcb = c.cb; }
  const enhanced = yCrCbToRgba({ y: fy, cr: fcr, cb: fcb, a: fin.a });
  return { enhanced, base, width: cw, height: ch };
}
