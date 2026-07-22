import { rgbaToYCrCb, yCrCbToRgba } from './enhanceColor';
import { cas, cleanChroma, effectiveEnhanceKernels, lumaGraft } from './enhanceOps';
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

export function enhanceImage(rgba: Float32Array, w: number, h: number, p: EnhanceParams, edgeMaskGlobalMax?: number, kernelScale = 1): EnhanceResult {
  // 0+1 native res: denoise chroma, RL-deconv deblur + luma graft
  // edgeMaskGlobalMax (optional): the full-image Sobel-gradient max, supplied by the tiled CPU
  // worker path so lumaGraft's edgeMask normalises by the SAME constant in every tile (seam-free
  // sharpen gain). Undefined on the untiled/whole-image path → edgeMask uses its own buffer max.
  //
  // kernelScale (optional, v1.36.0 C5 WYSIWYG): processingLongEdge / nativeLongEdge of the PASS
  // (never of a tile — the tiled path threads the full-pass scale, like edgeMaskGlobalMax).
  // Parameter semantics are NATIVE-resolution: sub-native preview passes scale psfSigma / hpSigma
  // down by this factor and attenuate the CAS peak likewise, so the preview's sharpening matches
  // what the native-resolution export produces. Default 1 = native semantics, bit-identical to
  // pre-C5 (exports / bake develops never thread it). Below ~0.3px effective sigma the stages
  // degenerate to visually-nil near-delta kernels but STILL RUN (structure kept — toggles keep
  // previewing something consistent). Full doc: effectiveEnhanceKernels in enhanceOps.ts.
  // NOTE: the tiled worker path's apron (moduleApron 'enhance') stays sized from the RAW native
  // params — oversized for a scaled preview, which is safe; it must never shrink with the scale.
  const eff = effectiveEnhanceKernels(p.psfSigma, p.hpSigma, kernelScale);
  const ycc = rgbaToYCrCb(rgba);
  let { y, cr, cb } = ycc; const a = ycc.a;
  if (p.denoiseStrength > 0) { const d = denoiseChroma(cr, cb, y, w, h, p.denoiseStrength); cr = d.cr; cb = d.cb; }
  // Gate on the RAW psfSigma (not σ_eff) so the run condition stays equivalent at every scale —
  // pipelineUsesEdgeMask (tiledPipeline.ts) mirrors this exact raw-param gate for the mmax sweep.
  if (p.rlIters > 0 && p.psfSigma > 0) {
    const restored = rlDeconvLuma(y, w, h, eff.psfSigma, p.rlIters);
    y = lumaGraft(y, restored, w, h, p.alpha, eff.hpSigma, edgeMaskGlobalMax);
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
  // v1.36.0 C1/F2: the finishing CAS is gated on the sharpness VALUE (0 = off, true no-op) —
  // matching the AI route's gate (enhanceAiUpscaled) and the GPU parity port. The old
  // "finish is always-on" behavior applied 62.5% of max sharpening even at sharpness 0.
  // Chroma cleanup stays gated by chromaClean only.

  // 3 finish: CAS on luma (skipped at sharpness ≤ 0) + chroma clean at final res.
  // C5: the CAS 3×3 window can't shrink below its pixel support, so a sub-native preview
  // attenuates its peak amplitude by eff.casGain instead (1 at native — exact no-op).
  const fin = rgbaToYCrCb(cur);
  const fy = p.sharpness > 0 ? cas(fin.y, cw, ch, p.sharpness, eff.casGain) : fin.y;
  let fcr = fin.cr, fcb = fin.cb;
  if (p.chromaClean) { const c = cleanChroma(fcr, fcb, cw, ch); fcr = c.cr; fcb = c.cb; }
  const enhanced = yCrCbToRgba({ y: fy, cr: fcr, cb: fcb, a: fin.a });
  return { enhanced, base, width: cw, height: ch };
}

/**
 * Finishing pass for the AI (Real-ESRGAN) upscale route, applied to the model's OUTPUT at final
 * resolution — the renderer-side analogue of enhanceImage's POST-Lanczos stages. It exists so the
 * Enhance panel's Chroma-noise, Detail, Sharpen and Chroma-cleanup sliders are NOT silently no-ops
 * when the AI route is auto-picked (they only ran on the deterministic Lanczos route before).
 *
 * Stages run in the SAME order and use the SAME kernels as enhanceImage, with ONE deliberate
 * omission: the Richardson-Lucy DEBLUR (rlDeconvLuma) is SKIPPED. Real-ESRGAN already resolves
 * sharp detail as part of super-resolution; running RL deconvolution on its crisp edges introduces
 * ringing/overshoot rather than recovering blur (fixture evidence: on a hard-edge target RL pushed
 * ~5.5% of pixels below the source min and clipped ~0.7% to white, vs ~1.6%/0% with RL off). The
 * Detail sliders (alpha/hpSigma) still apply, but as an edge-masked UNSHARP graft using the AI
 * output's own luma as the detail source (lumaGraft(y, y, …)) instead of an RL-restored luma.
 *
 * OPT-IN / pass-through: if no stage is requested (denoiseStrength≤0, alpha≤0, sharpness≤0,
 * chromaClean false) the AI output is returned UNCHANGED (same reference) — so a fully-neutral
 * slider set leaves the AI result byte-identical to the model output (no silent alteration).
 * Runs whole-buffer in the renderer (not the tiled CPU worker), so tiledPipeline's moduleApron is
 * not involved.
 */
/**
 * True when any finishing stage is requested — the single gate shared by enhanceAiUpscaled's
 * pass-through and EnhanceService's worker dispatch (W4 R4: a fully-neutral slider set must not
 * pay a worker round-trip/transfer just to get its own buffer back).
 */
export function aiFinishRequested(p: EnhanceParams): boolean {
  return p.denoiseStrength > 0 || p.alpha > 0 || p.sharpness > 0 || !!p.chromaClean;
}

export function enhanceAiUpscaled(rgba: Float32Array, w: number, h: number, p: EnhanceParams): Float32Array {
  const doDenoise = p.denoiseStrength > 0;
  const doDetail = p.alpha > 0;
  const doSharpen = p.sharpness > 0;
  const doChromaClean = p.chromaClean;
  if (!aiFinishRequested(p)) return rgba;

  const ycc = rgbaToYCrCb(rgba);
  let { y, cr, cb } = ycc; const a = ycc.a;
  // 1 chroma denoise (guided by luma) — same primitive as the native route, at final res.
  if (doDenoise) { const d = denoiseChroma(cr, cb, y, w, h, p.denoiseStrength); cr = d.cr; cb = d.cb; }
  // 2 detail: edge-masked unsharp graft (RL deblur skipped on AI output — see doc above).
  if (doDetail) { y = lumaGraft(y, y, w, h, p.alpha, p.hpSigma); }
  // 3 finish: CAS luma sharpen + chroma clean, same as enhanceImage's finish.
  if (doSharpen) { y = cas(y, w, h, p.sharpness); }
  if (doChromaClean) { const c = cleanChroma(cr, cb, w, h); cr = c.cr; cb = c.cb; }
  return yCrCbToRgba({ y, cr, cb, a });
}
