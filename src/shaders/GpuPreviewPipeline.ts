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
  VERT_PRESENT,
  FRAG_EXPOSURE,
  FRAG_GAINS,
  FRAG_BASICADJ,
  FRAG_TONECURVE,
  FRAG_COLORBALANCE,
  FRAG_DISTORTION,
  FRAG_LATERALCA,
  FRAG_VIGNETTE,
  FRAG_PRESENT,
  FRAG_SHADOWSHIGHLIGHTS,
  FRAG_BLUR_H,
  FRAG_BLUR_V,
  FRAG_UNSHARP,
} from './sources';
import type { PassDescriptor, PassRuntime, SubPassTexture } from './passDescriptors';
import { buildPassList } from './passDescriptors';
import { basicAdjUniforms, exposureUniforms, shadowsHighlightsUniforms } from './uniforms';
import { SharpenModule } from '../modules/SharpenModule';
import type { ShadowsHighlightsUniformParams } from './uniforms';
import type { DehazeState } from '../services/WebGLImageProcessor';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { ExposureModule } from '../modules/ExposureModule';
import { ShadowsHighlightsModule } from '../modules/ShadowsHighlightsModule';

export interface PreviewRenderResult {
  width: number;
  height: number;
}

interface PingPong {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/** Constant quad vertices for the present pass (TRIANGLE_STRIP: BL, BR, TL, TR).
 *  Allocated once; uploaded to the GPU buffer at attach() time via STATIC_DRAW. */
const PRESENT_QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/** programKey → fragment source. Keys must match those emitted by passDescriptors.ts. */
const PROGRAM_SOURCES: Record<string, string> = {
  exposure: FRAG_EXPOSURE,
  gains: FRAG_GAINS,
  basicadj: FRAG_BASICADJ,
  tonecurve: FRAG_TONECURVE,
  colorbalance: FRAG_COLORBALANCE,
  distortion: FRAG_DISTORTION,
  lateralca: FRAG_LATERALCA,
  vignette: FRAG_VIGNETTE,
  shadowshighlights: FRAG_SHADOWSHIGHLIGHTS,
  blur_h: FRAG_BLUR_H,
  blur_v: FRAG_BLUR_V,
  unsharp: FRAG_UNSHARP,
};

/** Tone-curve LUT sampler-uniform names, in the same order runToneCurveGPU binds them. */
const TONECURVE_LUT_NAMES = ['u_master', 'u_red', 'u_green', 'u_blue'] as const;

export class GpuPreviewPipeline {
  private gl: WebGL2RenderingContext | null = null;
  private attached = false;
  private vao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private programs = new Map<string, WebGLProgram>();

  // Separate program + dynamic vertex buffer for the present pass.
  // We can't share the fullscreen VAO because the present quad covers an arbitrary
  // clip-space rect (image rect after zoom/pan), not necessarily [-1,1]×[-1,1].
  private presentProgram: WebGLProgram | null = null;
  private presentQuadBuffer: WebGLBuffer | null = null;

  // Uniform locations for the present program, cached at attach() time.
  private presentUniforms: {
    u_destRect: WebGLUniformLocation | null;
    u_image: WebGLUniformLocation | null;
    u_original: WebGLUniformLocation | null;
    u_splitX: WebGLUniformLocation | null;
  } | null = null;

  // Reusable 4-element buffer for the u_destRect uniform — avoids per-call allocation.
  private presentDestRect = new Float32Array(4);

  private srcTexture: WebGLTexture | null = null;
  private srcData: Float32Array | null = null;
  private width = 0;
  private height = 0;

  // Two ping-pong FBO+texture pairs, reallocated only on size change.
  private ping: [PingPong | null, PingPong | null] = [null, null];

  // Extra scratch FBO+texture for multi-pass (subPasses) module steps — e.g. sharpen's
  // intermediate H-blur result. Allocated lazily (only when a subPasses pass runs),
  // resized with the ping-pong pair, freed in destroy(). NOT used by single-pass passes.
  private scratch: PingPong | null = null;

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
   *
   * Safe to call again after destroy() — destroy() resets `attached` to false and
   * nulls `gl`, so a subsequent attach() fully reinitializes the pipeline (StrictMode
   * double-mount safe).
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

