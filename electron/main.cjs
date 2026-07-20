const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

// IDENTITY PIN (load-bearing — do not remove): the runtime app name determines the userData
// path (%APPDATA%\<name>\) where every user's persisted edits, presets, and RAW disk cache
// live. It has always resolved to "photo_app" (the npm `name`, because electron-builder strips
// the `build` field from the packaged package.json). The v1.23 rebrand changes the DISPLAY name
// to "Vitrine" (build.productName / installer / About), but the IDENTITY must stay "photo_app"
// or every existing install orphans its saved work. Pinning it here — before app 'ready' and
// before any getPath('userData') — makes that guarantee independent of how electron-builder
// injects productName into the packaged manifest.
app.setName('photo_app');

const path = require('path');
const fs = require('fs');
const os = require('os');
const { writeImageFile, writeImageMetadata } = require('./imageWriter.cjs');
const { markSelfWrite, createFolderChangeDebouncer } = require('./selfWriteRegistry.cjs');
const {
  computeDeniedBases,
  validateWritePath: enforceWritePolicy,
  REJECT_PREFIX: WRITE_REJECT_PREFIX,
} = require('./writePathPolicy.cjs');
const aiUpscaler = require('./aiUpscaler.cjs');
const aiDeblur = require('./aiDeblur.cjs');

// Canonical RAW extension superset recognized by this app — duplicated (dot-prefixed) from
// `src/utils/rawExtensions.ts`'s `RAW_EXTENSIONS_DOTTED` (see that file's doc comment for why
// it's a union, not an intersection, of the historically drifted UI/decode lists). main.cjs is
// CommonJS and cannot `import` that ESM/TS module directly, so this is a manually-kept-in-sync
// duplicate rather than a shared import — update BOTH places if the supported RAW formats change.
//
// Task L4 (post-review polish): this replaces THREE independently-maintained local rawFormats
// arrays (read-image-as-data-url, write-image-rating, read-image-rating) that had drifted apart —
// the read-image-as-data-url preview list was missing '.sr2'/'.srf'/'.x3f', so those RAW formats
// silently got no embedded-preview thumbnail even though rating read/write already supported them.
const RAW_FORMATS = [
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.orf', '.dng', '.raf', '.rw2',
  '.pef', '.srw', '.x3f', '.raw', '.mrw', '.dcr', '.k25', '.kdc', '.erf', '.mef', '.mos',
  '.rwl',
];

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
    closeAllFolderWatchers(); // release all fs.watch handles + cancel pending debouncers
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
          label: 'About Vitrine',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Vitrine',
              message: 'Vitrine',
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

// Rich app metadata for the About dialog (version + runtime versions + project info).
ipcMain.handle('get-app-info', () => {
  const pkg = require('../package.json');
  const repoUrl = (pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url) || '')
    .replace(/^git\+/, '').replace(/\.git$/, '');
  // NOTE: electron-builder strips the `build` field from the packaged package.json, so
  // pkg.build.productName is only available in dev. Fall back to the literal product name
  // (never pkg.name, which is the npm id "photo_app").
  return {
    name: (pkg.build && pkg.build.productName) || 'Vitrine',
    version: pkg.version,
    description: pkg.description || '',
    author: typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || '',
    license: pkg.license || '',
    repository: repoUrl,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  };
});

// Open an external URL in the default browser (renderer-initiated, scheme-allowlisted).
ipcMain.handle('open-external-url', async (_e, url) => {
  try {
    const parsed = new URL(String(url));
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      await shell.openExternal(parsed.toString());
      return true;
    }
  } catch {
    // Invalid URL or disallowed scheme — deny silently
  }
  return false;
});

ipcMain.handle('file-exists', (_e, p) => { try { return fs.existsSync(p); } catch { return false; } });

