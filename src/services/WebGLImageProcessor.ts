/**
 * WebGL2 image processor — GPU acceleration for the per-pixel edit pipeline.
 *
 * Uploads an RGBA Float32 image as a float texture, runs fragment-shader passes
 * into an RGBA32F framebuffer, and reads the result back as Float32. Two programs
 * are provided: a minimal `exposure` pass (the original POC, kept for the startup
 * benchmark) and a full `basicAdjustments` pass that faithfully replicates
 * BasicAdjustmentsModule's math (exposure, black point, brightness, contrast,
 * dehaze, highlights/shadows, saturation, vibrance).
 *
 * Safety: everything degrades to an identical CPU implementation when WebGL2 /
 * EXT_color_buffer_float is unavailable (jsdom, weak GPUs). On init the GPU
 * basic-adjustments output is compared against the CPU reference on a small image;
 * if they diverge beyond a tiny tolerance the GPU path is disabled, so the GPU is
 * only ever used when it matches the CPU result — no possibility of a regression.
 */
import { logger } from '../utils/Logger';
import { rgbToHsl, hslToRgb, smoothStep } from '../modules/utils/ColorUtils';
import {
  VERT_SRC,
  FRAG_EXPOSURE,
  FRAG_GAINS,
  FRAG_DENOISE,
  FRAG_COLORBALANCE,
  FRAG_TONECURVE,
  FRAG_VIGNETTE,
  FRAG_HUECURVES,
  FRAG_DISTORTION,
  FRAG_LATERALCA,
  FRAG_BASICADJ,
  FRAG_SHADOWSHIGHLIGHTS,
} from '../shaders/sources';
import {
  exposureUniforms,
  gainsUniforms,
  basicAdjUniforms,
  colorBalanceUniforms,
  toneCurveUniforms,
  vignetteUniforms,
  distortionUniforms,
  lateralCAUniforms,
  hueCurvesUniforms,
  denoiseUniforms,
  shadowsHighlightsUniforms,
} from '../shaders/uniforms';
import { ShadowsHighlightsModule, ShadowsHighlightsParams } from '../modules/ShadowsHighlightsModule';

export interface BasicAdjustmentsParams {
  black_point: number;
  exposure: number;
  contrast: number;
  brightness: number;
  saturation: number;
  vibrance: number;
  dehaze: number;
  highlights: number;
  shadows: number;
}

export type HueCurveLuts = {
  hueVsHue: Float32Array | null; hueVsSat: Float32Array | null; hueVsLum: Float32Array | null;
  satVsSat: Float32Array | null; lumVsSat: Float32Array | null;
};


const LUM = { R: 0.299, G: 0.587, B: 0.114 };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface DehazeState { active: boolean; hazeStrength: number; hazeDivisor: number; }

// ── Color Balance helpers (mirror ColorBalanceModule exactly) ────────────────
function cbTonalWeight(l: number, range: 0 | 1 | 2): number {
  if (range === 0) return l < 0.33 ? 1.0 : Math.max(0, (0.66 - l) / 0.33);
  if (range === 1) return (l >= 0.33 && l <= 0.66) ? 1.0 : (l < 0.33 ? Math.max(0, l / 0.33) : Math.max(0, (1.0 - l) / 0.34));
  return l > 0.66 ? 1.0 : Math.max(0, (l - 0.33) / 0.33);
}
const CB_RANGES: number[][] = [[345, 360, 0, 15], [15, 45], [45, 75], [75, 165], [165, 195], [195, 255], [255, 285], [285, 345]];
function cbColorWeight(hue: number, i: number): number {
  const range = CB_RANGES[i];
  if (range.length === 4) {
    const [s1, e1, s2, e2] = range;
    if ((hue >= s1 && hue <= e1) || (hue >= s2 && hue <= e2)) return 1.0;
    return Math.max(0, 1 - Math.min(Math.min(Math.abs(hue - s1), Math.abs(hue - e1)), Math.min(Math.abs(hue - s2), Math.abs(hue - e2))) / 30);
  }
  const [s, e] = range;
  if (hue >= s && hue <= e) return 1.0;
  return Math.max(0, 1 - Math.min(Math.abs(hue - s), Math.abs(hue - e)) / 30);
}
const CB_SELFTEST = (() => {
  const w = 8, h = 8;
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i % 8) / 8; data[i * 4 + 1] = ((i * 5) % 8) / 8; data[i * 4 + 2] = ((i * 3) % 8) / 8; data[i * 4 + 3] = 1;
  }
  return { data, w, h };
})();
const CB_T = {
  shadows: [0.3, -0.2, 0.1], mid: [0.1, 0.2, -0.1], high: [-0.2, 0.1, 0.3],
  sat: [10, -5, 8, 0, 0, 12, 0, -8], lum: [5, 0, -5, 8, 0, 0, 10, 0], hue: [10, 0, -10, 0, 15, 0, 0, -12],
};

// Non-neutral S/H self-check params. Exercises EVERY GPU op: shadow + highlight
// recovery with color transfer (preserveColor:false), white/black point, compress,
// shadow/highlight color correction, strength≠1, 2 iterations. maskBlur MUST be 0
// (the only mode the analytic shader is valid for) and bilateralFilter false.
const SH_T: ShadowsHighlightsParams = {
  enabled: true,
  shadows: 70, shadowsRadius: 60, shadowsColorTransfer: 30,
  highlights: 35, highlightsRadius: 55, highlightsColorTransfer: 20,
  whitePoint: 0.5, blackPoint: 5,
  compress: 25, shadowsColorCorrection: 15, highlightsColorCorrection: 10,
  maskBlur: 0, maskFalloff: 2.0, preserveColor: false,
  bilateralFilter: false, iterations: 2, strength: 1.2,
};

