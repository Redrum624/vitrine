const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

  // File system
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readImageAsDataURL: (filePath) => ipcRenderer.invoke('read-image-as-data-url', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  writeLog: (logEntry) => ipcRenderer.invoke('write-log', logEntry),

  // Directory operations
  getSystemDrives: () => ipcRenderer.invoke('get-system-drives'),
  getFolderContents: (folderPath) => ipcRenderer.invoke('get-folder-contents', folderPath),

  // Advanced file operations
  writeImageFile: (filePath, imageData, format, options) =>
    ipcRenderer.invoke('write-image-file', filePath, imageData, format, options),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),

  // Metadata operations
  readImageMetadata: (filePath) => ipcRenderer.invoke('read-image-metadata', filePath),
  writeImageMetadata: (filePath, metadata) => ipcRenderer.invoke('write-image-metadata', filePath, metadata),

  // Menu actions - listen for events from main process
  onFileOpen: (callback) => ipcRenderer.on('file-open', (event, filePath) => callback(filePath)),
  onFileImport: (callback) => ipcRenderer.on('file-import', (event, filePaths) => callback(filePaths)),
  onFileExport: (callback) => ipcRenderer.on('file-export', () => callback()),

  onEditUndo: (callback) => ipcRenderer.on('edit-undo', () => callback()),
  onEditRedo: (callback) => ipcRenderer.on('edit-redo', () => callback()),
  onEditResetAll: (callback) => ipcRenderer.on('edit-reset-all', () => callback()),

  onViewZoomIn: (callback) => ipcRenderer.on('view-zoom-in', () => callback()),
  onViewZoomOut: (callback) => ipcRenderer.on('view-zoom-out', () => callback()),
  onViewFitWindow: (callback) => ipcRenderer.on('view-fit-window', () => callback()),
  onViewActualSize: (callback) => ipcRenderer.on('view-actual-size', () => callback()),

  // Platform info
  platform: process.platform,

  // Logging
  getLogFile: () => ipcRenderer.invoke('get-log-file'),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});

// Security: Remove node integration from window object
delete window.module;
delete window.exports;
delete window.require;