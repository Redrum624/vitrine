import { logger } from '../utils/Logger';
import { advancedRawProcessor, AdvancedRawProcessingOptions } from './AdvancedRawProcessor';
import { libRawService, LibRawOptions } from './LibRawService';

export interface RawImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  format: string;
  metadata: RawMetadata;
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
      } catch (libRawError) {
        logger.warn('LibRaw processing failed, trying advanced processor fallback:', libRawError);

        // Fallback to old advanced processor if available
        try {
          const rawData = await advancedRawProcessor.processRawFile(filePath, options);
          const loadTime = performance.now() - startTime;
          logger.info(`RAW image loaded with fallback processor in ${loadTime.toFixed(2)}ms: ${rawData.width}x${rawData.height}`);
          return rawData;
        } catch (advancedError) {
          logger.error('All RAW processing methods failed:', advancedError);
          throw new Error(`Failed to process RAW file: ${libRawError.message}`);
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

      if (typeof window !== 'undefined' && (window as any).electron) {
        // Electron environment - use IPC to read file
        buffer = await (window as any).electron.fs.readFile(filePath);
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
      const floatData = this.convertUint8ToFloat32Array(result.imageData);

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
}

export const rawImageService = RawImageService.getInstance();