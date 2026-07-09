/**
 * DEAD CODE — unused (imported by nothing live). The live GPU pipeline is
 * WebGLImageProcessor + GpuPreviewPipeline with shaders from ./sources.ts
 * (color balance: FRAG_COLORBALANCE).
 *
 * GPUImageProcessor - Hardware-Accelerated Image Processing
 *
 * Uses WebGL2 shaders for fast image processing operations.
 * Provides GPU-accelerated alternatives to CPU-based processing.
 */

import { logger } from '../utils/Logger';
import { shaderManager } from './ShaderManager';
import { vertexShaderSource } from './common.glsl';
import { exposureFragmentShader } from './exposure.frag';
import { whiteBalanceFragmentShader } from './whitebalance.frag';
import { toneCurveFragmentShader } from './tonecurve.frag';
import { colorBalanceFragmentShader } from './colorbalance.frag';
import { denoiseFragmentShader } from './denoise.frag';
import { saturationFragmentShader } from './saturation.frag';

export interface GPUProcessingResult {
  success: boolean;
  data?: Float32Array;
  error?: string;
  processingTime?: number;
}

export class GPUImageProcessor {
  private static instance: GPUImageProcessor;
  private gl: WebGL2RenderingContext | null = null;
  private quadVAO: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private framebuffers: WebGLFramebuffer[] = [];
  private textures: WebGLTexture[] = [];
  private isInitialized = false;

  private constructor() {}

  static getInstance(): GPUImageProcessor {
    if (!GPUImageProcessor.instance) {
      GPUImageProcessor.instance = new GPUImageProcessor();
    }
    return GPUImageProcessor.instance;
  }

  /**
   * Initialize GPU processor
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      // Initialize shader manager
      if (!shaderManager.initialize()) {
        logger.error('Failed to initialize ShaderManager');
        return false;
      }

      this.gl = shaderManager.getContext();
      if (!this.gl) {
        logger.error('WebGL2 context not available');
        return false;
      }

      // Create fullscreen quad
      this.createFullscreenQuad();

      // Compile all shaders
      await this.compileShaders();

      this.isInitialized = true;
      logger.info('GPUImageProcessor initialized successfully');

      return true;
    } catch (error) {
      logger.error('GPUImageProcessor initialization failed:', error);
      return false;
    }
  }

  /**
   * Create fullscreen quad for rendering
   */
  private createFullscreenQuad(): void {
    if (!this.gl) return;

    // Fullscreen quad vertices (position + texcoord)
    const vertices = new Float32Array([
      // Position (x, y)  // TexCoord (u, v)
      -1.0, -1.0,         0.0, 0.0,
       1.0, -1.0,         1.0, 0.0,
      -1.0,  1.0,         0.0, 1.0,
       1.0,  1.0,         1.0, 1.0
    ]);

    // Create and bind VAO
    this.quadVAO = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.quadVAO);

