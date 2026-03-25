import { logger } from '../utils/Logger';

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
  [key: string]: unknown;
}

export interface LibRawOptions {
  bright?: number;
  threshold?: number;
  halfSize?: boolean;
  fourColorRgb?: boolean;
  highlight?: number;
  userQual?: number;
  useAutoWb?: boolean;
  useCameraWb?: boolean;
  userMul?: number[];
  outputColor?: number;
  outputBps?: number;
  userBlack?: number;
  userSat?: number;
  expCorrec?: boolean;
  expShift?: number;
  expPreser?: number;
  greybox?: number[];
  cropbox?: number[];
  gamm?: number[];
}

export interface ProcessedRawData {
  imageData: Uint8Array;
  width: number;
  height: number;
  channels: number;
  metadata: RawMetadata;
  processingTime: number;
}

/**
 * LibRaw WebAssembly service.
 *
 * Each RAW file is processed in a disposable <iframe> that loads
 * libraw-wasm in a completely isolated JS/WASM context. This is
 * necessary because Emscripten's SharedArrayBuffer/pthread runtime
 * retains global heap state that corrupts subsequent decodes if
 * done within the same page context.
 *
 * The iframe communicates via postMessage and is destroyed after
 * each file, guaranteeing a clean WASM environment every time.
 */
export class LibRawService {
  private static instance: LibRawService;

  static getInstance(): LibRawService {
    if (!LibRawService.instance) {
      LibRawService.instance = new LibRawService();
    }
    return LibRawService.instance;
  }

  /** Kept for API compatibility — the iframe self-initializes. */
  async initialize(): Promise<void> {
    logger.info('LibRaw service ready (iframe-based processing)');
  }

  /**
   * Process a RAW file buffer via an isolated iframe.
   */
  async processRawFile(
    buffer: ArrayBuffer | Uint8Array,
    options: LibRawOptions = {}
  ): Promise<ProcessedRawData> {
    const startTime = performance.now();
    const bytes: ArrayBuffer = buffer instanceof Uint8Array
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      : buffer;

    logger.info(`Processing RAW file with LibRaw iframe (${bytes.byteLength} bytes)...`);

    const defaultOptions = {
      userQual: 3,
      useCameraWb: true,
      outputBps: 8,
      outputColor: 1,
      ...options
    };

    try {
      const result = await this.processInIframe(bytes, defaultOptions);
      const processingTime = performance.now() - startTime;

      logger.info(`RAW processing completed in ${processingTime.toFixed(0)}ms: ${result.width}x${result.height}, ${result.imageData.length} bytes`);

      return {
        imageData: result.imageData,
        width: result.width,
        height: result.height,
        channels: result.channels,
        metadata: result.metadata as RawMetadata,
        processingTime,
      };
    } catch (error) {
      const processingTime = performance.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`RAW processing failed after ${processingTime.toFixed(0)}ms: ${msg}`);
      throw new Error(`LibRaw processing failed: ${msg}`);
    }
  }

  /**
   * Spawn a disposable iframe, send the buffer, wait for the result,
   * then destroy the iframe. Each call gets a 100% fresh WASM context.
   */
  private processInIframe(
    buffer: ArrayBuffer,
    options: LibRawOptions
  ): Promise<{ imageData: Uint8Array; width: number; height: number; channels: number; metadata: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = '/libraw-worker-frame.html';

      const TIMEOUT_MS = 60_000;
      let timer: ReturnType<typeof setTimeout>;
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        try { document.body.removeChild(iframe); } catch { /* already removed */ }
      };

      const onMessage = (event: MessageEvent) => {
        // Only accept messages from our iframe
        if (event.source !== iframe.contentWindow) return;
        const data = event.data;

        if (data?.type === 'ready') {
          // Iframe loaded and LibRaw initialised — send the file
          const bufferCopy = buffer.slice(0); // copy so transfer doesn't affect caller
          iframe.contentWindow!.postMessage(
            { type: 'process', id: 1, buffer: bufferCopy, options },
            '*',
            [bufferCopy]
          );
        } else if (data?.type === 'init-error') {
          cleanup();
          reject(new Error(`LibRaw iframe init failed: ${data.message}`));
        } else if (data?.type === 'result') {
          cleanup();
          const pixels = data.imageData instanceof Uint8Array
            ? data.imageData
            : new Uint8Array(data.imageData);
          resolve({
            imageData: pixels,
            width: data.width,
            height: data.height,
            channels: data.channels,
            metadata: data.metadata,
          });
        } else if (data?.type === 'error') {
          cleanup();
          reject(new Error(data.message));
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('LibRaw processing timed out (60s)'));
      }, TIMEOUT_MS);

      window.addEventListener('message', onMessage);
      document.body.appendChild(iframe);
    });
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
        options = { userQual: 0, halfSize: true, useCameraWb: true, outputBps: 8, bright: 1.0 };
        break;
      case 'balanced':
        options = { userQual: 1, useCameraWb: true, outputBps: 8, bright: 1.0 };
        break;
      case 'quality':
        options = { userQual: 3, useCameraWb: true, outputBps: 8 };
        break;
      case 'custom':
        options = customOptions || {};
        break;
      default:
        options = {};
    }

    return this.processRawFile(buffer, options);
  }

  getSupportedExtensions(): string[] {
    return [
      '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
      '.orf', '.rw2', '.dng', '.raf', '.x3f', '.3fr', '.fff',
      '.mef', '.mos', '.mrw', '.pef', '.ptx', '.r3d', '.rwl'
    ];
  }

  isSupportedExtension(filename: string): boolean {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return this.getSupportedExtensions().includes(ext);
  }

  async detectRawFormat(buffer: Uint8Array): Promise<string | null> {
    const view = new DataView(buffer.buffer, buffer.byteOffset, Math.min(buffer.length, 64));
    try {
      if (view.getUint16(0) === 0x4949 || view.getUint16(0) === 0x4D4D) {
        const magic = new TextDecoder().decode(buffer.slice(8, 12));
        if (magic === 'CR\x02\x00') return 'Canon CR2';
        if (magic === 'CR\x03\x00') return 'Canon CR3';
      }
      if (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A) return 'Nikon NEF';
      if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x52 && buffer[3] === 0x4F) return 'Olympus ORF';
      return 'Unknown RAW';
    } catch (error) {
      logger.warn('Error detecting RAW format:', error);
      return null;
    }
  }

  getStats() {
    return {
      isInitialized: true,
      supportedFormats: this.getSupportedExtensions().length,
      version: 'LibRaw WebAssembly (iframe-isolated)'
    };
  }

  dispose(): void {
    logger.info('Disposing LibRaw WebAssembly service...');
  }
}

// Export singleton instance
export const libRawService = LibRawService.getInstance();
