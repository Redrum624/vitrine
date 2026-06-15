/**
 * GpuPreviewPipeline — resident-texture WebGL2 GPU pipeline (Task 4 core).
 *
 * Owns ONE WebGL2 context, uploads a source image to a texture ONCE, then runs an
 * ordered list of `PassDescriptor`s by ping-ponging between two RGBA32F framebuffers
 * with NO GPU→CPU readback between passes (the whole point: the previous round-trip-
 * per-module pipeline was the bottleneck). The final result can be read back once.
 *
 * This task has NO on-screen present — presenting to a visible canvas is a later task.
 * Correctness is verified at runtime by `selfTest()`, which renders a single basicadj
 * pass through this pipeline and compares the readback to the reference
 * `WebGLImageProcessor.applyBasicAdjustments` (maxDiff < 1e-4).
 *
 * Single responsibility: own the GL context + run the resident-texture pipeline.
 * No React, no store. GLSL lives in `sources.ts`; uniform-setters in `uniforms.ts`.
 * Patterns mirror WebGLImageProcessor (context/program/texture) + ShaderPipeline
 * (ping-pong framebuffers) so GPU self-checks stay meaningful.
 */
import { logger } from '../utils/Logger';
import {
  VERT_SRC,
  FRAG_GAINS,
  FRAG_BASICADJ,
  FRAG_TONECURVE,
  FRAG_COLORBALANCE,
  FRAG_DISTORTION,
  FRAG_LATERALCA,
  FRAG_VIGNETTE,
} from './sources';
import type { PassDescriptor, PassRuntime } from './passDescriptors';
import { basicAdjUniforms } from './uniforms';
import type { DehazeState } from '../services/WebGLImageProcessor';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';

export interface PreviewRenderResult {
  width: number;
  height: number;
}

interface PingPong {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/** programKey → fragment source. Keys must match those emitted by passDescriptors.ts. */
const PROGRAM_SOURCES: Record<string, string> = {
  gains: FRAG_GAINS,
  basicadj: FRAG_BASICADJ,
  tonecurve: FRAG_TONECURVE,
  colorbalance: FRAG_COLORBALANCE,
  distortion: FRAG_DISTORTION,
  lateralca: FRAG_LATERALCA,
  vignette: FRAG_VIGNETTE,
};

/** Tone-curve LUT sampler-uniform names, in the same order runToneCurveGPU binds them. */
const TONECURVE_LUT_NAMES = ['u_master', 'u_red', 'u_green', 'u_blue'] as const;

export class GpuPreviewPipeline {
  private gl: WebGL2RenderingContext | null = null;
  private attached = false;
  private vao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private programs = new Map<string, WebGLProgram>();

  private srcTexture: WebGLTexture | null = null;
  private srcData: Float32Array | null = null;
  private width = 0;
  private height = 0;

  // Two ping-pong FBO+texture pairs, reallocated only on size change.
  private ping: [PingPong | null, PingPong | null] = [null, null];

  // The output texture of the most recent render() (NOT read back).
  private resultTexture: WebGLTexture | null = null;

  // Cache of uploaded LUT textures, keyed by Float32Array identity. Re-uploaded
  // only when the LUT array reference changes.
  private lutCache = new WeakMap<Float32Array, WebGLTexture>();
  // Parallel iterable set so destroy() can delete every LUT texture (WeakMap isn't iterable).
  private lutTextures = new Set<WebGLTexture>();