      // Compile the present program (VERT_PRESENT + FRAG_PRESENT).
      this.presentProgram = this.buildProgram(gl, VERT_PRESENT, FRAG_PRESENT);
      if (!this.presentProgram) {
        logger.warn('[GPU-PIPELINE] present program failed to compile — present() will be a no-op');
      }

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

      // Static vertex buffer for the present quad. The positions are constant
      // (VERT_PRESENT remaps them via u_destRect); only the uniform changes per call.
      this.presentQuadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.presentQuadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, PRESENT_QUAD_VERTS, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Cache uniform locations for the present program (4 getUniformLocation calls once
      // at startup, not 4× per present() frame).
      if (this.presentProgram) {
        this.presentUniforms = {
          u_destRect: gl.getUniformLocation(this.presentProgram, 'u_destRect'),
          u_image:    gl.getUniformLocation(this.presentProgram, 'u_image'),
          u_original: gl.getUniformLocation(this.presentProgram, 'u_original'),
          u_splitX:   gl.getUniformLocation(this.presentProgram, 'u_splitX'),
        };
      }

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

    // Drop the scratch FBO too — it is reallocated lazily at the new size on next use.
    if (this.scratch) {
      gl.deleteFramebuffer(this.scratch.framebuffer);
      gl.deleteTexture(this.scratch.texture);
      this.scratch = null;
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

  /** Lazily create the scratch FBO+texture (for multi-pass subPasses) at the current size. */
  private ensureScratch(gl: WebGL2RenderingContext): PingPong {
    if (this.scratch) return this.scratch;
    const texture = this.makeTexture(gl, this.width, this.height, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error(`[GPU-PIPELINE] scratch framebuffer incomplete at ${this.width}x${this.height}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.scratch = { framebuffer, texture };
    return this.scratch;
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
      // ── Multi-pass module step (subPasses) ──────────────────────────────────
      // Executed as one logical step: chainInput is preserved, intermediates go to
      // the scratch FBO, the net output becomes the chain texture for the next module.
      if (pass.subPasses && pass.subPasses.length > 0) {
        const result = this.runSubPasses(gl, pass, inputTexture, idx, rt);
        if (result) {
          inputTexture = result.outputTexture;
          idx = result.idx;
          drew = true;
        }
        continue;
      }

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

  /**
   * Execute a multi-pass module step (PassDescriptor.subPasses) as one logical unit.
   *
   * Texture model (see SubPass docs in passDescriptors.ts):
   *   - chainInput : the texture entering this module step (the module's "original");
   *                  preserved unchanged for the whole step so a final sub-pass (e.g. the
   *                  unsharp combine) can sample it alongside an intermediate.
   *   - prev       : the output of the previous sub-pass; for the first sub-pass = chainInput.
   *   - scratch    : the dedicated intermediate FBO+texture.
   *
   * Each sub-pass binds `inputs` (default ['prev']) to texture units 0..n via `samplerNames`
   * (default ['u_image']), draws into its `target` FBO ('pingpong' default, or 'scratch'),
   * and updates `prev`. Ping-pong index only advances on 'pingpong' targets so the next
   * module continues the two-FBO ping-pong correctly. Returns the final output texture and
   * the new ping-pong index, or null if any sub-pass program is missing (step skipped).
   */
  private runSubPasses(
    gl: WebGL2RenderingContext,
    pass: PassDescriptor,
    chainInput: WebGLTexture,
    startIdx: number,
    rt: PassRuntime,
  ): { outputTexture: WebGLTexture; idx: number } | null {
    // All sub-pass programs must exist; otherwise skip the whole step (don't half-render).
    for (const sp of pass.subPasses!) {
      if (!this.programs.get(sp.programKey)) {
        logger.warn(`[GPU-PIPELINE] no program for sub-pass '${sp.id}' (key '${sp.programKey}') — skipping module '${pass.id}'`);
        return null;
      }
    }

    let prev: WebGLTexture = chainInput;
    let idx = startIdx;
    let outputTexture: WebGLTexture = chainInput;

    const resolveTexture = (which: SubPassTexture): WebGLTexture => {
      if (which === 'chainInput') return chainInput;
      if (which === 'scratch') return this.ensureScratch(gl).texture;
      if (which === 'prev') return prev;
      // External WebGLTexture — bind directly, no ownership transfer.
      return which as WebGLTexture;
    };

    for (const sp of pass.subPasses!) {
      const prog = this.programs.get(sp.programKey)!;
      const target = sp.target ?? 'pingpong';
      const dst = target === 'scratch' ? this.ensureScratch(gl) : this.ping[idx]!;

      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(prog);

      // Bind textures in unit order (default: single prev → u_image on unit 0).
      const bindings = sp.bindings ?? [{ texture: 'prev', sampler: 'u_image' }];
      for (let u = 0; u < bindings.length; u++) {
        const { texture, sampler } = bindings[u];
        gl.activeTexture(gl.TEXTURE0 + u);
        gl.bindTexture(gl.TEXTURE_2D, resolveTexture(texture));
        gl.uniform1i(gl.getUniformLocation(prog, sampler), u);
      }

      sp.setUniforms(gl, prog, rt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Advance: this sub-pass's output is the next sub-pass's 'prev'.
      prev = dst.texture;
      outputTexture = dst.texture;
      // Ping-pong index only flips when we actually consumed a ping-pong slot, so the
      // NEXT module writes to the other slot (never overwriting the live chain texture).
      if (target === 'pingpong') idx = 1 - idx;

      // Restore the default active unit so the next sub-pass / module isn't surprised.
      gl.activeTexture(gl.TEXTURE0);
    }

    return { outputTexture, idx };
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
      if (this.presentProgram) gl.deleteProgram(this.presentProgram);
      for (const pp of this.ping) {
        if (pp) {
          gl.deleteFramebuffer(pp.framebuffer);
          gl.deleteTexture(pp.texture);
        }
      }
      for (const tex of this.lutTextures) gl.deleteTexture(tex);
      this.lutTextures.clear();
      if (this.srcTexture) gl.deleteTexture(this.srcTexture);
      if (this.scratch) {
        gl.deleteFramebuffer(this.scratch.framebuffer);
        gl.deleteTexture(this.scratch.texture);
      }
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.presentQuadBuffer) gl.deleteBuffer(this.presentQuadBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.programs.clear();
    this.presentProgram = null;
    this.presentQuadBuffer = null;
    this.presentUniforms = null;
    this.scratch = null;
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
   * Return the most recent GL error code (gl.getError()). Used by the dev self-test
   * to assert that present() issues no GL errors. Returns 0 (NO_ERROR) when there is
   * no pending error or when the pipeline is not attached.
   */
  glError(): number {
    return this.gl ? this.gl.getError() : 0;
  }

  /**
   * Blit `resultTexture` to the default framebuffer (the visible canvas) with the
   * same zoom/pan geometry used by the 2D-canvas path in Canvas.tsx.
   *
   * No GPU→CPU readback — the texture stays resident on the GPU.
   *
   * Zoom/pan math (mirrors Canvas.tsx lines ~574-577):
   *   scaledW = canvasW * zoom
   *   scaledH = canvasH * zoom
   *   x = (canvasW - scaledW)/2 + panX   (left edge, in canvas pixels)
   *   y = (canvasH - scaledH)/2 + panY   (top  edge, in canvas pixels)
   *
   * Y-flip reasoning (see VERT_PRESENT for the authoritative comment):
   *   texImage2D stores row 0 of the Float32Array at the BOTTOM of the OpenGL texture
   *   (bottom-left origin). The default framebuffer is also bottom-left origin. So a
   *   naive v = unit.y would render the image upside-down (row 0 at bottom of quad =
   *   bottom of canvas = bottom of screen). We flip to v = 1-unit.y so row 0 of the
   *   texture (the top of the image) lands at the TOP of the quad on screen. This
   *   matches the 2D-canvas path (putImageData which is top-left-origin). The flip is
   *   in VERT_PRESENT; this method needs no additional inversion.
   *
   * Before/after split: fragments with canvas-pixel x < splitX sample srcTexture
   * (original); others sample resultTexture (processed). Pass splitX < 0 to disable.
   */
  present(opts: { zoom: number; panX: number; panY: number; splitX?: number }): void {
    const gl = this.gl;
    if (!gl || !this.attached) {
      logger.warn('[GPU-PIPELINE] present() called before a successful attach() — no-op');
      return;
    }
    if (!this.resultTexture) {
      logger.warn('[GPU-PIPELINE] present() called before setSource()/render() — no-op');
      return;
    }
    if (!this.presentProgram || !this.presentQuadBuffer || !this.presentUniforms) {
      logger.warn('[GPU-PIPELINE] present program not available — no-op');
      return;
    }

    const canvasW = (gl.canvas as HTMLCanvasElement).width;
    const canvasH = (gl.canvas as HTMLCanvasElement).height;

    // ── Destination rect in canvas pixels (same formula as Canvas.tsx ~574-577) ──
    const scaledW = canvasW * opts.zoom;
    const scaledH = canvasH * opts.zoom;
    const pixX = (canvasW - scaledW) / 2 + opts.panX;    // left edge
    const pixY = (canvasH - scaledH) / 2 + opts.panY;    // top  edge (canvas-pixel, top-origin)

    // ── Convert pixel rect to clip space (NDC [-1,1], bottom-left origin) ──
    // Canvas pixels: (0,0) top-left, (canvasW, canvasH) bottom-right
    // NDC:           (-1,1) top-left, (1,-1) bottom-right
    //   ndcX =  (pixX / canvasW) * 2 - 1
    //   ndcY = -((pixY / canvasH) * 2 - 1)  ← invert Y so top-pixel → NDC top
    // u_destRect = (x0_ndc, y0_ndc, x1_ndc, y1_ndc) where y0 > y1 (top > bottom in NDC)
    this.presentDestRect[0] =  (pixX              / canvasW) * 2 - 1;
    this.presentDestRect[1] = -((pixY              / canvasH) * 2 - 1);  // top edge in NDC
    this.presentDestRect[2] =  ((pixX + scaledW)   / canvasW) * 2 - 1;
    this.presentDestRect[3] = -(((pixY + scaledH)  / canvasH) * 2 - 1); // bottom edge in NDC

    // ── Render to default framebuffer ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.presentProgram);

    // Bind the static buffer (data uploaded once at attach()) and set the attribute.
    // TRIANGLE_STRIP corners: BL(-1,-1), BR(1,-1), TL(-1,1), TR(1,1)
    // VERT_PRESENT remaps them via u_destRect, so the strip covers the correct clip-space rect.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.presentQuadBuffer);
    const aPosLoc = gl.getAttribLocation(this.presentProgram, 'a_pos');
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms using cached locations (no getUniformLocation per frame).
    gl.uniform4fv(this.presentUniforms.u_destRect, this.presentDestRect);

    // Bind processed result → unit 0 (u_image).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.resultTexture);
    gl.uniform1i(this.presentUniforms.u_image, 0);

    // Bind source/original → unit 1 (u_original); fall back to resultTexture if no
    // source is available (split will show the same image on both sides, harmless).
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture ?? this.resultTexture);
    gl.uniform1i(this.presentUniforms.u_original, 1);

    // Before/after split: pass canvas-pixel x, or -1 to disable.
    gl.uniform1f(this.presentUniforms.u_splitX, opts.splitX ?? -1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Clean up attribute state so subsequent VAO-based draws aren't affected.
    gl.disableVertexAttribArray(aPosLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Restore the conventional default texture unit so subsequent code isn't surprised.
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Dev-only runtime correctness gate. Renders a synthetic 16x16 gradient through:
   *   1. A SINGLE basicadj pass — verifies the core ping-pong path (no LUT complexity).
   *   2. A SINGLE exposure pass — verifies shader matches ExposureModule.process()
   *      pixel-for-pixel (maxDiff < 1e-4) for non-default exposure + black params.
   *
   * Requires a real WebGL2 context — runs in the Electron app, NOT Jest.
   */
  selfTest(): { ok: boolean; maxDiff: number } {
    if (!this.gl) {
      logger.warn('[GPU-PIPELINE] selfTest: not attached / WebGL2 unavailable');
      return { ok: false, maxDiff: Infinity };
    }
    try {
      // 16x16 RGBA Float32 gradient (same data for both sub-tests).
      const w = 16, h = 16;
      const data = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = (i % w) / w;
        data[i * 4 + 1] = Math.floor(i / w) / h;
        data[i * 4 + 2] = ((i * 7) % 13) / 13;
        data[i * 4 + 3] = 1;
      }

      // ── 1. basicadj sub-test ────────────────────────────────────────────────
      const basicAdjParams = {
        black_point: 0.1, exposure: 0.3, contrast: 0.5, brightness: 0.2,
        saturation: 0.3, vibrance: 0.2, dehaze: 0, highlights: 0.4, shadows: -0.3,
      };

      // Build a single basicadj PassDescriptor via the real pass-list builder, so the
      // exact production uniform path is exercised.
      const basicAdjPass: PassDescriptor = {
        id: 'basicadj',
        programKey: 'basicadj',
        // Reuse the shared uniform-setter (the same one buildPassList wires).
        setUniforms: (gl, prog, rt) => basicAdjUniforms(basicAdjParams, rt.dehaze)(gl, prog),
      };

      this.setSource(data, w, h);
      this.setDehazeParam(basicAdjParams.dehaze);
      this.render([basicAdjPass]);
      const gpuBasicAdj = this.readback();

      const refBasicAdj = webGLImageProcessor.applyBasicAdjustments(data, w, h, basicAdjParams);

      let basicAdjMaxDiff = 0;
      for (let i = 0; i < refBasicAdj.length; i++) {
        basicAdjMaxDiff = Math.max(basicAdjMaxDiff, Math.abs(gpuBasicAdj[i] - refBasicAdj[i]));
      }
      const basicAdjOk = basicAdjMaxDiff < 1e-4;
      logger.info(`[GPU-PIPELINE] basicadj self-test maxDiff=${basicAdjMaxDiff.toExponential(2)} ${basicAdjOk ? 'PASS' : 'FAIL'}`);

      // ── 2. exposure sub-test ────────────────────────────────────────────────
      // Non-default params: 0.7 EV + 0.05 black — exercises both terms.
      const exposureStops = 0.7;
      const exposureBlack = 0.05;
      const exposureGain = Math.pow(2, exposureStops);

      const exposurePass: PassDescriptor = {
        id: 'exposure',
        programKey: 'exposure',
        setUniforms: (_gl, _prog, _rt) => exposureUniforms(exposureGain, exposureBlack)(_gl, _prog),
      };

      this.setSource(data, w, h);
      this.render([exposurePass]);
      const gpuExposure = this.readback();

      // Reference: ExposureModule.processWithContext with same params (single source of truth).
      const expModule = new ExposureModule();
      expModule.setCurrentParams({ exposure: exposureStops, black: exposureBlack });
      const refExposure = expModule.process(data, { width: w, height: h, channels: 4 });

      let exposureMaxDiff = 0;
      for (let i = 0; i < refExposure.length; i++) {
        exposureMaxDiff = Math.max(exposureMaxDiff, Math.abs(gpuExposure[i] - refExposure[i]));
      }
      const exposureOk = exposureMaxDiff < 1e-4;
      logger.info(`[GPU-PIPELINE] exposure self-test maxDiff=${exposureMaxDiff.toExponential(2)} ${exposureOk ? 'PASS' : 'FAIL'}`);

      // ── 3. shadows/highlights sub-test ──────────────────────────────────────
      // Non-neutral params exercising every GPU op (recovery with color transfer,
      // white/black point, compress, color correction, 2 iterations). maskBlur MUST
      // be 0 — the only mode the analytic shader is valid for (maskBlur>0 routes to CPU).
      const shParams: ShadowsHighlightsUniformParams = {
        shadows: 70, highlights: 35, shadowsRadius: 60, highlightsRadius: 55,
        shadowsColorTransfer: 30, highlightsColorTransfer: 20,
        whitePoint: 0.5, blackPoint: 5, compress: 25,
        shadowsColorCorrection: 15, highlightsColorCorrection: 10,
        maskFalloff: 2.0, strength: 1.2, preserveColor: false, iterations: 2,
      };

      const shPass: PassDescriptor = {
        id: 'shadowshighlights',
        programKey: 'shadowshighlights',
        setUniforms: (gl, prog, _rt) => shadowsHighlightsUniforms(shParams)(gl, prog),
      };

      this.setSource(data, w, h);
      this.render([shPass]);
      const gpuSH = this.readback();

      // Reference: the real ShadowsHighlightsModule (single source of truth).
      const shModule = new ShadowsHighlightsModule();
      shModule.setParams({ ...shParams, enabled: true, maskBlur: 0, bilateralFilter: false });
      const refSH = shModule.process({ width: w, height: h, data: new Float32Array(data), channels: 4 }).data;

      let shMaxDiff = 0;
      for (let i = 0; i < refSH.length; i++) {
        shMaxDiff = Math.max(shMaxDiff, Math.abs(gpuSH[i] - refSH[i]));
      }
      // pow() + additive color mixing → same tolerance class as color-balance (2e-2).
      const shOk = shMaxDiff < 0.02;
      logger.info(`[GPU-PIPELINE] s/h self-test maxDiff=${shMaxDiff.toExponential(2)} ${shOk ? 'PASS' : 'FAIL'}`);

      // ── 4. sharpen sub-test (multi-pass subPasses) ──────────────────────────
      // Non-trivial unsharp mask. Builds the REAL sharpen PassDescriptor (subPasses =
      // blurH→blurV→unsharp) via buildPassList, renders it through the multi-pass path,
      // and compares to SharpenModule.process() (single source of truth for the kernel +
      // threshold math). Tolerance: the GPU uses the SAME precomputed kernel and clamps
      // edges identically (CLAMP_TO_EDGE ↔ CPU min/max), so divergence is float-precision
      // only — 1e-3 is comfortably achievable.
      const sharpenMod = new SharpenModule();
      sharpenMod.setParams({ enabled: true, amount: 80, radius: 2.0, detail: 20 });
      const sharpenPasses = buildPassList([sharpenMod]).passes;

      this.setSource(data, w, h);
      this.render(sharpenPasses);
      const gpuSharpen = this.readback();

      const refSharpen = sharpenMod.process(new Float32Array(data), { width: w, height: h, channels: 4 });

      let sharpenMaxDiff = 0;
      for (let i = 0; i < refSharpen.length; i++) {
        sharpenMaxDiff = Math.max(sharpenMaxDiff, Math.abs(gpuSharpen[i] - refSharpen[i]));
      }
      const sharpenOk = sharpenMaxDiff < 1e-3;
      logger.info(`[GPU-PIPELINE] sharpen self-test maxDiff=${sharpenMaxDiff.toExponential(2)} ${sharpenOk ? 'PASS' : 'FAIL'}`);

      const ok = basicAdjOk && exposureOk && shOk && sharpenOk;
      const maxDiff = Math.max(basicAdjMaxDiff, exposureMaxDiff, shMaxDiff, sharpenMaxDiff);
      return { ok, maxDiff };
    } catch (e) {
      logger.warn('[GPU-PIPELINE] selfTest error:', e instanceof Error ? e.message : String(e));
      return { ok: false, maxDiff: Infinity };
    }
  }
}

export const gpuPreviewPipeline = new GpuPreviewPipeline();
