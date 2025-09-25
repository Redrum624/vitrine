import { logger } from '../utils/Logger';
import LibRawWasm, { LibRawProcessingParams, LibRawImageData, LibRawMetadata } from './LibRawWasm';
import { RawImageData, RawMetadata } from './RawImageService';

export interface AdvancedRawProcessingOptions {
  // Professional demosaicing options
  demosaicQuality: 'draft' | 'good' | 'best';

  // White balance options
  whiteBalanceMode: 'camera' | 'auto' | 'custom';
  temperature?: number;
  tint?: number;

  // Exposure options
  exposureCompensation: number;
  highlightRecovery: boolean;
  shadowBoost: boolean;

  // Color options
  colorSpace: 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB';
  colorProfile?: string;

  // Output options
  outputBitDepth: 8 | 16;
  outputSize: 'full' | 'half' | 'quarter';

  // Camera-specific options
  useManufacturerProfile: boolean;
  applyLensCorrections: boolean;

  // Advanced options
  denoiseThreshold: number;
  chromaDenoiseThreshold: number;
  sharpening: number;
}

export interface CameraProfile {
  make: string;
  model: string;
  colorMatrix1: number[];
  colorMatrix2: number[];
  forwardMatrix1?: number[];
  forwardMatrix2?: number[];
  dngColorSpace: number;
  calibrationMatrix1?: number[];
  calibrationMatrix2?: number[];
  toneCurve?: number[];
  baselineExposure: number;
  baselineNoise: number;
  baselineSharpness: number;
}

export class AdvancedRawProcessor {
  private static instance: AdvancedRawProcessor;
  private libRaw: LibRawWasm | null = null;
  private isInitialized = false;
  private cameraProfiles: Map<string, CameraProfile> = new Map();