  /**
   * Create the WebGL2 context (on the given canvas, or an internally-created one for
   * headless/self-test), compile all programs, build the fullscreen-quad VAO.
   * Returns false (and stays unavailable) if WebGL2 / float-color render targets
   * are missing (jsdom, weak GPUs).
   */
  attach(canvas?: HTMLCanvasElement): boolean {
    if (this.attached) return this.gl !== null;
    this.attached = true;
    try {
      let target = canvas;
      if (!target) {
        if (typeof document === 'undefined') return false;
        target = document.createElement('canvas');
      }
      const gl = target.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
      if (!gl || typeof gl.getExtension !== 'function' || !gl.getExtension('EXT_color_buffer_float')) {
        logger.info('[GPU-PIPELINE] WebGL2 / float render targets unavailable — pipeline disabled');
        return false;
      }

      this.gl = gl;
      this.compilePrograms(gl);

      // Fullscreen-quad VAO (TRIANGLE_STRIP of 4 verts), mirrors WebGLImageProcessor.
      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      // a_pos is location 0 in every program (same VERT_SRC); use any compiled program
      // to query the attribute location.
      const anyProg = this.programs.values().next().value as WebGLProgram | undefined;
      const aPos = anyProg ? gl.getAttribLocation(anyProg, 'a_pos') : 0;
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      logger.info(`[GPU-PIPELINE] attached — ${this.programs.size} programs compiled`);
      return true;
    } catch (e) {
      logger.warn('[GPU-PIPELINE] attach failed:', e instanceof Error ? e.message : String(e));
      this.gl = null;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.gl !== null;
  }

  /** Compile one WebGLProgram per programKey from PROGRAM_SOURCES, cache in programs map. */
  private compilePrograms(gl: WebGL2RenderingContext): void {
    for (const [key, frag] of Object.entries(PROGRAM_SOURCES)) {
      const prog = this.buildProgram(gl, VERT_SRC, frag);
      if (prog) {
        this.programs.set(key, prog);
      } else {
        logger.warn(`[GPU-PIPELINE] program '${key}' failed to compile — passes using it will be skipped`);
      }
    }
  }

  /** Compile + link a program. Mirrors WebGLImageProcessor.buildProgram. */
  private buildProgram(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        logger.warn('[GPU-PIPELINE] shader compile error:', gl.getShaderInfoLog(sh) ?? '');
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
      logger.warn('[GPU-PIPELINE] program link error:', gl.getProgramInfoLog(program) ?? '');
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  /** Create an RGBA32F texture (NEAREST + CLAMP_TO_EDGE). Mirrors WebGLImageProcessor.makeTexture. */
  private makeTexture(gl: WebGL2RenderingContext, width: number, height: number, data: Float32Array | null): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
  }

  /** Create or resize the two ping-pong FBO+texture pairs. No-op when size unchanged. */
  private ensureFramebuffers(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this.ping[0] && this.ping[1] && this.width === width && this.height === height) return;

    for (const pp of this.ping) {
      if (pp) {
        gl.deleteFramebuffer(pp.framebuffer);
        gl.deleteTexture(pp.texture);
      }
    }

    for (let i = 0; i < 2; i++) {
      const texture = this.makeTexture(gl, width, height, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        throw new Error(`[GPU-PIPELINE] framebuffer ${i} incomplete at ${width}x${height}`);
      }
      this.ping[i] = { framebuffer, texture };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Upload the source image to srcTexture ONCE (kept separate from the ping-pong
   * textures), and (re)allocate the ping-pong FBOs on size change. Holds a reference
   * to the source data so render() can compute the dehaze state from it.
   */
  setSource(data: Float32Array, width: number, height: number): void {
    const gl = this.gl;
    if (!gl) throw new Error('[GPU-PIPELINE] setSource called before a successful attach()');

    this.ensureFramebuffers(gl, width, height);

    if (this.srcTexture) gl.deleteTexture(this.srcTexture);
    this.srcTexture = this.makeTexture(gl, width, height, data);

    this.srcData = data;
    this.width = width;
    this.height = height;
    this.resultTexture = this.srcTexture; // identity until render() runs
  }

  /**
   * Upload a tone-curve LUT (65536 entries) as a 256x256 R32F texture, mirroring
   * WebGLImageProcessor.makeLutTexture. Cached by Float32Array identity.
   */
  private uploadLut(gl: WebGL2RenderingContext, lut: Float32Array): WebGLTexture {
    const cached = this.lutCache.get(lut);
    if (cached) return cached;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 256, 0, gl.RED, gl.FLOAT, lut);
    this.lutCache.set(lut, tex);
    this.lutTextures.add(tex);
    return tex;
  }

  /**
   * Run all passes in order, ping-ponging between the two RGBA32F framebuffers.
   * NO readPixels — the final output stays resident as `resultTexture`.
   */
  render(passes: PassDescriptor[]): PreviewRenderResult {
    const gl = this.gl;
    if (!gl) throw new Error('[GPU-PIPELINE] render called before a successful attach()');
    if (!this.srcTexture) throw new Error('[GPU-PIPELINE] render called before setSource()');

    const width = this.width;
    const height = this.height;

    // One PassRuntime per render. Dehaze is computed from the source pixels via the
    // shared single-source estimator on WebGLImageProcessor (no formula copy). The
    // dehaze param lives on basicadj; we read it off the basicadj pass if present.
    const rt: PassRuntime = {
      width,
      height,
      dehaze: this.computeRenderDehaze(),
    };

    // If there are no runnable passes, the result is the source itself.
    if (passes.length === 0) {
      this.resultTexture = this.srcTexture;
      return { width, height };
    }

    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);

    let inputTexture: WebGLTexture = this.srcTexture;
    let idx = 0;
    let drew = false;

    for (const pass of passes) {
      const prog = this.programs.get(pass.programKey);
      if (!prog) {
        logger.warn(`[GPU-PIPELINE] no program for key '${pass.programKey}' — skipping pass '${pass.id}'`);
        continue;
      }

      const dst = this.ping[idx]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);

      // Input on unit 0.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_image'), 0);

      // LUT textures (tone curve) on units >= 1. Replicates runToneCurveGPU exactly:
      // u_master/u_red/u_green/u_blue as 256x256 R32F on units 1..4.
      if (pass.luts) {
        TONECURVE_LUT_NAMES.forEach((name, i) => {
          const lut = pass.luts![name.replace('u_', '') as 'master' | 'red' | 'green' | 'blue'];
          if (!lut) return;
          const unit = i + 1;
          const tex = this.uploadLut(gl, lut);
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(gl.getUniformLocation(prog, name), unit);
        });
      }

      // Scalar/vector uniforms for this pass.
      pass.setUniforms(gl, prog, rt);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Output becomes next input; toggle ping-pong index.
      inputTexture = dst.texture;
      idx = 1 - idx;
      drew = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    // If every pass was skipped (no matching program), fall back to the source.
    this.resultTexture = drew ? inputTexture : this.srcTexture;
    return { width, height };
  }

