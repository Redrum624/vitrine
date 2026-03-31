const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Keep a global reference of the window objects
let mainWindow;
let splashWindow;

// Better development detection - check if dist/index.html exists for production mode
const distPath = path.join(__dirname, '../dist/index.html');
const hasBuiltFiles = fs.existsSync(distPath);
const isDev = process.env.NODE_ENV === 'development' || (!app.isPackaged && !hasBuiltFiles);

// Create splash screen window
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../assets/icon.ico')
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// Send progress update to splash screen
function sendSplashProgress(progress, message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-progress', { progress, message });
  }
}

// Close splash and show main window
function closeSplashAndShowMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.maximize();
    mainWindow.show();
  }

  if (splashWindow && !splashWindow.isDestroyed()) {
    // Small delay for smooth transition
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
    }, 300);
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    frame: false, // Frameless window - we'll add custom controls
    icon: path.join(__dirname, '../assets/icon.ico'),
    show: false, // Don't show until ready
    backgroundColor: '#282828' // Match our dark theme
  });

  // Load the app
  const startUrl = isDev
    ? 'http://localhost:3005'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  console.log('Development mode:', isDev);
  console.log('Loading URL:', startUrl);
  console.log('App packaged:', app.isPackaged);
  console.log('NODE_ENV:', process.env.NODE_ENV);

  // Enable SharedArrayBuffer for libraw-wasm (Emscripten pthreads)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      }
    });
  });

  mainWindow.loadURL(startUrl);

  // Open DevTools automatically in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Window is ready but we wait for app to signal it's fully loaded
  mainWindow.once('ready-to-show', () => {
    // Send initial progress to splash
    sendSplashProgress(40, 'Loading application...');
    // Don't show yet - wait for app-ready signal
  });

  // Handle window close request
  mainWindow.on('close', async (event) => {
    event.preventDefault(); // Prevent immediate close

    // Ask the renderer to prepare for closing
    const shouldClose = await requestAppClose();

    if (shouldClose) {
      // Perform cleanup
      await performAppCleanup();

      // Actually close the window
      mainWindow.destroy();
    }
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'] },
                { name: 'RAW Files', extensions: ['cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('file-open', result.filePaths[0]);
            }
          }
        },
        {
          label: 'Import...',
          accelerator: 'CmdOrCtrl+I',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'] },
                { name: 'RAW Files', extensions: ['cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'] }
              ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('file-import', result.filePaths);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export...',
          accelerator: 'CmdOrCtrl+E',
          enabled: false, // Enable when image is loaded
          click: () => {
            mainWindow.webContents.send('file-export');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow.webContents.send('edit-undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow.webContents.send('edit-redo')
        },
        { type: 'separator' },
        {
          label: 'Reset All',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('edit-reset-all')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow.webContents.send('view-zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('view-zoom-out')
        },
        {
          label: 'Fit to Window',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('view-fit-window')
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('view-actual-size')
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow.minimize()
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.close()
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Photo Editor Pro',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Photo Editor Pro',
              message: 'Photo Editor Pro',
              detail: 'Professional photo editing powered by darktable\nVersion 1.0.0'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handlers for file operations
// Window control handlers (for frameless window)
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Splash screen IPC handlers
ipcMain.handle('splash-progress', (event, progress, message) => {
  sendSplashProgress(progress, message);
});

ipcMain.handle('app-ready', () => {
  console.log('App ready signal received, showing main window...');
  closeSplashAndShowMain();
});

ipcMain.handle('get-app-version', () => {
  const packageJson = require('../package.json');
  return packageJson.version;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// File system operations
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = await fs.promises.readFile(filePath);
    return data;
  } catch (error) {
    throw error;
  }
});

// Get system drives (Windows) - only include C: and D: for faster loading
ipcMain.handle('get-system-drives', async () => {
  try {
    const drives = [];

    // Only check C: and D: drives for faster loading
    const allowedDrives = ['C', 'D'];
    for (const letter of allowedDrives) {
      const drive = letter + ':';
      const drivePath = drive + '\\';

      try {
        await fs.promises.access(drivePath);
        drives.push({
          id: drive.toLowerCase() + '_drive',
          name: `Local Disk (${drive})`,
          path: drivePath,
          type: 'drive'
        });
      } catch {
        // Drive doesn't exist, skip
      }
    }

    // Add common user folders
    const userProfile = os.homedir();
    const userFolders = [
      {
        id: 'pictures',
        name: 'Pictures',
        path: path.join(userProfile, 'Pictures'),
        type: 'folder'
      },
      {
        id: 'documents',
        name: 'Documents',
        path: path.join(userProfile, 'Documents'),
        type: 'folder'
      },
      {
        id: 'desktop',
        name: 'Desktop',
        path: path.join(userProfile, 'Desktop'),
        type: 'folder'
      }
    ];

    return [...drives, ...userFolders];
  } catch (error) {
    console.error('Failed to get system drives:', error);
    return [];
  }
});

// File watchers for detecting changes
const folderWatchers = new Map();

// Watch a folder for changes
ipcMain.handle('watch-folder', async (event, folderPath) => {
  try {
    // Don't watch if already watching
    if (folderWatchers.has(folderPath)) {
      return { success: true, alreadyWatching: true };
    }

    const watcher = fs.watch(folderPath, { persistent: false }, (eventType, filename) => {
      if (filename && mainWindow && !mainWindow.isDestroyed()) {
        // Debounce rapid changes
        const key = `${folderPath}:${filename}`;
        if (watcher._debounce) {
          clearTimeout(watcher._debounce);
        }
        watcher._debounce = setTimeout(() => {
          mainWindow.webContents.send('folder-changed', {
            folderPath,
            eventType,
            filename
          });
        }, 100);
      }
    });

    folderWatchers.set(folderPath, watcher);
    return { success: true };
  } catch (error) {
    console.error(`Failed to watch folder ${folderPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Stop watching a folder
ipcMain.handle('unwatch-folder', async (event, folderPath) => {
  try {
    const watcher = folderWatchers.get(folderPath);
    if (watcher) {
      watcher.close();
      folderWatchers.delete(folderPath);
    }
    return { success: true };
  } catch (error) {
    console.error(`Failed to unwatch folder ${folderPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Get folder contents
ipcMain.handle('get-folder-contents', async (event, folderPath) => {
  try {
    const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const folders = [];
    const images = [];

    // Image extensions to filter
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
      '.orf', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2', '.pef'];

    for (const item of items) {
      const itemPath = path.join(folderPath, item.name);

      try {
        if (item.isDirectory()) {
          folders.push({
            id: Buffer.from(itemPath).toString('base64'),
            name: item.name,
            path: itemPath,
            type: 'folder'
          });
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (imageExtensions.includes(ext)) {
            const stats = await fs.promises.stat(itemPath);
            images.push({
              id: Buffer.from(itemPath).toString('base64'),
              name: item.name,
              path: itemPath,
              size: stats.size,
              format: ext.substring(1).toUpperCase(),
              type: getMimeType(itemPath),
              lastModified: stats.mtime.getTime(),
              dateModified: stats.mtime
            });
          }
        }
      } catch (error) {
        // Skip files/folders we can't access
        console.warn(`Skipping ${itemPath}: ${error.message}`);
      }
    }

    return { folders, images };
  } catch (error) {
    throw error;
  }
});

// Read image as data URL for display in renderer (with thumbnail generation for RAW files)
ipcMain.handle('read-image-as-data-url', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const rawFormats = ['.cr2', '.cr3', '.nef', '.arw', '.orf', '.dng', '.raf', '.rw2', '.pef', '.srw'];

    // For RAW files, extract embedded JPEG preview
    if (rawFormats.includes(ext)) {
      // Try Sharp first (works for some RAW formats like DNG)
      try {
        const sharp = require('sharp');
        const thumbnailBuffer = await sharp(filePath, { failOn: 'none' })
          .resize(300, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        if (thumbnailBuffer && thumbnailBuffer.length > 100) {
          const base64 = thumbnailBuffer.toString('base64');
          console.log(`Preview: Sharp OK for ${path.basename(filePath)}: ${thumbnailBuffer.length} bytes`);
          return `data:image/jpeg;base64,${base64}`;
        }
      } catch (sharpError) {
        console.log(`Preview: Sharp failed for ${path.basename(filePath)}: ${sharpError.message}`);
        // Sharp doesn't support this RAW format, extract embedded JPEG preview
      }

      // Extract the largest embedded JPEG from the first 10MB of the RAW file.
      // For thumbnails we don't need to scan the entire 40MB+ DNG — the preview
      // JPEG is typically in the first few MB. The full-file scan is done only
      // by decode-raw-file when loading the actual image.
      try {
        const fd = await fs.promises.open(filePath, 'r');
        const scanSize = Math.min((await fd.stat()).size, 10 * 1024 * 1024);
        const fileData = Buffer.alloc(scanSize);
        await fd.read(fileData, 0, scanSize, 0);
        await fd.close();

        let largest = { offset: -1, size: 0 };

        for (let i = 0; i < fileData.length - 1; i++) {
          if (fileData[i] === 0xFF && fileData[i + 1] === 0xD8) {
            for (let j = i + 2; j < fileData.length - 1; j++) {
              if (fileData[j] === 0xFF && fileData[j + 1] === 0xD9) {
                const size = j - i + 2;
                if (size > largest.size) {
                  largest = { offset: i, size };
                }
                break;
              }
            }
          }
        }

        if (largest.offset >= 0 && largest.size > 1000) {
          const jpegBuffer = fileData.subarray(largest.offset, largest.offset + largest.size);
          const sharp = require('sharp');
          const thumbnailBuffer = await sharp(jpegBuffer)
            .resize(300, 200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          const base64 = thumbnailBuffer.toString('base64');
          return `data:image/jpeg;base64,${base64}`;
        }

        console.warn(`No embedded JPEG preview found in RAW file ${filePath}`);
        return null;
      } catch (extractError) {
        console.warn(`Failed to extract preview from RAW file ${filePath}:`, extractError.message);
        return null;
      }
    }

    // For standard image formats, read directly
    const data = await fs.promises.readFile(filePath);
    const mimeType = getMimeType(filePath);
    const base64 = data.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn(`Failed to read image as data URL: ${filePath}`, error.message);
    return null; // Return null instead of throwing — prevents thumbnail loading from stopping
  }
});

// Helper function to get MIME type from file extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.svg': 'image/svg+xml',
    // RAW formats (though they need special processing)
    '.cr2': 'image/x-canon-cr2',
    '.cr3': 'image/x-canon-cr3',
    '.nef': 'image/x-nikon-nef',
    '.arw': 'image/x-sony-arw',
    '.orf': 'image/x-olympus-orf',
    '.dng': 'image/x-adobe-dng'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    await fs.promises.writeFile(filePath, data);
    return true;
  } catch (error) {
    throw error;
  }
});

// Write image file (for exports)
ipcMain.handle('write-image-file', async (event, filePath, imageData, format, options) => {
  try {
    const sharp = require('sharp');

    const rawBuffer = Buffer.from(imageData);
    const expectedSize = options.width * options.height * (options.channels || 4);
    if (rawBuffer.length !== expectedSize) {
      console.warn(`Export buffer size mismatch: got ${rawBuffer.length}, expected ${expectedSize}`);
    }

    let sharpInstance = sharp(rawBuffer, {
      raw: {
        width: options.width,
        height: options.height,
        channels: options.channels || 4
      }
    })

    // Remove alpha channel for formats that don't support it
    if (format.toLowerCase() === 'jpeg') {
      sharpInstance = sharpInstance.removeAlpha();
    }

    // Apply format-specific options
    switch (format.toLowerCase()) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({
          quality: options.quality || 90,
          progressive: options.progressive || false,
          mozjpeg: true
        });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({
          compressionLevel: options.compressionLevel || 6,
          progressive: options.progressive || false
        });
        break;
      case 'tiff':
        sharpInstance = sharpInstance.tiff({
          compression: options.compression || 'lzw',
          quality: options.quality || 90
        });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({
          quality: options.quality || 80,
          lossless: options.lossless || false
        });
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Resize if needed
    if (options.resize && (options.resize.width || options.resize.height)) {
      sharpInstance = sharpInstance.resize(options.resize.width, options.resize.height, {
        fit: options.resize.fit || 'inside',
        withoutEnlargement: true
      });
    }

    await sharpInstance.toFile(filePath);
    return true;
  } catch (error) {
    console.error('Failed to write image file:', error);
    throw error;
  }
});

// Get file stats
ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime.getTime(),
      modified: stats.mtime.getTime(),
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error) {
    throw error;
  }
});

// Read image metadata (EXIF, IPTC, XMP)
ipcMain.handle('read-image-metadata', async (event, filePath) => {
  try {
    const ExifReader = require('exifreader');
    const data = await fs.promises.readFile(filePath);
    const tags = ExifReader.load(data, { expanded: true });

    return {
      exif: tags.exif || {},
      iptc: tags.iptc || {},
      xmp: tags.xmp || {},
      icc: tags.icc || {},
      thumbnail: tags.Thumbnail || null
    };
  } catch (error) {
    console.warn('Failed to read image metadata:', error);
    return {
      exif: {},
      iptc: {},
      xmp: {},
      icc: {},
      thumbnail: null
    };
  }
});

// Write image metadata
ipcMain.handle('write-image-metadata', async (event, filePath, metadata) => {
  try {
    // For now, we'll use exiftool if available, otherwise log the operation
    logger.info(`Would write metadata to ${filePath}:`, metadata);

    // In production, you'd use exiftool or similar:
    // const exiftool = require('node-exiftool');
    // const ep = new exiftool.ExiftoolProcess();
    // await ep.open();
    // await ep.writeMetadata(filePath, metadata);
    // await ep.close();

    return true;
  } catch (error) {
    console.error('Failed to write image metadata:', error);
    throw error;
  }
});

// Logging handlers
const logDir = path.join(os.homedir(), 'Photo Editor Pro', 'logs');
const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);

// Ensure log directory exists
fs.mkdirSync(logDir, { recursive: true });

// Batch logging to prevent file handle exhaustion
let logQueue = [];
let isWriting = false;
let flushTimer = null;

const flushLogs = async () => {
  if (isWriting || logQueue.length === 0) return;

  isWriting = true;
  const logsToWrite = [...logQueue]; // Copy the queue
  logQueue = []; // Clear the queue

  try {
    const logLines = logsToWrite.map(entry =>
      `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}\n`
    ).join('');

    await fs.promises.appendFile(logFile, logLines);
  } catch (error) {
    console.error('Failed to write batch logs:', error);
  } finally {
    isWriting = false;
  }
};

// Schedule periodic flushing
const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogs();
  }, 100);
};

