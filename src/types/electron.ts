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

export interface ElectronAPI {
  // File operations
  fileExists: (path: string) => Promise<boolean>;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;

  // File system
  readFile: (filePath: string) => Promise<Buffer>;
  readFileBuffer: (filePath: string) => Promise<ArrayBuffer>;
  decodeRawFile: (filePath: string) => Promise<{ data: ArrayBuffer; width: number; height: number; channels: number; bitDepth?: number }>;
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
  writeImageMetadata: (filePath: string, metadata: EmbeddableMetadata) => Promise<boolean>;
  writeImageRating: (filePath: string, rating: number) => Promise<{ ok: boolean; method?: string; path?: string; error?: string }>;
  readImageRating: (filePath: string) => Promise<number | null>;
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
  onSplashProgress: (callback: (data: { progress?: number; message?: string; error?: string }) => void) => void;

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