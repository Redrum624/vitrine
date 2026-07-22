/**
 * Task C5 (v1.36.0) — WYSIWYG resolution-compensated Enhance kernels (chain-audit F7).
 *
 * Parameter semantics are defined at NATIVE resolution: psfSigma / hpSigma / the CAS window
 * describe the effect on the full-resolution image (what exports). A preview pass running at a
 * smaller processing resolution must scale its kernels DOWN by
 * `kernelScale = processingLongEdge / nativeLongEdge` (σ_eff = σ × scale; the CAS 3×3 window
 * cannot shrink below its pixel support, so its PEAK amplitude scales instead), otherwise the
 * same σ on a ~4-5× smaller preview looks ~4-5× stronger than the export — the pre-C5 bug.
 *
 * Contract pinned here:
 *  - export-shaped passes (no kernelScale / kernelScale 1) are BIT-IDENTICAL to the pre-C5 code
 *    (the existing enhanceChain/enhanceOps/enhanceRestore/exportWorkerParity suites all call the
 *    old signature and remain the native-behavior regression net);
 *  - a downscaled pass WITH kernelScale lands materially closer to the native pass's sharpening
 *    energy (gradient-energy ratio vs its unsharpened input) than the unscaled pass does;
 *  - below the ~0.3px σ floor the stage is visually-nil but still RUNS (toggles keep previewing
 *    something consistent — the pipeline structure is never dropped);
 *  - the scale is derived ONCE (enhanceKernelScale / effectiveEnhanceKernels) and threaded to
 *    every route: EnhanceModule ctx, the worker-pool imageData, PROCESS_IMAGE / PROCESS_TILE,
 *    and the GPU parity port's uniforms (same single source).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  cas,
  enhanceKernelScale,
  effectiveEnhanceKernels,
  ENHANCE_KERNEL_SIGMA_FLOOR_PX,
} from '../utils/enhanceOps';
import { enhanceImage, DEFAULT_ENHANCE_PARAMS, EnhanceParams } from '../utils/enhanceChain';
import { EnhanceModule } from '../modules/EnhanceModule';
import { ImageProcessingPipeline, setWorkerPool } from '../services/ImageProcessingPipeline';

// Sharpen-route params (deterministic same-resolution chain), defaults = the shipped calibration.
const P: EnhanceParams = { ...DEFAULT_ENHANCE_PARAMS, enabled: true, sharpen: true, upscale: false };

// ---------------------------------------------------------------------------------------------
// Fixtures + metrics
// ---------------------------------------------------------------------------------------------

/** Deterministic gray RGBA test scene: low/mid-frequency bands + soft step edges. Feature widths
 *  are ≥6 native px so a 4× box downsample keeps them representable (no aliasing-only detail). */
function scene(w: number, h: number, featureScaleW: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let L =
        0.45 +
        0.16 * Math.sin(2 * Math.PI * 5 * u) * Math.cos(2 * Math.PI * 1.5 * v) +
        0.07 * Math.sin(2 * Math.PI * 24 * u);
      for (const e of [0.22, 0.51, 0.78]) L += 0.09 * Math.tanh(((u - e) * featureScaleW) / 6);
      L = Math.min(1, Math.max(0, L));
      const i = (y * w + x) * 4;
      out[i] = L; out[i + 1] = L; out[i + 2] = L; out[i + 3] = 1;
    }
  }
  return out;
}

/** Area-averaged 4× box downsample (mirrors the app's boxDownsampleRGBA intent). */
function boxDown4(src: Float32Array, w: number, h: number): { data: Float32Array; w: number; h: number } {
  const dw = w / 4, dh = h / 4;
  const out = new Float32Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const i = ((y * 4 + dy) * w + (x * 4 + dx)) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2];
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / 16; out[o + 1] = g / 16; out[o + 2] = b / 16; out[o + 3] = 1;
    }
  }
  return { data: out, w: dw, h: dh };
}

/** Mean squared central-difference gradient of the BT.601 luma (interior pixels). */
function gradEnergy(rgba: Float32Array, w: number, h: number): number {
  const n = w * h;
  const L = new Float32Array(n);
  for (let p2 = 0, i = 0; p2 < n; p2++, i += 4) {
    L[p2] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  let acc = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      const gx = (L[c + 1] - L[c - 1]) / 2;
      const gy = (L[c + w] - L[c - w]) / 2;
      acc += gx * gx + gy * gy; cnt++;
    }
  }
  return acc / cnt;
}