  static getInstance(): AdvancedRawProcessor {
    if (!AdvancedRawProcessor.instance) {
      AdvancedRawProcessor.instance = new AdvancedRawProcessor();
    }
    return AdvancedRawProcessor.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info('Initializing Advanced RAW Processor...');
      const startTime = performance.now();

      // Initialize LibRaw WASM module
      this.libRaw = new LibRawWasm({
        wasmPath: './libraw.wasm', // Path will be updated when we compile
        maxBufferSize: 256 * 1024 * 1024, // 256MB max buffer
        enableProfessionalFeatures: true
      });

      await this.libRaw.initialize();

      // Load camera profiles
      await this.loadCameraProfiles();

      const initTime = performance.now() - startTime;
      logger.info(`Advanced RAW Processor initialized in ${initTime.toFixed(2)}ms`);

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize Advanced RAW Processor:', error);
      throw error;
    }
  }

  private async loadCameraProfiles(): Promise<void> {
    logger.info('Loading camera profiles...');

    // Olympus profiles
    this.cameraProfiles.set('Olympus:OM-D E-M1 Mark III', {
      make: 'Olympus',
      model: 'OM-D E-M1 Mark III',
      colorMatrix1: [
        1.0234, -0.2973, -0.1261,
        -0.3180, 1.4419, -0.1239,
        -0.0421, -0.4434, 1.4855
      ],
      colorMatrix2: [
        1.1234, -0.3973, -0.2261,
        -0.4180, 1.5419, -0.2239,
        -0.1421, -0.5434, 1.5855
      ],
      dngColorSpace: 0,
      baselineExposure: 0.0,
      baselineNoise: 1.0,
      baselineSharpness: 1.0
    });

    this.cameraProfiles.set('Olympus:OM-D E-M1 Mark II', {
      make: 'Olympus',
      model: 'OM-D E-M1 Mark II',
      colorMatrix1: [
        0.9876, -0.2645, -0.1231,
        -0.3045, 1.4123, -0.1078,
        -0.0387, -0.4123, 1.4510
      ],
      colorMatrix2: [
        1.0876, -0.3645, -0.2231,
        -0.4045, 1.5123, -0.2078,
        -0.1387, -0.5123, 1.5510
      ],
      dngColorSpace: 0,
      baselineExposure: 0.0,
      baselineNoise: 1.0,
      baselineSharpness: 1.0
    });

    // Canon profiles
    this.cameraProfiles.set('Canon:EOS R5', {
      make: 'Canon',
      model: 'EOS R5',
      colorMatrix1: [
        1.3460, -0.5371, -0.1309,
        -0.2268, 1.1932, 0.0333,
        -0.0205, 0.1002, 0.9197
      ],
      colorMatrix2: [
        1.4460, -0.6371, -0.2309,
        -0.3268, 1.2932, -0.0667,
        -0.1205, 0.0002, 1.0197
      ],
      dngColorSpace: 0,
      baselineExposure: 0.0,
      baselineNoise: 1.0,
      baselineSharpness: 1.2
    });

    logger.info(`Loaded ${this.cameraProfiles.size} camera profiles`);
  }

  async processRawFile(
    filePath: string,
    options: Partial<AdvancedRawProcessingOptions> = {}
  ): Promise<RawImageData> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.libRaw) {
      throw new Error('LibRaw not initialized');
    }

    try {
      logger.info(`Processing RAW file with advanced pipeline: ${filePath}`);
      const startTime = performance.now();

      // Set default options
      const processingOptions: AdvancedRawProcessingOptions = {
        demosaicQuality: 'good',
        whiteBalanceMode: 'camera',
        exposureCompensation: 0.0,
        highlightRecovery: true,
        shadowBoost: false,
        colorSpace: 'sRGB',
        outputBitDepth: 16,
        outputSize: 'full',
        useManufacturerProfile: true,
        applyLensCorrections: false,
        denoiseThreshold: 0.0,
        chromaDenoiseThreshold: 0.0,
        sharpening: 0.0,
        ...options
      };

      // Convert to LibRaw parameters
      const libRawParams = this.convertToLibRawParams(processingOptions);

      // Determine if this needs Olympus-specific processing
      const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
      let result;

      if (extension === '.orf') {
        result = await this.libRaw.processOlympusORF(filePath, libRawParams);
      } else {
        result = await this.libRaw.processRawFile(filePath, libRawParams as LibRawProcessingParams);
      }

      // Apply camera profile if available
      const profileKey = `${result.metadata.make}:${result.metadata.model}`;
      const cameraProfile = this.cameraProfiles.get(profileKey);

      if (cameraProfile && processingOptions.useManufacturerProfile) {
        result.imageData.data = this.applyCameraProfile(
          result.imageData.data,
          cameraProfile
        );
        logger.debug(`Applied camera profile: ${profileKey}`);
      }

      // Apply additional post-processing
      if (processingOptions.denoiseThreshold > 0) {
        result.imageData.data = this.applyDenoising(
          result.imageData.data,
          result.imageData.width,
          result.imageData.height,
          processingOptions.denoiseThreshold
        );
      }

      if (processingOptions.sharpening > 0) {
        result.imageData.data = this.applySharpening(
          result.imageData.data,
          result.imageData.width,
          result.imageData.height,
          processingOptions.sharpening
        );
      }

      // Convert back to our format
      const rawImageData: RawImageData = this.convertLibRawToRawImageData(
        result.imageData,
        result.metadata,
        filePath
      );

      const processTime = performance.now() - startTime;
      logger.info(`Advanced RAW processing completed in ${processTime.toFixed(2)}ms`);

      return rawImageData;

    } catch (error) {
      logger.error(`Advanced RAW processing failed for ${filePath}:`, error);
      throw error;
    }
  }

  private convertToLibRawParams(options: AdvancedRawProcessingOptions): Partial<LibRawProcessingParams> {
    const params: Partial<LibRawProcessingParams> = {};

    // Demosaicing
    switch (options.demosaicQuality) {
      case 'draft':
        params.demosaicAlgorithm = 0; // Linear interpolation
        params.halfSize = true;
        break;
      case 'good':
        params.demosaicAlgorithm = 1; // VNG
        params.halfSize = false;
        break;
      case 'best':
        params.demosaicAlgorithm = 3; // AHD
        params.halfSize = false;
        break;
    }

    // White balance
    if (options.whiteBalanceMode === 'camera') {
      params.useCameraWB = true;
      params.useAutoWB = false;
    } else if (options.whiteBalanceMode === 'auto') {
      params.useCameraWB = false;
      params.useAutoWB = true;
    } else if (options.whiteBalanceMode === 'custom') {
      params.useCameraWB = false;
      params.useAutoWB = false;
      params.temperature = options.temperature || 6500;
      params.tint = options.tint || 1.0;
    }

    // Exposure
    params.exposure = options.exposureCompensation;

    // Highlight recovery
    if (options.highlightRecovery) {
      params.highlightMode = 2; // Blend highlights
    } else {
      params.highlightMode = 0; // Clip highlights
    }

    // Color space
    switch (options.colorSpace) {
      case 'sRGB':
        params.outputColorSpace = 0;
        break;
      case 'AdobeRGB':
        params.outputColorSpace = 1;
        break;
      case 'ProPhotoRGB':
        params.outputColorSpace = 2;
        break;
    }

    // Output depth
    params.outputDepth = options.outputBitDepth;

    // Size
    if (options.outputSize === 'half') {
      params.halfSize = true;
    }

    // Denoising
    params.denoise = options.denoiseThreshold > 0;

    // Profile
    params.useCameraProfile = options.useManufacturerProfile;

    return params;
  }

  private applyCameraProfile(data: Float32Array, profile: CameraProfile): Float32Array {
    logger.debug(`Applying camera profile: ${profile.make} ${profile.model}`);

    const processed = new Float32Array(data.length);
    processed.set(data);

    // Apply color matrix transformation
    const matrix = profile.colorMatrix1;

    for (let i = 0; i < data.length; i += 4) {
      const r = processed[i];
      const g = processed[i + 1];
      const b = processed[i + 2];

      // Apply 3x3 color matrix
      processed[i] = Math.max(0, Math.min(1,
        r * matrix[0] + g * matrix[1] + b * matrix[2]
      ));
      processed[i + 1] = Math.max(0, Math.min(1,
        r * matrix[3] + g * matrix[4] + b * matrix[5]
      ));
      processed[i + 2] = Math.max(0, Math.min(1,
        r * matrix[6] + g * matrix[7] + b * matrix[8]
      ));
    }

    return processed;
  }

  private applyDenoising(
    data: Float32Array,
    width: number,
    height: number,
    threshold: number
  ): Float32Array {
    logger.debug(`Applying denoising with threshold: ${threshold}`);

    // Simple bilateral filter for noise reduction
    const processed = new Float32Array(data.length);
    processed.set(data);

    const kernelSize = 3;
    const offset = Math.floor(kernelSize / 2);

    for (let y = offset; y < height - offset; y++) {
      for (let x = offset; x < width - offset; x++) {
        const centerIndex = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) { // RGB channels only
          let weightSum = 0;
          let valueSum = 0;

          for (let ky = -offset; ky <= offset; ky++) {
            for (let kx = -offset; kx <= offset; kx++) {
              const neighIndex = ((y + ky) * width + (x + kx)) * 4 + c;
              const centerValue = data[centerIndex + c];
              const neighValue = data[neighIndex];

              const spatialWeight = Math.exp(-(kx * kx + ky * ky) / (2 * threshold * threshold));
              const intensityWeight = Math.exp(-Math.abs(centerValue - neighValue) / (2 * threshold));
              const weight = spatialWeight * intensityWeight;

              weightSum += weight;
              valueSum += neighValue * weight;
            }
          }

          if (weightSum > 0) {
            processed[centerIndex + c] = valueSum / weightSum;
          }
        }
      }
    }

    return processed;
  }

  private applySharpening(
    data: Float32Array,
    width: number,
    height: number,
    amount: number
  ): Float32Array {
    logger.debug(`Applying sharpening with amount: ${amount}`);

    // Unsharp mask
    const processed = new Float32Array(data.length);
    processed.set(data);

    // Simple 3x3 sharpening kernel
    const kernel = [
      0, -amount, 0,
      -amount, 1 + 4 * amount, -amount,
      0, -amount, 0
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const centerIndex = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) { // RGB channels only
          let sum = 0;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const neighIndex = ((y + ky) * width + (x + kx)) * 4 + c;
              const kernelIndex = (ky + 1) * 3 + (kx + 1);
              sum += data[neighIndex] * kernel[kernelIndex];
            }
          }

          processed[centerIndex + c] = Math.max(0, Math.min(1, sum));
        }
      }
    }

    return processed;
  }

  private convertLibRawToRawImageData(
    imageData: LibRawImageData,
    metadata: LibRawMetadata,
    filePath: string
  ): RawImageData {
    const rawMetadata: RawMetadata = {
      make: metadata.make,
      model: metadata.model,
      iso: metadata.iso,
      aperture: metadata.aperture,
      shutter: metadata.shutter,
      focalLength: metadata.focalLength,
      whiteBalance: metadata.whiteBalance[0],
      colorSpace: metadata.colorSpace,
      orientation: metadata.orientation,
      dateTime: new Date(metadata.timestamp).toISOString(),
      exposureBias: 0 // Would be extracted from metadata
    };

    return {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
      fileName: filePath.split(/[\\/]/).pop() || 'unknown',
      filePath: filePath,
      format: metadata.make + ' RAW',
      metadata: rawMetadata
    };
  }

  async getSupportedFormats(): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.libRaw?.getSupportedFormats() || [];
  }

  getDefaultProcessingOptions(): AdvancedRawProcessingOptions {
    return {
      demosaicQuality: 'good',
      whiteBalanceMode: 'camera',
      exposureCompensation: 0.0,
      highlightRecovery: true,
      shadowBoost: false,
      colorSpace: 'sRGB',
      outputBitDepth: 16,
      outputSize: 'full',
      useManufacturerProfile: true,
      applyLensCorrections: false,
      denoiseThreshold: 0.0,
      chromaDenoiseThreshold: 0.0,
      sharpening: 0.0
    };
  }

  getCameraProfile(make: string, model: string): CameraProfile | null {
    return this.cameraProfiles.get(`${make}:${model}`) || null;
  }

  dispose(): void {
    if (this.libRaw) {
      this.libRaw.dispose();
      this.libRaw = null;
    }
    this.cameraProfiles.clear();
    this.isInitialized = false;
  }
}

export const advancedRawProcessor = AdvancedRawProcessor.getInstance();