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
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;

  // File system
  readFile: (filePath: string) => Promise<Buffer>;
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

  // Advanced file operations
  writeImageFile: (filePath: string, imageData: ArrayBuffer, format: string, options: {
    width: number;
    height: number;
    channels?: number;
    quality?: number;
    progressive?: boolean;
    compressionLevel?: number;
    compression?: string;
    lossless?: boolean;
    resize?: {
      width?: number;
      height?: number;
      fit?: string;
    };
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
    exif: Record<string, any>;
    iptc: Record<string, any>;
    xmp: Record<string, any>;
    icc: Record<string, any>;
    thumbnail: any;
  }>;
  writeImageMetadata: (filePath: string, metadata: Record<string, any>) => Promise<boolean>;

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

  // Platform info
  platform: string;

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