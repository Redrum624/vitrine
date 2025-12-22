/**
 * ShaderPipeline - Optimized GPU Shader Chain Execution
 *
 * Provides efficient multi-pass GPU rendering without CPU readback between passes.
 * Uses ping-pong framebuffers for chained shader operations.
 *
 * Features:
 * - Ping-pong framebuffer system
 * - Automatic uniform binding
 * - Shader program caching
 * - GPU state management
 * - Batch operation execution
 */

import { logger } from '../utils/Logger';

/**
 * Shader pass configuration
 */
interface ShaderPass {
  /** Unique identifier for this pass */
  id: string;
  /** Fragment shader source code */
  fragmentSource: string;
  /** Uniforms to set for this pass */
  uniforms: Record<string, number | number[] | Float32Array>;
  /** Whether this pass is enabled */
  enabled: boolean;
}

/**
 * Framebuffer with associated texture
 */
interface FramebufferTexture {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Compiled shader program with cached locations
 */
interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
  attributeLocations: Map<string, number>;
}

/**
 * Pipeline execution result
 */
interface PipelineResult {
  output: Float32Array;
  passTimings: Map<string, number>;
  totalTime: number;
}

/**
 * Common vertex shader for fullscreen quad
 */
const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

/**
 * ShaderPipeline class for efficient multi-pass GPU rendering
 */
export class ShaderPipeline {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: OffscreenCanvas | null = null;
  private programs: Map<string, CompiledProgram> = new Map();
  private pingPongBuffers: [FramebufferTexture | null, FramebufferTexture | null] = [null, null];
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private currentBufferIndex = 0;
  private inputTexture: WebGLTexture | null = null;
  private initialized = false;

  /**
   * Initialize the shader pipeline
   */
  async initialize(): Promise<boolean> {
    try {
      // Create offscreen canvas
      this.canvas = new OffscreenCanvas(1, 1);
      this.gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });

      if (!this.gl) {
        logger.error('ShaderPipeline: WebGL2 not supported');
        return false;
      }

      // Enable required extensions
      this.gl.getExtension('EXT_color_buffer_float');
      this.gl.getExtension('OES_texture_float_linear');

      // Create fullscreen quad geometry
      this.createQuadGeometry();

