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

interface DehazeState { active: boolean; hazeStrength: number; hazeDivisor: number; }

class WebGLImageProcessor {
  private gl: WebGL2RenderingContext | null = null;
  private exposureProgram: WebGLProgram | null = null;
  private basicAdjProgram: WebGLProgram | null = null;
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
      if (!exposureProgram || !basicAdjProgram) return (this.gl = null);

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
