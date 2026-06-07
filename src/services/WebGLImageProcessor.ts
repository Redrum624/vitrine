/**
 * WebGL2 image processor — Phase-1 GPU acceleration proof-of-concept.
 *
 * Proves the architecture end-to-end: upload an RGBA Float32 image as a float
 * texture, run a fragment-shader pass (exposure) into a float framebuffer, and
 * read the result back as Float32. This is the building block for moving the
 * per-pixel edit pipeline onto the GPU.
 *
 * Everything degrades gracefully: if WebGL2 or float render targets aren't
 * available (e.g. jsdom in tests, or a GPU that lacks EXT_color_buffer_float),
 * it transparently falls back to an identical CPU implementation. So callers get
 * correct output everywhere, and the GPU path is a pure speed-up where supported.
 */
import { logger } from '../utils/Logger';

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const EXPOSURE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_gain;       // 2^stops
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 c = texture(u_image, v_uv);
  outColor = vec4(c.rgb * u_gain, c.a); // exposure scales RGB in linear-ish space; alpha untouched
}`;

class WebGLImageProcessor {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uGain: WebGLUniformLocation | null = null;
  private initTried = false;

  /** Lazily create a WebGL2 context with float render-target support. Returns null if unavailable. */
  private ensureContext(): WebGL2RenderingContext | null {
    if (this.initTried) return this.gl;
    this.initTried = true;
    try {
      if (typeof document === 'undefined') return (this.gl = null);
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
      if (!gl) { logger.info('[GPU] WebGL2 not available — CPU fallback'); return (this.gl = null); }
      // Rendering to / reading back RGBA32F requires this extension.
      if (!gl.getExtension('EXT_color_buffer_float')) {
        logger.info('[GPU] EXT_color_buffer_float missing — CPU fallback');
        return (this.gl = null);
      }
      const program = this.buildProgram(gl, VERT_SRC, EXPOSURE_FRAG_SRC);
      if (!program) return (this.gl = null);

      // Full-screen quad as a triangle strip.
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const aPos = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      this.gl = gl;
      this.program = program;
      this.vao = vao;
      this.uGain = gl.getUniformLocation(program, 'u_gain');
      logger.info('[GPU] WebGL2 image processor initialised');
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

  /** True when the GPU path is usable in this environment. */
  isAvailable(): boolean {
    return this.ensureContext() !== null;
  }

  /**
   * Apply an exposure adjustment (in stops) to an RGBA Float32 image. Uses the GPU
   * when available, otherwise an identical CPU pass. Returns a new Float32Array.
   */
  applyExposure(data: Float32Array, width: number, height: number, stops: number): Float32Array {
    const gain = Math.pow(2, stops);
    const gl = this.ensureContext();
    if (gl && this.program && this.vao) {
      try {
        return this.runExposureGPU(gl, data, width, height, gain);
      } catch (e) {
        logger.warn('[GPU] exposure pass failed — CPU fallback:', e instanceof Error ? e.message : String(e));
      }
    }
    return this.applyExposureCPU(data, gain);
  }

  private applyExposureCPU(data: Float32Array, gain: number): Float32Array {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = data[i] * gain;
      out[i + 1] = data[i + 1] * gain;
      out[i + 2] = data[i + 2] * gain;
      out[i + 3] = data[i + 3]; // alpha unchanged
    }
    return out;
  }

  private runExposureGPU(
    gl: WebGL2RenderingContext, data: Float32Array, width: number, height: number, gain: number
  ): Float32Array {
    // Source texture (RGBA32F).
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);

    // Destination texture + framebuffer (RGBA32F render target).
    const dst = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer incomplete');
    }

    // Render the exposure pass.
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.uniform1f(this.uGain, gain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.program!, 'u_image'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // Read back.
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);

    // Cleanup per-call resources (POC; a real pipeline would pool these).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.deleteTexture(dst);
    return out;
  }

  /**
   * One-shot benchmark used by the in-app POC log: processes a synthetic image on
   * both paths and reports timings + the max per-channel difference (should be ~0).
   */
  benchmark(width = 2048, height = 2048, stops = 1): {
    available: boolean; width: number; height: number; gpuMs: number | null; cpuMs: number; maxDiff: number;
  } {
    const px = width * height * 4;
    const data = new Float32Array(px);
    for (let i = 0; i < px; i += 4) {
      data[i] = (i % 255) / 255; data[i + 1] = 0.5; data[i + 2] = 0.25; data[i + 3] = 1;
    }
    const available = this.isAvailable();

    const t0 = performance.now();
    const cpu = this.applyExposureCPU(data, Math.pow(2, stops));
    const cpuMs = performance.now() - t0;

    let gpuMs: number | null = null;
    let maxDiff = 0;
    if (available && this.gl && this.program && this.vao) {
      const t1 = performance.now();
      const gpu = this.runExposureGPU(this.gl, data, width, height, Math.pow(2, stops));
      gpuMs = performance.now() - t1;
      for (let i = 0; i < px; i++) maxDiff = Math.max(maxDiff, Math.abs(gpu[i] - cpu[i]));
    }
    return { available, width, height, gpuMs, cpuMs, maxDiff };
  }
}

export const webGLImageProcessor = new WebGLImageProcessor();
export { WebGLImageProcessor };
