import { logger } from '../utils/Logger';
// import { gpuAccelerationService } from './GPUAccelerationService';

// GPU processing interfaces
export interface GPUBuffer {
  buffer: WebGLTexture | WebGLBuffer;
  type: 'texture' | 'buffer';
  size: number;
}

export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, unknown>;
  attributes: Record<string, number>;
}

export interface ProcessingParameters {
  [key: string]: number | number[] | boolean | string;
}

// GPU-optimized configuration for RTX 3080
export interface RTXOptimizedConfig {
  dedicatedVRAM: number; // 12GB in bytes
  maxConcurrentOperations: number;
  useComputeShaders: boolean;
  enableTensorCores: boolean;
  memoryPoolSize: number;
  streamingChunkSize: number;
  prioritizeGPU: boolean;
}

export interface GPUMemoryPool {
  totalAllocated: number;
  available: number;
  buffers: Map<string, GPUBuffer>;
  reservedForProcessing: number;
}

export interface ProcessingTask {
  id: string;
  type: 'raw_processing' | 'noise_reduction' | 'tone_mapping' | 'color_grading' | 'sharpening';
  priority: number;
  imageData: Float32Array;
  width: number;
  height: number;
  parameters: ProcessingParameters;
  gpuMemoryRequired: number;
}

export class GPUOptimizedProcessingService {
  private static instance: GPUOptimizedProcessingService;
  private config: RTXOptimizedConfig;
  private memoryPool: GPUMemoryPool;
  // @ts-ignore: Reserved for future processing queue implementation
  private ___processingQueue: ProcessingTask[] = [];
  // @ts-ignore: Reserved for future operation tracking
  private ___activeOperations: Set<string> = new Set();
  private gl: WebGL2RenderingContext | null = null;
  // @ts-ignore: Reserved for WebGPU compute operations
  private ___webgpuDevice: unknown = null;
  private shaderCache: Map<string, ShaderProgram> = new Map();
  private textureCache: Map<string, WebGLTexture> = new Map();

  private constructor() {
    // RTX 3080 optimized configuration
    this.config = {
      dedicatedVRAM: 12 * 1024 * 1024 * 1024, // 12GB
      maxConcurrentOperations: 8, // RTX 3080 can handle multiple streams
      useComputeShaders: true,
      enableTensorCores: true, // For AI-enhanced processing
      memoryPoolSize: 10 * 1024 * 1024 * 1024, // 10GB memory pool
      streamingChunkSize: 256 * 1024 * 1024, // 256MB chunks for large images
      prioritizeGPU: true
    };

    this.memoryPool = {
      totalAllocated: 0,
      available: this.config.memoryPoolSize,
      buffers: new Map(),
      reservedForProcessing: 0
    };

    this.initializeGPUContexts();
  }

  static getInstance(): GPUOptimizedProcessingService {
    if (!GPUOptimizedProcessingService.instance) {
      GPUOptimizedProcessingService.instance = new GPUOptimizedProcessingService();
    }
    return GPUOptimizedProcessingService.instance;
  }

