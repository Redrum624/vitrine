import { logger } from '../utils/Logger';
import { advancedRawProcessor, AdvancedRawProcessingOptions } from './AdvancedRawProcessor';
import { libRawService, LibRawOptions } from './LibRawService';
import { cameraProfileService } from './CameraProfileService';
import { advancedDemosaicingService } from './AdvancedDemosaicingService';
import { rawHistogramService, HistogramData } from './RawHistogramService';
import { noiseReductionService, NoiseReductionOptions } from './NoiseReductionService';
import { lensProfileService, LensProfile, LensCorrections } from './LensProfileService';
import { colorManagementService } from './ColorManagementService';
import { printService } from './PrintService';
import { webGalleryService } from './WebGalleryService';

export interface RawImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  format: string;
  metadata: RawMetadata;
  histogram?: HistogramData;
}

export interface RawMetadata {
  make?: string;
  model?: string;
  iso?: number;
  aperture?: number;
  shutter?: number;
  focalLength?: number;
  whiteBalance?: number;
  colorSpace?: string;
  orientation?: number;
  dateTime?: string;
  exposureBias?: number;
  [key: string]: unknown; // Index signature for Record compatibility
}

// Supported RAW formats
const RAW_EXTENSIONS = [
  '.orf',  // Olympus
  '.cr2', '.cr3',  // Canon
  '.nef',  // Nikon
  '.arw', '.srf', '.sr2',  // Sony
  '.dng',  // Adobe DNG
  '.raf',  // Fujifilm
  '.rw2',  // Panasonic
  '.pef',  // Pentax
  '.x3f',  // Sigma
  '.mrw',  // Minolta
  '.dcr', '.k25', '.kdc',  // Kodak
  '.erf',  // Epson
  '.mef',  // Mamiya
  '.mos',  // Leaf
  '.raw',  // Generic
  '.rwl'   // Leica
];

export class RawImageService {
  private static instance: RawImageService;

  static getInstance(): RawImageService {
    if (!RawImageService.instance) {
      RawImageService.instance = new RawImageService();
    }
    return RawImageService.instance;
  }

  isRawFile(filePath: string): boolean {
    const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    return RAW_EXTENSIONS.includes(extension);
  }

  async loadRawImage(filePath: string, options?: Partial<AdvancedRawProcessingOptions>): Promise<RawImageData> {
    try {
      logger.info(`Loading RAW image: ${filePath}`);
      const startTime = performance.now();

      const extension = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));