// AI super-resolution upscale (Real-ESRGAN via onnxruntime-node, main-process native). Availability
// is DirectML-gated (see aiUpscaler.cjs, W5 R1) so a CPU-only machine reports unavailable and the
// renderer auto-routes to the deterministic Lanczos path instead of an hours-long CPU tile crawl.
ipcMain.handle('ai-upscale-available', async () => {
  try { return await aiUpscaler.isAvailable(); } catch { return false; }
});
ipcMain.handle('ai-upscale', async (event, { rgba, width, height, scale }) => {
  const onProgress = (p) => { try { event.sender.send('ai-upscale-progress', p); } catch { /* window gone */ } };
  const r = await aiUpscaler.upscale(new Uint8Array(rgba), width, height, scale, onProgress);
  return { data: r.data, width: r.width, height: r.height, backend: aiUpscaler.getBackend() };
});

// AI motion deblur (NAFNet-GoPro via onnxruntime-node, main-process native). Availability is
// DirectML-gated (see aiDeblur.cjs) so a CPU-only machine reports unavailable and the control hides.
ipcMain.handle('ai-deblur-available', async () => {
  try { return await aiDeblur.isAvailable(); } catch { return false; }
});
ipcMain.handle('ai-deblur', async (event, { rgba, width, height }) => {
  const onProgress = (p) => { try { event.sender.send('ai-deblur-progress', p); } catch { /* window gone */ } };
  const r = await aiDeblur.deblur(new Uint8Array(rgba), width, height, onProgress);
  return { data: r.data, width: r.width, height: r.height, backend: aiDeblur.getBackend(), skippedTiles: r.skippedTiles ?? 0 };
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

// Tear down every fs.watch handle on window close so no watcher (or its pending
// debounce timer) outlives the window — otherwise a reload/close leaks native watch
// handles and a debouncer could fire `webContents.send` on a destroyed window.
// Declared here (hoisted) but referenced from mainWindow.on('closed') in createWindow.
function closeAllFolderWatchers() {
  for (const watcher of folderWatchers.values()) {
    try {
      if (watcher && watcher._debouncer) watcher._debouncer.cancel();
      if (watcher) watcher.close();
    } catch (error) {
      console.warn('Failed to close folder watcher:', error && error.message);
    }
  }
  folderWatchers.clear();
}

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

    // For RAW files, extract an embedded JPEG preview.
    if (RAW_FORMATS.includes(ext)) {
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

          const { findEmbeddedJpegs, rawDataStart, readOrientation, applyExifOrientation } = require('./embeddedPreview.cjs');
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
              // 512px box (was 300x200): gallery tiles run 420px+ wide, and the
              // old cap left RAW tiles visibly soft — portrait previews were
              // squeezed to 150x200 and upscaled ~3x. 512 keeps a ~2000-entry
              // worst-case cache in the tens of MB while covering both surfaces.
              const out = await pipe
                .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
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
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
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

// applyExifOrientation now lives in ./embeddedPreview.cjs (shared with rawDecoder.cjs's
// progressive-preview path); the read-image-as-data-url handler requires it locally.

// Path validation for the write IPC handlers. The policy itself (deny-list of protected
// dirs + user autorun sinks, and the optional extension allow-list) lives in the pure,
// unit-tested electron/writePathPolicy.cjs; this thin wrapper only gathers the Electron/
// environment-derived deny-list bases and delegates. We use a DENY-LIST of dirs (not an
// allow-list) because the app legitimately exports to any user-chosen path (Desktop, SD
// cards, native save dialog); the deny-list blocks the realistic threats — a compromised
// renderer writing into a system path OR into an autorun sink (Startup / PowerShell
// profile / ~/.ssh) to escalate a file-write into persistent code execution.
function currentDeniedWriteBases() {
  let appDataDir;
  let installDir;
  try { appDataDir = app.getPath('appData'); } catch { appDataDir = undefined; }
  try { installDir = path.dirname(app.getPath('exe')); } catch { installDir = undefined; }
  return computeDeniedBases({
    env: process.env,
    homeDir: os.homedir(),
    resourcesPath: process.resourcesPath,
    installDir,
    appDataDir,
  });
}

// Resolve the write target's DIRECT parent dir to its REAL path, so the deny-list compare
// sees through 8.3 short names (PROGRA~1) and symlinks/junctions a string prefix would miss.
// Every protected sink (Startup / PowerShell profile / ~/.ssh / system dirs) already exists,
// so a write INTO one has an existing direct parent that realpath resolves; a write whose
// parent does NOT exist can't be a sink, so returning undefined (pure path.resolve fallback,
// which still covers traversal + trailing dot/space) is safe. Best-effort — never throws.
function realParentDir(p) {
  try {
    return fs.realpathSync.native(path.dirname(path.resolve(p)));
  } catch {
    return undefined;
  }
}

// @param {{ requireAllowedExtension?: boolean }} [opts]
function validateWritePath(p, opts = {}) {
  return enforceWritePolicy(p, {
    deniedBases: currentDeniedWriteBases(),
    realDir: realParentDir(p),
    ...opts,
  });
}

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    const safeFilePath = validateWritePath(filePath, { requireAllowedExtension: true });
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
    const safeFilePath = validateWritePath(filePath, { requireAllowedExtension: true });
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

// Read camera EXIF from a proprietary RAW container (ORF/CR2/NEF/ARW/DNG/...).
// exifreader THROWS "Invalid image format" on these containers and the embedded
// preview JPEG often carries no EXIF, so we parse the file's own TIFF/EXIF IFDs
// directly (electron/rawMetadata.cjs — unit-tested). Cheap, decode-independent,
// and cache-tier-agnostic: it reads the same fields whether the pixels come from
// a fresh decode, an L1 hit, or an L2 disk hit. Returns a flat metadata object,
// or null when nothing usable is found (never throws).
ipcMain.handle('read-raw-metadata', async (event, filePath) => {
  try {
    const { readRawMetadataFile } = require('./rawMetadata.cjs');
    // Bounded prefix read (Q6 LOW) — the header-local TIFF/EXIF parse doesn't need the whole
    // ~20-25MB RAW file; readRawMetadataFile reads a 1MB prefix and falls back to the whole file
    // only if that prefix yields nothing. See rawMetadata.cjs for the bounds-checking rationale.
    const md = await readRawMetadataFile(filePath);
    return Object.keys(md).length ? md : null;
  } catch (error) {
    console.warn('Failed to read RAW metadata:', error.message);
    return null;
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
    if (RAW_FORMATS.includes(ext)) {
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
    // A rejected path (deny-list / traversal guard) is a security condition, not a
    // soft write failure — surface it to the caller instead of returning { ok:false }.
    if (error instanceof Error && error.message.startsWith(WRITE_REJECT_PREFIX)) {
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
    if (RAW_FORMATS.includes(ext)) {
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

// Move files to the OS trash / Windows Recycle Bin (Gallery Del → "Move to Recycle
// Bin"). NEVER a permanent delete: each path goes through shell.trashItem, which is
// reversible from the Recycle Bin. Trashes each path independently and returns a
// per-path { path, ok, error } so a partially-failed batch cleanly splits into
// successes (dropped from the session list) and failures (kept, with a toast). Paths
// pass the same deny-list guard as the write handlers — a trash IS a destructive
// operation, so a compromised renderer must not trash a protected system location.
ipcMain.handle('trash-items', async (event, filePaths) => {
  if (!Array.isArray(filePaths)) return [];
  const results = [];
  for (const filePath of filePaths) {
    try {
      const safe = validateWritePath(filePath);
      await shell.trashItem(safe);
      results.push({ path: filePath, ok: true });
    } catch (error) {
      console.warn('Failed to trash item:', filePath, error && error.message);
      results.push({ path: filePath, ok: false, error: (error && error.message) || 'trash failed' });
    }
  }
  return results;
});

// Reveals a file in the OS file manager (Explorer on Windows), selecting it —
// Gallery tile context menu's "Show in Explorer" (Task Q5, P11 follow-up).
// Read-only / non-destructive (never writes, moves, or deletes anything), so unlike
// the write handlers it doesn't go through validateWritePath's system-location
// deny-list — it only validates the incoming value is a non-empty string, same
// input-validation shape as the other IPC handlers.
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'Invalid path' };
  }
  try {
    shell.showItemInFolder(path.resolve(filePath));
    return { ok: true };
  } catch (error) {
    console.warn('Failed to show item in folder:', filePath, error && error.message);
    return { ok: false, error: (error && error.message) || 'show in folder failed' };
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

// Decode a RAW file via the native LibRaw pipeline (true demosaic).
// Accepts optional decode options { demosaic, highlightMode }; defaults to
// DEFAULT_RAW_DECODE_OPTIONS (DCB + blend) when omitted.
// Runs in the main process (Node.js) to avoid browser SharedArrayBuffer/Emscripten issues.
ipcMain.handle('decode-raw-file', async (event, filePath, options) => {
  const { decodeRawFile } = require('./rawDecoder.cjs');
  try {
    return await decodeRawFile(filePath, console, options);
  } catch (error) {
    console.error('RAW decode failed:', error);
    throw new Error(`RAW decode failed: ${error.message}`);
  }
});

// Fast progressive-open preview: the camera's embedded JPEG, oriented + downscaled to fit
// maxDim (8-bit RGB). Decoded in a few hundred ms so the editor paints a meaningful image
// near-instantly while the full 16-bit LibRaw decode runs in the background (the transfer is
// ~9MB @ 2048px vs. 122MB for the full buffer). Rejects when no embedded preview exists —
// the renderer then falls back to a full-decode-first open.
ipcMain.handle('decode-raw-preview', async (event, filePath, maxDim) => {
  const { decodeEmbeddedPreview } = require('./rawDecoder.cjs');
  try {
    return await decodeEmbeddedPreview(filePath, maxDim || 2048, console);
  } catch (error) {
    console.warn('RAW preview decode failed:', error.message);
    throw new Error(`RAW preview decode failed: ${error.message}`);
  }
});

// Disk-persisted base cache (L2): serve a decoded RAW base persisted from an EARLIER SESSION for
// this exact (path, decode options) so a 2nd-session cold open gets full quality from a fast NVMe
// read (~1s) instead of the ~4.3s native LibRaw decode. Returns the SAME shape as decode-raw-file
// ({ data, width, height, channels, bitDepth }) or null on a miss. See electron/baseCache.cjs.
ipcMain.handle('base-cache-read', async (event, filePath, options) => {
  try {
    return await require('./baseCache.cjs').read(filePath, options);
  } catch (error) {
    console.warn('base-cache-read failed:', error.message);
    return null; // a cache read failure is never fatal — the renderer decodes fresh
  }
});

// Write-through: persist a freshly-decoded base (fire-and-forget from the renderer; atomic
// temp+rename + LRU eviction happen here off the renderer's critical path). Keyed by the captured
// decode options for coherence. The PREVIEW is never written here (only full decodes route in).
ipcMain.handle('base-cache-write', async (event, filePath, options, payload) => {
  try {
    await require('./baseCache.cjs').write(filePath, options, payload);
    return true;
  } catch (error) {
    console.warn('base-cache-write failed:', error.message);
    return false;
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

  // Initialise the disk-persisted base cache (L2) and rebuild its in-memory index by scanning the
  // cache dir. Cheap (a dir listing + one stat/sidecar read per entry, ~a few dozen entries) but
  // wrapped in try/catch so a broken cache dir can never break startup. Must run after app-ready
  // (userData path is only valid then).
  try {
    const indexed = require('./baseCache.cjs').init(path.join(app.getPath('userData'), 'base-cache'));
    console.log(`Base cache (L2) initialised: ${indexed} persisted RAW base(s) indexed`);
  } catch (baseCacheInitError) {
    console.warn('Base cache init failed (continuing without disk cache):', baseCacheInitError.message);
  }

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

  let expected;
  try { expected = new URL(appUrl); } catch { expected = null; }

  contents.on('will-navigate', (e, url) => {
    let target;
    try { target = new URL(url); } catch { e.preventDefault(); return; }
    // Structured comparison (NOT startsWith, which a crafted host/path like
    // "http://localhost:3005.evil.com" would bypass). Same protocol + host, and
    // for file:// also the exact pathname (the app's index.html).
    const sameOrigin = !!expected
      && target.protocol === expected.protocol
      && target.host === expected.host;
    const samePath = expected && expected.protocol === 'file:'
      ? target.pathname === expected.pathname
      : true;
    if (!sameOrigin || !samePath) {
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