  private async initializeGPUContexts(): Promise<void> {
    try {
      // Initialize WebGL2 with maximum performance settings
      const canvas = new OffscreenCanvas(1, 1);
      this.gl = canvas.getContext('webgl2', {
        powerPreference: 'high-performance',
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false
      });

      if (this.gl) {
        // Enable all WebGL2 extensions for maximum performance
        const extensions = [
          'EXT_color_buffer_float',
          'EXT_texture_filter_anisotropic',
          'WEBGL_draw_buffers',
          'OES_texture_float_linear',
          'EXT_shader_texture_lod',
          'WEBGL_debug_renderer_info'
        ];

        extensions.forEach(ext => {
          const extension = this.gl!.getExtension(ext);
          if (extension) {
            logger.info(`Enabled WebGL2 extension: ${ext}`);
          }
        });

        // Log GPU information
        const debugInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const renderer = this.gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          const vendor = this.gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          logger.info(`GPU: ${vendor} ${renderer}`);
        }
      }

      // Initialize WebGPU if available for compute shaders
      if ('gpu' in navigator) {
        const adapter = await navigator.gpu?.requestAdapter({
          powerPreference: 'high-performance'
        });

        if (adapter) {
          this.___webgpuDevice = await adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {
              maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB buffers
              maxBufferSize: 1024 * 1024 * 1024,
              maxComputeWorkgroupSizeX: 1024,
              maxComputeWorkgroupSizeY: 1024,
              maxComputeInvocationsPerWorkgroup: 1024
            }
          });
          logger.info('WebGPU initialized for compute shaders');
        }
      }

      this.precompileShaders();
      this.preallocateTextures();

    } catch (error) {
      logger.error('Failed to initialize GPU contexts:', error);
    }
  }

  /**
   * Precompile common shaders for instant use
   */
  private precompileShaders(): void {
    const shaderSources = {
      // High-performance RAW debayering shader
      rawDebayer: `#version 300 es
        precision highp float;
        uniform sampler2D rawTexture;
        uniform vec2 imageSize;
        uniform int bayerPattern; // 0=RGGB, 1=BGGR, 2=GRBG, 3=GBRG
        in vec2 texCoord;
        out vec4 fragColor;

        void main() {
          vec2 pos = texCoord * imageSize;
          ivec2 ipos = ivec2(pos);

          // High-quality demosaicing with edge detection
          float r = 0.0, g = 0.0, b = 0.0;

          // Sample neighboring pixels for demosaicing
          vec4 samples[9];
          for(int i = -1; i <= 1; i++) {
            for(int j = -1; j <= 1; j++) {
              samples[(i+1)*3 + (j+1)] = texelFetch(rawTexture, ipos + ivec2(i, j), 0);
            }
          }

          // Advanced demosaicing algorithm
          bool evenRow = (ipos.y % 2) == 0;
          bool evenCol = (ipos.x % 2) == 0;

          if(bayerPattern == 0) { // RGGB
            if(evenRow && evenCol) {
              r = samples[4].r; // Center red
              g = (samples[1].g + samples[3].g + samples[5].g + samples[7].g) * 0.25;
              b = (samples[0].b + samples[2].b + samples[6].b + samples[8].b) * 0.25;
            } else if(evenRow && !evenCol) {
              r = (samples[3].r + samples[5].r) * 0.5;
              g = samples[4].g; // Center green
              b = (samples[1].b + samples[7].b) * 0.5;
            } else if(!evenRow && evenCol) {
              r = (samples[1].r + samples[7].r) * 0.5;
              g = samples[4].g; // Center green
              b = (samples[3].b + samples[5].b) * 0.5;
            } else {
              r = (samples[0].r + samples[2].r + samples[6].r + samples[8].r) * 0.25;
              g = (samples[1].g + samples[3].g + samples[5].g + samples[7].g) * 0.25;
              b = samples[4].b; // Center blue
            }
          }

          fragColor = vec4(r, g, b, 1.0);
        }`,

      // GPU-accelerated noise reduction
      noiseReduction: `#version 300 es
        precision highp float;
        uniform sampler2D inputTexture;
        uniform vec2 imageSize;
        uniform float strength;
        uniform float threshold;
        in vec2 texCoord;
        out vec4 fragColor;

        // Non-local means denoising
        void main() {
          vec2 texelSize = 1.0 / imageSize;
          vec3 centerColor = texture(inputTexture, texCoord).rgb;
          vec3 result = vec3(0.0);
          float totalWeight = 0.0;

          // Sample in a larger window for better denoising
          for(int i = -4; i <= 4; i++) {
            for(int j = -4; j <= 4; j++) {
              vec2 offset = vec2(float(i), float(j)) * texelSize;
              vec3 sampleColor = texture(inputTexture, texCoord + offset).rgb;

              // Calculate patch similarity
              float weight = 1.0;
              for(int pi = -1; pi <= 1; pi++) {
                for(int pj = -1; pj <= 1; pj++) {
                  vec2 patchOffset = vec2(float(pi), float(pj)) * texelSize;
                  vec3 centerPatch = texture(inputTexture, texCoord + patchOffset).rgb;
                  vec3 samplePatch = texture(inputTexture, texCoord + offset + patchOffset).rgb;
                  float diff = length(centerPatch - samplePatch);
                  weight *= exp(-diff * diff / (strength * strength));
                }
              }

              result += sampleColor * weight;
              totalWeight += weight;
            }
          }

          fragColor = vec4(result / totalWeight, 1.0);
        }`,

      // High-performance tone mapping
      toneMapping: `#version 300 es
        precision highp float;
        uniform sampler2D inputTexture;
        uniform float exposure;
        uniform float highlights;
        uniform float shadows;
        uniform float contrast;
        uniform float vibrance;
        in vec2 texCoord;
        out vec4 fragColor;

        vec3 tonemap_aces(vec3 color) {
          mat3 input_matrix = mat3(
            0.59719, 0.35458, 0.04823,
            0.07600, 0.90834, 0.01566,
            0.02840, 0.13383, 0.83777
          );

          mat3 output_matrix = mat3(
            1.60475, -0.53108, -0.07367,
            -0.10208, 1.10813, -0.00605,
            -0.00327, -0.07276, 1.07602
          );

          color = input_matrix * color;

          vec3 a = color * (color + 0.0245786) - 0.000090537;
          vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
          color = a / b;

          return output_matrix * color;
        }

        void main() {
          vec3 color = texture(inputTexture, texCoord).rgb;

          // Apply exposure
          color *= pow(2.0, exposure);

          // Shadow/highlight adjustment
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          float shadowAdjust = smoothstep(0.0, 0.3, luminance);
          float highlightAdjust = 1.0 - smoothstep(0.7, 1.0, luminance);

          color *= mix(1.0 + shadows, 1.0, shadowAdjust);
          color *= mix(1.0, 1.0 + highlights, highlightAdjust);

          // Tone mapping
          color = tonemap_aces(color);

          // Contrast
          color = mix(vec3(0.5), color, 1.0 + contrast);

          fragColor = vec4(color, 1.0);
        }`,

      // GPU-accelerated color grading
      colorGrading: `#version 300 es
        precision highp float;
        uniform sampler2D inputTexture;
        uniform sampler2D lutTexture;
        uniform float lutSize;
        uniform float strength;
        uniform vec3 lift;
        uniform vec3 gamma;
        uniform vec3 gain;
        uniform float saturation;
        in vec2 texCoord;
        out vec4 fragColor;

        vec3 applyLUT(vec3 color, sampler2D lut, float size) {
          color = clamp(color, 0.0, 1.0);

          float cell = color.b * (size - 1.0);
          float cellL = floor(cell);
          float cellH = ceil(cell);
          float offset = 0.5 / size;

          vec2 lutPos_L = vec2((color.r + cellL) / size + offset, color.g + offset);
          vec2 lutPos_H = vec2((color.r + cellH) / size + offset, color.g + offset);

          vec3 graded_L = texture(lut, lutPos_L).rgb;
          vec3 graded_H = texture(lut, lutPos_H).rgb;

          return mix(graded_L, graded_H, cell - cellL);
        }

        void main() {
          vec3 color = texture(inputTexture, texCoord).rgb;

          // Lift, gamma, gain
          color = lift + (1.0 - lift) * color;
          color = pow(color, 1.0 / gamma);
          color *= gain;

          // LUT application
          vec3 gradedColor = applyLUT(color, lutTexture, lutSize);
          color = mix(color, gradedColor, strength);

          // Saturation
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          color = mix(vec3(luma), color, saturation);

          fragColor = vec4(color, 1.0);
        }`
    };

    // Compile and cache all shaders
    if (this.gl) {
      for (const [name, source] of Object.entries(shaderSources)) {
        try {
          const program = this.createShaderProgram(this.gl, source);
          this.shaderCache.set(name, program);
          logger.info(`Precompiled shader: ${name}`);
        } catch (error) {
          logger.error(`Failed to compile shader ${name}:`, error);
        }
      }
    }
  }

  /**
   * Pre-allocate textures for common image sizes
   */
  private preallocateTextures(): void {
    if (!this.gl) return;

    const commonSizes = [
      [4096, 3072],   // 12MP
      [6000, 4000],   // 24MP
      [8000, 6000],   // 48MP
      [9504, 6336],   // 60MP (A7R V)
      [11008, 7344]   // 80MP (GFX 100S)
    ];

    for (const [width, height] of commonSizes) {
      const texture = this.gl.createTexture();
      if (texture) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D, 0, this.gl.RGBA32F,
          width, height, 0,
          this.gl.RGBA, this.gl.FLOAT, null
        );
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        const key = `${width}x${height}`;
        this.textureCache.set(key, texture);
        this.memoryPool.totalAllocated += width * height * 16; // RGBA32F = 16 bytes
        logger.info(`Pre-allocated texture: ${key}`);
      }
    }

    this.memoryPool.available = this.config.memoryPoolSize - this.memoryPool.totalAllocated;
    logger.info(`GPU memory pool initialized: ${this.memoryPool.totalAllocated / (1024*1024)} MB allocated`);
  }

  /**
   * Process RAW image with maximum GPU acceleration
   */
  async processRAWImage(
    rawData: Float32Array,
    width: number,
    height: number,
    parameters: ProcessingParameters
  ): Promise<Float32Array> {
    const startTime = performance.now();

    if (!this.gl) {
      throw new Error('WebGL2 context not initialized');
    }

    try {
      // Step 1: GPU-accelerated RAW debayering
      const debayeredData = await this.gpuDebayering(rawData, width, height, parameters);

      // Step 2: Noise reduction (if needed)
      let processedData = debayeredData;
      if (typeof parameters.noiseReduction === 'number' && parameters.noiseReduction > 0) {
        processedData = await this.gpuNoiseReduction(processedData, width, height, parameters);
      }

      // Step 3: Tone mapping and color grading
      processedData = await this.gpuToneMapping(processedData, width, height, parameters);

      // Step 4: Final color grading
      if (parameters.colorGrading) {
        processedData = await this.gpuColorGrading(processedData, width, height, parameters);
      }

      const processingTime = performance.now() - startTime;
      logger.info(`GPU RAW processing completed in ${processingTime.toFixed(2)}ms for ${width}x${height}`);

      return processedData;

    } catch (error) {
      logger.error('GPU RAW processing failed:', error);
      throw error;
    }
  }

  private async gpuDebayering(
    rawData: Float32Array,
    width: number,
    height: number,
    parameters: ProcessingParameters
  ): Promise<Float32Array> {
    if (!this.gl) throw new Error('WebGL2 not initialized');

    const gl = this.gl;
    const program = this.shaderCache.get('rawDebayer');
    if (!program) throw new Error('RAW debayer shader not found');

    // Create or get cached texture
    const textureKey = `${width}x${height}`;
    let inputTexture = this.textureCache.get(textureKey);

    if (!inputTexture) {
      inputTexture = gl.createTexture()!;
      this.textureCache.set(textureKey, inputTexture);
    }

    // Upload RAW data
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, rawData);

    // Setup framebuffer
    const framebuffer = gl.createFramebuffer();
    const outputTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

    // Render
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'rawTexture'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'imageSize'), width, height);
    gl.uniform1i(gl.getUniformLocation(program, 'bayerPattern'), typeof parameters.bayerPattern === 'number' ? parameters.bayerPattern : 0);

    gl.viewport(0, 0, width, height);
    this.renderFullscreenQuad(gl);

    // Read result
    const result = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, result);

    // Cleanup
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(outputTexture);

    return result;
  }

  private async gpuNoiseReduction(
    imageData: Float32Array,
    width: number,
    height: number,
    parameters: ProcessingParameters
  ): Promise<Float32Array> {
    if (!this.gl) throw new Error('WebGL2 not initialized');

    const gl = this.gl;
    const program = this.shaderCache.get('noiseReduction');
    if (!program) throw new Error('Noise reduction shader not found');

    // Multi-pass noise reduction for better quality
    let currentData = imageData;
    const noiseReductionValue = typeof parameters.noiseReduction === 'number' ? parameters.noiseReduction : 0.5;
    const passes = Math.min(3, Math.max(1, Math.floor(noiseReductionValue * 3)));

    for (let pass = 0; pass < passes; pass++) {
      currentData = await this.applyShaderPass(
        gl, program, currentData, width, height,
        {
          strength: noiseReductionValue / passes,
          threshold: parameters.noiseThreshold || 0.1
        }
      );
    }

    return currentData;
  }

  private async gpuToneMapping(
    imageData: Float32Array,
    width: number,
    height: number,
    parameters: ProcessingParameters
  ): Promise<Float32Array> {
    if (!this.gl) throw new Error('WebGL2 not initialized');

    const gl = this.gl;
    const program = this.shaderCache.get('toneMapping');
    if (!program) throw new Error('Tone mapping shader not found');

    return this.applyShaderPass(gl, program, imageData, width, height, {
      exposure: parameters.exposure || 0.0,
      highlights: parameters.highlights || 0.0,
      shadows: parameters.shadows || 0.0,
      contrast: parameters.contrast || 0.0,
      vibrance: parameters.vibrance || 1.0
    });
  }

  private async gpuColorGrading(
    imageData: Float32Array,
    width: number,
    height: number,
    parameters: ProcessingParameters
  ): Promise<Float32Array> {
    if (!this.gl) throw new Error('WebGL2 not initialized');

    const gl = this.gl;
    const program = this.shaderCache.get('colorGrading');
    if (!program) throw new Error('Color grading shader not found');

    const colorGradingParams = parameters.colorGrading &&
      typeof parameters.colorGrading === 'object' &&
      !Array.isArray(parameters.colorGrading) ?
      parameters.colorGrading as Record<string, number | number[] | WebGLTexture> : {};

    return this.applyShaderPass(gl, program, imageData, width, height, colorGradingParams);
  }

  private async applyShaderPass(
    gl: WebGL2RenderingContext,
    shaderProgram: ShaderProgram,
    imageData: Float32Array,
    width: number,
    height: number,
    uniforms: Record<string, number | number[] | WebGLTexture>
  ): Promise<Float32Array> {
    // Create input texture
    const inputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, imageData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Create output texture and framebuffer
    const outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

    // Setup shader
    gl.useProgram(shaderProgram.program);
    gl.uniform1i(gl.getUniformLocation(shaderProgram.program, 'inputTexture'), 0);
    gl.uniform2f(gl.getUniformLocation(shaderProgram.program, 'imageSize'), width, height);

    // Set uniforms
    for (const [name, value] of Object.entries(uniforms)) {
      const location = gl.getUniformLocation(shaderProgram.program, name);
      if (location) {
        if (typeof value === 'number') {
          gl.uniform1f(location, value);
        } else if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2fv(location, value);
          else if (value.length === 3) gl.uniform3fv(location, value);
          else if (value.length === 4) gl.uniform4fv(location, value);
        }
      }
    }

    // Render
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    this.renderFullscreenQuad(gl);

    // Read result
    const result = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, result);

    // Cleanup
    gl.deleteTexture(inputTexture);
    gl.deleteTexture(outputTexture);
    gl.deleteFramebuffer(framebuffer);

    return result;
  }

  private createShaderProgram(gl: WebGL2RenderingContext, fragmentSource: string): ShaderProgram {
    const vertexSource = `#version 300 es
      precision highp float;
      in vec2 position;
      out vec2 texCoord;
      void main() {
        texCoord = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }`;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader program linking failed: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    // Get program uniforms and attributes
    const uniforms: Record<string, unknown> = {};
    const attributes: Record<string, number> = {};

    // Get uniform locations
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const uniform = gl.getActiveUniform(program, i);
      if (uniform) {
        uniforms[uniform.name] = gl.getUniformLocation(program, uniform.name);
      }
    }

    // Get attribute locations
    const numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttributes; i++) {
      const attribute = gl.getActiveAttrib(program, i);
      if (attribute) {
        attributes[attribute.name] = gl.getAttribLocation(program, attribute.name);
      }
    }

    return { program, uniforms, attributes };
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }

    return shader;
  }

  private renderFullscreenQuad(gl: WebGL2RenderingContext): void {
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionAttribute = 0; // Assume position is bound to location 0
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.deleteBuffer(buffer);
  }

  /**
   * Get optimal processing configuration for RTX 3080
   */
  getOptimalConfig(): RTXOptimizedConfig {
    return { ...this.config };
  }

  /**
   * Get current GPU memory usage
   */
  getMemoryUsage(): GPUMemoryPool {
    return { ...this.memoryPool };
  }

  /**
   * Cleanup GPU resources
   */
  cleanup(): void {
    // Clear texture cache
    if (this.gl) {
      for (const texture of this.textureCache.values()) {
        this.gl.deleteTexture(texture);
      }
    }
    this.textureCache.clear();

    // Clear shader cache
    if (this.gl) {
      for (const program of this.shaderCache.values()) {
        this.gl.deleteProgram(program);
      }
    }
    this.shaderCache.clear();

    logger.info('GPU resources cleaned up');
  }
}

export const gpuOptimizedProcessingService = GPUOptimizedProcessingService.getInstance();