ipcMain.handle('write-log', async (event, logEntry) => {
  try {
    logQueue.push(logEntry);
    scheduleFlush();

    // For critical errors, flush immediately
    if (logEntry.level === 'error' && !isWriting) {
      flushLogs();
    }

    return true;
  } catch (error) {
    console.error('Failed to queue log:', error);
    return false;
  }
});

ipcMain.handle('get-log-file', async () => {
  return logFile;
});

// Decode a RAW file by extracting its embedded JPEG and returning raw pixels.
// This runs in the main process (Node.js) to avoid the browser's
// SharedArrayBuffer/Emscripten issues with libraw-wasm.
ipcMain.handle('decode-raw-file', async (event, filePath) => {
  const sharp = require('sharp');

  try {
    const buf = await fs.promises.readFile(filePath);

    // 1. Read sensor dimensions from TIFF/IFD header (tag 256=width, 257=height)
    let sensorWidth = 0, sensorHeight = 0;
    try {
      const le = buf[0] === 0x49; // 'II' = little-endian
      const r16 = le ? (o) => buf[o] | (buf[o+1] << 8) : (o) => (buf[o] << 8) | buf[o+1];
      const r32 = le
        ? (o) => (buf[o] | (buf[o+1] << 8) | (buf[o+2] << 16) | (buf[o+3] << 24)) >>> 0
        : (o) => ((buf[o] << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3]) >>> 0;
      const ifd0 = r32(4);
      const n = r16(ifd0);
      for (let i = 0; i < Math.min(n, 40); i++) {
        const off = ifd0 + 2 + i * 12;
        const tag = r16(off);
        if (tag === 256) sensorWidth = r32(off + 8);
        if (tag === 257) sensorHeight = r32(off + 8);
      }
    } catch (_) { /* ignore parse errors */ }

    // 2. Find the largest embedded JPEG (FF D8 ... FF D9)
    let bestStart = -1, bestSize = 0;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xD8) {
        for (let j = i + 2; j < buf.length - 1; j++) {
          if (buf[j] === 0xFF && buf[j + 1] === 0xD9) {
            const size = j - i + 2;
            if (size > bestSize) {
              bestStart = i;
              bestSize = size;
            }
            break;
          }
        }
      }
    }

    let pixelBuffer, info;

    if (bestSize > 50000) {
      // Use the embedded JPEG, upscale to sensor dimensions if needed
      const jpeg = buf.slice(bestStart, bestStart + bestSize);
      let pipeline = sharp(jpeg);

      // Upscale to full sensor resolution with high-quality Lanczos
      if (sensorWidth > 0 && sensorHeight > 0) {
        const meta = await sharp(jpeg).metadata();
        if (meta.width < sensorWidth || meta.height < sensorHeight) {
          // Respect orientation: if JPEG is landscape but sensor is portrait (or vice versa), swap
          let targetW = sensorWidth, targetH = sensorHeight;
          if ((meta.width > meta.height) !== (sensorWidth > sensorHeight)) {
            targetW = sensorHeight;
            targetH = sensorWidth;
          }
          pipeline = pipeline.resize(targetW, targetH, {
            kernel: sharp.kernel.lanczos3,
            fit: 'fill',
          });
          console.log(`RAW decode: upscaling ${meta.width}x${meta.height} → ${targetW}x${targetH}`);
        }
      }

      const result = await pipeline.raw().toBuffer({ resolveWithObject: true });
      pixelBuffer = result.data;
      info = result.info;
      console.log(`RAW decode: ${info.width}x${info.height} (${info.channels}ch) from ${filePath}`);
    } else {
      // No usable embedded JPEG — try Sharp directly (works for some DNGs)
      const result = await sharp(filePath, { failOn: 'none' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // If Sharp returns a thumbnail, upscale to sensor dimensions
      if (sensorWidth > 0 && sensorHeight > 0 && result.info.width < sensorWidth) {
        let targetW = sensorWidth, targetH = sensorHeight;
        if ((result.info.width > result.info.height) !== (sensorWidth > sensorHeight)) {
          targetW = sensorHeight; targetH = sensorWidth;
        }
        const upscaled = await sharp(result.data, {
          raw: { width: result.info.width, height: result.info.height, channels: result.info.channels }
        }).resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
          .raw().toBuffer({ resolveWithObject: true });
        pixelBuffer = upscaled.data;
        info = upscaled.info;
        console.log(`RAW decode: upscaled DNG ${result.info.width}x${result.info.height} → ${info.width}x${info.height}`);
      } else {
        pixelBuffer = result.data;
        info = result.info;
      }
      console.log(`RAW decode: Sharp direct ${info.width}x${info.height} from ${filePath}`);
    }

    // Convert Node Buffer to ArrayBuffer for IPC transfer
    const ab = pixelBuffer.buffer.slice(
      pixelBuffer.byteOffset,
      pixelBuffer.byteOffset + pixelBuffer.byteLength
    );

    return {
      data: ab,
      width: info.width,
      height: info.height,
      channels: info.channels,
    };
  } catch (error) {
    console.error('RAW decode failed:', error);
    throw new Error(`RAW decode failed: ${error.message}`);
  }
});

