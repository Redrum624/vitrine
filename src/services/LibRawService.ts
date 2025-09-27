import { logger } from '../utils/Logger';

// Define the LibRaw interface based on the package documentation
interface LibRawInstance {
  open(buffer: Uint8Array): Promise<void>;
  metadata(): Promise<RawMetadata>;
  imageData(): Promise<Uint8Array>;
  configure(options: LibRawOptions): void;
  close(): void;
}

interface LibRawConstructor {
  new(): LibRawInstance;
}

export interface RawMetadata {
  make: string;
  model: string;
  width: number;
  height: number;
  iso: number;
  aperture: number;
  shutter: number;
  focal_length: number;
  timestamp: number;
  colors: number;
  color_desc: string;
  filters: number;
  white_balance: {
    camera_wb: number[];
    daylight_wb: number[];
  };
  [key: string]: unknown; // Index signature for Record compatibility
}

export interface LibRawOptions {
  // White balance settings
  use_camera_wb?: boolean;
  use_auto_wb?: boolean;
  greybox?: [number, number, number, number]; // x, y, width, height
  user_wb?: number[]; // [r_multiplier, g_multiplier, b_multiplier, g2_multiplier]

  // Quality settings
  user_qual?: number; // 0=linear, 1=VNG, 2=PPG, 3=AHD, 4=DCB, 11=DHT, 12=AAHD
  half_size?: boolean;
  four_color_rgb?: boolean;

  // Color settings
  user_cspace?: number; // 0=raw, 1=sRGB, 2=Adobe, 3=Wide, 4=ProPhoto, 5=XYZ
  output_color?: number;
  output_bps?: number; // 8 or 16

  // Exposure correction
  exp_correc?: boolean;
  exp_shift?: number;
  exp_preser?: number;

  // Brightness and gamma
  bright?: number;
  user_gamma?: number[];

  // Noise reduction and sharpening
  threshold?: number;
  aber?: number[];
  user_black?: number;
  user_sat?: number;

  // Cropping
  cropbox?: [number, number, number, number]; // x, y, width, height
}

export interface ProcessedRawData {
  imageData: Uint8Array;
  width: number;
  height: number;
  channels: number;
  metadata: RawMetadata;
  processingTime: number;
}

export class LibRawService {
  private static instance: LibRawService;
  private LibRaw: LibRawConstructor | null = null;
  private isInitialized = false;

  static getInstance(): LibRawService {
    if (!LibRawService.instance) {
      LibRawService.instance = new LibRawService();
    }
    return LibRawService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('LibRaw WebAssembly service already initialized, skipping...');
      return;
    }

    try {
      logger.info('Initializing LibRaw WebAssembly service...');
      const startTime = performance.now();

      // Import the LibRaw WebAssembly module
      const LibRawModule = await import('libraw-wasm');
      this.LibRaw = (LibRawModule.default || LibRawModule) as LibRawConstructor;

      this.isInitialized = true;
      const initTime = performance.now() - startTime;
      logger.info(`LibRaw WebAssembly service initialized in ${initTime.toFixed(2)}ms`);

    } catch (error) {
      logger.error('Failed to initialize LibRaw WebAssembly service:', error);
      throw new Error(`LibRaw initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async processRawFile(
    buffer: ArrayBuffer | Uint8Array,
    options: LibRawOptions = {}
  ): Promise<ProcessedRawData> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.LibRaw) {
      throw new Error('LibRaw not initialized');
    }

    const startTime = performance.now();
    let rawInstance: LibRawInstance | null = null;

    try {
      logger.info(`Processing RAW file with LibRaw (${buffer.byteLength} bytes)...`);

      // Create LibRaw instance
      rawInstance = new this.LibRaw();

      // Convert buffer to Uint8Array if needed
      const uint8Buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

      // Configure processing options with professional defaults
      const defaultOptions: LibRawOptions = {
        // Quality settings - use high-quality demosaicing
        user_qual: 3, // AHD (Adaptive Homogeneity-Directed)
        half_size: false, // Full resolution
        four_color_rgb: false, // Standard RGB

        // Color settings - sRGB output for web compatibility
        user_cspace: 1, // sRGB
        output_color: 1, // sRGB
        output_bps: 8, // 8-bit output for web

        // White balance - use camera settings by default
        use_camera_wb: true,
        use_auto_wb: false,

        // Exposure and gamma correction
        exp_correc: false, // Let our modules handle exposure
        bright: 1.0, // Default brightness
        user_gamma: [1.0, 4.5], // Standard sRGB gamma

        // Noise and enhancement
        threshold: 100, // Wavelet denoising threshold
        user_black: 0, // Auto black level
        user_sat: 32767, // Auto saturation

        ...options // Override with user-provided options
      };

      rawInstance.configure(defaultOptions);

      // Open the RAW file
      await rawInstance.open(uint8Buffer);

      // Get metadata
      const metadata = await rawInstance.metadata();
      logger.debug('RAW metadata extracted:', {
        make: metadata.make,
        model: metadata.model,
        dimensions: `${metadata.width}x${metadata.height}`,
        iso: metadata.iso,
        colors: metadata.colors
      });

      // Process and get image data
      const processedData = await rawInstance.imageData();

      const processingTime = performance.now() - startTime;
      logger.info(`RAW processing completed in ${processingTime.toFixed(2)}ms`);

      // Determine channels from metadata
      const channels = metadata.colors === 1 ? 1 : (defaultOptions.output_bps === 16 ? 3 : 3);

      return {
        imageData: processedData,
        width: metadata.width,
        height: metadata.height,
        channels,
        metadata,
        processingTime
      };

    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error(`RAW processing failed after ${processingTime.toFixed(2)}ms:`, error);

      throw new Error(`LibRaw processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

    } finally {
      // Clean up LibRaw instance
      if (rawInstance) {
        try {
          rawInstance.close();
        } catch (closeError) {
          logger.warn('Error closing LibRaw instance:', closeError);
        }
      }
    }
  }

