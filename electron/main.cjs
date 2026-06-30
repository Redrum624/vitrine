const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { writeImageFile, writeImageMetadata } = require('./imageWriter.cjs');
const { markSelfWrite, createFolderChangeDebouncer } = require('./selfWriteRegistry.cjs');

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
    show: false, // show only once painted (ready-to-show) so it appears fully, not blank-then-fill
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
      sandbox: true,
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
    try {
      const parsed = new URL(url);
      const allowed = ['https:', 'http:', 'mailto:'];
      if (allowed.includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch {
      // Invalid URL — deny silently
    }
    return { action: 'deny' };
  });
}

// Create application menu
// eslint-disable-next-line no-unused-vars -- retained for non-frameless builds; the app ships a custom in-window MenuBar
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

ipcMain.handle('file-exists', (_e, p) => { try { return fs.existsSync(p); } catch { return false; } });

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

    // Debounce rapid changes, swallowing events caused by the app's own writes
    // (rating XMP, exports) — forwarding those makes the renderer reload an
    // unchanged folder and the filmstrip scroll back to the start. The
    // debouncer guarantees: emit iff a NON-self-write event occurred in the
    // window; self-writes alone never emit and never delay/suppress a genuine
    // external event. (Logic lives in selfWriteRegistry.cjs — unit-tested.)
    const debouncer = createFolderChangeDebouncer({
      delayMs: 100,
      emit: ({ eventType, filename }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('folder-changed', {
            folderPath,
            eventType,
            filename
          });
        }
      }
    });

    const watcher = fs.watch(folderPath, { persistent: false }, (eventType, filename) => {
      debouncer.handleEvent(eventType, filename);
    });
    watcher._debouncer = debouncer;

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
      if (watcher._debouncer) watcher._debouncer.cancel(); // drop any pending emit
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
// Cache decoded RAW preview thumbnails (filePath -> data URL). The filmstrip re-requests
// visible thumbnails on every scroll, and decoding a multi-MP embedded JPEG each time is
// expensive — so memoise, bounded to avoid unbounded growth.
const rawThumbCache = new Map();
const RAW_THUMB_CACHE_MAX = 2000;
function cacheRawThumb(key, url) {
  rawThumbCache.set(key, url);
  if (rawThumbCache.size > RAW_THUMB_CACHE_MAX) {
    rawThumbCache.delete(rawThumbCache.keys().next().value); // evict oldest
  }
  return url;
}

