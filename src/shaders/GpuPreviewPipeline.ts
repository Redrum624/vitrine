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
  FRAG_LAYER_BLEND,
} from './sources';
import type { PassDescriptor, PassRuntime, SubPassTexture, MaskUpload } from './passDescriptors';
import { buildPassList, buildLocalAdjustmentsPass } from './passDescriptors';
import { basicAdjUniforms, exposureUniforms, shadowsHighlightsUniforms, gainsUniforms, colorBalanceUniforms, vignetteUniforms } from './uniforms';
import type { ShadowsHighlightsUniformParams } from './uniforms';
import type { DehazeState } from '../services/WebGLImageProcessor';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { ExposureModule } from '../modules/ExposureModule';
import { ShadowsHighlightsModule } from '../modules/ShadowsHighlightsModule';
import { LocalAdjustmentsModule } from '../modules/LocalAdjustmentsModule';
import { WhiteBalanceModule, computeWBGains } from '../modules/WhiteBalanceModule';
import { ToneCurveModule } from '../modules/ToneCurveModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';

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
  layerblend: FRAG_LAYER_BLEND,
};

/** Tone-curve LUT sampler-uniform names, in the same order runToneCurveGPU binds them. */
const TONECURVE_LUT_NAMES = ['u_master', 'u_red', 'u_green', 'u_blue'] as const;

/** Maximum number of mask textures kept in maskCache before LRU eviction. */
const MAX_MASK_TEXTURES = 32;

/** Exact signature of WebGL2RenderingContext.getUniformLocation, for a faithful wrap. */
export type GetUniformLocationFn = (program: WebGLProgram, name: string) => WebGLUniformLocation | null;

/**
 * Wrap a raw `getUniformLocation` with a per-program memoization cache.
 *
 * Uniform locations are STABLE for a program's lifetime (programs are compiled once
 * and never relinked in GpuPreviewPipeline), so the per-frame driver round-trips are
 * safely cacheable. The returned function is a drop-in replacement that returns EXACTLY
 * what `raw` would (same location object, or null), just cached — so it cannot change
 * rendering output.
 *
 * Caching rules (correctness-critical):
 *   - Keyed by program via the WeakMap (so different programs never collide, and a
 *     deleted program's cache entry is GC'd).
 *   - `null` results are cached too (`map.has(name)`, NOT truthiness): a uniform
 *     optimized-out of a shader returns null; without caching null we'd re-query it
 *     every frame, defeating the optimization.
 */
export function memoizeUniformLocation(raw: GetUniformLocationFn): GetUniformLocationFn {
  const cache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  return (program: WebGLProgram, name: string): WebGLUniformLocation | null => {
    let map = cache.get(program);
    if (!map) {
      map = new Map<string, WebGLUniformLocation | null>();
      cache.set(program, map);
    }
    if (map.has(name)) return map.get(name) ?? null;
    const loc = raw(program, name);
    map.set(name, loc);
    return loc;
  };
}

export class GpuPreviewPipeline {
  private gl: WebGL2RenderingContext | null = null;
  private attached = false;

  // The raw (un-memoized) getUniformLocation captured at attach() time, before we replace
  // the context method with a memoized version. Non-null acts as the double-wrap guard:
  // if it's already set on the CURRENT context, attach() has already wrapped that context
  // and must not wrap again. Reset to null in destroy() (the wrapped context is discarded).
  private rawGetUniformLocation: GetUniformLocationFn | null = null;
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

  // Diagnostic: count present() calls so we can log the first few (with full state) and any
  // GL error WITHOUT spamming the console on every viewport change. Reset on destroy().
  private presentFrames = 0;

  private srcTexture: WebGLTexture | null = null;
  private srcData: Float32Array | null = null;
  private width = 0;
  private height = 0;

  // Two ping-pong FBO+texture pairs, reallocated only on size change.
  private ping: [PingPong | null, PingPong | null] = [null, null];

  // Extra scratch FBO+texture for multi-pass (subPasses) module steps.
  // Allocated lazily (only when a subPasses pass runs),
  // resized with the ping-pong pair, freed in destroy(). NOT used by single-pass passes.
  private scratch: PingPong | null = null;

  // The output texture of the most recent render() (NOT read back).
  private resultTexture: WebGLTexture | null = null;