function bitIdentical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Scale derivation — the single source both CPU and GPU routes read
// ---------------------------------------------------------------------------------------------

describe('enhanceKernelScale — processingLongEdge / nativeLongEdge, clamped to 1', () => {
  it('is 1 when the native long edge is unknown or invalid (fail-safe: pre-C5 behavior)', () => {
    expect(enhanceKernelScale(1024, undefined)).toBe(1);
    expect(enhanceKernelScale(1024, 0)).toBe(1);
    expect(enhanceKernelScale(1024, -5)).toBe(1);
    expect(enhanceKernelScale(1024, NaN)).toBe(1);
    expect(enhanceKernelScale(0, 4096)).toBe(1);
    expect(enhanceKernelScale(NaN, 4096)).toBe(1);
  });

  it('is 1 at native resolution and above (export / bake develop passes are UNCHANGED)', () => {
    expect(enhanceKernelScale(5472, 5472)).toBe(1);
    expect(enhanceKernelScale(8000, 5472)).toBe(1);
  });

  it('is the linear ratio below native (fit-zoom preview)', () => {
    expect(enhanceKernelScale(1024, 4096)).toBeCloseTo(0.25, 12);
    expect(enhanceKernelScale(1368, 5472)).toBeCloseTo(0.25, 12);
    expect(enhanceKernelScale(1024, 5472)).toBeCloseTo(1024 / 5472, 12);
  });
});

describe('effectiveEnhanceKernels — σ_eff = σ × scale, CAS peak amplitude likewise', () => {
  it('scale 1 returns the params untouched (native semantics)', () => {
    const eff = effectiveEnhanceKernels(1.0, 1.2, 1);
    expect(eff.psfSigma).toBe(1.0);
    expect(eff.hpSigma).toBe(1.2);
    expect(eff.casGain).toBe(1);
  });

  it('scales the Gaussian sigmas and the CAS amplitude linearly', () => {
    const eff = effectiveEnhanceKernels(1.0, 1.2, 0.25);
    expect(eff.psfSigma).toBeCloseTo(0.25, 12);
    expect(eff.hpSigma).toBeCloseTo(0.3, 12);
    expect(eff.casGain).toBeCloseTo(0.25, 12);
  });

  it('treats invalid or >1 scales as 1 (defensive — never AMPLIFY kernels)', () => {
    for (const s of [0, -1, NaN, Infinity, 2]) {
      const eff = effectiveEnhanceKernels(1.0, 1.2, s);
      expect(eff.psfSigma).toBe(1.0);
      expect(eff.hpSigma).toBe(1.2);
      expect(eff.casGain).toBe(1);
    }
  });

  it('documents the ~0.3px visually-nil floor as a named constant', () => {
    expect(ENHANCE_KERNEL_SIGMA_FLOOR_PX).toBeCloseTo(0.3, 12);
  });
});

// ---------------------------------------------------------------------------------------------
// CAS gain
// ---------------------------------------------------------------------------------------------

describe('cas casGain (the CAS window cannot shrink below 3×3 — its amplitude scales instead)', () => {
  const W = 48, H = 32;
  const edge = (): Float32Array => {
    const y = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) y[j * W + i] = i < W / 2 ? 0.25 : 0.75;
    return y;
  };
  const energy1 = (y: Float32Array): number => {
    let acc = 0;
    for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) { const d = y[j * W + i] - y[j * W + i - 1]; acc += d * d; }
    return acc;
  };

  it('gain 1 (default) is bit-identical to the 4-arg call', () => {
    expect(bitIdentical(cas(edge(), W, H, 0.4), cas(edge(), W, H, 0.4, 1))).toBe(true);
  });

  it('gain < 1 attenuates the added acutance but keeps the pass alive (structure kept)', () => {
    const src = edge();
    const full = cas(edge(), W, H, 0.4);
    const soft = cas(edge(), W, H, 0.4, 0.25);
    const e0 = energy1(src), eFull = energy1(full), eSoft = energy1(soft);
    expect(eFull).toBeGreaterThan(e0);            // full-gain CAS sharpens
    expect(eSoft).toBeGreaterThan(e0);            // attenuated CAS still previews SOMETHING
    expect(eSoft).toBeLessThan(eFull);            // ...but less than full gain
    expect(bitIdentical(soft, src)).toBe(false);  // not silently dropped
  });
});