  // basicadj's dehaze PARAM (a scalar) is baked into the pass closure by buildPassList,
  // but the dehaze STATE (hazeStrength/hazeDivisor) is a pixel statistic of the source
  // and so belongs to the per-render PassRuntime. The caller therefore supplies the
  // dehaze param here so render() can compute the real haze floor from the source.
  // Default 0 = inactive, which matches basicadj's default and every image without
  // dehaze>0 — so the common path needs no setDehazeParam() call.
  private dehazeParam = 0;

  /**
   * Set the basicadj dehaze param so render() computes the real haze floor from the
   * source pixels. Default 0 (inactive); only images with dehaze>0 need this.
   * Call after setSource(), before render().
   */
  setDehazeParam(dehaze: number): void {
    this.dehazeParam = dehaze;
  }

  private computeRenderDehaze(): DehazeState {
    if (!this.srcData || Math.abs(this.dehazeParam) <= 0.001) {
      return { active: false, hazeStrength: 0, hazeDivisor: 1 };
    }
    // Single source of truth: reuse WebGLImageProcessor's estimator (no formula copy).
    return webGLImageProcessor.computeDehazeState(this.srcData, this.width, this.height, this.dehazeParam);
  }

  /** Read back resultTexture once as RGBA Float32. Call after render(). */
  readback(): Float32Array {
    const gl = this.gl;
    if (!gl) throw new Error('[GPU-PIPELINE] readback called before a successful attach()');
    if (!this.resultTexture) throw new Error('[GPU-PIPELINE] readback called before render()/setSource()');

    const width = this.width;
    const height = this.height;
    const out = new Float32Array(width * height * 4);

    // The result lives in a texture, not necessarily a bound FBO (e.g. when it IS the
    // source texture). Attach it to a scratch FBO to read it.
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.resultTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    } else {
      logger.warn('[GPU-PIPELINE] readback framebuffer incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return out;
  }

  /** Release all GL resources. */
  destroy(): void {
    const gl = this.gl;
    if (gl) {
      for (const prog of this.programs.values()) gl.deleteProgram(prog);
      for (const pp of this.ping) {
        if (pp) {
          gl.deleteFramebuffer(pp.framebuffer);
          gl.deleteTexture(pp.texture);
        }
      }
      for (const tex of this.lutTextures) gl.deleteTexture(tex);
      this.lutTextures.clear();
      if (this.srcTexture) gl.deleteTexture(this.srcTexture);
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.programs.clear();
    this.ping = [null, null];
    this.srcTexture = null;
    this.srcData = null;
    this.resultTexture = null;
    this.vao = null;
    this.quadBuffer = null;
    this.gl = null;
    this.attached = false;
    this.width = 0;
    this.height = 0;
  }

  /**
   * Dev-only runtime correctness gate. Renders a synthetic 16x16 gradient through a
   * SINGLE basicadj pass (non-default params) and compares the readback to the
   * reference WebGLImageProcessor.applyBasicAdjustments. ok = maxDiff < 1e-4.
   *
   * basicadj is non-LUT, so this verifies the core ping-pong path without LUT
   * complexity. Requires a real WebGL2 context — runs in the Electron app, NOT Jest.
   */
  selfTest(): { ok: boolean; maxDiff: number } {
    if (!this.gl) {
      logger.warn('[GPU-PIPELINE] selfTest: not attached / WebGL2 unavailable');
      return { ok: false, maxDiff: Infinity };
    }
    try {
      // 16x16 RGBA Float32 gradient.
      const w = 16, h = 16;
      const data = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = (i % w) / w;
        data[i * 4 + 1] = Math.floor(i / w) / h;
        data[i * 4 + 2] = ((i * 7) % 13) / 13;
        data[i * 4 + 3] = 1;
      }

      const params = {
        black_point: 0.1, exposure: 0.3, contrast: 0.5, brightness: 0.2,
        saturation: 0.3, vibrance: 0.2, dehaze: 0, highlights: 0.4, shadows: -0.3,
      };

      // Build a single basicadj PassDescriptor via the real pass-list builder, so the
      // exact production uniform path is exercised.
      const passDesc: PassDescriptor = {
        id: 'basicadj',
        programKey: 'basicadj',
        // Reuse the shared uniform-setter (the same one buildPassList wires).
        setUniforms: (gl, prog, rt) => basicAdjUniforms(params, rt.dehaze)(gl, prog),
      };

      this.setSource(data, w, h);
      this.setDehazeParam(params.dehaze);
      this.render([passDesc]);
      const gpu = this.readback();

      const ref = webGLImageProcessor.applyBasicAdjustments(data, w, h, params);

      let maxDiff = 0;
      for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(gpu[i] - ref[i]));
      const ok = maxDiff < 1e-4;
      return { ok, maxDiff };
    } catch (e) {
      logger.warn('[GPU-PIPELINE] selfTest error:', e instanceof Error ? e.message : String(e));
      return { ok: false, maxDiff: Infinity };
    }
  }
}

export const gpuPreviewPipeline = new GpuPreviewPipeline();