class WebGLImageProcessor {
  private gl: WebGL2RenderingContext | null = null;
  private maxTextureSize = 0; // GPU MAX_TEXTURE_SIZE; passes above a safe cap fall back to CPU
  private exposureProgram: WebGLProgram | null = null;
  private basicAdjProgram: WebGLProgram | null = null;
  private gainsProgram: WebGLProgram | null = null;
  private denoiseProgram: WebGLProgram | null = null;
  private colorBalanceProgram: WebGLProgram | null = null;
  private colorBalanceVerified: boolean | null = null;
  private toneCurveProgram: WebGLProgram | null = null;
  private toneCurveVerified: boolean | null = null;
  private vignetteProgram: WebGLProgram | null = null;
  private vignetteVerified: boolean | null = null;
  private hueCurvesProgram: WebGLProgram | null = null;
  private hueCurvesVerified: boolean | null = null;
  private distortionProgram: WebGLProgram | null = null;
  private distortionVerified: boolean | null = null;
  private lateralCAProgram: WebGLProgram | null = null;
  private lateralCAVerified: boolean | null = null;
  private shadowsHighlightsProgram: WebGLProgram | null = null;
  private shadowsHighlightsVerified: boolean | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private initTried = false;

  private ensureContext(): WebGL2RenderingContext | null {
    if (this.initTried) return this.gl;
    this.initTried = true;
    try {
      if (typeof document === 'undefined') return (this.gl = null);
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
      if (!gl || typeof gl.getExtension !== 'function' || !gl.getExtension('EXT_color_buffer_float')) {
        logger.info('[GPU] WebGL2 / float render targets unavailable — CPU fallback');
        return (this.gl = null);
      }
      const exposureProgram = this.buildProgram(gl, VERT_SRC, FRAG_EXPOSURE);
      const basicAdjProgram = this.buildProgram(gl, VERT_SRC, FRAG_BASICADJ);
      const gainsProgram = this.buildProgram(gl, VERT_SRC, FRAG_GAINS);
      const denoiseProgram = this.buildProgram(gl, VERT_SRC, FRAG_DENOISE);
      const colorBalanceProgram = this.buildProgram(gl, VERT_SRC, FRAG_COLORBALANCE);
      const toneCurveProgram = this.buildProgram(gl, VERT_SRC, FRAG_TONECURVE);
      const vignetteProgram = this.buildProgram(gl, VERT_SRC, FRAG_VIGNETTE);
      const distortionProgram = this.buildProgram(gl, VERT_SRC, FRAG_DISTORTION);
      const lateralCAProgram = this.buildProgram(gl, VERT_SRC, FRAG_LATERALCA);
      if (!exposureProgram || !basicAdjProgram || !gainsProgram || !denoiseProgram || !colorBalanceProgram || !toneCurveProgram || !vignetteProgram || !distortionProgram || !lateralCAProgram) return (this.gl = null);

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const aPos = gl.getAttribLocation(exposureProgram, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      this.gl = gl;
      this.exposureProgram = exposureProgram;
      this.basicAdjProgram = basicAdjProgram;
      this.gainsProgram = gainsProgram;
      this.denoiseProgram = denoiseProgram;
      this.colorBalanceProgram = colorBalanceProgram;
      this.toneCurveProgram = toneCurveProgram;
      this.vignetteProgram = vignetteProgram;
      this.distortionProgram = distortionProgram;
      this.lateralCAProgram = lateralCAProgram;
      // Optional program: the hue-curves shader uses array uniforms some drivers may
      // reject. A compile failure must NOT disable the other (required) GPU ops, so
      // build it here without gating the context on it.
      this.hueCurvesProgram = this.buildProgram(gl, VERT_SRC, FRAG_HUECURVES);
      // Optional program: shadows/highlights. Built without gating the context so a
      // compile failure leaves only S/H on the CPU, not the whole GPU path.
      this.shadowsHighlightsProgram = this.buildProgram(gl, VERT_SRC, FRAG_SHADOWSHIGHLIGHTS);
      this.vao = vao;

      // Self-check: only trust the GPU basic-adjustments path if it matches the CPU
      // reference. Guarantees no visual regression even if a shader is subtly wrong.
      if (!this.selfCheck()) {
        logger.warn('[GPU] basic-adjustments self-check failed — disabling GPU path');
        return (this.gl = null);
      }
      logger.info('[GPU] WebGL2 image processor initialised + verified');
      return this.gl;
    } catch (e) {
      logger.warn('[GPU] WebGL2 init failed — CPU fallback:', e instanceof Error ? e.message : String(e));
      return (this.gl = null);
    }
  }

  private buildProgram(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        logger.warn('[GPU] shader compile error:', gl.getShaderInfoLog(sh) ?? '');
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      logger.warn('[GPU] program link error:', gl.getProgramInfoLog(program) ?? '');
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  /** Verify GPU basic-adjustments == CPU reference on a small mixed image. */
  private selfCheck(): boolean {
    const w = 8, h = 8;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = (i % 8) / 8; data[i * 4 + 1] = ((i * 3) % 8) / 8;
      data[i * 4 + 2] = ((i * 5) % 8) / 8; data[i * 4 + 3] = 1;
    }
    const p: BasicAdjustmentsParams = {
      exposure: 0.3, black_point: 0.1, brightness: 0.2, contrast: 0.5,
      dehaze: 0.2, highlights: 0.4, shadows: -0.3, saturation: 0.3, vibrance: 0.2,
    };
    const cpu = this.basicAdjustmentsCPU(data, w, h, p);
    let gpu: Float32Array | null = null;
    try { gpu = this.runBasicAdjGPU(this.gl!, data, w, h, p); } catch { return false; }
    if (!gpu) return false;
    let maxDiff = 0;
    for (let i = 0; i < cpu.length; i++) maxDiff = Math.max(maxDiff, Math.abs(gpu[i] - cpu[i]));
    logger.info(`[GPU] basic-adjustments self-check maxDiff=${maxDiff.toExponential(2)}`);
    return maxDiff < 0.01; // < ~2.5/255, well within visual tolerance
  }

  isAvailable(): boolean { return this.ensureContext() !== null; }

  applyExposure(data: Float32Array, width: number, height: number, stops: number): Float32Array {
    const gain = Math.pow(2, stops);
    const gl = this.ensureContext();
    if (gl && this.exposureProgram && this.vao) {
      try { return this.runExposureGPU(gl, data, width, height, gain); }
      catch (e) { logger.warn('[GPU] exposure failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = data[i] * gain; out[i + 1] = data[i + 1] * gain; out[i + 2] = data[i + 2] * gain; out[i + 3] = data[i + 3];
    }
    return out;
  }

  /** Apply the full Basic Adjustments set. GPU when verified-available, else identical CPU. */
  applyBasicAdjustments(data: Float32Array, width: number, height: number, p: BasicAdjustmentsParams): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.basicAdjProgram && this.vao) {
      try {
        const out = this.runBasicAdjGPU(gl, data, width, height, p);
        if (out) return out;
      } catch (e) {
        logger.warn('[GPU] basic-adjustments failed — CPU:', e instanceof Error ? e.message : String(e));
      }
    }
    return this.basicAdjustmentsCPU(data, width, height, p);
  }

  /** Apply pre-computed per-channel gains + clamp (white balance). GPU or CPU. */
  applyChannelGains(data: Float32Array, width: number, height: number, gr: number, gg: number, gb: number): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.gainsProgram && this.vao) {
      try {
        return this.runPass(this.gainsProgram, data, width, height, gainsUniforms(gr, gg, gb));
      } catch (e) { logger.warn('[GPU] gains failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = Math.max(0, Math.min(1, data[i] * gr));
      out[i + 1] = Math.max(0, Math.min(1, data[i + 1] * gg));
      out[i + 2] = Math.max(0, Math.min(1, data[i + 2] * gb));
      out[i + 3] = data[i + 3];
    }
    return out;
  }

  /** GPU Non-Local-Means denoise. Returns null when no GPU (caller falls back to CPU). */
  denoise(data: Float32Array, width: number, height: number, strength: number): Float32Array | null {
    const gl = this.ensureContext();
    if (!gl || !this.denoiseProgram || !this.vao) return null;
    try {
      return this.runPass(this.denoiseProgram, data, width, height, denoiseUniforms(width, height, strength));
    } catch (e) {
      logger.warn('[GPU] denoise failed:', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** Apply Color Balance (3-range tonal + 8-hue HSL). GPU when verified, else CPU. */
  applyColorBalance(
    data: Float32Array, width: number, height: number,
    shadows: number[], mid: number[], high: number[], sat: number[], lum: number[], hue: number[]
  ): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.colorBalanceProgram && this.vao && this.verifyColorBalance()) {
      try { return this.runColorBalanceGPU(gl, data, width, height, shadows, mid, high, sat, lum, hue); }
      catch (e) { logger.warn('[GPU] color-balance failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.colorBalanceCPU(data, width, height, shadows, mid, high, sat, lum, hue);
  }

  private runColorBalanceGPU(
    gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number,
    shadows: number[], mid: number[], high: number[], sat: number[], lum: number[], hue: number[]
  ): Float32Array {
    void gl;
    return this.runPass(this.colorBalanceProgram!, data, width, height,
      colorBalanceUniforms(shadows, mid, high, sat, lum, hue));
  }

  private verifyColorBalance(): boolean {
    if (this.colorBalanceVerified !== null) return this.colorBalanceVerified;
    let ok = false;
    try {
      const { data, w, h } = CB_SELFTEST;
      const a = this.runColorBalanceGPU(this.gl!, data, w, h, CB_T.shadows, CB_T.mid, CB_T.high, CB_T.sat, CB_T.lum, CB_T.hue);
      const c = this.colorBalanceCPU(data, w, h, CB_T.shadows, CB_T.mid, CB_T.high, CB_T.sat, CB_T.lum, CB_T.hue);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02; // HSL round-trip → slightly looser than the per-pixel ops
      logger.info(`[GPU] color-balance self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] color-balance self-check error:', e instanceof Error ? e.message : String(e)); }
    this.colorBalanceVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of ColorBalanceModule.process (keep formula-identical
   *  with it AND with sources.ts FRAG_COLORBALANCE: normalised band weights,
   *  chroma gate, proportional saturation, headroom-mapped luminance). */
  colorBalanceCPU(
    data: Float32Array, _width: number, _height: number,
    shadows: number[], mid: number[], high: number[], sat: number[], lum: number[], hue: number[]
  ): Float32Array {
    const out = new Float32Array(data);
    const ranges: [number[], 0 | 1 | 2][] = [[shadows, 0], [mid, 1], [high, 2]];
    const bandW = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < out.length; i += 4) {
      let r = out[i], g = out[i + 1], b = out[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      for (const [vals, rng] of ranges) {
        const w = cbTonalWeight(luminance, rng);
        if (w > 0.01) { r += vals[0] * w * 0.3; g += vals[1] * w * 0.3; b += vals[2] * w * 0.3; }
      }
      r = clamp01(r); g = clamp01(g); b = clamp01(b);
      const [h, s, l] = rgbToHsl(r, g, b);
      let wSum = 0;
      for (let c = 0; c < 8; c++) { bandW[c] = cbColorWeight(h, c); wSum += bandW[c]; }
      const scale = Math.min(1, s / 20) / Math.max(1, wSum);
      let hueShift = 0, satAdj = 0, lumAdj = 0;
      for (let c = 0; c < 8; c++) {
        const w = bandW[c] * scale;
        hueShift += hue[c] * w; satAdj += (sat[c] / 100) * w; lumAdj += (lum[c] / 100) * w;
      }
      const nh = ((h + hueShift) % 360 + 360) % 360;
      const ns = Math.max(0, Math.min(100, s * (1 + satAdj)));
      const nl = Math.max(0, Math.min(100, lumAdj >= 0 ? l + (100 - l) * lumAdj : l + l * lumAdj));
      const [nr, ng, nb] = hslToRgb(nh, ns, nl);
      out[i] = clamp01(nr); out[i + 1] = clamp01(ng); out[i + 2] = clamp01(nb);
    }
    return out;
  }

  /**
   * Apply Shadows/Highlights. GPU when verified AND maskBlur==0 (the analytic single-pass
   * shader only matches the CPU when the tone masks are NOT box-blurred). For maskBlur>0
   * or bilateralFilter, the caller (passDescriptors / pipeline) must route to the CPU
   * module; this method itself guards on maskBlur==0 && !bilateralFilter and otherwise
   * runs the CPU reference so a direct call is always correct.
   */
  applyShadowsHighlights(
    data: Float32Array, width: number, height: number, params: ShadowsHighlightsParams
  ): Float32Array {
    const gpuEligible = params.maskBlur === 0 && !params.bilateralFilter;
    const gl = this.ensureContext();
    if (gpuEligible && gl && this.shadowsHighlightsProgram && this.vao && this.verifyShadowsHighlights()) {
      try {
        return this.runPass(this.shadowsHighlightsProgram, data, width, height,
          shadowsHighlightsUniforms(params));
      } catch (e) { logger.warn('[GPU] shadows/highlights failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.shadowsHighlightsCPU(data, width, height, params);
  }

  /** CPU reference — the real ShadowsHighlightsModule (single source of truth). */
  shadowsHighlightsCPU(
    data: Float32Array, width: number, height: number, params: ShadowsHighlightsParams
  ): Float32Array {
    const mod = new ShadowsHighlightsModule();
    mod.setParams({ ...params, enabled: true });
    // The module copies the input internally (new Float32Array(data)); pass a copy
    // anyway so this method never mutates the caller's buffer.
    const result = mod.process({ width, height, data: new Float32Array(data), channels: 4 });
    return result.data;
  }

  private verifyShadowsHighlights(): boolean {
    if (this.shadowsHighlightsVerified !== null) return this.shadowsHighlightsVerified;
    let ok = false;
    try {
      const { data, w, h } = CB_SELFTEST;
      // Non-neutral params that exercise EVERY GPU op: shadow + highlight recovery
      // (color-transfer ON via preserveColor:false), white/black point, compress,
      // color correction, strength≠1, 2 iterations — all with maskBlur:0 (the only
      // mode the shader is valid for) and bilateralFilter:false.
      const p = SH_T;
      const a = this.runPass(this.shadowsHighlightsProgram!, data, w, h, shadowsHighlightsUniforms(p));
      const c = this.shadowsHighlightsCPU(data, w, h, p);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      // pow() + additive color mixing → same tolerance class as color-balance.
      ok = maxDiff < 0.02;
      logger.info(`[GPU] shadows/highlights self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] shadows/highlights self-check error:', e instanceof Error ? e.message : String(e)); }
    this.shadowsHighlightsVerified = ok;
    return ok;
  }

  /** Apply Tone Curve (base curve + per-channel RGB curves). GPU when verified, else CPU. */
  applyToneCurve(
    data: Float32Array, width: number, height: number,
    master: Float32Array, red: Float32Array, green: Float32Array, blue: Float32Array, preserveColors: number
  ): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.toneCurveProgram && this.vao && this.verifyToneCurve()) {
      try { return this.runToneCurveGPU(gl, data, width, height, master, red, green, blue, preserveColors); }
      catch (e) { logger.warn('[GPU] tone-curve failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.toneCurveCPU(data, width, height, master, red, green, blue, preserveColors);
  }

  private makeLutTexture(gl: WebGL2RenderingContext, lut: Float32Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 256, 0, gl.RED, gl.FLOAT, lut); // 65536 entries
    return tex;
  }

  private runToneCurveGPU(
    gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number,
    master: Float32Array, red: Float32Array, green: Float32Array, blue: Float32Array, preserveColors: number
  ): Float32Array {
    const prog = this.toneCurveProgram!;
    const tex = this.makeTexture(gl, width, height, data);
    const luts = [this.makeLutTexture(gl, master), this.makeLutTexture(gl, red), this.makeLutTexture(gl, green), this.makeLutTexture(gl, blue)];
    const dst = this.makeTexture(gl, width, height, null);
    const fbo = gl.createFramebuffer();
    const cleanup = () => { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst); luts.forEach(t => gl.deleteTexture(t)); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { cleanup(); throw new Error('framebuffer incomplete'); }
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    toneCurveUniforms(preserveColors)(gl, prog);
    const names = ['u_image', 'u_master', 'u_red', 'u_green', 'u_blue'];
    [tex, ...luts].forEach((t, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(gl.getUniformLocation(prog, names[unit]), unit);
    });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    cleanup();
    return out;
  }

  private verifyToneCurve(): boolean {
    if (this.toneCurveVerified !== null) return this.toneCurveVerified;
    let ok = false;
    try {
      const master = new Float32Array(65536), red = new Float32Array(65536), green = new Float32Array(65536), blue = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) {
        const v = i / 65535;
        master[i] = Math.pow(v, 1 / 1.5); red[i] = Math.min(1, v * 1.1); green[i] = v; blue[i] = Math.max(0, v * 0.9);
      }
      const { data, w, h } = CB_SELFTEST;
      const a = this.runToneCurveGPU(this.gl!, data, w, h, master, red, green, blue, 1);
      const c = this.toneCurveCPU(data, w, h, master, red, green, blue, 1);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02;
      logger.info(`[GPU] tone-curve self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] tone-curve self-check error:', e instanceof Error ? e.message : String(e)); }
    this.toneCurveVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of ToneCurveModule applyBaseCurve + applyRGBCurves. */
  toneCurveCPU(
    data: Float32Array, _width: number, _height: number,
    master: Float32Array, red: Float32Array, green: Float32Array, blue: Float32Array, preserveColors: number
  ): Float32Array {
    const out = new Float32Array(data);
    const idx = (v: number) => Math.min(65535, Math.floor(v * 65535));
    for (let i = 0; i < out.length; i += 4) {
      let r = out[i], g = out[i + 1], b = out[i + 2];
      if (preserveColors === 1) {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > 0) { const sc = master[idx(lum)] / lum; r = clamp01(r * sc); g = clamp01(g * sc); b = clamp01(b * sc); }
      } else {
        r = master[idx(r)]; g = master[idx(g)]; b = master[idx(b)];
      }
      out[i] = red[idx(r)]; out[i + 1] = green[idx(g)]; out[i + 2] = blue[idx(b)];
    }
    return out;
  }

  /** Apply lens vignetting correction (radial). GPU when verified, else CPU. */
  applyVignetting(
    data: Float32Array, width: number, height: number,
    strength: number, midpoint: number, roundnessNorm: number, featherNorm: number
  ): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.vignetteProgram && this.vao && this.verifyVignette()) {
      try {
        return this.runPass(this.vignetteProgram, data, width, height,
          vignetteUniforms(width, height, strength, midpoint, roundnessNorm, featherNorm));
      } catch (e) { logger.warn('[GPU] vignette failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.vignettingCPU(data, width, height, strength, midpoint, roundnessNorm, featherNorm);
  }

  private verifyVignette(): boolean {
    if (this.vignetteVerified !== null) return this.vignetteVerified;
    let ok = false;
    try {
      const { data, w, h } = CB_SELFTEST;
      const a = this.runPass(this.vignetteProgram!, data, w, h,
        vignetteUniforms(w, h, 0.5, 0.5, 0.2, 0.6));
      const c = this.vignettingCPU(data, w, h, 0.5, 0.5, 0.2, 0.6);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02;
      logger.info(`[GPU] vignette self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] vignette self-check error:', e instanceof Error ? e.message : String(e)); }
    this.vignetteVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of LensCorrectionsModule.correctVignetting. */
  vignettingCPU(
    data: Float32Array, width: number, height: number,
    strength: number, midpoint: number, roundnessNorm: number, featherNorm: number
  ): Float32Array {
    const result = new Float32Array(data);
    const cx = width / 2, cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dx = (x - cx) / cx;
        const dy = ((y - cy) / cy) * (1 + roundnessNorm);
        const nd = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2);
        let mask = 1;
        if (nd > 0) {
          const fs = midpoint * 0.5, fe = midpoint * 1.5;
          if (nd > fs) {
            const fp = Math.min(1, (nd - fs) / (fe - fs));
            const sf = smoothStep(0, 1, fp);
            const ff = fp * (1 - featherNorm) + sf * featherNorm;
            mask = 1 - ff;
          }
        }
        const factor = 1 + strength * (1 / Math.max(0.1, mask) - 1);
        result[i] *= factor; result[i + 1] *= factor; result[i + 2] *= factor;
      }
    }
    return result;
  }

  /** Apply Hue Curves (5 curves via 256-entry LUTs). GPU when verified, else CPU. */
  applyHueCurves(data: Float32Array, width: number, height: number, luts: HueCurveLuts, blend: number): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.hueCurvesProgram && this.vao && this.verifyHueCurves()) {
      try { return this.runHueCurvesGPU(gl, data, width, height, luts, blend); }
      catch (e) { logger.warn('[GPU] hue-curves failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.hueCurvesCPU(data, width, height, luts, blend);
  }

  private runHueCurvesGPU(
    gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number, luts: HueCurveLuts, blend: number
  ): Float32Array {
    void gl;
    return this.runPass(this.hueCurvesProgram!, data, width, height, hueCurvesUniforms(luts, blend));
  }

  private verifyHueCurves(): boolean {
    if (this.hueCurvesVerified !== null) return this.hueCurvesVerified;
    let ok = false;
    try {
      const mk = (fn: (x: number) => number) => { const a = new Float32Array(256); for (let i = 0; i < 256; i++) a[i] = fn(i / 255); return a; };
      const luts: HueCurveLuts = {
        hueVsHue: mk(x => Math.min(1, Math.max(0, 0.5 + 0.1 * Math.sin(x * 6.2831)))),
        hueVsSat: mk(x => 0.5 + 0.2 * x),
        hueVsLum: null,
        satVsSat: mk(x => x * x),
        lumVsSat: null,
      };
      const { data, w, h } = CB_SELFTEST;
      const a = this.runHueCurvesGPU(this.gl!, data, w, h, luts, 0.8);
      const c = this.hueCurvesCPU(data, w, h, luts, 0.8);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02;
      logger.info(`[GPU] hue-curves self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] hue-curves self-check error:', e instanceof Error ? e.message : String(e)); }
    this.hueCurvesVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of HueCurvesModule.process (post HSL-scale fix). */
  hueCurvesCPU(data: Float32Array, _width: number, _height: number, luts: HueCurveLuts, blend: number): Float32Array {
    const out = new Float32Array(data);
    const samp = (lut: Float32Array, x: number) => {
      const idx = Math.max(0, Math.min(1, x)) * 255;
      const lo = Math.floor(idx), hi = Math.min(lo + 1, 255);
      const t = idx - lo;
      return lut[lo] * (1 - t) + lut[hi] * t;
    };
    for (let i = 0; i < out.length; i += 4) {
      const r = out[i], g = out[i + 1], b = out[i + 2];
      const hsl = rgbToHsl(r, g, b);
      let h = hsl[0] / 360, s = hsl[1] / 100, l = hsl[2] / 100;
      if (luts.hueVsHue) { const sh = samp(luts.hueVsHue, h) - 0.5; h = (h + sh + 1) % 1; }
      if (luts.hueVsSat) s = Math.min(1, s * (samp(luts.hueVsSat, h) * 2));
      if (luts.hueVsLum) l = Math.min(1, l * (samp(luts.hueVsLum, h) * 2));
      if (luts.satVsSat) s = samp(luts.satVsSat, s);
      if (luts.lumVsSat) s = Math.min(1, s * (samp(luts.lumVsSat, l) * 2));
      const [nr, ng, nb] = hslToRgb(h * 360, s * 100, l * 100);
      out[i] = r + (nr - r) * blend;
      out[i + 1] = g + (ng - g) * blend;
      out[i + 2] = b + (nb - b) * blend;
    }
    return out;
  }

  /** Apply lens distortion (barrel + perspective + scale). GPU when verified, else CPU. */
  applyDistortion(
    data: Float32Array, width: number, height: number,
    barrelAmount: number, scale: number, perspH: number, perspV: number
  ): Float32Array {
    const gl = this.ensureContext();
    if (gl && this.distortionProgram && this.vao && this.verifyDistortion()) {
      try {
        return this.runPass(this.distortionProgram, data, width, height,
          distortionUniforms(width, height, barrelAmount, scale, perspH, perspV));
      } catch (e) { logger.warn('[GPU] distortion failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.distortionCPU(data, width, height, barrelAmount, scale, perspH, perspV);
  }

  private verifyDistortion(): boolean {
    if (this.distortionVerified !== null) return this.distortionVerified;
    let ok = false;
    try {
      const { data, w, h } = CB_SELFTEST;
      // Mild barrel only → all samples interior (no out-of-bounds discontinuity),
      // and the manual bilinear is continuous so GPU/CPU agree to ~float precision.
      const a = this.runPass(this.distortionProgram!, data, w, h,
        distortionUniforms(w, h, 0.1, 1.0, 0.0, 0.0));
      const c = this.distortionCPU(data, w, h, 0.1, 1.0, 0.0, 0.0);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02;
      logger.info(`[GPU] distortion self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] distortion self-check error:', e instanceof Error ? e.message : String(e)); }
    this.distortionVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of LensCorrectionsModule.correctDistortion (non-identity). */
  distortionCPU(
    data: Float32Array, width: number, height: number,
    barrelAmount: number, scale: number, perspH: number, perspV: number
  ): Float32Array {
    const result = new Float32Array(data.length);
    const cx = width / 2, cy = height / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;
        let nx = (x - cx) / cx, ny = (y - cy) / cy;
        if (barrelAmount !== 0) {
          const r = Math.sqrt(nx * nx + ny * ny);
          if (r > 0) { const f = 1 + barrelAmount * r * r; nx /= f; ny /= f; }
        }
        if (perspH !== 0 || perspV !== 0) {
          const cH = Math.cos(perspH), sH = Math.sin(perspH), cV = Math.cos(perspV), sV = Math.sin(perspV);
          const xr = nx * cH - sH, zr = nx * sH + cH;
          const yr = ny * cV - zr * sV, zf = ny * sV + zr * cV;
          if (zf > 0.1) { nx = xr / zf; ny = yr / zf; }
        }
        nx /= scale; ny /= scale;
        const srcX = nx * cx + cx, srcY = ny * cy + cy;
        if (srcX >= 0 && srcX < width - 1 && srcY >= 0 && srcY < height - 1) {
          const x0 = Math.floor(srcX), y0 = Math.floor(srcY), x1 = x0 + 1, y1 = y0 + 1;
          const wx = srcX - x0, wy = srcY - y0;
          const i00 = (y0 * width + x0) * 4, i01 = (y0 * width + x1) * 4, i10 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
          for (let c = 0; c < 4; c++) {
            const p0 = data[i00 + c] * (1 - wx) + data[i01 + c] * wx;
            const p1 = data[i10 + c] * (1 - wx) + data[i11 + c] * wx;
            result[dst + c] = p0 * (1 - wy) + p1 * wy;
          }
        } else {
          result[dst] = 0; result[dst + 1] = 0; result[dst + 2] = 0; result[dst + 3] = data[dst + 3];
        }
      }
    }
    return result;
  }

  /** Apply lateral chromatic aberration (R/B radial shift). GPU when verified, else CPU. */
  applyLateralCA(data: Float32Array, width: number, height: number, redCyan: number, blueMagenta: number): Float32Array {
    const redShift = redCyan * 0.001, blueShift = blueMagenta * 0.001;
    const gl = this.ensureContext();
    if (gl && this.lateralCAProgram && this.vao && this.verifyLateralCA()) {
      try {
        return this.runPass(this.lateralCAProgram, data, width, height,
          lateralCAUniforms(width, height, redShift, blueShift));
      } catch (e) { logger.warn('[GPU] lateral-CA failed — CPU:', e instanceof Error ? e.message : String(e)); }
    }
    return this.lateralCACPU(data, width, height, redShift, blueShift);
  }

  private verifyLateralCA(): boolean {
    if (this.lateralCAVerified !== null) return this.lateralCAVerified;
    let ok = false;
    try {
      const { data, w, h } = CB_SELFTEST;
      const a = this.runPass(this.lateralCAProgram!, data, w, h,
        lateralCAUniforms(w, h, 0.02, -0.01));
      const c = this.lateralCACPU(data, w, h, 0.02, -0.01);
      let maxDiff = 0;
      for (let i = 0; i < c.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - c[i]));
      ok = maxDiff < 0.02;
      logger.info(`[GPU] lateral-CA self-check maxDiff=${maxDiff.toExponential(2)} -> ${ok ? 'GPU' : 'CPU fallback'}`);
    } catch (e) { logger.warn('[GPU] lateral-CA self-check error:', e instanceof Error ? e.message : String(e)); }
    this.lateralCAVerified = ok;
    return ok;
  }

  /** CPU reference — a replica of LensCorrectionsModule.correctLateralCA. */
  lateralCACPU(data: Float32Array, width: number, height: number, redShift: number, blueShift: number): Float32Array {
    const out = new Float32Array(data); // R/B replaced below; G/A preserved
    const cx = width / 2, cy = height / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const sampleCh = (sx: number, sy: number, ch: number): number => {
      if (sx < 0 || sx >= width - 1 || sy < 0 || sy >= height - 1) return 0;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = x0 + 1, y1 = y0 + 1;
      const wx = sx - x0, wy = sy - y0;
      const p00 = data[(y0 * width + x0) * 4 + ch], p01 = data[(y0 * width + x1) * 4 + ch];
      const p10 = data[(y1 * width + x0) * 4 + ch], p11 = data[(y1 * width + x1) * 4 + ch];
      return (p00 * (1 - wx) + p01 * wx) * (1 - wy) + (p10 * (1 - wx) + p11 * wx) * wy;
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxR;
        const rs = 1 + redShift * dist * dist, bs = 1 + blueShift * dist * dist;
        out[i * 4] = sampleCh(cx + dx * rs, cy + dy * rs, 0);
        out[i * 4 + 2] = sampleCh(cx + dx * bs, cy + dy * bs, 2);
      }
    }
    return out;
  }

  /** Generic single-pass shader run: source texture → program → float readback. */
  private runPass(
    program: WebGLProgram, data: Float32Array, width: number, height: number,
    setUniforms: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void
  ): Float32Array {
    const gl = this.gl!;
    // Full-resolution exports (e.g. 5200x3904 RAW) can exceed the GPU's safe float
    // texture/FBO size: the RGBA32F upload/readback silently corrupts into noise.
    // The per-shader self-check only validates a tiny image, so it never catches
    // this. Above a conservative cap, throw so the caller falls back to the
    // (verified-correct) CPU path. The edit PREVIEW is always <=1024px, so this only
    // routes large exports through the CPU — editing stays GPU-fast.
    if (!this.maxTextureSize) this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    const safeDim = Math.min(this.maxTextureSize, 4096);
    if (width > safeDim || height > safeDim) {
      throw new Error(`[GPU] ${width}x${height} exceeds safe GPU size ${safeDim} — using CPU`);
    }
    const tex = this.makeTexture(gl, width, height, data);
    const dst = this.makeTexture(gl, width, height, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
      throw new Error('framebuffer incomplete');
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    setUniforms(gl, program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
    return out;
  }

  /**
   * Public single-source dehaze-state estimator. Delegates to the private
   * `computeDehaze` so the resident-texture GpuPreviewPipeline computes its
   * PassRuntime.dehaze from the SAME formula the per-module path uses — no copy.
   */
  computeDehazeState(data: Float32Array, width: number, height: number, dehaze: number): DehazeState {
    return this.computeDehaze(data, width, height, dehaze);
  }

  // ── dehaze pre-pass (identical to BasicAdjustmentsModule) ───────────────────
  private computeDehaze(data: Float32Array, width: number, height: number, dehaze: number): DehazeState {
    const clampedDehaze = Math.max(-1.0, Math.min(1.0, dehaze));
    const active = Math.abs(clampedDehaze) > 0.001;
    let hazeFloor = 0.0;
    if (active) {
      const total = width * height;
      const step = Math.max(1, Math.floor(total / 4096));
      const samples: number[] = [];
      for (let pp = 0; pp < total; pp += step) {
        const idx = pp * 4;
        samples.push(Math.min(data[idx], data[idx + 1], data[idx + 2]));
      }
      if (samples.length > 0) {
        samples.sort((a, b) => a - b);
        hazeFloor = samples[Math.floor(samples.length * 0.1)];
      }
    }
    const hazeStrength = active ? clampedDehaze * 0.5 * hazeFloor : 0.0;
    return { active, hazeStrength, hazeDivisor: 1.0 - hazeStrength };
  }

  private runBasicAdjGPU(
    gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number, p: BasicAdjustmentsParams
  ): Float32Array | null {
    const prog = this.basicAdjProgram!;
    const dz = this.computeDehaze(data, width, height, p.dehaze);
    const tex = this.makeTexture(gl, width, height, data);
    const dst = this.makeTexture(gl, width, height, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
      throw new Error('framebuffer incomplete');
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    basicAdjUniforms(p, dz)(gl, prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_image'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
    return out;
  }

  private runExposureGPU(gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number, gain: number): Float32Array {
    const tex = this.makeTexture(gl, width, height, data);
    const dst = this.makeTexture(gl, width, height, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
      throw new Error('framebuffer incomplete');
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.exposureProgram);
    exposureUniforms(gain)(gl, this.exposureProgram!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.exposureProgram!, 'u_image'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteTexture(dst);
    return out;
  }

  private makeTexture(gl: WebGL2RenderingContext, width: number, height: number, data: Float32Array | null): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
  }

  /** CPU reference — a line-for-line replica of BasicAdjustmentsModule.process. */
  basicAdjustmentsCPU(data: Float32Array, width: number, height: number, p: BasicAdjustmentsParams): Float32Array {
    const out = new Float32Array(data);
    const dz = this.computeDehaze(out, width, height, p.dehaze);
    const clampedDehaze = Math.max(-1, Math.min(1, p.dehaze));
    const clampedHighlights = Math.max(-1, Math.min(1, p.highlights));
    const clampedShadows = Math.max(-1, Math.min(1, p.shadows));
    const hlActive = Math.abs(clampedHighlights) > 0.001;
    const shActive = Math.abs(clampedShadows) > 0.001;
    const lumOf = (r: number, g: number, b: number) => LUM.R * r + LUM.G * g + LUM.B * b;

    for (let i = 0; i < out.length; i += 4) {
      const lumHS = (hlActive || shActive) ? lumOf(out[i], out[i + 1], out[i + 2]) : 0;
      const hMask = hlActive ? lumHS * lumHS : 0;
      const sMask = shActive ? (1 - lumHS) * (1 - lumHS) : 0;

      for (let c = 0; c < 3; c++) {
        let pixel = out[i + c];
        if (p.exposure !== 0) pixel *= Math.pow(2, Math.max(-1, Math.min(1, p.exposure)));
        if (p.black_point !== 0) pixel = Math.max(0, pixel - p.black_point * 0.1);
        if (p.brightness !== 0) pixel += p.brightness * 0.1;
        if (p.contrast !== 0) pixel = 0.5 + (pixel - 0.5) * (1 + p.contrast * 0.1);
        if (dz.active) {
          pixel = (pixel - dz.hazeStrength) / dz.hazeDivisor;
          pixel = 0.5 + (pixel - 0.5) * (1 + clampedDehaze * 0.15);
        }
        if (hlActive) pixel += clampedHighlights * 0.4 * hMask;
        if (shActive) pixel += clampedShadows * 0.4 * sMask;
        pixel = Math.max(0, Math.min(1, pixel));
        if (pixel > 0 && pixel < 0.001) pixel = 0.001;
        out[i + c] = pixel;
      }

      if (p.saturation !== 0 || p.vibrance !== 0 || dz.active) {
        const r = out[i], g = out[i + 1], b = out[i + 2];
        const luminance = lumOf(r, g, b);
        const dehazeSatBoost = dz.active ? clampedDehaze * 0.3 : 0;
        if (p.saturation !== 0 || dehazeSatBoost !== 0) {
          const satFactor = Math.max(0, 1 + p.saturation + dehazeSatBoost);
          out[i] = luminance + (r - luminance) * satFactor;
          out[i + 1] = luminance + (g - luminance) * satFactor;
          out[i + 2] = luminance + (b - luminance) * satFactor;
        }
        if (p.vibrance !== 0) {
          const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
          const curSat = maxC > 0 ? (maxC - minC) / maxC : 0;
          const vibFactor = 1 + p.vibrance * (1 - curSat);
          out[i] = Math.max(0, Math.min(1, luminance + (out[i] - luminance) * vibFactor));
          out[i + 1] = Math.max(0, Math.min(1, luminance + (out[i + 1] - luminance) * vibFactor));
          out[i + 2] = Math.max(0, Math.min(1, luminance + (out[i + 2] - luminance) * vibFactor));
        }
      }
    }
    return out;
  }

  /** Startup benchmark: exposure GPU-vs-CPU timing + correctness, for the in-app POC log. */
  benchmark(width = 2048, height = 2048, stops = 1): {
    available: boolean; width: number; height: number; gpuMs: number | null; cpuMs: number; maxDiff: number;
  } {
    const px = width * height * 4;
    const data = new Float32Array(px);
    for (let i = 0; i < px; i += 4) { data[i] = (i % 255) / 255; data[i + 1] = 0.5; data[i + 2] = 0.25; data[i + 3] = 1; }
    const available = this.isAvailable();
    const gain = Math.pow(2, stops);

    const t0 = performance.now();
    const cpu = new Float32Array(px);
    for (let i = 0; i < px; i += 4) { cpu[i] = data[i] * gain; cpu[i + 1] = data[i + 1] * gain; cpu[i + 2] = data[i + 2] * gain; cpu[i + 3] = data[i + 3]; }
    const cpuMs = performance.now() - t0;

    let gpuMs: number | null = null, maxDiff = 0;
    if (available && this.gl && this.exposureProgram && this.vao) {
      const t1 = performance.now();
      const gpu = this.runExposureGPU(this.gl, data, width, height, gain);
      gpuMs = performance.now() - t1;
      for (let i = 0; i < px; i++) maxDiff = Math.max(maxDiff, Math.abs(gpu[i] - cpu[i]));
    }
    return { available, width, height, gpuMs, cpuMs, maxDiff };
  }
}

export const webGLImageProcessor = new WebGLImageProcessor();
export { WebGLImageProcessor };
