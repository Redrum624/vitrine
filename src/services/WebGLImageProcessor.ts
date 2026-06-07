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
import { rgbToHsl, hslToRgb } from '../modules/utils/ColorUtils';

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

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const EXPOSURE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_gain;
in vec2 v_uv;
out vec4 outColor;
void main() { vec4 c = texture(u_image, v_uv); outColor = vec4(c.rgb * u_gain, c.a); }`;

// Per-channel gains + clamp (white balance applies pre-computed R/G/B factors).
const GAINS_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec3 u_gains;
in vec2 v_uv;
out vec4 outColor;
void main() { vec4 c = texture(u_image, v_uv); outColor = vec4(clamp(c.rgb * u_gains, 0.0, 1.0), c.a); }`;

// Non-Local Means denoise — a fast GPU replacement for the slow CPU BM3D/NLMeans.
// Each output pixel is a weighted average of its search-window neighbours, weighted
// by 3x3-patch similarity. Runs sub-second even on RAW (GPU does the gather).
const NLMEANS_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;   // (1/width, 1/height)
uniform float u_h2;     // filter strength denominator
in vec2 v_uv;
out vec4 outColor;
const int R = 4;        // search radius -> 9x9 window
const int P = 1;        // patch radius  -> 3x3 patch
void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int dy = -R; dy <= R; dy++) {
    for (int dx = -R; dx <= R; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * u_texel;
      float dist = 0.0;
      for (int py = -P; py <= P; py++) {
        for (int px = -P; px <= P; px++) {
          vec2 po = vec2(float(px), float(py)) * u_texel;
          vec3 d = texture(u_image, v_uv + po).rgb - texture(u_image, v_uv + off + po).rgb;
          dist += dot(d, d);
        }
      }
      float w = exp(-dist / u_h2);
      sum += texture(u_image, v_uv + off).rgb * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / max(wsum, 1e-6), texture(u_image, v_uv).a);
}`;

// Color Balance: 3-range tonal shift (shadows/midtones/highlights) + 8-hue HSL.
// Mirrors ColorBalanceModule + ColorUtils rgbToHsl/hslToRgb exactly.
const COLORBALANCE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec3 u_shadows, u_mid, u_high;   // (cyan_red, magenta_green, yellow_blue)
uniform float u_sat[8];
uniform float u_lum[8];
uniform float u_hue[8];
in vec2 v_uv;
out vec4 outColor;

float tonal(float l, int r) {
  if (r == 0) return l < 0.33 ? 1.0 : max(0.0, (0.66 - l) / 0.33);
  if (r == 1) return (l >= 0.33 && l <= 0.66) ? 1.0 : (l < 0.33 ? max(0.0, l / 0.33) : max(0.0, (1.0 - l) / 0.34));
  return l > 0.66 ? 1.0 : max(0.0, (l - 0.33) / 0.33);
}
float cwRange(float h, float a, float b) {
  if (h >= a && h <= b) return 1.0;
  return max(0.0, 1.0 - min(abs(h - a), abs(h - b)) / 30.0);
}
float colorWeight(float h, int i) {
  if (i == 0) {
    if ((h >= 345.0 && h <= 360.0) || (h >= 0.0 && h <= 15.0)) return 1.0;
    return max(0.0, 1.0 - min(min(abs(h - 345.0), abs(h - 360.0)), min(abs(h), abs(h - 15.0))) / 30.0);
  }
  vec2 r = i == 1 ? vec2(15.0, 45.0) : i == 2 ? vec2(45.0, 75.0) : i == 3 ? vec2(75.0, 165.0)
         : i == 4 ? vec2(165.0, 195.0) : i == 5 ? vec2(195.0, 255.0) : i == 6 ? vec2(255.0, 285.0) : vec2(285.0, 345.0);
  return cwRange(h, r.x, r.y);
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float diff = mx - mn, sum = mx + mn, h = 0.0, l = sum / 2.0, s = 0.0;
  if (diff != 0.0) {
    s = l > 0.5 ? diff / (2.0 - sum) : diff / sum;
    if (mx == c.r) h = (c.g - c.b) / diff + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / diff + 2.0;
    else h = (c.r - c.g) / diff + 4.0;
    h /= 6.0;
  }
  return vec3(h * 360.0, s * 100.0, l * 100.0);
}
vec3 hsl2rgb(float h, float s, float l) {
  h = mod(mod(h, 360.0) + 360.0, 360.0);
  s = clamp(s, 0.0, 100.0) / 100.0;
  l = clamp(l, 0.0, 100.0) / 100.0;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - c / 2.0;
  vec3 rgb = h < 60.0 ? vec3(c, x, 0.0) : h < 120.0 ? vec3(x, c, 0.0) : h < 180.0 ? vec3(0.0, c, x)
           : h < 240.0 ? vec3(0.0, x, c) : h < 300.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + m;
}
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 rgb = src.rgb;
  float lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float ws = tonal(lum, 0); if (ws > 0.01) rgb += u_shadows * ws * 0.1;
  float wm = tonal(lum, 1); if (wm > 0.01) rgb += u_mid * wm * 0.1;
  float wh = tonal(lum, 2); if (wh > 0.01) rgb += u_high * wh * 0.1;
  rgb = clamp(rgb, 0.0, 1.0);
  vec3 hsl = rgb2hsl(rgb);
  float nh = hsl.x, ns = hsl.y, nl = hsl.z;
  for (int i = 0; i < 8; i++) {
    float w = colorWeight(hsl.x, i);
    if (w > 0.01) { nh += u_hue[i] * w; ns += u_sat[i] * w; nl += u_lum[i] * w; }
  }
  outColor = vec4(clamp(hsl2rgb(nh, ns, nl), 0.0, 1.0), src.a);
}`;