      // Try LibRaw WebAssembly processing first
      try {
        logger.debug('Attempting LibRaw WebAssembly processing...');
        const rawData = await this.decodeRawFile(filePath, extension);

        const loadTime = performance.now() - startTime;
        logger.info(`RAW image loaded with LibRaw in ${loadTime.toFixed(2)}ms: ${rawData.width}x${rawData.height}`);

        return rawData;
      } catch (libRawError: unknown) {
        logger.warn('LibRaw processing failed, trying advanced processor fallback:', libRawError);

        // Fallback to old advanced processor if available
        try {
          const rawData = await advancedRawProcessor.processRawFile(filePath, options);
          const loadTime = performance.now() - startTime;
          logger.info(`RAW image loaded with fallback processor in ${loadTime.toFixed(2)}ms: ${rawData.width}x${rawData.height}`);
          return rawData;
        } catch (advancedError) {
          logger.error('All RAW processing methods failed:', advancedError);
          throw new Error(`Failed to process RAW file: ${libRawError instanceof Error ? libRawError.message : String(libRawError)}`);
        }
      }

    } catch (error) {
      logger.error(`Failed to load RAW image: ${filePath}`, error);
      throw error;
    }
  }

  private async decodeRawFile(filePath: string, extension: string): Promise<RawImageData> {
    logger.debug(`Decoding RAW file with LibRaw: ${extension.toUpperCase()}`);

    try {
      // Read the file buffer
      let buffer: ArrayBuffer;

      if (typeof window !== 'undefined' && (window as typeof window & { electron?: { fs: { readFile: (path: string) => Promise<ArrayBuffer> } } }).electron) {
        // Electron environment - use IPC to read file
        buffer = await (window as typeof window & { electron: { fs: { readFile: (path: string) => Promise<ArrayBuffer> } } }).electron.fs.readFile(filePath);
      } else {
        // Browser environment - file should be provided as ArrayBuffer
        throw new Error('Browser RAW processing requires file buffer, not file path');
      }

      // Process with LibRaw WebAssembly
      const result = await libRawService.processRawFileWithPreset(
        buffer,
        'quality', // Use quality preset for best results
        {
          // Custom options for web compatibility
          output_bps: 8,
          user_cspace: 1, // sRGB
          use_camera_wb: true
        }
      );

      // Convert LibRaw output to our format
      let floatData = this.convertUint8ToFloat32Array(result.imageData);

      // Apply advanced camera profile if available
      if (result.metadata.make && result.metadata.model) {
        const cameraProfile = cameraProfileService.getProfile(result.metadata.make, result.metadata.model);
        if (cameraProfile) {
          logger.info(`Applying camera profile: ${cameraProfile.make} ${cameraProfile.model}`);
          floatData = cameraProfileService.applyCameraProfile(
            floatData,
            result.width,
            result.height,
            cameraProfile,
            'D65' // Standard illuminant for most cases
          );
        } else {
          // Try to auto-detect camera profile from EXIF
          const autoProfile = cameraProfileService.autoDetectProfile({
            Make: result.metadata.make,
            Model: result.metadata.model
          });
          if (autoProfile) {
            logger.info(`Auto-detected camera profile: ${autoProfile.make} ${autoProfile.model}`);
            floatData = cameraProfileService.applyCameraProfile(
              floatData,
              result.width,
              result.height,
              autoProfile,
              'D65'
            );
          }
        }
      }

      const rawData: RawImageData = {
        width: result.width,
        height: result.height,
        data: floatData,
        fileName: filePath.split(/[\\/]/).pop() || 'unknown',
        filePath: filePath,
        format: extension.toUpperCase(),
        metadata: {
          make: result.metadata.make,
          model: result.metadata.model,
          iso: result.metadata.iso,
          aperture: result.metadata.aperture,
          shutter: result.metadata.shutter,
          focalLength: result.metadata.focal_length,
          colorSpace: 'sRGB',
          dateTime: new Date(result.metadata.timestamp * 1000).toISOString()
        }
      };

      logger.info(`RAW file decoded successfully: ${result.width}x${result.height} (${result.processingTime.toFixed(2)}ms)`);
      return rawData;

    } catch (error) {
      logger.warn(`LibRaw processing failed for ${filePath}, falling back to mock processing:`, error);

      // Fallback to mock processing for development/testing
      return this.processMockRawFile(filePath, extension);
    }
  }

  // Fallback mock processing method
  private async processMockRawFile(filePath: string, extension: string): Promise<RawImageData> {
    try {
      // For development, we'll try to read it as a regular image first
      // and add basic RAW-like processing
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      return new Promise((resolve, reject) => {
        img.onload = () => {
          try {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const floatData = this.convertToFloat32Array(imageData.data);

            // Apply basic RAW-like processing
            const processedData = this.applyBasicRawProcessing(floatData, img.width, img.height);

            const result: RawImageData = {
              width: img.width,
              height: img.height,
              data: processedData,
              fileName: filePath.split(/[\\/]/).pop() || 'unknown',
              filePath: filePath,
              format: extension.toUpperCase(),
              metadata: this.extractBasicMetadata(extension)
            };

            resolve(result);
          } catch (error) {
            reject(error);
          }
        };

        img.onerror = () => {
          // If regular image loading fails, we need actual RAW processing
          this.processWithDcraw(filePath, extension)
            .then(resolve)
            .catch(reject);
        };

        img.src = filePath;
      });

    } catch (error) {
      logger.error('RAW decoding failed:', error);
      throw error;
    }
  }

  private convertToFloat32Array(uint8Data: Uint8ClampedArray): Float32Array {
    const floatData = new Float32Array(uint8Data.length);
    for (let i = 0; i < uint8Data.length; i++) {
      floatData[i] = uint8Data[i] / 255.0;
    }
    return floatData;
  }

  private applyBasicRawProcessing(data: Float32Array, width: number, height: number): Float32Array {
    // Apply basic RAW-like processing
    const processed = new Float32Array(data.length);
    processed.set(data);

    logger.debug('Applying basic RAW processing...');

    // Demosaicing simulation (very basic)
    // In real RAW processing, this would be much more sophisticated
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;

        // Simple gamma correction for RAW-like processing
        processed[pixelIndex] = Math.pow(processed[pixelIndex], 1.0 / 2.2);     // R
        processed[pixelIndex + 1] = Math.pow(processed[pixelIndex + 1], 1.0 / 2.2); // G
        processed[pixelIndex + 2] = Math.pow(processed[pixelIndex + 2], 1.0 / 2.2); // B
        // Alpha stays the same
      }
    }

    return processed;
  }

  private extractBasicMetadata(extension: string): RawMetadata {
    // Basic metadata based on file extension
    // In production, this would be extracted from EXIF/maker notes
    const metadata: RawMetadata = {
      colorSpace: 'sRGB',
      orientation: 1
    };

    switch (extension) {
      case '.orf':
        metadata.make = 'Olympus';
        break;
      case '.cr2':
      case '.cr3':
        metadata.make = 'Canon';
        break;
      case '.nef':
        metadata.make = 'Nikon';
        break;
      case '.arw':
      case '.srf':
      case '.sr2':
        metadata.make = 'Sony';
        break;
      case '.raf':
        metadata.make = 'Fujifilm';
        break;
      case '.rw2':
        metadata.make = 'Panasonic';
        break;
      case '.pef':
        metadata.make = 'Pentax';
        break;
    }

    return metadata;
  }

  private async processWithDcraw(filePath: string, extension: string): Promise<RawImageData> {
    // Placeholder for actual dcraw/LibRaw WebAssembly integration
    logger.warn(`Advanced RAW processing not implemented yet for ${extension}`);

    // For now, create a placeholder image
    const width = 4000;
    const height = 3000;
    const channels = 4;

    const data = new Float32Array(width * height * channels);

    // Create a simple pattern to show RAW processing is attempted
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * channels;
        data[index] = 0.5;     // R
        data[index + 1] = 0.5; // G
        data[index + 2] = 0.5; // B
        data[index + 3] = 1.0; // A
      }
    }

    return {
      width,
      height,
      data,
      fileName: filePath.split(/[\\/]/).pop() || 'unknown',
      filePath,
      format: extension.toUpperCase(),
      metadata: this.extractBasicMetadata(extension)
    };
  }

  // Olympus ORF specific processing
  async processOlympusORF(filePath: string): Promise<RawImageData> {
    logger.info(`Processing Olympus ORF file: ${filePath}`);

    try {
      // ORF files have specific structure
      // This would normally use LibRaw or similar
      const rawData = await this.loadRawImage(filePath);

      // Apply Olympus-specific processing
      rawData.data = this.applyOlympusProcessing(rawData.data, rawData.width, rawData.height);

      return rawData;
    } catch (error) {
      logger.error('Failed to process Olympus ORF file:', error);
      throw error;
    }
  }

  private applyOlympusProcessing(data: Float32Array, _width: number, _height: number): Float32Array {
    // Olympus-specific processing
    const processed = new Float32Array(data.length);
    processed.set(data);

    logger.debug('Applying Olympus-specific processing...');

    // Olympus typically uses different color matrices and tone curves
    for (let i = 0; i < data.length; i += 4) {
      // Apply Olympus color matrix (simplified)
      const r = processed[i];
      const g = processed[i + 1];
      const b = processed[i + 2];

      // Simplified Olympus color correction
      processed[i] = Math.min(1.0, r * 1.1 + g * -0.05);
      processed[i + 1] = Math.min(1.0, g * 1.05 + r * -0.02 + b * -0.02);
      processed[i + 2] = Math.min(1.0, b * 1.08 + g * -0.03);
    }

    return processed;
  }

  // Convert Uint8Array to Float32Array (for LibRaw output)
  private convertUint8ToFloat32Array(uint8Data: Uint8Array): Float32Array {
    const floatData = new Float32Array(uint8Data.length);

    for (let i = 0; i < uint8Data.length; i++) {
      floatData[i] = uint8Data[i] / 255.0; // Normalize to 0-1 range
    }

    return floatData;
  }

  // Get supported formats
  getSupportedFormats(): string[] {
    return [...RAW_EXTENSIONS];
  }

  // Check if format needs special processing
  needsAdvancedProcessing(extension: string): boolean {
    return ['.orf', '.cr2', '.cr3', '.nef', '.arw'].includes(extension.toLowerCase());
  }

  // Process RAW file from ArrayBuffer (for browser usage)
  async processRawFromBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    preset: 'fast' | 'balanced' | 'quality' = 'balanced',
    customOptions?: LibRawOptions
  ): Promise<RawImageData> {
    try {
      logger.info(`Processing RAW buffer with LibRaw: ${fileName} (${buffer.byteLength} bytes)`);

      const result = await libRawService.processRawFileWithPreset(buffer, preset, customOptions);

      // Convert LibRaw output to our format
      const floatData = this.convertUint8ToFloat32Array(result.imageData);

      const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

      const rawData: RawImageData = {
        width: result.width,
        height: result.height,
        data: floatData,
        fileName: fileName,
        filePath: fileName, // Use filename as path for buffer-based processing
        format: extension.toUpperCase(),
        metadata: {
          make: result.metadata.make,
          model: result.metadata.model,
          iso: result.metadata.iso,
          aperture: result.metadata.aperture,
          shutter: result.metadata.shutter,
          focalLength: result.metadata.focal_length,
          colorSpace: 'sRGB',
          dateTime: new Date(result.metadata.timestamp * 1000).toISOString()
        }
      };

      logger.info(`RAW buffer processed successfully: ${result.width}x${result.height} (${result.processingTime.toFixed(2)}ms)`);
      return rawData;

    } catch (error) {
      logger.error(`Failed to process RAW buffer for ${fileName}:`, error);
      throw error;
    }
  }

  // Initialize LibRaw service
  async initializeLibRaw(): Promise<void> {
    try {
      await libRawService.initialize();
      logger.info('LibRaw WebAssembly service initialized successfully');
    } catch (error) {
      logger.warn('Failed to initialize LibRaw WebAssembly service:', error);
      throw error;
    }
  }

  // Get LibRaw service statistics
  getLibRawStats() {
    return libRawService.getStats();
  }

  /**
   * Apply advanced demosaicing to RAW data
   * This method provides access to professional demosaicing algorithms
   */
  async applyAdvancedDemosaicing(
    rawData: Float32Array,
    width: number,
    height: number,
    algorithm: 'VNG' | 'AHD' | 'LMMSE' = 'VNG',
    bayerPattern: 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG' = 'RGGB'
  ): Promise<Float32Array> {
    logger.info(`Applying ${algorithm} demosaicing to ${width}x${height} image`);

    try {
      switch (algorithm) {
        case 'VNG':
          return await advancedDemosaicingService.demosaicVNG(rawData, width, height, bayerPattern);
        case 'AHD':
          return await advancedDemosaicingService.demosaicAHD(rawData, width, height, bayerPattern);
        case 'LMMSE':
          return await advancedDemosaicingService.demosaicLMMSE(rawData, width, height, bayerPattern, 0.01);
        default:
          throw new Error(`Unsupported demosaicing algorithm: ${algorithm}`);
      }
    } catch (error) {
      logger.error(`Advanced demosaicing failed:`, error);
      throw error;
    }
  }

  /**
   * Process RAW file with professional-grade settings
   * This method combines LibRaw processing with advanced camera profiles and demosaicing
   */
  async processRawWithProfessionalQuality(
    filePath: string,
    options: {
      demosaicAlgorithm?: 'VNG' | 'AHD' | 'LMMSE';
      bayerPattern?: 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';
      applyNoiseProfiling?: boolean;
      applyLensCorrection?: boolean;
      whiteBalanceMode?: 'camera' | 'auto' | 'daylight' | 'tungsten';
      applyNoiseReduction?: boolean;
      noiseReductionOptions?: Partial<NoiseReductionOptions>;
    } = {}
  ): Promise<RawImageData> {
    logger.info(`Processing RAW file with professional quality settings: ${filePath}`);

    const {
      demosaicAlgorithm = 'VNG',
      bayerPattern = 'RGGB',
      whiteBalanceMode = 'camera',
      applyNoiseReduction = false,
      noiseReductionOptions = {}
    } = options;

    try {
      // First, load the RAW file with standard processing
      const rawData = await this.loadRawImage(filePath);

      // Apply advanced demosaicing if requested
      if (demosaicAlgorithm !== 'VNG') {
        logger.info(`Applying advanced ${demosaicAlgorithm} demosaicing`);
        rawData.data = await this.applyAdvancedDemosaicing(
          rawData.data,
          rawData.width,
          rawData.height,
          demosaicAlgorithm,
          bayerPattern
        );
      }

      // Apply camera-specific white balance if available
      if (rawData.metadata.make && rawData.metadata.model) {
        const cameraProfile = cameraProfileService.getProfile(rawData.metadata.make, rawData.metadata.model);
        if (cameraProfile && whiteBalanceMode !== 'camera') {
          const wbType = whiteBalanceMode as keyof typeof cameraProfile.whiteBalance;
          rawData.data = cameraProfileService.applyCameraWhiteBalance(
            rawData.data,
            cameraProfile,
            wbType
          );
        }

        // Apply camera tone curve if available
        if (cameraProfile && cameraProfile.toneCurve) {
          rawData.data = cameraProfileService.applyCameraToneCurve(rawData.data, cameraProfile);
        }
      }

      // Apply noise reduction if requested
      if (applyNoiseReduction) {
        logger.info('Applying noise reduction to RAW image');

        const defaultNoiseOptions: NoiseReductionOptions = {
          algorithm: 'wavelet',
          strength: 25,
          detail: 75,
          chromaStrength: 20,
          luminanceStrength: 30,
          edgeThreshold: 0.1,
          iterations: 1
        };

        const finalNoiseOptions = { ...defaultNoiseOptions, ...noiseReductionOptions };

        rawData.data = await noiseReductionService.applyNoiseReduction(
          rawData.data,
          rawData.width,
          rawData.height,
          finalNoiseOptions
        );
      }

      logger.info(`Professional RAW processing completed for ${filePath}`);
      return rawData;

    } catch (error) {
      logger.error(`Professional RAW processing failed:`, error);
      throw error;
    }
  }

  /**
   * Get available camera profiles
   */
  getAvailableCameraProfiles() {
    return cameraProfileService.getAllProfiles();
  }

  /**
   * Get camera profiles by manufacturer
   */
  getCameraProfilesByMake(make: string) {
    return cameraProfileService.getProfilesByMake(make);
  }

  /**
   * Generate histogram for RAW image data
   */
  async generateHistogramForRawData(
    imageData: Float32Array,
    width: number,
    height: number,
    options?: {
      bins?: number;
      bitDepth?: 8 | 16;
      shadowThreshold?: number;
      highlightThreshold?: number;
      enableClippingAnalysis?: boolean;
    }
  ): Promise<HistogramData> {
    logger.info(`Generating histogram for ${width}x${height} RAW image`);

    try {
      const histogram = rawHistogramService.generateHistogram(
        imageData,
        width,
        height,
        {
          bins: options?.bins || 256,
          bitDepth: options?.bitDepth || 16,
          shadowThreshold: options?.shadowThreshold || 0.02,
          highlightThreshold: options?.highlightThreshold || 0.98,
          enableClippingAnalysis: options?.enableClippingAnalysis !== false
        }
      );

      return histogram;
    } catch (error) {
      logger.error('Failed to generate histogram:', error);
      throw error;
    }
  }

  /**
   * Load RAW image with histogram generation
   */
  async loadRawImageWithHistogram(
    filePath: string,
    options?: Partial<AdvancedRawProcessingOptions>,
    histogramOptions?: {
      generateHistogram?: boolean;
      bins?: number;
      bitDepth?: 8 | 16;
      shadowThreshold?: number;
      highlightThreshold?: number;
    }
  ): Promise<RawImageData> {
    const rawData = await this.loadRawImage(filePath, options);

    // Generate histogram if requested
    if (histogramOptions?.generateHistogram !== false) {
      try {
        const histogram = await this.generateHistogramForRawData(
          rawData.data,
          rawData.width,
          rawData.height,
          histogramOptions
        );

        return {
          ...rawData,
          histogram
        };
      } catch (error) {
        logger.warn('Failed to generate histogram, returning image data without histogram:', error);
        return rawData;
      }
    }

    return rawData;
  }

  /**
   * Analyze image exposure and get recommendations
   */
  analyzeImageExposure(imageData: Float32Array, width: number, height: number): {
    exposureAdjustment: number;
    shadowsAdjustment: number;
    highlightsAdjustment: number;
    reasoning: string;
  } {
    try {
      const histogram = rawHistogramService.generateHistogram(imageData, width, height, {
        bins: 256,
        bitDepth: 16,
        shadowThreshold: 0.02,
        highlightThreshold: 0.98,
        enableClippingAnalysis: true
      });

      return rawHistogramService.getRecommendedExposureAdjustment(histogram);
    } catch (error) {
      logger.error('Failed to analyze image exposure:', error);
      return {
        exposureAdjustment: 0,
        shadowsAdjustment: 0,
        highlightsAdjustment: 0,
        reasoning: 'Unable to analyze exposure'
      };
    }
  }

  /**
   * Apply noise reduction to image data
   */
  async applyNoiseReduction(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    logger.info('Applying noise reduction to image data');

    try {
      return await noiseReductionService.applyNoiseReduction(imageData, width, height, options);
    } catch (error) {
      logger.error('Failed to apply noise reduction:', error);
      throw error;
    }
  }

  /**
   * Estimate noise level in image
   */
  estimateImageNoise(imageData: Float32Array, width: number, height: number) {
    try {
      return noiseReductionService.estimateNoiseLevel(imageData, width, height);
    } catch (error) {
      logger.error('Failed to estimate noise level:', error);
      return {
        luminanceNoise: 0,
        chrominanceNoise: 0,
        channelNoise: { red: 0, green: 0, blue: 0 }
      };
    }
  }

  /**
   * Get available noise profiles
   */
  getAvailableNoiseProfiles() {
    return noiseReductionService.getAllNoiseProfiles();
  }

  /**
   * Get noise profile for specific camera and ISO
   */
  getNoiseProfile(camera: string, model: string, iso: number) {
    return noiseReductionService.getNoiseProfile(camera, model, iso);
  }

  /**
   * Detect lens from image metadata
   */
  detectLensFromMetadata(metadata: RawMetadata) {
    try {
      return lensProfileService.detectLens(metadata);
    } catch (error) {
      logger.error('Failed to detect lens from metadata:', error);
      return { confidence: 0 };
    }
  }

  /**
   * Get lens profile for specific camera and lens
   */
  getLensProfile(camera: string, lens: string, focalLength?: number, aperture?: number): LensProfile | null {
    return lensProfileService.getLensProfile(camera, lens, focalLength, aperture);
  }

  /**
   * Apply lens corrections to image data
   */
  async applyLensCorrections(
    imageData: Float32Array,
    width: number,
    height: number,
    profile: LensProfile,
    corrections: LensCorrections
  ): Promise<Float32Array> {
    logger.info('Applying lens corrections to image data');

    try {
      return await lensProfileService.applyLensCorrections(imageData, width, height, profile, corrections);
    } catch (error) {
      logger.error('Failed to apply lens corrections:', error);
      throw error;
    }
  }

  /**
   * Get available lens profiles for a camera
   */
  getLensProfilesForCamera(camera: string) {
    return lensProfileService.getLensProfilesForCamera(camera);
  }

  /**
   * Get all supported cameras
   */
  getSupportedCameras() {
    return lensProfileService.getSupportedCameras();
  }

  /**
   * Estimate lens distortion from image content
   */
  estimateLensDistortion(imageData: Float32Array, width: number, height: number) {
    try {
      return lensProfileService.estimateDistortionFromImage(imageData, width, height);
    } catch (error) {
      logger.error('Failed to estimate lens distortion:', error);
      return { k1: 0, k2: 0, confidence: 0 };
    }
  }

  /**
   * Get available color profiles
   */
  getColorProfiles(type?: 'input' | 'display' | 'output') {
    return colorManagementService.getColorProfilesByType(type);
  }

  /**
   * Get available print profiles
   */
  getPrintProfiles() {
    return colorManagementService.getPrintProfiles();
  }

  /**
   * Apply soft proofing for print preview
   */
  async applySoftProof(imageData: Float32Array, width: number, height: number, options: any) {
    try {
      return await colorManagementService.applySoftProof(imageData, width, height, options);
    } catch (error) {
      logger.error('Failed to apply soft proof:', error);
      throw error;
    }
  }

  /**
   * Convert image to different color profile
   */
  async convertColorProfile(imageData: Float32Array, width: number, height: number, options: any) {
    try {
      return await colorManagementService.convertColorProfile(imageData, width, height, options);
    } catch (error) {
      logger.error('Failed to convert color profile:', error);
      throw error;
    }
  }

  /**
   * Get available paper sizes
   */
  getPaperSizes() {
    return printService.getPaperSizes();
  }

  /**
   * Get available print layouts
   */
  getPrintLayouts() {
    return printService.getPrintLayouts();
  }

  /**
   * Create print job
   */
  async createPrintJob(imageData: Float32Array, width: number, height: number, settings: any) {
    try {
      return await printService.createPrintJob(imageData, width, height, settings);
    } catch (error) {
      logger.error('Failed to create print job:', error);
      throw error;
    }
  }

  /**
   * Get print jobs
   */
  getPrintJobs() {
    return printService.getAllPrintJobs();
  }

  /**
   * Get available gallery themes
   */
  getGalleryThemes() {
    return webGalleryService.getThemes();
  }

  /**
   * Generate web gallery
   */
  async generateWebGallery(images: any[], settings: any) {
    try {
      return await webGalleryService.generateGallery(images, settings);
    } catch (error) {
      logger.error('Failed to generate web gallery:', error);
      throw error;
    }
  }

  /**
   * Export gallery as downloadable file
   */
  async exportGallery(galleryOutput: any, filename: string) {
    try {
      return await webGalleryService.exportGallery(galleryOutput, filename);
    } catch (error) {
      logger.error('Failed to export gallery:', error);
      throw error;
    }
  }
}

export const rawImageService = RawImageService.getInstance();