  // Cache of uploaded LUT textures, keyed by Float32Array identity. Re-uploaded
  // only when the LUT array reference changes.
  private lutCache = new WeakMap<Float32Array, WebGLTexture>();
  // Parallel iterable set so destroy() can delete every LUT texture (WeakMap isn't iterable).
  private lutTextures = new Set<WebGLTexture>();

  // Cache of uploaded local-adjustment mask textures (Task 10), keyed by MaskUpload.key
  // (layer id + dims + value hash). Re-uploaded only when the key changes (geometry/dims
  // change → mask rebuilt → new hash). NOT re-uploaded per frame for a static mask.
  // Bounded to MAX_MASK_TEXTURES entries (LRU eviction: least-recently-used entry is
  // the first key in the insertion-ordered Map).
  private maskCache = new Map<string, WebGLTexture>();

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
      // preserveDrawingBuffer:true — this is a PRESENT-ON-DEMAND canvas (present() runs on
      // edit/viewport/before-after changes, not every rAF). With the default (false) Chromium
      // clears the volatile drawing buffer after each composite, so any composite not
      // immediately followed by a present() (window minimize → restore, or layout thrash
      // during the first image load) leaves the canvas BLACK or showing a half-composited
      // frame. Preserving the buffer keeps the last presented frame visible until the next
      // present(), at a small (acceptable) perf cost.
      const gl = target.getContext('webgl2', {
        premultipliedAlpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      });
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

