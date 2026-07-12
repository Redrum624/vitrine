import type { ElectronAPI } from '../types/electron';

class ElectronService {
  private electronAPI: ElectronAPI | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      this.electronAPI = window.electronAPI;
      this.setupMenuListeners();
    }
  }

  public isElectron(): boolean {
    return this.electronAPI !== null;
  }

  private setupMenuListeners() {
    if (!this.electronAPI) return;

    // File menu handlers
    this.electronAPI.onFileOpen((filePath: string) => {
      this.handleFileOpen(filePath);
    });

    this.electronAPI.onFileImport((filePaths: string[]) => {
      this.handleFileImport(filePaths);
    });

    this.electronAPI.onFileExport(() => {
      this.handleFileExport();
    });

    // Edit menu handlers
    this.electronAPI.onEditUndo(() => {
      this.handleUndo();
    });

    this.electronAPI.onEditRedo(() => {
      this.handleRedo();
    });

    this.electronAPI.onEditResetAll(() => {
      this.handleResetAll();
    });

    // View menu handlers
    this.electronAPI.onViewZoomIn(() => {
      this.handleZoomIn();
    });

    this.electronAPI.onViewZoomOut(() => {
      this.handleZoomOut();
    });

    this.electronAPI.onViewFitWindow(() => {
      this.handleFitWindow();
    });

    this.electronAPI.onViewActualSize(() => {
      this.handleActualSize();
    });

    // App lifecycle handlers
    this.electronAPI.onAppCloseRequest(() => {
      this.handleAppCloseRequest();
    });

    this.electronAPI.onAppCleanup(() => {
      this.handleAppCleanup();
    });
  }

  // File operations
  public async openFile(): Promise<string | null> {
    if (!this.electronAPI) {
      // Fallback to web file input
      return this.webFileOpen();
    }

    try {
      const result = await this.electronAPI.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'] },
          { name: 'RAW Files', extensions: ['cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }

    return null;
  }

  public async saveFile(data: Buffer | string, defaultName: string = 'image.jpg'): Promise<string | null> {
    if (!this.electronAPI) {
      // Fallback to web download
      this.webFileSave(data, defaultName);
      return null;
    }

    try {
      const result = await this.electronAPI.showSaveDialog({
        defaultPath: defaultName,
        filters: [
          { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
          { name: 'PNG', extensions: ['png'] },
          { name: 'TIFF', extensions: ['tiff', 'tif'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        await this.electronAPI.writeFile(result.filePath, data);
        return result.filePath;
      }
    } catch (error) {
      console.error('Error saving file:', error);
    }

    return null;
  }

  public async readFile(filePath: string): Promise<Buffer | null> {
    if (!this.electronAPI) {
      console.warn('File reading not available in web mode');
      return null;
    }

    try {
      return await this.electronAPI.readFile(filePath);
    } catch (error) {
      console.error('Error reading file:', error);
      return null;
    }
  }

  // Menu action handlers - to be implemented by the app
  private handleFileOpen(filePath: string) {
    window.dispatchEvent(new CustomEvent('electron-file-open', { detail: filePath }));
  }

  private handleFileImport(filePaths: string[]) {
    window.dispatchEvent(new CustomEvent('electron-file-import', { detail: filePaths }));
  }

  private handleFileExport() {
    window.dispatchEvent(new CustomEvent('electron-file-export'));
  }

  private handleUndo() {
    window.dispatchEvent(new CustomEvent('electron-edit-undo'));
  }

  private handleRedo() {
    window.dispatchEvent(new CustomEvent('electron-edit-redo'));
  }

  private handleResetAll() {
    window.dispatchEvent(new CustomEvent('electron-edit-reset-all'));
  }

  private handleZoomIn() {
    window.dispatchEvent(new CustomEvent('electron-view-zoom-in'));
  }

  private handleZoomOut() {
    window.dispatchEvent(new CustomEvent('electron-view-zoom-out'));
  }

  private handleFitWindow() {
    window.dispatchEvent(new CustomEvent('electron-view-fit-window'));
  }

  private handleActualSize() {
    window.dispatchEvent(new CustomEvent('electron-view-actual-size'));
  }

  private handleAppCloseRequest() {
    window.dispatchEvent(new CustomEvent('electron-app-close-request'));
  }

  private handleAppCleanup() {
    window.dispatchEvent(new CustomEvent('electron-app-cleanup'));
  }

  public sendCloseResponse(shouldClose: boolean, reason?: string) {
    if (this.electronAPI) {
      this.electronAPI.sendAppCloseResponse(shouldClose, reason);
    }
  }

  // Web fallbacks
  private async webFileOpen(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const url = URL.createObjectURL(file);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  private webFileSave(data: Buffer | string, filename: string) {
    const dataArray = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const blob = new Blob([dataArray], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  public cleanup() {
    if (this.electronAPI) {
      // Clean up listeners
      this.electronAPI.removeAllListeners('file-open');
      this.electronAPI.removeAllListeners('file-import');
      this.electronAPI.removeAllListeners('file-export');
      this.electronAPI.removeAllListeners('edit-undo');
      this.electronAPI.removeAllListeners('edit-redo');
      this.electronAPI.removeAllListeners('edit-reset-all');
      this.electronAPI.removeAllListeners('view-zoom-in');
      this.electronAPI.removeAllListeners('view-zoom-out');
      this.electronAPI.removeAllListeners('view-fit-window');
      this.electronAPI.removeAllListeners('view-actual-size');
    }
  }
}

// Singleton instance
export const electronService = new ElectronService();