// RAW decode options — parameterise demosaic algorithm and highlight handling.
export type DemosaicAlgo = 'ahd' | 'dcb';
export type HighlightMode = 'off' | 'blend' | 'reconstruct';
export interface RawDecodeOptions {
  demosaic: DemosaicAlgo;
  highlightMode: HighlightMode;
  /**
   * Fit the decode to the shot's own embedded camera JPEG at decode time, so the
   * starting point matches the manufacturer's render (picture mode, adaptive
   * gradation, WB nuance included). Optional & undefined-as-false so edit states
   * persisted before this field existed keep their exact look on reopen.
   */
  cameraMatch?: boolean;
}
/** Default used when no options are supplied: DCB + blend + camera match. */
export const DEFAULT_RAW_DECODE_OPTIONS: RawDecodeOptions = {
  demosaic: 'dcb',
  highlightMode: 'blend',
  cameraMatch: true,
};

// Durable upscale INTENT persisted per-image (Q7): {scale, mode} when an upscale bake is active
// OR a reopened image carries a persisted-but-not-yet-reapplied upscale. `scale` is narrowed to
// the two scales the Enhance UI offers (EnhanceService.SUPPORTED_UPSCALE_SCALES / EnhanceParams).
export interface BakedUpscaleIntent {
  scale: 2 | 4;
  mode: 'ai' | 'standard';
}

// Electron API types
interface DialogFilter {
  name: string;
  extensions: string[];
}

interface OpenDialogOptions {
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
  filters?: DialogFilter[];
}

interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}

/**
 * Metadata payload accepted by the image writer (export embed) and the
 * standalone write-image-metadata IPC. This is the WRITE shape (a small set of
 * EXIF copyright/artist tags + IPTC-as-XMP fields), distinct from the richer
 * ImageMetadata READ shape returned by read-image-metadata.
 */
export interface EmbeddableMetadata {
  exif?: {
    Copyright?: string;
    Artist?: string;
    ImageDescription?: string;
    DateTimeOriginal?: string; // EXIF colon format: 'YYYY:MM:DD HH:MM:SS'
  };
  xmp?: {
    rights?: string;
    creator?: string[];
    title?: string;
    description?: string;
    subject?: string[];
    credit?: string;
    source?: string;
    webStatement?: string;
    usageTerms?: string;
  };
}

/**
 * Camera EXIF read from a proprietary RAW container's TIFF/EXIF IFDs (the
 * read-raw-metadata IPC). Flat, display-oriented shape — every field optional,
 * present only when the file carried it. `exposureTime` is in seconds (the
 * renderer formats it to a shutter string).
 */
export interface RawExifMetadata {
  make?: string;
  model?: string;
  iso?: number;
  exposureTime?: number;
  aperture?: number;
  focalLength?: number;
  dateTime?: string;
  lens?: string;
}

interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: string;
  message: string;
  detail?: string;
}

interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
}

interface SaveDialogReturnValue {
  canceled: boolean;
  filePath?: string;
}

interface MessageBoxReturnValue {
  response: number;
}

/** Per-file result of the `trash-items` IPC (Gallery Del → Recycle Bin). One
 *  entry per requested path, in the same order; `ok:false` carries the reason so
 *  a partially-failed batch keeps its failures in the session list with a toast. */
export interface TrashItemResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface ElectronAPI {
  // File operations
  fileExists: (path: string) => Promise<boolean>;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;