      // ── Memoize getUniformLocation on THIS pipeline's private context ──────────
      // All programs are compiled and never relinked, so uniform locations are stable
      // for the context's lifetime. Wrapping getUniformLocation here makes EVERY caller
      // (the shared setters in uniforms.ts, the present-uniform caching below, render(),
      // runSubPasses()) hit a cache instead of a per-frame driver round-trip — without
      // touching the shared setter API. This context is private to the pipeline, so the
      // wrap cannot affect any other WebGL context in the app.
      //
      // Double-wrap guard: only wrap if not already wrapped. After destroy() a fresh
      // context is created and rawGetUniformLocation is null, so a subsequent attach()
      // correctly wraps the NEW context (StrictMode double-mount safe). If attach() ran
      // twice on the same context (shouldn't happen — guarded by `this.attached`), the
      // non-null flag prevents wrapping the already-memoized method.
      if (!this.rawGetUniformLocation) {
        const raw = gl.getUniformLocation.bind(gl) as GetUniformLocationFn;
        this.rawGetUniformLocation = raw;
        (gl as { getUniformLocation: GetUniformLocationFn }).getUniformLocation =
          memoizeUniformLocation(raw);
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

    // Diagnostic: confirm the uploaded buffer is real image data (not all-zero / wrong
    // length / a single-channel ramp), which would explain a red/garbage present.
    const expected = width * height * 4;
    const c = Math.min(data.length, expected) >> 1; // a mid-buffer pixel offset (×4-aligned below)
    const p = (c >> 2) << 2;
    logger.info(
      `[GPU-PIPELINE] setSource ${width}x${height} len=${data.length}/${expected} ` +
      `mid-rgba=[${data[p]?.toFixed(3)},${data[p + 1]?.toFixed(3)},${data[p + 2]?.toFixed(3)},${data[p + 3]?.toFixed(3)}]`,
    );
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
   * Upload a local-adjustment mask (Task 10) as a width×height R32F texture, NEAREST +
   * CLAMP_TO_EDGE (NEAREST because the CPU indexes mask[pixelIndex] — a nearest lookup,
   * not a bilinear blend — so the GPU must sample the exact same texel). Cached by
   * `upload.key`; re-uploaded only when the key changes (geometry/dims → rebuilt mask).
   *
   * The mask must match the render dimensions — the pass builder rebuilds it (via the
   * module's setLayerGeometry) before emitting the pass, so a stale-size mask never
   * reaches here. We still guard: a size mismatch means we don't upload (caller fell back).
   */
  private uploadMask(gl: WebGL2RenderingContext, upload: MaskUpload): WebGLTexture | null {
    if (upload.width !== this.width || upload.height !== this.height) {
      logger.warn(`[GPU-PIPELINE] mask '${upload.key}' size ${upload.width}x${upload.height} != render ${this.width}x${this.height} — skipping`);
      return null;
    }
    const cached = this.maskCache.get(upload.key);
    if (cached) {
      // Cache hit: move to end (most recently used) by deleting and re-inserting.
      this.maskCache.delete(upload.key);
      this.maskCache.set(upload.key, cached);
      return cached;
    }
    // Cache miss: evict the oldest entry (first key) when at capacity.
    if (this.maskCache.size >= MAX_MASK_TEXTURES) {
      const firstKey = this.maskCache.keys().next().value as string;
      const evicted = this.maskCache.get(firstKey)!;
      gl.deleteTexture(evicted);
      this.maskCache.delete(firstKey);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, upload.width, upload.height, 0, gl.RED, gl.FLOAT, upload.data);
    this.maskCache.set(upload.key, tex);
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
          // Select this LUT's texture unit BEFORE uploadLut(). On a cache MISS uploadLut()
          // runs bindTexture()+texImage2D() on the ACTIVE unit — and unit 0 is still active
          // here, holding the input image (bound just above). Creating the LUT before
          // switching units would clobber unit 0 → the shader's u_image (unit 0) would then
          // sample an R32F LUT instead of the image → garbage/red output (this was the
          // tonecurve self-test FAIL maxDiff~0.975). Selecting the unit first makes the
          // upload land on units 1..4, leaving unit 0 = image intact.
          gl.activeTexture(gl.TEXTURE0 + unit);
          const tex = this.uploadLut(gl, lut);
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

    const resolveTexture = (which: SubPassTexture): WebGLTexture | null => {
      if (which === 'chainInput') return chainInput;
      if (which === 'scratch') return this.ensureScratch(gl).texture;
      if (which === 'prev') return prev;
      // MaskUpload — a CPU mask the pipeline uploads+caches as an R32F texture (Task 10).
      if (typeof which === 'object' && which !== null && (which as MaskUpload).kind === 'mask') {
        return this.uploadMask(gl, which as MaskUpload);
      }
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
        const tex = resolveTexture(texture);
        if (!tex) {
          // A required texture (e.g. a mask upload that failed/size-mismatched) is
          // missing — abort the whole module step rather than render a half-bound pass.
          logger.warn(`[GPU-PIPELINE] sub-pass '${sp.id}' binding '${sampler}' unresolved — skipping module '${pass.id}'`);
          gl.activeTexture(gl.TEXTURE0);
          return null;
        }
        gl.activeTexture(gl.TEXTURE0 + u);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(prog, sampler), u);
      }

      sp.setUniforms(gl, prog, rt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Advance only on a PING-PONG target. A 'scratch' write is an INTERMEDIATE side
      // buffer, NOT the chain — it must not become 'prev' (a sub-pass reads scratch via
      // the explicit 'scratch' binding, never via 'prev'). Critically this lets the
      // local-adjustments blend read the RUNNING image as 'prev' (u_base) even though the
      // immediately-preceding basicadj sub-pass wrote its result to scratch:
      //   layer: basicadj(prev=running) → scratch ; blend(u_base=prev=running, u_adjusted=scratch) → pingpong
      // and the NEXT layer's basicadj then reads prev = THIS blend output (correct
      // sequential semantics). Sharpen is unaffected: its blurV binds 'scratch' explicitly
      // and its unsharp's 'prev' is the blurV PING-PONG output (which DOES advance prev).
      if (target === 'pingpong') {
        prev = dst.texture;
        outputTexture = dst.texture;
        // Flip the ping-pong slot so the NEXT pingpong write goes to the other slot,
        // never overwriting the live chain texture currently held in 'prev'.
        idx = 1 - idx;
      }

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
      for (const tex of this.maskCache.values()) gl.deleteTexture(tex);
      this.maskCache.clear();
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
    // The wrapped context is discarded with this.gl; clearing the guard lets a fresh
    // attach() wrap the NEW context it creates. No un-wrapping needed.
    this.rawGetUniformLocation = null;
    this.attached = false;
    this.width = 0;
    this.height = 0;
    this.presentFrames = 0;
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
   * Orientation (see VERT_PRESENT for the authoritative comment):
   *   makeTexture uploads with UNPACK_FLIP_Y_WEBGL=false, so Float32Array row 0 (the
   *   TOP of the image) maps to texture t=0. VERT_PRESENT therefore samples v = unit.y
   *   directly (NO inversion) so the image top lands at the top of the screen — matching
   *   the 2D-canvas putImageData path. (A previous v = 1-unit.y flip here rendered every
   *   image upside-down; removed in v1.7.1.) This method needs no additional inversion.
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

    // The dest-rect math below divides by the drawing-buffer size, so it must equal the
    // resident result resolution (this.width/height, set by setSource()). present() OWNS
    // that size: size the GL drawing buffer from the resident result HERE rather than
    // depending on Canvas.redrawCanvas() to have sized it first. The old code instead
    // SKIPPED any frame where the canvas was still 0×0 (first GPU frame, or the ~150ms
    // histogram-readback resize) — but nothing re-presents afterwards (the present-effect
    // deps don't change again), so the canvas stayed BLACK until an unrelated event fired
    // a new present (the "first image black" + "sometimes loads black" reports). A 0-sized
    // buffer also divides by zero → NaN gl_Position → a garbage red/black frame.
    // Only assign when the size actually differs: assigning canvas.width/height ALWAYS
    // clears the drawing buffer, which on a viewport-only present would needlessly drop the
    // frame. (redrawCanvas no longer touches the GL drawing buffer in gpu mode — it owns
    // only the CSS display size — so there is no resize fight.)
    const canvasEl = gl.canvas as HTMLCanvasElement;
    if (this.width > 0 && this.height > 0 &&
        (canvasEl.width !== this.width || canvasEl.height !== this.height)) {
      canvasEl.width = this.width;
      canvasEl.height = this.height;
    }
    const canvasW = canvasEl.width;
    const canvasH = canvasEl.height;
    if (canvasW <= 0 || canvasH <= 0) {
      logger.warn('[GPU-PIPELINE] present(): resident result has no size yet — no-op');
      return;
    }

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

    // ── Diagnostic (first 6 frames + any GL error) ──────────────────────────────────
    // A red/garbage canvas means present() drew a bad texture; this surfaces exactly what
    // it drew: buffer size, resident result dims, whether the result is the raw source
    // (passthrough = no edits ran), and any GL error from the draw.
    const err = gl.getError();
    if (this.presentFrames < 6 || err !== 0) {
      logger.info(
        `[GPU-PIPELINE] present #${this.presentFrames}: canvas=${canvasW}x${canvasH} result=${this.width}x${this.height} ` +
        `zoom=${opts.zoom.toFixed(2)} passthrough=${this.resultTexture === this.srcTexture} splitX=${opts.splitX ?? -1} glError=${err}`,
      );
    }
    this.presentFrames++;
  }

  /**
   * Dev-only runtime correctness gate. Renders a synthetic 16x16 gradient through:
   *   1. A SINGLE basicadj pass — verifies the core ping-pong path (no LUT complexity).
   *   2. A SINGLE exposure pass — verifies shader matches ExposureModule.process()
   *      pixel-for-pixel (maxDiff < 1e-4) for non-default exposure + black params.
   *
   * Requires a real WebGL2 context — runs in the Electron app, NOT Jest.
   */
  selfTest(): { ok: boolean; maxDiff: number; unsafe: string[] } {
    if (!this.gl) {
      logger.warn('[GPU-PIPELINE] selfTest: not attached / WebGL2 unavailable');
      // No GL → the GPU path won't be used at all (renderMode stays 'cpu'); nothing to gate.
      return { ok: false, maxDiff: Infinity, unsafe: [] };
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

      // ── 4. local-adjustments sub-test (masks + sequential blend) ────────────
      // The hard one: build a real LA module with TWO enabled radial-mask layers, each
      // with a non-trivial basicAdj, then render through the multi-pass LA descriptor
      // (basicadj→scratch + blend→pingpong PER LAYER) and compare to the CPU
      // LocalAdjustmentsModule.processImage (which itself runs the SAME FRAG_BASICADJ via
      // BasicAdjustmentsModule's GPU fast-path, then the same mask*opacity blend). This
      // verifies (a) mask upload/sampling alignment, (b) the per-layer blend formula, and
      // (c) the SEQUENTIAL semantics (layer 2 operates on layer 1's result). Tolerance
      // 1e-3: same shader + same kernel; divergence is float-precision only.
      const laModule = new LocalAdjustmentsModule();
      const id1 = laModule.createLayer('radial_gradient', 'L1', w, h);
      laModule.updateLayerBasicAdj(id1, { exposure: 0.3, contrast: 0.4, saturation: 0.2 });
      // Non-unity opacity exercises the mask*opacity weight in the blend (set directly —
      // the module has no opacity setter; getLayer returns the live layer object).
      const layer1 = laModule.getLayer(id1);
      if (layer1) layer1.opacity = 0.85;
      const id2 = laModule.createLayer('radial_gradient', 'L2', w, h);
      // Move layer 2's mask so it overlaps layer 1 partially (tests sequential blend).
      laModule.setLayerGeometry(id2, {
        type: 'radial', centerX: 0.65, centerY: 0.4, radiusX: 0.35, radiusY: 0.25,
        startX: 0.5, startY: 0.15, endX: 0.5, endY: 0.85, feather: 0.4, invert: false, rotation: 0.3,
      }, w, h);
      laModule.updateLayerBasicAdj(id2, { brightness: 0.5, vibrance: 0.3, highlights: -0.2 });

      // Build the GPU LA pass from the module's getParams()-shaped layer list.
      const laParams = { enabled: true, layers: laModule.getLayers() } as Record<string, unknown>;
      const laPass = buildLocalAdjustmentsPass(laParams, w, h);
      let laMaxDiff = Infinity;
      let laOk = false;
      if (laPass) {
        this.setSource(data, w, h);
        this.render([laPass]);
        const gpuLA = this.readback();
        const refLA = laModule.processImage(new Float32Array(data), w, h);
        laMaxDiff = 0;
        for (let i = 0; i < refLA.length; i++) {
          laMaxDiff = Math.max(laMaxDiff, Math.abs(gpuLA[i] - refLA[i]));
        }
        laOk = laMaxDiff < 1e-3;
      } else {
        logger.warn('[GPU-PIPELINE] local-adj self-test: pass builder returned null (unexpected for GPU-representable layers)');
      }
      logger.info(`[GPU-PIPELINE] local-adj self-test maxDiff=${laMaxDiff.toExponential(2)} ${laOk ? 'PASS' : 'FAIL'}`);

      // ── 6. white-balance (gains) sub-test ──────────────────────────────────────
      // Non-trivial params: tungsten (3200K) + tint=10 — exercises both temperature and tint
      // terms of computeWBGains. The GPU shader is FRAG_GAINS (programKey 'gains').
      // CPU reference: WhiteBalanceModule.process() (single source of truth for the formula).
      const wbTemperature = 3200;
      const wbTint = 10;
      const { r: wbR, g: wbG, b: wbB } = computeWBGains(wbTemperature, wbTint);

      const wbPass: PassDescriptor = {
        id: 'temperature',
        programKey: 'gains',
        setUniforms: (_gl, _prog, _rt) => gainsUniforms(wbR, wbG, wbB)(_gl, _prog),
      };

      this.setSource(data, w, h);
      this.render([wbPass]);
      const gpuWB = this.readback();

      const wbModule = new WhiteBalanceModule();
      wbModule.setParams({ temperature: wbTemperature, tint: wbTint });
      const refWB = wbModule.process(new Float32Array(data), { width: w, height: h, channels: 4 });

      let wbMaxDiff = 0;
      for (let i = 0; i < refWB.length; i++) {
        wbMaxDiff = Math.max(wbMaxDiff, Math.abs(gpuWB[i] - refWB[i]));
      }
      // Gains are simple per-channel multiplies + clamp — precision is float-level.
      const wbOk = wbMaxDiff < 1e-3;
      logger.info(`[GPU-PIPELINE] white-balance self-test maxDiff=${wbMaxDiff.toExponential(2)} ${wbOk ? 'PASS' : 'FAIL'}`);

      // ── 7. tone-curve sub-test ────────────────────────────────────────────────
      // A non-trivial 3-point S-curve on the master channel (blue-channel stays linear).
      // GPU pass built via buildPassList (exercises the real production LUT-upload path).
      // CPU reference: webGLImageProcessor.applyToneCurve() with the module's own LUTs
      // (which are the same arrays the GPU pass carries in its `luts` field).
      const tcMod = new ToneCurveModule();
      tcMod.setParams({
        baseCurve: [
          { x: 0.0, y: 0.0 },
          { x: 0.5, y: 0.6 }, // raised midtones — non-identity S
          { x: 1.0, y: 1.0 },
        ],
        baseCurveNodes: 3,
        baseCurveType: 0, // linear segments — deterministic LUT, same CPU/GPU
        preserveColors: 0, // apply per-channel — simplest path
      });
      const tcPassList = buildPassList([{
        getId: () => 'tonecurve',
        getParams: () => tcMod.getParams() as unknown as Record<string, unknown>,
        getGpuLuts: () => tcMod.getGpuLuts(),
      }]);
      const tcPass = tcPassList.passes[0];
      let tcMaxDiff = 0;
      let tcOk = false;
      if (tcPass) {
        this.setSource(data, w, h);
        this.render([tcPass]);
        const gpuTC = this.readback();
        const gpuLuts = tcMod.getGpuLuts()!;
        const refTC = webGLImageProcessor.applyToneCurve(
          new Float32Array(data), w, h,
          gpuLuts.master, gpuLuts.red, gpuLuts.green, gpuLuts.blue,
          0, // preserveColors=0 — matches setParams above
        );
        tcMaxDiff = 0;
        for (let i = 0; i < refTC.length; i++) {
          tcMaxDiff = Math.max(tcMaxDiff, Math.abs(gpuTC[i] - refTC[i]));
        }
        tcOk = tcMaxDiff < 1e-3;
      } else {
        logger.warn('[GPU-PIPELINE] tone-curve self-test: pass builder returned no pass (unexpected)');
      }
      logger.info(`[GPU-PIPELINE] tone-curve self-test maxDiff=${tcMaxDiff.toExponential(2)} ${tcOk ? 'PASS' : 'FAIL'}`);

      // ── 8. color-balance sub-test ─────────────────────────────────────────────
      // Non-zero shadows/midtones/highlights + a few hue saturation tweaks.
      // CPU reference: webGLImageProcessor.applyColorBalance() (same method ColorBalanceModule
      // calls on its GPU fast-path — the ground truth for the shader).
      const cbMod = new ColorBalanceModule();
      cbMod.setParams({
        shadows:    { cyan_red: 0.3, magenta_green: -0.2, yellow_blue: 0.1 },
        midtones:   { cyan_red: -0.1, magenta_green: 0.4, yellow_blue: 0.0 },
        highlights: { cyan_red: 0.0, magenta_green: 0.2, yellow_blue: -0.3 },
        green_saturation: 20,
        blue_hue: 15,
      });
      const cbParams = cbMod.getParams();
      const cbColors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
      const cbSat = cbColors.map(c => (cbParams[`${c}_saturation`] as number | undefined) ?? 0);
      const cbLum = cbColors.map(c => (cbParams[`${c}_luminance`] as number | undefined) ?? 0);
      const cbHue = cbColors.map(c => (cbParams[`${c}_hue`] as number | undefined) ?? 0);
      const cbSh = cbParams.shadows as { cyan_red: number; magenta_green: number; yellow_blue: number };
      const cbMd = cbParams.midtones as { cyan_red: number; magenta_green: number; yellow_blue: number };
      const cbHl = cbParams.highlights as { cyan_red: number; magenta_green: number; yellow_blue: number };

      const cbPass: PassDescriptor = {
        id: 'colorbalance',
        programKey: 'colorbalance',
        setUniforms: (gl, prog, _rt) => colorBalanceUniforms(
          [cbSh.cyan_red, cbSh.magenta_green, cbSh.yellow_blue],
          [cbMd.cyan_red, cbMd.magenta_green, cbMd.yellow_blue],
          [cbHl.cyan_red, cbHl.magenta_green, cbHl.yellow_blue],
          cbSat, cbLum, cbHue,
        )(gl, prog),
      };

      this.setSource(data, w, h);
      this.render([cbPass]);
      const gpuCB = this.readback();

      const refCB = webGLImageProcessor.applyColorBalance(
        new Float32Array(data), w, h,
        [cbSh.cyan_red, cbSh.magenta_green, cbSh.yellow_blue],
        [cbMd.cyan_red, cbMd.magenta_green, cbMd.yellow_blue],
        [cbHl.cyan_red, cbHl.magenta_green, cbHl.yellow_blue],
        cbSat, cbLum, cbHue,
      );

      let cbMaxDiff = 0;
      for (let i = 0; i < refCB.length; i++) {
        cbMaxDiff = Math.max(cbMaxDiff, Math.abs(gpuCB[i] - refCB[i]));
      }
      // HSL round-trip — consistent with the existing s/h tolerance class.
      const cbOk = cbMaxDiff < 2e-2;
      logger.info(`[GPU-PIPELINE] color-balance self-test maxDiff=${cbMaxDiff.toExponential(2)} ${cbOk ? 'PASS' : 'FAIL'}`);

      // ── 9. lens-corrections vignette sub-test ─────────────────────────────────
      // Only vignetting enabled — cleanest comparison (distortion changes pixel addresses,
      // CA is a radial shift — both make pixel-exact comparison harder than a per-pixel op).
      // GPU shader is FRAG_VIGNETTE.
      // CPU reference: LensCorrectionsModule.processImage() with ONLY vignetting enabled.
      const vigAmount = 50;   // amount / 100 = 0.5 in the uniform (negative = darken)
      const vigMidpoint = 1.0;
      const vigRoundness = 0;
      const vigFeather = 50;
      const vigAmountN = vigAmount / 100;
      const vigRoundnessN = vigRoundness / 100;
      const vigFeatherN = vigFeather / 100;

      const vigPass: PassDescriptor = {
        id: 'lenscorrections:vignette',
        programKey: 'vignette',
        setUniforms: (gl, prog, rt) => vignetteUniforms(rt.width, rt.height, vigAmountN, vigMidpoint, vigRoundnessN, vigFeatherN)(gl, prog),
      };

      this.setSource(data, w, h);
      this.render([vigPass]);
      const gpuVig = this.readback();

      const vigMod = new LensCorrectionsModule();
      vigMod.setParams({
        vignetting: { enabled: true, amount: vigAmount, midpoint: vigMidpoint, roundness: vigRoundness, feather: vigFeather },
        distortion: { enabled: false, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 },
        chromaticAberration: { enabled: false, redCyan: 0, blueMagenta: 0, purple: { amount: 0, hue: 300, range: 10 }, green: { amount: 0, hue: 60, range: 10 } },
        blur: { enabled: false, radius: 0 },
        filmGrain: { enabled: false, amount: 0, size: 1 },
      });
      const refVig = vigMod.processImage(new Float32Array(data), w, h);

      let vigMaxDiff = 0;
      for (let i = 0; i < refVig.length; i++) {
        vigMaxDiff = Math.max(vigMaxDiff, Math.abs(gpuVig[i] - refVig[i]));
      }
      // Per-pixel smoothstep vignette — same formula both sides.
      const vigOk = vigMaxDiff < 1e-3;
      logger.info(`[GPU-PIPELINE] vignette self-test maxDiff=${vigMaxDiff.toExponential(2)} ${vigOk ? 'PASS' : 'FAIL'}`);

      const ok = basicAdjOk && exposureOk && shOk && laOk && wbOk && tcOk && cbOk && vigOk;
      const maxDiff = Math.max(basicAdjMaxDiff, exposureMaxDiff, shMaxDiff, laMaxDiff, wbMaxDiff, tcMaxDiff, cbMaxDiff, vigMaxDiff);

      // Map each failed sub-test to the MODULE ID buildPassList uses, so a broken GPU shader
      // is routed to the CPU bridge (proven path) instead of corrupting the image (e.g. the
      // tonecurve LUT pass rendering red). 'temperature' = WhiteBalanceModule.getId();
      // 'lenscorrections' covers the vignette/distortion/CA sub-passes.
      const unsafe: string[] = [];
      if (!basicAdjOk) unsafe.push('basicadj');
      if (!exposureOk) unsafe.push('exposure');
      if (!shOk) unsafe.push('shadowshighlights');
      if (!laOk) unsafe.push('localadjustments');
      if (!wbOk) unsafe.push('temperature');
      if (!tcOk) unsafe.push('tonecurve');
      if (!cbOk) unsafe.push('colorbalance');
      if (!vigOk) unsafe.push('lenscorrections');

      return { ok, maxDiff, unsafe };
    } catch (e) {
      logger.warn('[GPU-PIPELINE] selfTest error:', e instanceof Error ? e.message : String(e));
      // A thrown self-test means the GPU path is unreliable end-to-end — mark every GPU
      // module unsafe so the whole pipeline falls back to CPU rather than risking garbage.
      return {
        ok: false,
        maxDiff: Infinity,
        unsafe: ['basicadj', 'exposure', 'shadowshighlights', 'localadjustments', 'temperature', 'tonecurve', 'colorbalance', 'lenscorrections'],
      };
    }
  }
}

export const gpuPreviewPipeline = new GpuPreviewPipeline();