    // Create and bind VBO
    this.quadVBO = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVBO);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    // Position attribute (location 0)
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 16, 0);

    // TexCoord attribute (location 1)
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 16, 8);

    this.gl.bindVertexArray(null);

    logger.debug('Fullscreen quad created');
  }

  /**
   * Compile all shader programs
   */
  private async compileShaders(): Promise<void> {
    const shaders = [
      { name: 'exposure', frag: exposureFragmentShader },
      { name: 'whitebalance', frag: whiteBalanceFragmentShader },
      { name: 'tonecurve', frag: toneCurveFragmentShader },
      { name: 'colorbalance', frag: colorBalanceFragmentShader },
      { name: 'denoise', frag: denoiseFragmentShader },
      { name: 'saturation', frag: saturationFragmentShader }
    ];

    for (const shader of shaders) {
      const program = shaderManager.createProgram(shader.name, vertexShaderSource, shader.frag);
      if (!program) {
        logger.error(`Failed to compile shader: ${shader.name}`);
      } else {
        logger.debug(`Compiled shader: ${shader.name}`);
      }
    }
  }

  /**
   * Create texture from image data
   */
  private createTexture(data: Float32Array, width: number, height: number): WebGLTexture | null {
    if (!this.gl) return null;

    const texture = this.gl.createTexture();
    if (!texture) return null;

    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Upload data (RGBA32F format for high precision)
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA32F,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.FLOAT,
      data
    );

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.gl.bindTexture(this.gl.TEXTURE_2D, null);

    return texture;
  }

  /**
   * Create framebuffer for rendering
   */
  private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer | null {
    if (!this.gl) return null;

    const framebuffer = this.gl.createFramebuffer();
    if (!framebuffer) return null;

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0
    );

    // Check framebuffer status
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      logger.error(`Framebuffer incomplete: ${status}`);
      this.gl.deleteFramebuffer(framebuffer);
      return null;
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

    return framebuffer;
  }

  /**
   * Read pixels from framebuffer
   */
  private readPixels(framebuffer: WebGLFramebuffer, width: number, height: number): Float32Array | null {
    if (!this.gl) return null;

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);

    const pixels = new Float32Array(width * height * 4);
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.FLOAT, pixels);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

    return pixels;
  }

  /**
   * Process image with exposure adjustment
   */
  async processExposure(
    imageData: Float32Array,
    width: number,
    height: number,
    exposure: number,
    blackPoint: number
  ): Promise<GPUProcessingResult> {
    if (!this.gl || !this.isInitialized) {
      return { success: false, error: 'GPU processor not initialized' };
    }

    const startTime = performance.now();

    try {
      // Create input texture
      const inputTexture = this.createTexture(imageData, width, height);
      if (!inputTexture) {
        return { success: false, error: 'Failed to create input texture' };
      }

      // Create output texture
      const outputTexture = this.createTexture(new Float32Array(width * height * 4), width, height);
      if (!outputTexture) {
        this.gl.deleteTexture(inputTexture);
        return { success: false, error: 'Failed to create output texture' };
      }

      // Create framebuffer
      const framebuffer = this.createFramebuffer(outputTexture);
      if (!framebuffer) {
        this.gl.deleteTexture(inputTexture);
        this.gl.deleteTexture(outputTexture);
        return { success: false, error: 'Failed to create framebuffer' };
      }

      // Use shader program
      if (!shaderManager.useProgram('exposure')) {
        return { success: false, error: 'Failed to use exposure shader' };
      }

      // Set uniforms
      shaderManager.setUniform('exposure', 'u_exposure', exposure);
      shaderManager.setUniform('exposure', 'u_blackPoint', blackPoint);

      // Bind input texture
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, inputTexture);

      // Render to framebuffer
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.gl.viewport(0, 0, width, height);

      this.gl.bindVertexArray(this.quadVAO);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      // Read result
      const result = this.readPixels(framebuffer, width, height);

      // Clean up
      this.gl.deleteTexture(inputTexture);
      this.gl.deleteTexture(outputTexture);
      this.gl.deleteFramebuffer(framebuffer);

      const processingTime = performance.now() - startTime;

      if (!result) {
        return { success: false, error: 'Failed to read pixels' };
      }

      return {
        success: true,
        data: result,
        processingTime
      };

    } catch (error) {
      logger.error('GPU exposure processing failed:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Clean up GPU resources
   */
  dispose(): void {
    if (!this.gl) return;

    // Delete framebuffers
    for (const fb of this.framebuffers) {
      this.gl.deleteFramebuffer(fb);
    }

    // Delete textures
    for (const tex of this.textures) {
      this.gl.deleteTexture(tex);
    }

    // Delete quad resources
    if (this.quadVAO) this.gl.deleteVertexArray(this.quadVAO);
    if (this.quadVBO) this.gl.deleteBuffer(this.quadVBO);

    this.framebuffers = [];
    this.textures = [];
    this.quadVAO = null;
    this.quadVBO = null;
    this.isInitialized = false;

    logger.info('GPUImageProcessor disposed');
  }
}

export const gpuImageProcessor = GPUImageProcessor.getInstance();