// Read file as ArrayBuffer for RAW files
ipcMain.handle('read-file-buffer', async (event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    // Convert Node.js Buffer to ArrayBuffer
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch (error) {
    console.error('Error reading file as buffer:', error);
    throw new Error(`Failed to read file as buffer: ${error.message}`);
  }
});

// App event handlers
app.whenReady().then(() => {
  // Create splash screen first
  createSplashWindow();

  // Send initial progress
  setTimeout(() => sendSplashProgress(10, 'Starting application...'), 100);

  // Create main window (hidden)
  setTimeout(() => {
    sendSplashProgress(20, 'Loading modules...');
    createWindow();
  }, 300);

  // Remove the default menu bar
  Menu.setApplicationMenu(null);

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      setTimeout(() => createWindow(), 300);
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// App closing cycle functions
async function requestAppClose() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return true;
    }

    console.log('Requesting app close from renderer...');

    // Send close request to renderer and wait for response
    const result = await new Promise((resolve) => {
      // Set up timeout in case renderer doesn't respond
      const timeout = global.setTimeout(() => {
        console.warn('Renderer did not respond to close request, proceeding with close');
        resolve(true);
      }, 5000); // 5 second timeout

      // Set up response listener
      const handleCloseResponse = (event, shouldClose, reason) => {
        global.clearTimeout(timeout);
        ipcMain.removeListener('app-close-response', handleCloseResponse);
        console.log(`Renderer close response: ${shouldClose ? 'proceed' : 'cancel'} - ${reason || 'no reason'}`);
        resolve(shouldClose);
      };

      ipcMain.on('app-close-response', handleCloseResponse);

      // Send the close request
      mainWindow.webContents.send('app-close-request');
    });

    return result;
  } catch (error) {
    console.error('Error during close request:', error);
    return true; // Default to allowing close on error
  }
}

async function performAppCleanup() {
  try {
    console.log('Performing app cleanup...');

    // Clean up any background processes, timers, etc.
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Send cleanup signal to renderer
      mainWindow.webContents.send('app-cleanup');

      // Give renderer time to clean up (but don't wait too long)
      await new Promise(resolve => global.setTimeout(resolve, 1000));
    }

    // Close log file handles if any
    // Additional cleanup can be added here

    console.log('App cleanup completed');
  } catch (error) {
    console.error('Error during app cleanup:', error);
  }
}