import { logger } from '../utils/Logger';

// Define the LibRaw interface based on the actual libraw-wasm API
interface LibRawInstance {
  open(buffer: Uint8Array, options?: LibRawOptions): Promise<void>;
  metadata(fullOutput?: boolean): Promise<RawMetadata>;
  imageData(): Promise<Uint8Array>;
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
  // Basic settings
  bright?: number; // brightness
  threshold?: number; // wavelet denoise threshold

  // Size and quality
  halfSize?: boolean; // output at 1/2 size
  fourColorRgb?: boolean; // separate interpolation for two green channels
  highlight?: number; // highlight mode (0..9)
  userQual?: number; // interpolation quality (0..12)

  // White balance
  useAutoWb?: boolean; // auto white balance
  useCameraWb?: boolean; // camera's recorded WB
  userMul?: number[]; // user WB multipliers (r, g, b, g2)

  // Color space
  outputColor?: number; // output colorspace (0..8) (0=raw,1=sRGB,2=Adobe, etc.)
  outputBps?: number; // 8 or 16 bits per sample

  // Advanced
  userBlack?: number; // user black level
  userSat?: number; // saturation level
  expCorrec?: boolean; // enable exposure correction
  expShift?: number; // exposure shift in linear scale
  expPreser?: number; // preserve highlights when expShift>1 (0..1)

  // Geometry
  greybox?: number[]; // rectangle (x,y,width,height) for WB calc
  cropbox?: number[]; // cropping rectangle (left, top, w, h)
  gamm?: number[]; // gamma correction [power, toe_slope]
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
      this.LibRaw = (LibRawModule.default || LibRawModule) as unknown as LibRawConstructor;

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
        userQual: 3, // AHD (Adaptive Homogeneity-Directed)
        halfSize: false, // Full resolution
        fourColorRgb: false, // Standard RGB

        // Color settings - most neutral processing
        outputColor: 0, // RAW colorspace (no color conversion)
        outputBps: 8, // 8-bit output for web

        // White balance - disable all white balance to preserve original colors
        useCameraWb: false,
        useAutoWb: false,

        // Exposure and gamma correction - completely linear processing
        expCorrec: false, // Disable exposure correction
        bright: 1.0, // Default brightness
        gamm: [1.0, 1.0], // Linear gamma (no tone curve applied)

        // Noise and enhancement
        threshold: 100, // Wavelet denoising threshold
        userBlack: 0, // Auto black level
        userSat: 32767, // Auto saturation

        ...options // Override with user-provided options
      };

      // Open the RAW file with settings (libraw-wasm combines open and configure)
      await rawInstance.open(uint8Buffer, defaultOptions);

      // Get metadata
      const metadata = await rawInstance.metadata();
      logger.debug('RAW metadata extracted:', {
        make: metadata.make,
        model: metadata.model,
        dimensions: `${metadata.width}x${metadata.height}`,
        iso: metadata.iso,
        // colors: metadata.colors // may not be available in all versions
      });

      // Process and get image data
      const processedData = await rawInstance.imageData();

      const processingTime = performance.now() - startTime;
      logger.info(`RAW processing completed in ${processingTime.toFixed(2)}ms`);

      // RGB channels (libraw-wasm typically outputs RGB)
      const channels = 3;

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

    }
    // Note: libraw-wasm handles cleanup automatically
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
          userQual: 0, // Linear interpolation (fastest)
          halfSize: true, // Half resolution for speed
          useCameraWb: true,
          outputBps: 8,
          bright: 1.0
        };
        break;

      case 'balanced':
        options = {
          userQual: 1, // VNG interpolation (good balance)
          halfSize: false,
          useCameraWb: true,
          outputBps: 8,
          bright: 1.0,
          threshold: 100
        };
        break;

      case 'quality':
        options = {
          userQual: 3, // AHD interpolation (highest quality)
          halfSize: false,
          fourColorRgb: false,
          useCameraWb: true,
          outputBps: 8, // Keep 8-bit for web compatibility
          bright: 1.0,
          threshold: 50, // Lower threshold for better noise reduction
          gamm: [1.0, 4.5]
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