  // Convenience method for common RAW formats
  async processRawFileWithPreset(
    buffer: ArrayBuffer | Uint8Array,
    preset: 'fast' | 'balanced' | 'quality' | 'custom',
    customOptions?: LibRawOptions
  ): Promise<ProcessedRawData> {
    let options: LibRawOptions;

    switch (preset) {
      case 'fast':
        options = {
          user_qual: 0, // Linear interpolation (fastest)
          half_size: true, // Half resolution for speed
          use_camera_wb: true,
          output_bps: 8,
          bright: 1.0
        };
        break;

      case 'balanced':
        options = {
          user_qual: 1, // VNG interpolation (good balance)
          half_size: false,
          use_camera_wb: true,
          output_bps: 8,
          bright: 1.0,
          threshold: 100
        };
        break;

      case 'quality':
        options = {
          user_qual: 3, // AHD interpolation (highest quality)
          half_size: false,
          four_color_rgb: false,
          use_camera_wb: true,
          output_bps: 8, // Keep 8-bit for web compatibility
          bright: 1.0,
          threshold: 50, // Lower threshold for better noise reduction
          user_gamma: [1.0, 4.5]
        };
        break;

      case 'custom':
        options = customOptions || {};
        break;

      default:
        options = {};
    }

    return this.processRawFile(buffer, options);
  }

  // Get supported RAW file extensions
  getSupportedExtensions(): string[] {
    return [
      '.cr2', '.cr3', // Canon
      '.nef', '.nrw', // Nikon
      '.arw', '.srf', '.sr2', // Sony
      '.orf', // Olympus
      '.rw2', // Panasonic
      '.dng', // Adobe Digital Negative
      '.raf', // Fujifilm
      '.x3f', // Sigma
      '.3fr', // Hasselblad
      '.fff', // Imacon
      '.mef', // Mamiya
      '.mos', // Leaf
      '.mrw', // Minolta
      '.pef', '.ptx', // Pentax
      '.r3d', // RED
      '.rwl' // Leica
    ];
  }

  // Check if file extension is supported
  isSupportedExtension(filename: string): boolean {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return this.getSupportedExtensions().includes(ext);
  }

  // Detect RAW format from buffer (simplified detection)
  async detectRawFormat(buffer: Uint8Array): Promise<string | null> {
    // Check magic bytes for common RAW formats
    const view = new DataView(buffer.buffer, buffer.byteOffset, Math.min(buffer.length, 64));

    try {
      // Canon CR2/CR3
      if (view.getUint16(0) === 0x4949 || view.getUint16(0) === 0x4D4D) {
        const magic = new TextDecoder().decode(buffer.slice(8, 12));
        if (magic === 'CR\x02\x00') return 'Canon CR2';
        if (magic === 'CR\x03\x00') return 'Canon CR3';
      }

      // Nikon NEF
      if (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A) {
        return 'Nikon NEF';
      }

      // Sony ARW
      if (new TextDecoder().decode(buffer.slice(0, 4)) === 'SONY') {
        return 'Sony ARW';
      }

      // Olympus ORF
      if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x52 && buffer[3] === 0x4F) {
        return 'Olympus ORF';
      }

      // Adobe DNG
      if (view.getUint16(0) === 0x4949 || view.getUint16(0) === 0x4D4D) {
        // Check for DNG version tag
        return 'Adobe DNG';
      }

      return 'Unknown RAW';

    } catch (error) {
      logger.warn('Error detecting RAW format:', error);
      return null;
    }
  }

  // Get processing statistics
  getStats() {
    return {
      isInitialized: this.isInitialized,
      supportedFormats: this.getSupportedExtensions().length,
      version: 'LibRaw WebAssembly'
    };
  }

  // Cleanup resources
  dispose(): void {
    logger.info('Disposing LibRaw WebAssembly service...');
    this.LibRaw = null;
    this.isInitialized = false;
  }
}

// Export singleton instance
export const libRawService = LibRawService.getInstance();