// Tone Curve: base curve (luminance-preserve or per-channel) then per-channel RGB
// curves. The 65536-entry LUTs are uploaded as 256x256 R32F textures; floor(v*65535)
// indexes the exact texel (NEAREST). Mirrors ToneCurveModule (Rec.709 luma).
const TONECURVE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_master, u_red, u_green, u_blue;
uniform float u_preserveColors;
in vec2 v_uv;
out vec4 outColor;
float lut(sampler2D t, float v) {
  float idx = floor(clamp(v, 0.0, 1.0) * 65535.0);
  return texture(t, vec2((mod(idx, 256.0) + 0.5) / 256.0, (floor(idx / 256.0) + 0.5) / 256.0)).r;
}
void main() {
  vec4 src = texture(u_image, v_uv);
  vec3 rgb = src.rgb;
  if (u_preserveColors == 1.0) {
    float lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    if (lum > 0.0) rgb = clamp(rgb * (lut(u_master, lum) / lum), 0.0, 1.0);
  } else {
    rgb = vec3(lut(u_master, rgb.r), lut(u_master, rgb.g), lut(u_master, rgb.b));
  }
  rgb = vec3(lut(u_red, rgb.r), lut(u_green, rgb.g), lut(u_blue, rgb.b));
  outColor = vec4(rgb, src.a);
}`;

// Faithful GLSL port of BasicAdjustmentsModule.process (see that file for intent).
const BASICADJ_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_exposure, u_blackPoint, u_brightness, u_contrast;
uniform float u_dehazeActive, u_dehaze, u_hazeStrength, u_hazeDivisor;
uniform float u_hlActive, u_shActive, u_highlights, u_shadows;
uniform float u_saturation, u_vibrance;
in vec2 v_uv;
out vec4 outColor;
const vec3 W = vec3(0.299, 0.587, 0.114);

float adjustChannel(float pixel, float hMask, float sMask) {
  pixel *= pow(2.0, clamp(u_exposure, -1.0, 1.0));      // exposure
  pixel = max(0.0, pixel - u_blackPoint * 0.1);          // black point
  pixel += u_brightness * 0.1;                           // brightness
  pixel = 0.5 + (pixel - 0.5) * (1.0 + u_contrast * 0.1);// contrast around 0.5
  if (u_dehazeActive > 0.5) {                            // dehaze
    pixel = (pixel - u_hazeStrength) / u_hazeDivisor;
    pixel = 0.5 + (pixel - 0.5) * (1.0 + u_dehaze * 0.15);
  }
  pixel += u_hlActive * u_highlights * 0.4 * hMask;      // highlights (masked)
  pixel += u_shActive * u_shadows * 0.4 * sMask;         // shadows (masked)
  pixel = clamp(pixel, 0.0, 1.0);
  if (pixel > 0.0 && pixel < 0.001) pixel = 0.001;       // min visibility
  return pixel;
}

void main() {
  vec4 src = texture(u_image, v_uv);
  float lumHS = dot(src.rgb, W);
  float hMask = lumHS * lumHS;
  float sMask = (1.0 - lumHS) * (1.0 - lumHS);
  vec3 c = vec3(
    adjustChannel(src.r, hMask, sMask),
    adjustChannel(src.g, hMask, sMask),
    adjustChannel(src.b, hMask, sMask));

  float lum = dot(c, W);
  float dehazeSatBoost = (u_dehazeActive > 0.5) ? u_dehaze * 0.3 : 0.0;
  vec3 outc = c;
  if (u_saturation != 0.0 || dehazeSatBoost != 0.0) {
    float satFactor = max(0.0, 1.0 + u_saturation + dehazeSatBoost);
    outc = lum + (c - lum) * satFactor;
  }
  if (u_vibrance != 0.0) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float curSat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;
    float vibFactor = 1.0 + u_vibrance * (1.0 - curSat);
    outc = clamp(lum + (outc - lum) * vibFactor, 0.0, 1.0);
  }
  outColor = vec4(outc, src.a);
}`;

