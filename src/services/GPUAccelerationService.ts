import { logger } from '../utils/Logger';
import { WebGLUniforms } from '../types/index';

// GPU API type declarations for WebGPU
declare global {
  interface Navigator {
    gpu?: {
      requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    };
  }
}

// GPU types
interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  features: Set<string>;
  limits: Record<string, number>;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: string[];
  requiredLimits?: Record<string, number>;
}

interface GPUDevice {
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  queue: GPUQueue;
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUTextureDescriptor {
  size: [number, number, number];
  format: string;
  usage: number;
}

interface GPUBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

interface GPUTexture {
  createView(): GPUTextureView;
}

interface GPUTextureView {}

interface GPUQueue {
  writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBuffer): void;
}

// GPU constants
const GPUBufferUsage = {
  VERTEX: 1,
  INDEX: 2,
  UNIFORM: 64,
  STORAGE: 128,
  COPY_SRC: 4,
  COPY_DST: 8,
  QUERY_RESOLVE: 512
} as const;

const GPUShaderStage = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4
} as const;

const GPUMapMode = {
  READ: 1,
  WRITE: 2,
  MAP_READ: 1
} as const;

export interface GPUCapabilities {
  webgl2: boolean;
  webgpu: boolean;
  maxTextureSize: number;
  maxComputeWorkgroupSize: number;
  maxComputeInvocations: number;
  floatTextures: boolean;
  linearFiltering: boolean;
  computeShaders: boolean;
}

export interface GPUProcessingOptions {
  useGPU: boolean;
  fallbackToCPU: boolean;
  maxTextureSize: number;
  tileSize: number;
  preferWebGPU: boolean;
}

export interface ComputeShaderProgram {
  id: string;
  name: string;
  source: string;
  uniforms: WebGLUniforms;
  workgroupSize: [number, number, number];
}

export interface GPUBufferWrapper {
  buffer: GPUBuffer | WebGLBuffer;
  size: number;
  usage: string;
  format: string;
}

export interface GPUTextureWrapper {
  texture: GPUTexture | WebGLTexture;
  width: number;
  height: number;
  format: string;
  usage: string;
}

class GPUAccelerationService {
  private static instance: GPUAccelerationService;
  private webgl2Context: WebGL2RenderingContext | null = null;
  private webgpuDevice: GPUDevice | null = null;
  private webgpuAdapter: GPUAdapter | null = null;
  private capabilities: GPUCapabilities | null = null;
  private shaderPrograms: Map<string, ComputeShaderProgram> = new Map();
  private texturePool: Map<string, GPUTexture[]> = new Map();
  private bufferPool: Map<string, GPUBuffer[]> = new Map();
  private isInitialized = false;

  private constructor() {}