  // File system
  readFile: (filePath: string) => Promise<Buffer>;
  decodeRawFile: (filePath: string, options?: RawDecodeOptions) => Promise<{ data: ArrayBuffer; width: number; height: number; channels: number; bitDepth?: number }>;
  /** Fast progressive-open preview: the embedded JPEG, oriented + downscaled to fit maxDim
   *  (8-bit RGB). Rejects when no embedded preview exists. See ImageService progressive open. */
  decodeRawPreview: (filePath: string, maxDim?: number) => Promise<{ data: ArrayBuffer; width: number; height: number; channels: number; bitDepth?: number }>;
  /** Disk-persisted base cache (L2): read a decoded RAW base persisted from an earlier session for
   *  this exact (path, decode options). Returns the same shape as decodeRawFile, or null on a miss.
   *  See electron/baseCache.cjs + RawImageService.decodeRawFile. */
  baseCacheRead: (filePath: string, options?: RawDecodeOptions) => Promise<{ data: ArrayBuffer; width: number; height: number; channels: number; bitDepth?: number } | null>;
  /** Write-through a freshly-decoded RAW base to disk (fire-and-forget). Keyed by (path, options). */
  baseCacheWrite: (
    filePath: string,
    options: RawDecodeOptions | undefined,
    payload: { data: ArrayBuffer; width: number; height: number; channels?: number; bitDepth?: number },
  ) => Promise<boolean>;
  readImageAsDataURL: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, data: Buffer | string) => Promise<boolean>;
  writeLog: (logEntry: Record<string, unknown>) => Promise<boolean>;
  getLogFile: () => Promise<string>;

  // Directory operations
  getSystemDrives: () => Promise<Array<{
    id: string;
    name: string;
    path: string;
    type: 'drive' | 'folder';
  }>>;
  getFolderContents: (folderPath: string) => Promise<{
    folders: Array<{
      id: string;
      name: string;
      path: string;
      type: 'folder';
    }>;
    images: Array<{
      id: string;
      name: string;
      path: string;
      size: number;
      format: string;
      type: string;
      lastModified: number;
      dateModified: Date;
    }>;
  }>;

  // Folder watching
  watchFolder: (folderPath: string) => Promise<{ success: boolean; alreadyWatching?: boolean; error?: string }>;
  unwatchFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  onFolderChanged: (callback: (data: { folderPath: string; eventType: string; filename: string }) => void) => void;

  // Advanced file operations
  writeImageFile: (filePath: string, imageData: ArrayBuffer, format: string, options: {
    width: number;
    height: number;
    channels?: number;
    bitDepth?: number;
    colorSpace?: string;
    quality?: number;
    progressive?: boolean;
    compressionLevel?: number;
    compression?: string;
    lossless?: boolean;
    // Primary export resize done in the main process (sharp, off the renderer
    // thread). width/height describe the incoming full-res buffer; these are the
    // output dimensions sharp resizes to before encoding.
    targetWidth?: number;
    targetHeight?: number;
    targetFit?: string;
    resize?: {
      width?: number;
      height?: number;
      fit?: string;
    };
    metadata?: EmbeddableMetadata;
  }) => Promise<boolean>;
  getFileStats: (filePath: string) => Promise<{
    size: number;
    created: number;
    modified: number;
    isFile: boolean;
    isDirectory: boolean;
  }>;

  // Metadata operations
  readImageMetadata: (filePath: string) => Promise<{
    exif: import('./index').ExifData;
    iptc: import('./index').IptcData;
    xmp: import('./index').XmpData;
    icc: import('./index').IccProfile;
    thumbnail: import('./index').ThumbnailData;
  }>;
  /** Camera EXIF parsed from a proprietary RAW container's TIFF/EXIF IFDs in the
   *  main process (exifreader cannot parse ORF/CR2/NEF/ARW/DNG/...). Flat shape;
   *  every field optional; null when nothing usable is found. See
   *  electron/rawMetadata.cjs + CameraMetadataService. */
  readRawMetadata: (filePath: string) => Promise<RawExifMetadata | null>;
  writeImageMetadata: (filePath: string, metadata: EmbeddableMetadata) => Promise<boolean>;
  writeImageRating: (filePath: string, rating: number) => Promise<{ ok: boolean; method?: string; path?: string; error?: string }>;
  readImageRating: (filePath: string) => Promise<number | null>;
  /** Move files to the OS trash / Windows Recycle Bin (NEVER a permanent delete);
   *  returns a per-path { path, ok, error } result. Used by the Gallery Del flow. */
  trashItems: (filePaths: string[]) => Promise<TrashItemResult[]>;
  /** Read-only reveal — deny-list deliberately skipped, see main.cjs. Never writes/deletes.
   *  Used by the Gallery tile context menu's "Show in Explorer" (Task Q5). */
  showItemInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  storeGet: <T = unknown>(key: string) => Promise<T | null>;
  storeSet: (key: string, value: unknown) => Promise<boolean>;
  storeDelete: (key: string) => Promise<boolean>;

  // Menu event listeners
  onFileOpen: (callback: (filePath: string) => void) => void;
  onFileImport: (callback: (filePaths: string[]) => void) => void;
  onFileExport: (callback: () => void) => void;

  onEditUndo: (callback: () => void) => void;
  onEditRedo: (callback: () => void) => void;
  onEditResetAll: (callback: () => void) => void;

  onViewZoomIn: (callback: () => void) => void;
  onViewZoomOut: (callback: () => void) => void;
  onViewFitWindow: (callback: () => void) => void;
  onViewActualSize: (callback: () => void) => void;

  // App lifecycle events
  onAppCloseRequest: (callback: () => void) => void;
  onAppCleanup: (callback: () => void) => void;
  sendAppCloseResponse: (shouldClose: boolean, reason?: string) => void;

  // Platform info
  platform: string;

  // Window controls (for frameless window)
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;

  // Splash screen
  splashProgress: (progress: number, message: string) => Promise<void>;
  appReady: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAppInfo: () => Promise<{
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    repository: string;
    electron: string;
    chrome: string;
    node: string;
    v8: string;
    platform: string;
    arch: string;
  }>;
  openExternalUrl: (url: string) => Promise<boolean>;
  onSplashProgress: (callback: (data: { progress?: number; message?: string; error?: string }) => void) => void;

  // AI super-resolution upscale
  aiUpscaleAvailable: () => Promise<boolean>;
  aiUpscale: (
    rgba: Uint8Array,
    width: number,
    height: number,
    scale: 2 | 4,
  ) => Promise<{ data: Uint8Array; width: number; height: number; backend: string | null }>;
  onAiUpscaleProgress: (callback: (p: { done: number; total: number }) => void) => () => void;

  // AI motion deblur (NAFNet; DirectML-gated — resolves false on a CPU-only backend)
  aiDeblurAvailable: () => Promise<boolean>;
  aiDeblur: (
    rgba: Uint8Array,
    width: number,
    height: number,
  ) => Promise<{ data: Uint8Array; width: number; height: number; backend: string | null }>;
  onAiDeblurProgress: (callback: (p: { done: number; total: number }) => void) => () => void;

  // Cleanup
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Helper to check if running in Electron
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};