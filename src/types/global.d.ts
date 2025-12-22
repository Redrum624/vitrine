// Global type declarations for extended browser APIs

// Electron API exposed via preload script
interface ElectronAPI {
  showOpenDialog: (options: {
    properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[];
    filters?: { name: string; extensions: string[] }[];
    defaultPath?: string;
    title?: string;
  }) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
  showSaveDialog?: (options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    title?: string;
  }) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  // Window controls (for frameless window)
  windowMinimize?: () => Promise<void>;
  windowMaximize?: () => Promise<void>;
  windowClose?: () => Promise<void>;
  windowIsMaximized?: () => Promise<boolean>;
}

// Extend Window interface for Electron
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Chrome-specific Performance memory API
export interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

// Type for performance object with optional Chrome memory API
export interface PerformanceWithMemory {
  memory?: PerformanceMemory;
}

// Re-export for use in TypeScript files
export { ElectronAPI };