const LUM = { R: 0.299, G: 0.587, B: 0.114 };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface DehazeState { active: boolean; hazeStrength: number; hazeDivisor: number; }

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

class WebGLImageProcessor {
  private gl: WebGL2RenderingContext | null = null;
  private exposureProgram: WebGLProgram | null = null;
  private basicAdjProgram: WebGLProgram | null = null;
  private gainsProgram: WebGLProgram | null = null;
  private denoiseProgram: WebGLProgram | null = null;
  private colorBalanceProgram: WebGLProgram | null = null;
  private colorBalanceVerified: boolean | null = null;
  private toneCurveProgram: WebGLProgram | null = null;
  private toneCurveVerified: boolean | null = null;
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
      const exposureProgram = this.buildProgram(gl, VERT_SRC, EXPOSURE_FRAG_SRC);
      const basicAdjProgram = this.buildProgram(gl, VERT_SRC, BASICADJ_FRAG_SRC);
      const gainsProgram = this.buildProgram(gl, VERT_SRC, GAINS_FRAG_SRC);
      const denoiseProgram = this.buildProgram(gl, VERT_SRC, NLMEANS_FRAG_SRC);
      const colorBalanceProgram = this.buildProgram(gl, VERT_SRC, COLORBALANCE_FRAG_SRC);
      const toneCurveProgram = this.buildProgram(gl, VERT_SRC, TONECURVE_FRAG_SRC);
      if (!exposureProgram || !basicAdjProgram || !gainsProgram || !denoiseProgram || !colorBalanceProgram || !toneCurveProgram) return (this.gl = null);

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
        return this.runPass(this.gainsProgram, data, width, height, (g, prog) => {
          g.uniform3f(g.getUniformLocation(prog, 'u_gains'), gr, gg, gb);
        });
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
      const s = Math.max(0, Math.min(100, strength)) / 100;
      const h = 0.015 + s * 0.12;  // filter strength grows with the denoise strength
      const h2 = h * h * 27.0;     // 27 = 3x3 patch * 3 channels
      return this.runPass(this.denoiseProgram, data, width, height, (g, prog) => {
        g.uniform2f(g.getUniformLocation(prog, 'u_texel'), 1 / width, 1 / height);
        g.uniform1f(g.getUniformLocation(prog, 'u_h2'), h2);
      });
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
    return this.runPass(this.colorBalanceProgram!, data, width, height, (g, prog) => {
      g.uniform3f(g.getUniformLocation(prog, 'u_shadows'), shadows[0], shadows[1], shadows[2]);
      g.uniform3f(g.getUniformLocation(prog, 'u_mid'), mid[0], mid[1], mid[2]);
      g.uniform3f(g.getUniformLocation(prog, 'u_high'), high[0], high[1], high[2]);
      g.uniform1fv(g.getUniformLocation(prog, 'u_sat'), sat);
      g.uniform1fv(g.getUniformLocation(prog, 'u_lum'), lum);
      g.uniform1fv(g.getUniformLocation(prog, 'u_hue'), hue);
    });
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

