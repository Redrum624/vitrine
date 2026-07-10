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

export class AdvancedRawProcessor {
  private static instance: AdvancedRawProcessor;
  private libRaw: LibRawWasm | null = null;
  private isInitialized = false;

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

      const initTime = performance.now() - startTime;
      logger.info(`Advanced RAW Processor initialized in ${initTime.toFixed(2)}ms`);

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize Advanced RAW Processor:', error);
      throw error;
    }
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

      // NOTE: LibRaw already applies the correct per-camera colour matrix
      // (-o 1 → sRGB). A second JS-side matrix multiply would double-transform
      // the colours and is therefore omitted.

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

  dispose(): void {
    if (this.libRaw) {
      this.libRaw.dispose();
      this.libRaw = null;
    }
    this.isInitialized = false;
  }
}

export const advancedRawProcessor = AdvancedRawProcessor.getInstance();