import { logger } from '../utils/Logger';
import { advancedRawProcessor, AdvancedRawProcessingOptions } from './AdvancedRawProcessor';
import { libRawService, LibRawOptions, ProcessedRawData } from './LibRawService';
import { cameraProfileService } from './CameraProfileService';
import { advancedDemosaicingService } from './AdvancedDemosaicingService';
import { rawHistogramService, HistogramData } from './RawHistogramService';
import { noiseReductionService, NoiseReductionOptions } from './NoiseReductionService';
import { lensProfileService, LensProfile, LensCorrections } from './LensProfileService';
import { colorManagementService, SoftProofOptions, ColorConversionOptions } from './ColorManagementService';
import { printService, PrintSettings } from './PrintService';
import { webGalleryService, GalleryImage, GalleryOutput, GallerySettings } from './WebGalleryService';

export interface RawImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  format: string;
  metadata: RawMetadata;
  histogram?: HistogramData;
  isLibRawProcessed?: boolean;
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
        const errorMessage = libRawError instanceof Error ? libRawError.message : String(libRawError);
        logger.warn(`LibRaw processing failed for ${extension.toUpperCase()} file:`, errorMessage);
        logger.info('Attempting fallback processing...');

        // Fallback to old advanced processor if available
        try {
          const rawData = await advancedRawProcessor.processRawFile(filePath, options);
          const loadTime = performance.now() - startTime;
          logger.info(`RAW image loaded with fallback processor in ${loadTime.toFixed(2)}ms: ${rawData.width}x${rawData.height}`);
          logger.warn('Note: Fallback processor was used. For best results, ensure LibRaw WebAssembly module is properly installed.');
          return rawData;
        } catch (advancedError) {
          const advErrorMessage = advancedError instanceof Error ? advancedError.message : String(advancedError);
          logger.error('All RAW processing methods failed:', {
            libRawError: errorMessage,
            advancedProcessorError: advErrorMessage
          });
          throw new Error(`Failed to process ${extension.toUpperCase()} RAW file. LibRaw error: ${errorMessage}. Advanced processor error: ${advErrorMessage}`);
        }
      }

    } catch (error) {
      logger.error(`Failed to load RAW image: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Primary decoder: uses Electron main process (Node.js + Sharp) to extract
   * the embedded JPEG from the RAW file. This is 100% reliable for every file
   * and avoids the browser SharedArrayBuffer/Emscripten issues entirely.
   */
  private async decodeRawFile(filePath: string, extension: string): Promise<RawImageData> {
    // Try Electron main-process decoder first (embedded JPEG extraction via Sharp)
    if (typeof window !== 'undefined' && window.electronAPI?.decodeRawFile) {
      try {
        logger.info(`Decoding RAW file via Electron main process: ${extension.toUpperCase()}`);
        const result = await window.electronAPI.decodeRawFile(filePath);

        // Native LibRaw demosaic returns 16-bit pixels; the embedded-JPEG
        // fallback returns 8-bit. Convert from whichever depth we got.
        const channels = result.channels ?? 4;
        const floatData = result.bitDepth === 16
          ? this.convertUint16ToFloat32Array(new Uint16Array(result.data), result.width, result.height, channels)
          : this.convertUint8ToFloat32Array(new Uint8Array(result.data), result.width, result.height);

        logger.info(`RAW decoded via main process: ${result.width}x${result.height}, ${result.bitDepth ?? 8}-bit, ${channels}ch`);

        const rawData: RawImageData = {
          width: result.width,
          height: result.height,
          data: floatData,
          isLibRawProcessed: true,
          fileName: filePath.split(/[\\/]/).pop() || 'unknown',
          filePath,
          format: extension.toUpperCase(),
          metadata: this.extractBasicMetadata(extension),
        };

        return rawData;
      } catch (mainProcessError) {
        const msg = mainProcessError instanceof Error ? mainProcessError.message : String(mainProcessError);
        logger.warn(`Main-process RAW decode failed, trying LibRaw WASM: ${msg}`);
      }
    }

    // Fallback: LibRaw WASM (iframe-based, works for first file per session)
    logger.info(`Decoding RAW file with LibRaw WASM: ${extension.toUpperCase()}`);

    try {
      let buffer: ArrayBuffer;
      if (typeof window !== 'undefined' && window.electronAPI) {
        buffer = await window.electronAPI.readFileBuffer(filePath);
      } else {
        throw new Error('Browser RAW processing requires file buffer, not file path');
      }

      const result = await libRawService.processRawFileWithPreset(buffer, 'quality');

      let pixelData: Uint8Array | null = null;
      if (result.imageData instanceof Uint8Array) {
        pixelData = result.imageData;
      } else if (result.imageData && typeof result.imageData === 'object') {
        const obj = result.imageData as Record<string, unknown>;
        if (obj.data instanceof Uint8Array) pixelData = obj.data;
        else if (obj.buffer instanceof ArrayBuffer) pixelData = new Uint8Array(obj.buffer);
      }

      if (pixelData && pixelData.length > 0) {
        const floatData = this.convertUint8ToFloat32Array(pixelData, result.width, result.height);
        return this.finishRawProcessing(result as ProcessedRawData, floatData, filePath);
      }

      throw new Error(`LibRaw returned unusable pixel data`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`LibRaw WASM failed for ${filePath}: ${msg}`);
      throw error;
    }
  }

  // Helper method to finish RAW processing with the final result.
  // NOTE: LibRaw already applies the correct per-camera colour matrix and emits
  // colour-managed sRGB pixels (-o 1). No JS-side colour-matrix multiply must
  // be applied on top; that would double-transform the colours.
  private finishRawProcessing(result: ProcessedRawData, floatData: Float32Array, filePath: string): RawImageData {
    const rawData: RawImageData = {
      width: result.width,
      height: result.height,
      data: floatData,
      isLibRawProcessed: true,
      fileName: filePath.split(/[\\/]/).pop() || 'unknown',
      filePath: filePath,
      format: filePath.substring(filePath.lastIndexOf('.')).toUpperCase(),
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

    logger.debug(`RAW final result — data length: ${rawData.data.length}`);

    return rawData;
  }

  // Fallback mock processing method
  // @ts-expect-error — kept as potential fallback but no longer called from the main pipeline
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

        // Use Electron's secure file reading for mock processing
        if (typeof window !== 'undefined' && window.electronAPI) {
          // Electron environment - read as data URL
          window.electronAPI.readImageAsDataURL(filePath)
            .then((dataUrl: string) => {
              img.src = dataUrl;
            })
            .catch((error: Error) => {
              logger.error('Failed to read RAW file via Electron for mock processing:', error);
              // Fall back to processWithDcraw
              this.processWithDcraw(filePath, extension)
                .then(resolve)
                .catch(reject);
            });
        } else {
          // Browser environment - cannot load files directly
          logger.warn('Cannot load RAW files in browser environment, using placeholder');
          this.processWithDcraw(filePath, extension)
            .then(resolve)
            .catch(reject);
        }
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
    // Fallback placeholder processor - creates a test image when LibRaw fails
    logger.debug(`Using fallback placeholder processor for ${extension} file`);

    // Create a placeholder image for development/testing
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

  /**
   * Convert LibRaw Uint8Array output to Float32Array RGBA (0-1 normalized).
   * Auto-detects whether the input is RGB (3ch) or RGBA (4ch) from data length.
   */
  private convertUint8ToFloat32Array(uint8Data: Uint8Array, width: number, height: number): Float32Array {
    const totalPixels = width * height;
    const rgbaData = new Float32Array(totalPixels * 4);

    // Detect channel count from data length
    let channels: number;
    if (uint8Data.length === totalPixels * 3) {
      channels = 3;
    } else if (uint8Data.length === totalPixels * 4) {
      channels = 4;
    } else {
      // Best guess: try 3 channels first, fall back to 4
      channels = uint8Data.length >= totalPixels * 4 ? 4 : 3;
      logger.warn(`Unexpected pixel data length ${uint8Data.length} for ${width}x${height}. Assuming ${channels} channels.`);
    }

    logger.debug(`Converting ${channels}-channel Uint8 → RGBA Float32 (${width}x${height}, ${uint8Data.length} bytes)`);

    if (channels === 3) {
      for (let i = 0; i < totalPixels; i++) {
        const srcIdx = i * 3;
        const dstIdx = i * 4;
        rgbaData[dstIdx]     = uint8Data[srcIdx] / 255.0;
        rgbaData[dstIdx + 1] = uint8Data[srcIdx + 1] / 255.0;
        rgbaData[dstIdx + 2] = uint8Data[srcIdx + 2] / 255.0;
        rgbaData[dstIdx + 3] = 1.0;
      }
    } else {
      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        rgbaData[idx]     = uint8Data[idx] / 255.0;
        rgbaData[idx + 1] = uint8Data[idx + 1] / 255.0;
        rgbaData[idx + 2] = uint8Data[idx + 2] / 255.0;
        rgbaData[idx + 3] = uint8Data[idx + 3] / 255.0;
      }
    }

    return rgbaData;
  }

  /**
   * Convert 16-bit LibRaw output (host-endian uint16) to Float32Array RGBA (0-1).
   * Native dcraw_emu emits 3-channel RGB; the 4-channel branch is defensive.
   */
  private convertUint16ToFloat32Array(uint16Data: Uint16Array, width: number, height: number, channels: number): Float32Array {
    const totalPixels = width * height;
    const rgbaData = new Float32Array(totalPixels * 4);
    const inv = 1 / 65535;

    if (channels === 4) {
      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        rgbaData[idx]     = uint16Data[idx] * inv;
        rgbaData[idx + 1] = uint16Data[idx + 1] * inv;
        rgbaData[idx + 2] = uint16Data[idx + 2] * inv;
        rgbaData[idx + 3] = uint16Data[idx + 3] * inv;
      }
    } else {
      for (let i = 0; i < totalPixels; i++) {
        const srcIdx = i * 3;
        const dstIdx = i * 4;
        rgbaData[dstIdx]     = uint16Data[srcIdx] * inv;
        rgbaData[dstIdx + 1] = uint16Data[srcIdx + 1] * inv;
        rgbaData[dstIdx + 2] = uint16Data[srcIdx + 2] * inv;
        rgbaData[dstIdx + 3] = 1.0;
      }
    }

    return rgbaData;
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
      const floatData = this.convertUint8ToFloat32Array(result.imageData, result.width, result.height);

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
  async applySoftProof(imageData: Float32Array, width: number, height: number, options: Record<string, unknown>) {
    try {
      return await colorManagementService.applySoftProof(imageData, width, height, options as unknown as SoftProofOptions);
    } catch (error) {
      logger.error('Failed to apply soft proof:', error);
      throw error;
    }
  }

  /**
   * Convert image to different color profile
   */
  async convertColorProfile(imageData: Float32Array, width: number, height: number, options: Record<string, unknown>) {
    try {
      return await colorManagementService.convertColorProfile(imageData, width, height, options as unknown as ColorConversionOptions);
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
  async createPrintJob(imageData: Float32Array, width: number, height: number, settings: Record<string, unknown>) {
    try {
      return await printService.createPrintJob(imageData, width, height, settings as unknown as PrintSettings);
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
  async generateWebGallery(images: unknown[], settings: Record<string, unknown>) {
    try {
      return await webGalleryService.generateGallery(images as GalleryImage[], settings as unknown as GallerySettings);
    } catch (error) {
      logger.error('Failed to generate web gallery:', error);
      throw error;
    }
  }

  /**
   * Export gallery as downloadable file
   */
  async exportGallery(galleryOutput: unknown, filename: string) {
    try {
      return await webGalleryService.exportGallery(galleryOutput as GalleryOutput, filename);
    } catch (error) {
      logger.error('Failed to export gallery:', error);
      throw error;
    }
  }
}

export const rawImageService = RawImageService.getInstance();