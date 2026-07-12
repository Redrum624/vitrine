/**
 * ShaderManager - WebGL2 Shader Compilation and Management
 *
 * Manages shader compilation, program linking, and resource pooling
 * for GPU-accelerated image processing.
 */

import { logger } from '../utils/Logger';

export interface ShaderSource {
  vertex: string;
  fragment: string;
}

export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
}

export class ShaderManager {
  private static instance: ShaderManager;
  private gl: WebGL2RenderingContext | null = null;
  private programs: Map<string, ShaderProgram> = new Map();
  private canvas: HTMLCanvasElement | null = null;

  private constructor() {}

  static getInstance(): ShaderManager {
    if (!ShaderManager.instance) {
      ShaderManager.instance = new ShaderManager();
    }
    return ShaderManager.instance;
  }

  /**
   * Initialize WebGL2 context
   */
  initialize(): boolean {
    try {
      // Create offscreen canvas for GPU processing
      this.canvas = document.createElement('canvas');
      this.canvas.width = 2048;
      this.canvas.height = 2048;

      // Get WebGL2 context with optimal settings
      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        desynchronized: true
      });

      if (!this.gl) {
        logger.error('WebGL2 not supported');
        return false;
      }

      // Check for required extensions
      const ext = this.gl.getExtension('EXT_color_buffer_float');
      if (!ext) {
        logger.warn('EXT_color_buffer_float not supported - float textures may not work');
      }

      logger.info('ShaderManager initialized with WebGL2');
      logger.info(`Max texture size: ${this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)}`);
      logger.info(`Max viewport dims: ${this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS)}`);

      return true;
    } catch (error) {
      logger.error('ShaderManager initialization failed:', error);
      return false;
    }
  }

  /**
   * Compile a shader
   */
  private compileShader(source: string, type: number): WebGLShader | null {
    if (!this.gl) return null;

    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    // Check compilation status
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      logger.error(`Shader compilation failed: ${info}`);
      logger.error(`Shader source:\n${source}`);
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Create and link shader program
   */
  createProgram(name: string, vertexSource: string, fragmentSource: string): ShaderProgram | null {
    if (!this.gl) {
      logger.error('WebGL2 context not initialized');
      return null;
    }

    // Check if program already exists
    if (this.programs.has(name)) {
      return this.programs.get(name)!;
    }

    // Compile shaders
    const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);

    if (!vertexShader || !fragmentShader) {
      return null;
    }

    // Create program
    const program = this.gl.createProgram();
    if (!program) {
      logger.error('Failed to create shader program');
      return null;
    }

    // Attach shaders
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    // Check linking status
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      logger.error(`Shader program linking failed: ${info}`);
      this.gl.deleteProgram(program);
      return null;
    }

    // Clean up shaders (no longer needed after linking)
    this.gl.detachShader(program, vertexShader);
    this.gl.detachShader(program, fragmentShader);
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);

    // Get uniform and attribute locations
    const uniforms = new Map<string, WebGLUniformLocation>();
    const attributes = new Map<string, number>();

    const numUniforms = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = this.gl.getActiveUniform(program, i);
      if (info) {
        const location = this.gl.getUniformLocation(program, info.name);
        if (location) {
          uniforms.set(info.name, location);
        }
      }
    }

    const numAttributes = this.gl.getProgramParameter(program, this.gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttributes; i++) {
      const info = this.gl.getActiveAttrib(program, i);
      if (info) {
        const location = this.gl.getAttribLocation(program, info.name);
        attributes.set(info.name, location);
      }
    }

    const shaderProgram: ShaderProgram = {
      program,
      uniforms,
      attributes
    };

    this.programs.set(name, shaderProgram);
    logger.info(`Shader program '${name}' created successfully`);
    logger.debug(`  Uniforms: ${Array.from(uniforms.keys()).join(', ')}`);
    logger.debug(`  Attributes: ${Array.from(attributes.keys()).join(', ')}`);

    return shaderProgram;
  }

  /**
   * Get a shader program
   */
  getProgram(name: string): ShaderProgram | null {
    return this.programs.get(name) || null;
  }

  /**
   * Use a shader program
   */
  useProgram(name: string): boolean {
    if (!this.gl) return false;

    const program = this.programs.get(name);
    if (!program) {
      logger.error(`Shader program '${name}' not found`);
      return false;
    }

    this.gl.useProgram(program.program);
    return true;
  }

  /**
   * Set uniform value
   */
  setUniform(programName: string, uniformName: string, value: number | number[] | Float32Array): boolean {
    if (!this.gl) return false;

    const program = this.programs.get(programName);
    if (!program) return false;

    const location = program.uniforms.get(uniformName);
    if (!location) {
      logger.warn(`Uniform '${uniformName}' not found in program '${programName}'`);
      return false;
    }

    // Determine uniform type and set value
    if (typeof value === 'number') {
      this.gl.uniform1f(location, value);
    } else if (value.length === 2) {
      this.gl.uniform2fv(location, value);
    } else if (value.length === 3) {
      this.gl.uniform3fv(location, value);
    } else if (value.length === 4) {
      this.gl.uniform4fv(location, value);
    } else if (value.length === 9) {
      this.gl.uniformMatrix3fv(location, false, value);
    } else if (value.length === 16) {
      this.gl.uniformMatrix4fv(location, false, value);
    }

    return true;
  }

  /**
   * Get WebGL2 context
   */
  getContext(): WebGL2RenderingContext | null {
    return this.gl;
  }

  /**
   * Get canvas
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (!this.gl) return;

    // Delete all programs
    for (const [name, program] of this.programs) {
      this.gl.deleteProgram(program.program);
      logger.debug(`Deleted shader program: ${name}`);
    }

    this.programs.clear();
    this.gl = null;
    this.canvas = null;

    logger.info('ShaderManager disposed');
  }
}

export const shaderManager = ShaderManager.getInstance();