// ---------------------------------------------------------------------------------------------
// The WYSIWYG contract itself — gradient-energy evidence
// ---------------------------------------------------------------------------------------------

describe('enhanceImage kernelScale — preview sharpening energy matches the native pass', () => {
  it('an export-shaped pass without kernelScale is bit-identical to kernelScale 1', () => {
    const w = 320, h = 64;
    const img = scene(w, h, w);
    const a = enhanceImage(img.slice(), w, h, P);
    const b = enhanceImage(img.slice(), w, h, P, undefined, 1);
    expect(bitIdentical(a.enhanced, b.enhanced)).toBe(true);
    expect(bitIdentical(a.base, b.base)).toBe(true);
  });

  it('4096-wide native vs 1024-wide preview: the scaled preview ratio is materially closer to the native ratio (C5 evidence)', () => {
    const NW = 4096, NH = 96;
    const native = scene(NW, NH, NW);
    const eN0 = gradEnergy(native, NW, NH);
    const nativeOut = enhanceImage(native.slice(), NW, NH, P).enhanced;
    const rNative = gradEnergy(nativeOut, NW, NH) / eN0;

    const prev = boxDown4(native, NW, NH); // 1024×24, same content
    const eP0 = gradEnergy(prev.data, prev.w, prev.h);
    const outUnscaled = enhanceImage(prev.data.slice(), prev.w, prev.h, P).enhanced; // pre-C5 behavior
    const outScaled = enhanceImage(prev.data.slice(), prev.w, prev.h, P, undefined, 0.25).enhanced;
    const rUnscaled = gradEnergy(outUnscaled, prev.w, prev.h) / eP0;
    const rScaled = gradEnergy(outScaled, prev.w, prev.h) / eP0;

    // Evidence numbers for the C5 report (export unchanged + preview now proportional).
    console.log(
      `[C5 gradient-energy] native(4096)=${rNative.toFixed(4)} ` +
      `previewUnscaled(1024)=${rUnscaled.toFixed(4)} previewScaled(1024,×0.25)=${rScaled.toFixed(4)}`,
    );

    // The bug direction: the unscaled preview's sharpening UPLIFT (ratio − 1) is a multiple of
    // the native pass's (measured ~18× on this fixture: 0.134 vs 0.007).
    expect(rUnscaled - 1).toBeGreaterThan(3 * (rNative - 1));
    // The pinned improvement: scaling closes at least 85% of the gap to the native ratio
    // (measured ~98.5%: |1.0054 − 1.0073| = 0.0019 vs |1.1344 − 1.0073| = 0.1271).
    const gapBefore = Math.abs(rUnscaled - rNative);
    const gapAfter = Math.abs(rScaled - rNative);
    expect(gapAfter).toBeLessThan(gapBefore * 0.15);
  }, 120000);

  it('below the σ floor (deep zoom-out) the stages are visually-nil but still run — toggles stay live', () => {
    const w = 320, h = 64;
    const img = scene(w, h, w);
    const e0 = gradEnergy(img, w, h);
    const rUnscaled = gradEnergy(enhanceImage(img.slice(), w, h, P).enhanced, w, h) / e0;
    // scale 0.1 → σ_eff(psf)=0.1, σ_eff(hp)=0.12, casGain 0.1 — all beneath the 0.3px floor.
    const out01 = enhanceImage(img.slice(), w, h, P, undefined, 0.1).enhanced;
    const r01 = gradEnergy(out01, w, h) / e0;
    // Visually-nil: the uplift collapses to a sliver of the unscaled uplift...
    expect(r01 - 1).toBeLessThan(0.15 * (rUnscaled - 1));
    expect(r01).toBeGreaterThan(0.9); // ...and never a heavy-handed blur/attenuation either.
    // ...but the pipeline structure is intact: the sharpness toggle still changes the output.
    const sharpOff = enhanceImage(img.slice(), w, h, { ...P, sharpness: 0 }, undefined, 0.1).enhanced;
    const sharpOn = enhanceImage(img.slice(), w, h, { ...P, sharpness: 1 }, undefined, 0.1).enhanced;
    expect(bitIdentical(sharpOff, sharpOn)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Threading — module ctx, worker pool, GPU port (single source)
// ---------------------------------------------------------------------------------------------

describe('kernelScale threading', () => {
  it('EnhanceModule.process threads ctx.kernelScale into enhanceImage (bit-exact)', () => {
    const w = 96, h = 64;
    const img = scene(w, h, w);
    const m = new EnhanceModule();
    m.setParams({ enabled: true, sharpen: true, upscale: false });
    const viaCtx = m.process(img.slice(), { width: w, height: h, channels: 4, kernelScale: 0.25 });
    const direct = enhanceImage(img.slice(), w, h, { ...m.getParams(), upscale: false }, undefined, 0.25).enhanced;
    expect(bitIdentical(viaCtx, direct)).toBe(true);
    const withoutScale = m.process(img.slice(), { width: w, height: h, channels: 4 });
    expect(bitIdentical(viaCtx, withoutScale)).toBe(false);
  });

  it('ImageProcessingPipeline forwards context.kernelScale on the worker-pool imageData', async () => {
    const pipeline = new ImageProcessingPipeline();
    let captured: { kernelScale?: number } | null = null;
    setWorkerPool({
      shouldUseWorkers: () => true,
      processImage: async (imageData) => {
        captured = imageData as unknown as { kernelScale?: number };
        return { success: true, data: (imageData as { data: Float32Array }).data, processingTime: 0 };
      },
    });
    try {
      const w = 300, h = 240; // ≥ the 256×256 small-preview floor so the pool path is taken
      const data = new Float32Array(w * h * 4).fill(0.5);
      await pipeline.processImage(data, { width: w, height: h, channels: 4, kernelScale: 0.42 });
      expect(captured).not.toBeNull();
      expect(captured!.kernelScale).toBe(0.42);
    } finally {
      setWorkerPool({
        shouldUseWorkers: () => false,
        processImage: async (imageData) => ({
          success: false, data: (imageData as { data: Float32Array }).data, processingTime: 0,
        }),
      });
    }
  });
});

describe('kernelScale threading — source pins (jsdom cannot boot real workers/WebGL2)', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8');

  it('GPU parity port: runEnhanceChain takes kernelScale and derives σ/peak from effectiveEnhanceKernels', () => {
    const src = read('../shaders/GpuPreviewPipeline.ts');
    expect(src).toMatch(/runEnhanceChain\([^)]*kernelScale/);
    expect(src).toMatch(/effectiveEnhanceKernels\(/);
    expect(src).toMatch(/casPeak\(params\.sharpness\)\s*\*\s*eff\.casGain/);
    // Radius guards + uniforms must read the EFFECTIVE sigmas, not the raw params.
    expect(src).toMatch(/2\s*\*\s*eff\.psfSigma\s*\*\s*eff\.psfSigma/);
    expect(src).toMatch(/2\s*\*\s*eff\.hpSigma\s*\*\s*eff\.hpSigma/);
  });

  it('pipeline.worker: kernelScale rides both PROCESS_IMAGE and PROCESS_TILE into the ProcessingContext', () => {
    const src = read('../workers/pipeline.worker.ts');
    const hits = src.match(/kernelScale/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it('WebWorkerImageProcessor: the PROCESS_TILE message carries imageData.kernelScale (full-pass scale, not tile dims)', () => {
    const src = read('../services/WebWorkerImageProcessor.ts');
    expect(src).toMatch(/kernelScale:\s*imageData\.kernelScale/);
  });

  it('AdjustmentPanel: the preview derives kernelScale once and threads it to both CPU paths', () => {
    const src = read('../components/Panels/AdjustmentPanel.tsx');
    expect(src).toMatch(/enhanceKernelScale\(/);
    const hits = src.match(/kernelScale/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('tiled apron stays sized from NATIVE params — the C5 preview scaling must never shrink it', () => {
    const src = read('../utils/tiledPipeline.ts');
    expect(src).toMatch(/kernelScale/); // the explicit do-not-shrink statement in moduleApron's enhance case
  });
});
