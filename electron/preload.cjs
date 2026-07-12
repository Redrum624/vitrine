const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  fileExists: (p) => ipcRenderer.invoke('file-exists', p),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

  // File system
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  decodeRawFile: (filePath, options) => ipcRenderer.invoke('decode-raw-file', filePath, options),
  decodeRawPreview: (filePath, maxDim) => ipcRenderer.invoke('decode-raw-preview', filePath, maxDim),
  // Disk-persisted base cache (L2): read a decode persisted from an earlier session; write-through
  // a fresh decode (fire-and-forget). Keyed by (path, decode options). See electron/baseCache.cjs.
  baseCacheRead: (filePath, options) => ipcRenderer.invoke('base-cache-read', filePath, options),
  baseCacheWrite: (filePath, options, payload) => ipcRenderer.invoke('base-cache-write', filePath, options, payload),
  readImageAsDataURL: (filePath) => ipcRenderer.invoke('read-image-as-data-url', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  writeLog: (logEntry) => ipcRenderer.invoke('write-log', logEntry),

  // Directory operations
  getSystemDrives: () => ipcRenderer.invoke('get-system-drives'),
  getFolderContents: (folderPath) => ipcRenderer.invoke('get-folder-contents', folderPath),

  // Folder watching
  watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
  unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
  onFolderChanged: (callback) => ipcRenderer.on('folder-changed', (event, data) => callback(data)),

  // Advanced file operations
  writeImageFile: (filePath, imageData, format, options) =>
    ipcRenderer.invoke('write-image-file', filePath, imageData, format, options),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),

  // Metadata operations
  readImageMetadata: (filePath) => ipcRenderer.invoke('read-image-metadata', filePath),
  // Camera EXIF from a proprietary RAW container (parsed from the file's TIFF/EXIF
  // IFDs in the main process, since exifreader cannot parse these containers).
  readRawMetadata: (filePath) => ipcRenderer.invoke('read-raw-metadata', filePath),
  writeImageMetadata: (filePath, metadata) => ipcRenderer.invoke('write-image-metadata', filePath, metadata),
  writeImageRating: (filePath, rating) => ipcRenderer.invoke('write-image-rating', filePath, rating),
  readImageRating: (filePath) => ipcRenderer.invoke('read-image-rating', filePath),
  // Move files to the OS trash / Windows Recycle Bin (never a permanent delete).
  trashItems: (filePaths) => ipcRenderer.invoke('trash-items', filePaths),
  // Read-only reveal — deny-list deliberately skipped, see main.cjs.
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

  // Generic durable JSON store (userData; survives app updates)
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

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

  // App lifecycle events
  onAppCloseRequest: (callback) => ipcRenderer.on('app-close-request', () => callback()),
  onAppCleanup: (callback) => ipcRenderer.on('app-cleanup', () => callback()),
  sendAppCloseResponse: (shouldClose, reason) => ipcRenderer.send('app-close-response', shouldClose, reason),

  // Platform info
  platform: process.platform,

  // Window controls (for frameless window)
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Splash screen
  splashProgress: (progress, message) => ipcRenderer.invoke('splash-progress', progress, message),
  appReady: () => ipcRenderer.invoke('app-ready'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  onSplashProgress: (callback) => ipcRenderer.on('splash-progress', (event, data) => callback(data)),

  // AI super-resolution upscale
  aiUpscaleAvailable: () => ipcRenderer.invoke('ai-upscale-available'),
  aiUpscale: (rgba, width, height, scale) => ipcRenderer.invoke('ai-upscale', { rgba, width, height, scale }),
  onAiUpscaleProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ai-upscale-progress', listener);
    return () => ipcRenderer.removeListener('ai-upscale-progress', listener);
  },

  // AI motion deblur (NAFNet via onnxruntime-node; DirectML-gated availability)
  aiDeblurAvailable: () => ipcRenderer.invoke('ai-deblur-available'),
  aiDeblur: (rgba, width, height) => ipcRenderer.invoke('ai-deblur', { rgba, width, height }),
  onAiDeblurProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ai-deblur-progress', listener);
    return () => ipcRenderer.removeListener('ai-deblur-progress', listener);
  },

  // Logging
  getLogFile: () => ipcRenderer.invoke('get-log-file'),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});

// Security: Remove node integration from window object
delete window.module;
delete window.exports;
delete window.require;