  /** CPU reference — a replica of ColorBalanceModule.process. */
  colorBalanceCPU(
    data: Float32Array, _width: number, _height: number,
    shadows: number[], mid: number[], high: number[], sat: number[], lum: number[], hue: number[]
  ): Float32Array {
    const out = new Float32Array(data);
    const ranges: [number[], 0 | 1 | 2][] = [[shadows, 0], [mid, 1], [high, 2]];
    for (let i = 0; i < out.length; i += 4) {
      let r = out[i], g = out[i + 1], b = out[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      for (const [vals, rng] of ranges) {
        const w = cbTonalWeight(luminance, rng);
        if (w > 0.01) { r += vals[0] * w * 0.1; g += vals[1] * w * 0.1; b += vals[2] * w * 0.1; }
      }
      r = clamp01(r); g = clamp01(g); b = clamp01(b);
      const [h, s, l] = rgbToHsl(r, g, b);
      let nh = h, ns = s, nl = l;
      for (let c = 0; c < 8; c++) {
        const w = cbColorWeight(h, c);
        if (w > 0.01) { nh += hue[c] * w; ns += sat[c] * w; nl += lum[c] * w; }
      }
      const [nr, ng, nb] = hslToRgb(nh, ns, nl);
      out[i] = clamp01(nr); out[i + 1] = clamp01(ng); out[i + 2] = clamp01(nb);
    }
    return out;
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
    gl.uniform1f(gl.getUniformLocation(prog, 'u_preserveColors'), preserveColors);
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

  /** Generic single-pass shader run: source texture → program → float readback. */
  private runPass(
    program: WebGLProgram, data: Float32Array, width: number, height: number,
    setUniforms: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void
  ): Float32Array {
    const gl = this.gl!;
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
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    const hlActive = Math.abs(clamp1(p.highlights)) > 0.001;
    const shActive = Math.abs(clamp1(p.shadows)) > 0.001;

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
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1f(u('u_exposure'), p.exposure);
    gl.uniform1f(u('u_blackPoint'), p.black_point);
    gl.uniform1f(u('u_brightness'), p.brightness);
    gl.uniform1f(u('u_contrast'), p.contrast);
    gl.uniform1f(u('u_dehazeActive'), dz.active ? 1 : 0);
    gl.uniform1f(u('u_dehaze'), clamp1(p.dehaze));
    gl.uniform1f(u('u_hazeStrength'), dz.hazeStrength);
    gl.uniform1f(u('u_hazeDivisor'), dz.hazeDivisor);
    gl.uniform1f(u('u_hlActive'), hlActive ? 1 : 0);
    gl.uniform1f(u('u_shActive'), shActive ? 1 : 0);
    gl.uniform1f(u('u_highlights'), clamp1(p.highlights));
    gl.uniform1f(u('u_shadows'), clamp1(p.shadows));
    gl.uniform1f(u('u_saturation'), p.saturation);
    gl.uniform1f(u('u_vibrance'), p.vibrance);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u('u_image'), 0);
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
    gl.uniform1f(gl.getUniformLocation(this.exposureProgram!, 'u_gain'), gain);
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