      this.initialized = true;
      logger.debug('ShaderPipeline initialized');
      return true;
    } catch (error) {
      logger.error('ShaderPipeline initialization failed', { error });
      return false;
    }
  }

  /**
   * Create fullscreen quad geometry
   */
  private createQuadGeometry(): void {
    if (!this.gl) return;

    const gl = this.gl;

    // Fullscreen quad vertices (position + texcoord)
    const vertices = new Float32Array([
      // Position    // TexCoord
      -1.0, -1.0,    0.0, 0.0,
       1.0, -1.0,    1.0, 0.0,
      -1.0,  1.0,    0.0, 1.0,
       1.0,  1.0,    1.0, 1.0,
    ]);

    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);

    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Position attribute
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);

    // TexCoord attribute
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
  }

  /**
   * Compile a shader program
   */
  private compileProgram(id: string, fragmentSource: string): CompiledProgram | null {
    if (!this.gl) return null;

    const gl = this.gl;

    // Check cache
    if (this.programs.has(id)) {
      return this.programs.get(id)!;
    }

    // Compile vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) return null;

    gl.shaderSource(vertexShader, VERTEX_SHADER);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      logger.error('Vertex shader compilation failed', {
        error: gl.getShaderInfoLog(vertexShader),
      });
      gl.deleteShader(vertexShader);
      return null;
    }

    // Compile fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      gl.deleteShader(vertexShader);
      return null;
    }

    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      logger.error('Fragment shader compilation failed', {
        id,
        error: gl.getShaderInfoLog(fragmentShader),
      });
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }

    // Link program
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    // Bind attribute locations before linking
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_texCoord');

    gl.linkProgram(program);

    // Clean up shaders (they're now part of the program)
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      logger.error('Program linking failed', {
        id,
        error: gl.getProgramInfoLog(program),
      });
      gl.deleteProgram(program);
      return null;
    }

    const compiled: CompiledProgram = {
      program,
      uniformLocations: new Map(),
      attributeLocations: new Map(),
    };

    // Cache uniform locations
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) {
        const location = gl.getUniformLocation(program, info.name);
        if (location) {
          compiled.uniformLocations.set(info.name, location);
        }
      }
    }

    this.programs.set(id, compiled);
    logger.debug('ShaderPipeline: Compiled program', { id });

    return compiled;
  }

  /**
   * Create or resize ping-pong framebuffers
   */
  private ensureFramebuffers(width: number, height: number): void {
    if (!this.gl) return;

    const gl = this.gl;

    // Check if we need to resize
    if (
      this.pingPongBuffers[0] &&
      this.pingPongBuffers[0].width === width &&
      this.pingPongBuffers[0].height === height
    ) {
      return;
    }

    // Delete old framebuffers
    for (const fb of this.pingPongBuffers) {
      if (fb) {
        gl.deleteFramebuffer(fb.framebuffer);
        gl.deleteTexture(fb.texture);
      }
    }

    // Create new ping-pong framebuffers
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      // Check framebuffer status
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        logger.error('Framebuffer incomplete', { index: i, status });
      }

      this.pingPongBuffers[i] = { framebuffer, texture, width, height };
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    logger.debug('ShaderPipeline: Created ping-pong buffers', { width, height });
  }

  /**
   * Upload input image to texture
   */
  private uploadInputTexture(data: Float32Array, width: number, height: number): void {
    if (!this.gl) return;

    const gl = this.gl;

    if (!this.inputTexture) {
      this.inputTexture = gl.createTexture();
    }

    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Set uniforms for a program
   */
  private setUniforms(
    program: CompiledProgram,
    uniforms: Record<string, number | number[] | Float32Array>
  ): void {
    if (!this.gl) return;

    const gl = this.gl;

    for (const [name, value] of Object.entries(uniforms)) {
      const location = program.uniformLocations.get(name);
      if (!location) continue;

      if (typeof value === 'number') {
        gl.uniform1f(location, value);
      } else if (Array.isArray(value)) {
        switch (value.length) {
          case 2:
            gl.uniform2fv(location, value);
            break;
          case 3:
            gl.uniform3fv(location, value);
            break;
          case 4:
            gl.uniform4fv(location, value);
            break;
          default:
            gl.uniform1fv(location, value);
        }
      } else if (value instanceof Float32Array) {
        gl.uniform1fv(location, value);
      }
    }
  }

  /**
   * Execute a pipeline of shader passes
   */
  async execute(
    input: Float32Array,
    width: number,
    height: number,
    passes: ShaderPass[]
  ): Promise<PipelineResult> {
    if (!this.initialized || !this.gl) {
      throw new Error('ShaderPipeline not initialized');
    }

    const startTime = performance.now();
    const passTimings = new Map<string, number>();
    const gl = this.gl;

    // Resize canvas if needed
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Ensure framebuffers are the right size
    this.ensureFramebuffers(width, height);

    // Upload input texture
    this.uploadInputTexture(input, width, height);

    // Set viewport
    gl.viewport(0, 0, width, height);

    // Filter enabled passes
    const enabledPasses = passes.filter((p) => p.enabled);

    // Current input texture (starts as the uploaded input)
    let currentInputTexture = this.inputTexture;
    this.currentBufferIndex = 0;

    // Execute each pass
    for (let i = 0; i < enabledPasses.length; i++) {
      const pass = enabledPasses[i];
      const passStart = performance.now();

      // Compile shader if needed
      const program = this.compileProgram(pass.id, pass.fragmentSource);
      if (!program) {
        logger.error('Failed to compile shader for pass', { id: pass.id });
        continue;
      }

      // Determine output framebuffer (ping-pong)
      const outputBuffer = this.pingPongBuffers[this.currentBufferIndex];
      if (!outputBuffer) continue;

      // Bind output framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, outputBuffer.framebuffer);

      // Use program
      gl.useProgram(program.program);

      // Bind input texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentInputTexture);

      // Set u_texture uniform
      const texLocation = program.uniformLocations.get('u_texture');
      if (texLocation) {
        gl.uniform1i(texLocation, 0);
      }

      // Set resolution uniform if present
      const resLocation = program.uniformLocations.get('u_resolution');
      if (resLocation) {
        gl.uniform2f(resLocation, width, height);
      }

      // Set custom uniforms
      this.setUniforms(program, pass.uniforms);

      // Draw fullscreen quad
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      // Swap buffers for next pass
      currentInputTexture = outputBuffer.texture;
      this.currentBufferIndex = 1 - this.currentBufferIndex;

      passTimings.set(pass.id, performance.now() - passStart);
    }

    // Read back result
    const resultBuffer = this.pingPongBuffers[1 - this.currentBufferIndex];
    if (!resultBuffer) {
      throw new Error('No result buffer available');
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, resultBuffer.framebuffer);
    const output = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, output);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const totalTime = performance.now() - startTime;

    logger.debug('ShaderPipeline: Executed pipeline', {
      passes: enabledPasses.length,
      totalTime: totalTime.toFixed(2),
    });

    return { output, passTimings, totalTime };
  }

  /**
   * Warm up shaders by compiling them ahead of time
   */
  warmup(passes: ShaderPass[]): void {
    for (const pass of passes) {
      this.compileProgram(pass.id, pass.fragmentSource);
    }
    logger.debug('ShaderPipeline: Warmed up shaders', { count: passes.length });
  }

  /**
   * Clear cached programs
   */
  clearCache(): void {
    if (!this.gl) return;

    for (const program of this.programs.values()) {
      this.gl.deleteProgram(program.program);
    }
    this.programs.clear();
    logger.debug('ShaderPipeline: Cleared program cache');
  }

  /**
   * Destroy the pipeline and release resources
   */
  destroy(): void {
    if (!this.gl) return;

    const gl = this.gl;

    // Delete programs
    for (const program of this.programs.values()) {
      gl.deleteProgram(program.program);
    }
    this.programs.clear();

    // Delete framebuffers
    for (const fb of this.pingPongBuffers) {
      if (fb) {
        gl.deleteFramebuffer(fb.framebuffer);
        gl.deleteTexture(fb.texture);
      }
    }
    this.pingPongBuffers = [null, null];

    // Delete geometry
    if (this.quadVAO) {
      gl.deleteVertexArray(this.quadVAO);
      this.quadVAO = null;
    }
    if (this.quadVBO) {
      gl.deleteBuffer(this.quadVBO);
      this.quadVBO = null;
    }

    // Delete input texture
    if (this.inputTexture) {
      gl.deleteTexture(this.inputTexture);
      this.inputTexture = null;
    }

    this.gl = null;
    this.canvas = null;
    this.initialized = false;

    logger.debug('ShaderPipeline destroyed');
  }

  /**
   * Check if pipeline is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const shaderPipeline = new ShaderPipeline();

// Export types
export type { ShaderPass, PipelineResult };