ipcMain.handle('read-image-as-data-url', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const rawFormats = ['.cr2', '.cr3', '.nef', '.arw', '.orf', '.dng', '.raf', '.rw2', '.pef', '.srw'];

    // For RAW files, extract an embedded JPEG preview.
    if (rawFormats.includes(ext)) {
      const cached = rawThumbCache.get(filePath);
      if (cached) return cached;

      const sharp = require('sharp');

      // 1) Embedded JPEG preview — reliable for ORF/CR2/NEF/ARW/... (the preview sits
      //    before the raw sensor strip; we cap the read there and bound each JPEG by
      //    PARSING its marker structure, so we don't trip over false FF D9 markers in
      //    entropy-coded data). Tried first so proprietary RAW doesn't spam sharp errors.
      try {
        const fd = await fs.promises.open(filePath, 'r');
        try {
          const stat = await fd.stat();
          const headSize = Math.min(stat.size, 256 * 1024);
          const head = Buffer.allocUnsafe(headSize);
          await fd.read(head, 0, headSize, 0);

          const { findEmbeddedJpegs, rawDataStart, readOrientation } = require('./embeddedPreview.cjs');
          const cap = rawDataStart(head) || 8 * 1024 * 1024;
          const scanSize = Math.min(stat.size, cap, 12 * 1024 * 1024);
          const buf = Buffer.allocUnsafe(scanSize);
          await fd.read(buf, 0, scanSize, 0);

          // Orientation source: the RAW container's IFD0 Orientation tag (0x0112). Used
          // for previews (ORF) whose embedded JPEG has no orientation of its own.
          const containerOrientation = readOrientation(head);

          for (const c of findEmbeddedJpegs(buf)) {
            try {
              const jpegBuf = buf.subarray(c.offset, c.offset + c.length);
              // Orient the thumbnail (the bytes are baked into the data URL; the filmstrip
              // <img> does not CSS-rotate). Prefer the embedded JPEG's OWN EXIF orientation
              // (Canon/Nikon/Sony previews carry it) via sharp's auto-orient; otherwise
              // fall back to the container orientation (Olympus ORF). sharp never
              // auto-orients unless asked — that omission is why RAW thumbs were sideways.
              const previewOri = await sharp(jpegBuf, { failOn: 'none' })
                .metadata().then((m) => m.orientation || 0).catch(() => 0);
              let pipe = sharp(jpegBuf, { failOn: 'none' });
              if (previewOri > 1) {
                pipe = pipe.rotate(); // auto-orient from the preview's own EXIF
              } else if (containerOrientation > 1) {
                pipe = applyExifOrientation(pipe, containerOrientation);
              }
              const out = await pipe
                .resize(300, 200, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();
              if (out && out.length > 100) {
                return cacheRawThumb(filePath, `data:image/jpeg;base64,${out.toString('base64')}`);
              }
            } catch (jpegError) {
              void jpegError; // try the next embedded JPEG
            }
          }
        } finally {
          await fd.close();
        }
      } catch (extractError) {
        void extractError; // fall through to the sharp-direct fallback
      }

      // 2) Fallback: sharp directly (DNG and the few RAWs libvips can decode natively).
      //    .rotate() auto-orients from the file's own EXIF so DNG thumbs aren't sideways.
      try {
        const out = await sharp(filePath, { failOn: 'none' })
          .rotate()
          .resize(300, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        if (out && out.length > 100) {
          return cacheRawThumb(filePath, `data:image/jpeg;base64,${out.toString('base64')}`);
        }
      } catch (sharpError) {
        void sharpError; // proprietary RAW libvips can't decode — expected, no usable preview
      }

      console.warn(`No embedded preview found for RAW ${path.basename(filePath)}`);
      return null;
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

// Apply an EXIF orientation (1-8) to a sharp pipeline explicitly. Used for RAW previews
// whose embedded JPEG carries NO orientation tag (e.g. Olympus ORF, where orientation
// lives in the RAW container's IFD0), so sharp's .rotate() auto-orient can't help. sharp
// .rotate(deg) is clockwise; .flip() is vertical, .flop() is horizontal. 5/7 (transpose/
// transverse) are best-effort — real cameras only emit 1/3/6/8 (and rarely 2).
function applyExifOrientation(pipe, ori) {
  switch (ori) {
    case 2: return pipe.flop();
    case 3: return pipe.rotate(180);
    case 4: return pipe.flip();
    case 5: return pipe.rotate(90).flop();
    case 6: return pipe.rotate(90);
    case 7: return pipe.rotate(270).flop();
    case 8: return pipe.rotate(270);
    default: return pipe; // 1 (none) or unknown
  }
}

// Path validation helper for write IPC handlers -- rejects traversal attempts
function validateWritePath(p) {
  const normalized = path.normalize(p);
  if (normalized.includes('..')) {
    throw new Error(`Path traversal rejected: ${p}`);
  }
  return normalized;
}

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    const safeFilePath = validateWritePath(filePath);
    markSelfWrite(safeFilePath); // don't let the folder watcher react to our own write
    await fs.promises.writeFile(safeFilePath, data);
    return true;
  } catch (error) {
    throw error;
  }
});

// Write image file (for exports)
ipcMain.handle('write-image-file', async (event, filePath, imageData, format, options) => {
  try {
    const safeFilePath = validateWritePath(filePath);
    // Delegates to electron/imageWriter.cjs (unit-tested). Correctly handles
    // 8-bit and 16-bit raw RGBA buffers and embeds an sRGB ICC profile.
    markSelfWrite(safeFilePath); // exports into a watched folder must not retrigger it
    return await writeImageFile(safeFilePath, imageData, format, options);
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

// Write image metadata (EXIF copyright/artist + IPTC-as-XMP) into an existing
// raster file. Delegates to electron/imageWriter.cjs (unit-tested). Throws on
// failure so the renderer promise rejects (no silent success).
ipcMain.handle('write-image-metadata', async (event, filePath, metadata) => {
  try {
    const safeFilePath = validateWritePath(filePath);
    markSelfWrite(safeFilePath); // in-place metadata write must not retrigger the watcher
    return await writeImageMetadata(safeFilePath, metadata);
  } catch (error) {
    console.error('Failed to write image metadata:', error);
    throw error;
  }
});

// Write a star rating (xmp:Rating 0-5) to the file so it shows in the OS file
// details. For RAW (which sharp can't re-encode) write a standard sidecar .xmp;
// for everything else embed the XMP in-place.
ipcMain.handle('write-image-rating', async (event, filePath, rating) => {
  try {
    const safeFilePath = validateWritePath(filePath);
    const ext = path.extname(safeFilePath).toLowerCase();
    const rawFormats = ['.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.orf', '.dng', '.raf', '.rw2', '.pef', '.srw', '.x3f'];
    if (rawFormats.includes(ext)) {
      const { buildXmpPacket } = require('./imageWriter.cjs');
      const sidecar = safeFilePath.slice(0, -ext.length) + '.xmp';
      // Mark BEFORE writing so the folder watcher swallows the resulting
      // change event instead of reloading the folder (filmstrip scroll reset).
      markSelfWrite(sidecar);
      await fs.promises.writeFile(sidecar, buildXmpPacket({ rating }), 'utf8');
      return { ok: true, method: 'sidecar', path: sidecar };
    }
    markSelfWrite(safeFilePath);
    await writeImageMetadata(safeFilePath, { xmp: { rating } });
    return { ok: true, method: 'embedded' };
  } catch (error) {
    // A rejected path (traversal guard) is a security condition, not a soft
    // write failure — surface it to the caller instead of returning { ok:false }.
    if (error instanceof Error && error.message.startsWith('Path traversal rejected')) {
      throw error;
    }
    console.warn('Failed to write image rating:', error.message);
    return { ok: false, error: error.message };
  }
});

// Read the star rating (xmp:Rating 0-5) back FROM a file so it survives app restarts and
// shows up the way the user set it. RAW → read the sibling sidecar .xmp; everything else →
// read the embedded XMP packet via sharp. Returns the rating (0-5) or null when none.
ipcMain.handle('read-image-rating', async (event, filePath) => {
  try {
    const sharp = require('sharp');
    const { parseXmpRating } = require('./imageWriter.cjs');
    const ext = path.extname(filePath).toLowerCase();
    const rawFormats = ['.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.orf', '.dng', '.raf', '.rw2', '.pef', '.srw', '.x3f'];
    if (rawFormats.includes(ext)) {
      const sidecar = filePath.slice(0, -ext.length) + '.xmp';
      try {
        return parseXmpRating(await fs.promises.readFile(sidecar, 'utf8'));
      } catch {
        return null; // no sidecar
      }
    }
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    return parseXmpRating(meta.xmp);
  } catch (error) {
    console.warn('Failed to read image rating:', error.message);
    return null;
  }
});

// Generic JSON key-value store under userData (survives app updates — userData is
// outside the install dir). Keys are hashed to a safe filename. Used for per-image
// edit persistence and any other durable renderer state.
const STORE_DIR = path.join(app.getPath('userData'), 'store');
function storeFilePath(key) {
  const hash = require('crypto').createHash('sha1').update(String(key)).digest('hex');
  return path.join(STORE_DIR, `${hash}.json`);
}
ipcMain.handle('store-get', async (event, key) => {
  try {
    const data = await fs.promises.readFile(storeFilePath(key), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('store-get failed:', error.message);
    return null;
  }
});
ipcMain.handle('store-set', async (event, key, value) => {
  try {
    await fs.promises.mkdir(STORE_DIR, { recursive: true });
    await fs.promises.writeFile(storeFilePath(key), JSON.stringify(value), 'utf8');
    return true;
  } catch (error) {
    console.warn('store-set failed:', error.message);
    return false;
  }
});
ipcMain.handle('store-delete', async (event, key) => {
  try {
    await fs.promises.unlink(storeFilePath(key));
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('store-delete failed:', error.message);
    return false;
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
  const { decodeRawFile } = require('./rawDecoder.cjs');
  try {
    return await decodeRawFile(filePath, console);
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

  // Purge stale RAW-decode temp dirs (left behind if a previous session crashed
  // mid-decode; the per-decode cleanup is best-effort only). Deferred so it
  // never competes with startup work.
  setTimeout(() => {
    try {
      require('./rawDecoder.cjs').sweepStaleRawTmpDirs();
    } catch (_) {
      /* best-effort */
    }
  }, 5000);

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

// Security: Prevent navigation outside the app's own origin + new window creation
app.on('web-contents-created', (event, contents) => {
  const appUrl = isDev
    ? 'http://localhost:3005'
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith(appUrl)) {
      e.preventDefault();
    }
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