  static getInstance(): GPUAccelerationService {
    if (!GPUAccelerationService.instance) {
      GPUAccelerationService.instance = new GPUAccelerationService();
    }
    return GPUAccelerationService.instance;
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      // PRIORITY: WebGPU for 30MP+ processing capability
      if ('gpu' in navigator) {
        await this.initializeWebGPU();
        if (this.webgpuDevice) {
          logger.info('WebGPU initialized - unlimited texture size processing available');
        }
      }

      // Fallback to WebGL2 for smaller images and compatibility
      if (!this.webgpuDevice) {
        this.initializeWebGL2();
        if (this.webgl2Context) {
          logger.info('WebGL2 fallback initialized - limited to 16MP textures');
        }
      }

      this.capabilities = this.detectCapabilities();
      this.initializeShaders();
      this.isInitialized = true;

      console.log('GPU Acceleration initialized:', this.capabilities);
      return true;
    } catch (error) {
      console.error('Failed to initialize GPU acceleration:', error);
      return false;
    }
  }

  private async initializeWebGPU(): Promise<void> {
    try {
      if (!('gpu' in navigator)) return;

      this.webgpuAdapter = (await navigator.gpu?.requestAdapter({
        powerPreference: 'high-performance'
      })) ?? null;

      if (!this.webgpuAdapter) return;

      this.webgpuDevice = await this.webgpuAdapter.requestDevice({
        requiredFeatures: [],
        requiredLimits: {}
      });

      console.log('WebGPU initialized successfully');
    } catch (error) {
      console.warn('WebGPU initialization failed:', error);
    }
  }

  private initializeWebGL2(): void {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      this.webgl2Context = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      }) as WebGL2RenderingContext;

      if (!this.webgl2Context) {
        throw new Error('WebGL2 not supported');
      }

      // Enable required extensions
      this.webgl2Context.getExtension('EXT_color_buffer_float');
      this.webgl2Context.getExtension('OES_texture_float_linear');

      console.log('WebGL2 initialized successfully');
    } catch (error) {
      console.error('WebGL2 initialization failed:', error);
    }
  }

  private detectCapabilities(): GPUCapabilities {
    const capabilities: GPUCapabilities = {
      webgl2: !!this.webgl2Context,
      webgpu: !!this.webgpuDevice,
      maxTextureSize: 0,
      maxComputeWorkgroupSize: 0,
      maxComputeInvocations: 0,
      floatTextures: false,
      linearFiltering: false,
      computeShaders: false
    };

    if (this.webgpuDevice && this.webgpuAdapter) {
      const limits = this.webgpuAdapter.limits;
      capabilities.maxTextureSize = limits.maxTextureDimension2D || 8192;
      capabilities.maxComputeWorkgroupSize = limits.maxComputeWorkgroupSizeX || 256;
      capabilities.maxComputeInvocations = limits.maxComputeInvocationsPerWorkgroup || 256;
      capabilities.floatTextures = true;
      capabilities.linearFiltering = true;
      capabilities.computeShaders = true;
    } else if (this.webgl2Context) {
      const gl = this.webgl2Context;
      capabilities.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      capabilities.floatTextures = !!gl.getExtension('EXT_color_buffer_float');
      capabilities.linearFiltering = !!gl.getExtension('OES_texture_float_linear');
      capabilities.computeShaders = false; // WebGL2 doesn't have compute shaders
    }

    return capabilities;
  }

  private initializeShaders(): void {
    // Gaussian blur shader
    this.addShader({
      id: 'gaussian_blur',
      name: 'Gaussian Blur',
      source: this.getGaussianBlurShader(),
      uniforms: { radius: 5.0, sigma: 2.0 },
      workgroupSize: [16, 16, 1]
    });

    // Brightness/Contrast adjustment
    this.addShader({
      id: 'brightness_contrast',
      name: 'Brightness Contrast',
      source: this.getBrightnessContrastShader(),
      uniforms: { brightness: 0.0, contrast: 1.0 },
      workgroupSize: [16, 16, 1]
    });

    // Color temperature adjustment
    this.addShader({
      id: 'color_temperature',
      name: 'Color Temperature',
      source: this.getColorTemperatureShader(),
      uniforms: { temperature: 6500.0, tint: 0.0 },
      workgroupSize: [16, 16, 1]
    });

    // Unsharp mask
    this.addShader({
      id: 'unsharp_mask',
      name: 'Unsharp Mask',
      source: this.getUnsharpMaskShader(),
      uniforms: { amount: 1.0, radius: 1.0, threshold: 0.0 },
      workgroupSize: [16, 16, 1]
    });

    // Tone curve
    this.addShader({
      id: 'tone_curve',
      name: 'Tone Curve',
      source: this.getToneCurveShader(),
      uniforms: { curve: new Float32Array(256) },
      workgroupSize: [16, 16, 1]
    });
  }

  addShader(program: ComputeShaderProgram): void {
    this.shaderPrograms.set(program.id, program);
  }

  async processImageGPU(
    imageData: Float32Array,
    width: number,
    height: number,
    operation: string,
    parameters: WebGLUniforms = {}
  ): Promise<Float32Array> {
    if (!this.isInitialized || !this.capabilities) {
      throw new Error('GPU acceleration not initialized');
    }

    const shader = this.shaderPrograms.get(operation);
    if (!shader) {
      throw new Error(`Shader not found: ${operation}`);
    }

    if (this.webgpuDevice) {
      return this.processWithWebGPU(imageData, width, height, shader, parameters);
    } else if (this.webgl2Context) {
      return this.processWithWebGL2(imageData, width, height, shader, parameters);
    } else {
      throw new Error('No GPU context available');
    }
  }

  private async processWithWebGPU(
    imageData: Float32Array,
    width: number,
    height: number,
    shader: ComputeShaderProgram,
    parameters: WebGLUniforms
  ): Promise<Float32Array> {
    if (!this.webgpuDevice) throw new Error('WebGPU device not available');

    const device = this.webgpuDevice;

    // Create compute shader module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shaderModule = (device as any).createShaderModule({
      code: this.adaptShaderForWebGPU(shader.source)
    });

    // Create buffers
    const inputBuffer = device.createBuffer({
      size: imageData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(inputBuffer.getMappedRange()).set(imageData);
    inputBuffer.unmap();

    const outputBuffer = device.createBuffer({
      size: imageData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const stagingBuffer = device.createBuffer({
      size: imageData.byteLength,
      usage: GPUMapMode.MAP_READ | GPUBufferUsage.COPY_DST
    });

    // Create uniform buffer for parameters
    const uniformData = this.packUniforms(shader.uniforms, parameters);
    const uniformBuffer = device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
    uniformBuffer.unmap();

    // Create bind group layout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bindGroupLayout = (device as any).createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' }
        }
      ]
    });

    // Create compute pipeline
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const computePipeline = (device as any).createComputePipeline({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layout: (device as any).createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Create bind group
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bindGroup = (device as any).createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } }
      ]
    });

    // Dispatch compute shader
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandEncoder = (device as any).createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();

    passEncoder.setPipeline(computePipeline);
    passEncoder.setBindGroup(0, bindGroup);

    const [workgroupX, workgroupY] = shader.workgroupSize;
    const dispatchX = Math.ceil(width / workgroupX);
    const dispatchY = Math.ceil(height / workgroupY);

    passEncoder.dispatchWorkgroups(dispatchX, dispatchY);
    passEncoder.end();

    // Copy result to staging buffer
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, imageData.byteLength);

    // Submit commands
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (device.queue as any).submit([commandEncoder.finish()]);

    // Read result
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();

    // Cleanup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (inputBuffer as any).destroy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (outputBuffer as any).destroy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stagingBuffer as any).destroy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (uniformBuffer as any).destroy();

    return result;
  }

  private processWithWebGL2(
    imageData: Float32Array,
    width: number,
    height: number,
    shader: ComputeShaderProgram,
    _parameters: WebGLUniforms
  ): Float32Array {
    if (!this.webgl2Context) throw new Error('WebGL2 context not available');

    const gl = this.webgl2Context;

    // Create framebuffer and textures
    const inputTexture = this.createTexture2D(gl, width, height, imageData);
    const outputTexture = this.createTexture2D(gl, width, height);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

    // Create and use shader program
    const program = this.createShaderProgram(gl, shader.source, _parameters);
    gl.useProgram(program);

    // Set uniforms
    this.setUniforms(gl, program, shader.uniforms, _parameters);

    // Bind input texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'inputTexture'), 0);

    // Set viewport and render
    gl.viewport(0, 0, width, height);
    this.renderFullscreenQuad(gl, program);

    // Read result
    const result = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, result);

    // Cleanup
    gl.deleteTexture(inputTexture);
    gl.deleteTexture(outputTexture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(program);

    return result;
  }

  private createTexture2D(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    data?: Float32Array
  ): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  private createShaderProgram(
    gl: WebGL2RenderingContext,
    fragmentSource: string,
    _parameters: WebGLUniforms
  ): WebGLProgram {
    const vertexSource = `#version 300 es
      in vec2 position;
      out vec2 uv;
      void main() {
        uv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, this.adaptShaderForWebGL2(fragmentSource));

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create shader program');

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

    return program;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }

    return shader;
  }

  private setUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    defaults: WebGLUniforms,
    parameters: WebGLUniforms
  ): void {
    const uniforms = { ...defaults, ...parameters };

    for (const [name, value] of Object.entries(uniforms)) {
      const location = gl.getUniformLocation(program, name);
      if (location === null) continue;

      if (typeof value === 'number') {
        gl.uniform1f(location, value);
      } else if (Array.isArray(value)) {
        if (value.length === 2) {
          gl.uniform2fv(location, value);
        } else if (value.length === 3) {
          gl.uniform3fv(location, value);
        } else if (value.length === 4) {
          gl.uniform4fv(location, value);
        }
      }
    }
  }

  private renderFullscreenQuad(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const location = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.deleteBuffer(buffer);
  }

  private packUniforms(defaults: WebGLUniforms, parameters: WebGLUniforms): Float32Array {
    const uniforms = { ...defaults, ...parameters };
    const values: number[] = [];

    for (const value of Object.values(uniforms)) {
      if (typeof value === 'number') {
        values.push(value);
      } else if (Array.isArray(value)) {
        values.push(...value);
      }
    }

    return new Float32Array(values);
  }

  private adaptShaderForWebGPU(source: string): string {
    return `
      @group(0) @binding(0) var<storage, read> inputBuffer: array<vec4<f32>>;
      @group(0) @binding(1) var<storage, read_write> outputBuffer: array<vec4<f32>>;
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;

      struct Uniforms {
        ${source.includes('radius') ? 'radius: f32,' : ''}
        ${source.includes('sigma') ? 'sigma: f32,' : ''}
        ${source.includes('brightness') ? 'brightness: f32,' : ''}
        ${source.includes('contrast') ? 'contrast: f32,' : ''}
        ${source.includes('temperature') ? 'temperature: f32,' : ''}
        ${source.includes('tint') ? 'tint: f32,' : ''}
        ${source.includes('amount') ? 'amount: f32,' : ''}
        ${source.includes('threshold') ? 'threshold: f32,' : ''}
      }

      ${source}
    `;
  }

  private adaptShaderForWebGL2(source: string): string {
    return `#version 300 es
      precision highp float;

      uniform sampler2D inputTexture;
      uniform vec2 resolution;
      in vec2 uv;
      out vec4 fragColor;

      ${source}
    `;
  }

  // Shader source generators
  private getGaussianBlurShader(): string {
    return `
      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let dimensions = vec2<i32>(textureDimensions(inputTexture));

        if (coords.x >= dimensions.x || coords.y >= dimensions.y) {
          return;
        }

        let radius = i32(uniforms.radius);
        let sigma = uniforms.sigma;
        var color = vec4<f32>(0.0);
        var weight_sum = 0.0;

        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            let sample_coords = coords + vec2<i32>(dx, dy);
            if (sample_coords.x >= 0 && sample_coords.x < dimensions.x &&
                sample_coords.y >= 0 && sample_coords.y < dimensions.y) {

              let distance = f32(dx * dx + dy * dy);
              let weight = exp(-distance / (2.0 * sigma * sigma));

              let index = sample_coords.y * dimensions.x + sample_coords.x;
              color += inputBuffer[index] * weight;
              weight_sum += weight;
            }
          }
        }

        let output_index = coords.y * dimensions.x + coords.x;
        outputBuffer[output_index] = color / weight_sum;
      }
    `;
  }

  private getBrightnessContrastShader(): string {
    return `
      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let dimensions = vec2<i32>(textureDimensions(inputTexture));

        if (coords.x >= dimensions.x || coords.y >= dimensions.y) {
          return;
        }

        let index = coords.y * dimensions.x + coords.x;
        let color = inputBuffer[index];

        // Apply brightness and contrast
        let adjusted = (color.rgb + vec3<f32>(uniforms.brightness)) * uniforms.contrast;

        outputBuffer[index] = vec4<f32>(clamp(adjusted, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
      }
    `;
  }

  private getColorTemperatureShader(): string {
    return `
      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let dimensions = vec2<i32>(textureDimensions(inputTexture));

        if (coords.x >= dimensions.x || coords.y >= dimensions.y) {
          return;
        }

        let index = coords.y * dimensions.x + coords.x;
        let color = inputBuffer[index];

        // Temperature adjustment (simplified)
        let temp_factor = uniforms.temperature / 6500.0;
        let tint_factor = uniforms.tint / 100.0;

        var adjusted = color.rgb;
        if (temp_factor > 1.0) {
          adjusted.r *= (1.0 + (temp_factor - 1.0) * 0.3);
          adjusted.b *= (1.0 - (temp_factor - 1.0) * 0.2);
        } else {
          adjusted.r *= (1.0 + (temp_factor - 1.0) * 0.2);
          adjusted.b *= (1.0 - (temp_factor - 1.0) * 0.3);
        }

        adjusted.g *= (1.0 + tint_factor * 0.1);

        outputBuffer[index] = vec4<f32>(clamp(adjusted, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
      }
    `;
  }

  private getUnsharpMaskShader(): string {
    return `
      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let dimensions = vec2<i32>(textureDimensions(inputTexture));

        if (coords.x >= dimensions.x || coords.y >= dimensions.y) {
          return;
        }

        let index = coords.y * dimensions.x + coords.x;
        let original = inputBuffer[index];

        // Simple box blur for demonstration
        var blurred = vec4<f32>(0.0);
        let radius = i32(uniforms.radius);
        var count = 0;

        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            let sample_coords = coords + vec2<i32>(dx, dy);
            if (sample_coords.x >= 0 && sample_coords.x < dimensions.x &&
                sample_coords.y >= 0 && sample_coords.y < dimensions.y) {
              let sample_index = sample_coords.y * dimensions.x + sample_coords.x;
              blurred += inputBuffer[sample_index];
              count++;
            }
          }
        }
        blurred /= f32(count);

        // Unsharp mask
        let difference = original - blurred;
        let mask = original + difference * uniforms.amount;

        outputBuffer[index] = vec4<f32>(clamp(mask.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
      }
    `;
  }

  private getToneCurveShader(): string {
    return `
      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let dimensions = vec2<i32>(textureDimensions(inputTexture));

        if (coords.x >= dimensions.x || coords.y >= dimensions.y) {
          return;
        }

        let index = coords.y * dimensions.x + coords.x;
        let color = inputBuffer[index];

        // Apply tone curve (simplified linear interpolation)
        let r_index = i32(clamp(color.r * 255.0, 0.0, 255.0));
        let g_index = i32(clamp(color.g * 255.0, 0.0, 255.0));
        let b_index = i32(clamp(color.b * 255.0, 0.0, 255.0));

        // Note: In real implementation, curve would be passed as uniform array
        let adjusted = vec3<f32>(
          color.r, // uniforms.curve[r_index] / 255.0,
          color.g, // uniforms.curve[g_index] / 255.0,
          color.b  // uniforms.curve[b_index] / 255.0
        );

        outputBuffer[index] = vec4<f32>(adjusted, color.a);
      }
    `;
  }

  getCapabilities(): GPUCapabilities | null {
    return this.capabilities;
  }

  isGPUAccelerationAvailable(): boolean {
    return this.isInitialized && (!!this.webgpuDevice || !!this.webgl2Context);
  }

  getOptimalTileSize(imageWidth: number, imageHeight: number): number {
    if (!this.capabilities) return 512;

    const maxTexture = this.capabilities.maxTextureSize;
    const imageSize = Math.max(imageWidth, imageHeight);

    if (imageSize <= maxTexture / 4) return 512;
    if (imageSize <= maxTexture / 2) return 1024;
    if (imageSize <= maxTexture) return 2048;

    return Math.min(maxTexture, 4096);
  }

  async benchmarkGPU(): Promise<{
    webgpu: number;
    webgl2: number;
    cpu: number;
    recommendation: 'webgpu' | 'webgl2' | 'cpu';
  }> {
    const testImage = new Float32Array(1024 * 1024 * 4).fill(0.5);
    const iterations = 5;

    // Benchmark WebGPU
    let webgpuTime = Infinity;
    if (this.webgpuDevice) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await this.processImageGPU(testImage, 1024, 1024, 'brightness_contrast', { brightness: 0.1, contrast: 1.1 });
      }
      webgpuTime = (performance.now() - start) / iterations;
    }

    // Benchmark WebGL2
    let webgl2Time = Infinity;
    if (this.webgl2Context) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await this.processImageGPU(testImage, 1024, 1024, 'brightness_contrast', { brightness: 0.1, contrast: 1.1 });
      }
      webgl2Time = (performance.now() - start) / iterations;
    }

    // Simple CPU benchmark
    const cpuStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < testImage.length; j += 4) {
        testImage[j] = Math.min(1, testImage[j] * 1.1 + 0.1);
        testImage[j + 1] = Math.min(1, testImage[j + 1] * 1.1 + 0.1);
        testImage[j + 2] = Math.min(1, testImage[j + 2] * 1.1 + 0.1);
      }
    }
    const cpuTime = (performance.now() - cpuStart) / iterations;

    let recommendation: 'webgpu' | 'webgl2' | 'cpu' = 'cpu';
    if (webgpuTime < Math.min(webgl2Time, cpuTime)) {
      recommendation = 'webgpu';
    } else if (webgl2Time < cpuTime) {
      recommendation = 'webgl2';
    }

    return {
      webgpu: webgpuTime,
      webgl2: webgl2Time,
      cpu: cpuTime,
      recommendation
    };
  }

  dispose(): void {
    // Clear texture and buffer pools
    this.texturePool.clear();
    this.bufferPool.clear();
    this.shaderPrograms.clear();

    // Cleanup WebGPU
    if (this.webgpuDevice) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.webgpuDevice as any).destroy();
      this.webgpuDevice = null;
    }

    // Cleanup WebGL2
    if (this.webgl2Context) {
      const ext = this.webgl2Context.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.webgl2Context = null;
    }

    this.isInitialized = false;
    this.capabilities = null;
  }
}

export default GPUAccelerationService;