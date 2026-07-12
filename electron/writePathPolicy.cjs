'use strict';

// Write-path security policy for the file-write IPC handlers (round-10 H2 security).
//
// Two independent layers, both enforced before any fs write:
//  1. DENY-LIST of directories a write must never land in. Beyond the system dirs
//     (SystemRoot / Program Files / the packaged app's own resources+install dir),
//     this also denies USER-WRITABLE AUTORUN SINKS — the per-user Startup folder, the
//     PowerShell profile dirs, and ~/.ssh — so a compromised renderer cannot turn an
//     arbitrary file-write into PERSISTENT CODE EXECUTION (drop a .ps1/.lnk that runs
//     at logon, or overwrite authorized_keys). We use a deny-list (not an allow-list
//     of dirs) because the app legitimately exports to any user-chosen folder (Desktop,
//     SD cards, native save dialog), so an allow-list would break real export flows.
//  2. An EXTENSION ALLOW-LIST for the raster/generic write handlers: the app only ever
//     writes image / sidecar / data files, never executables or scripts. Anything
//     outside the allow-list is rejected — defense in depth against a payload path that
//     dodges the dir deny-list (e.g. a .bat dropped into an ordinary folder on PATH).
//
// Pure + Electron-free so it unit-tests in plain Node (see src/test/writePathPolicy.test.ts);
// main.cjs injects the environment-derived deny-list bases via computeDeniedBases().

const path = require('node:path');

// The complete set of extensions the write IPC handlers legitimately produce, derived
// from the real callers:
//   - write-image-file  (ExportService)         → .jpg .jpeg .png .tif .tiff .webp
//   - write-file         (ElectronService.saveFile save-dialog) → .jpg .jpeg .png .tif .tiff
//   - write-image-rating (sidecar path)         → .xmp
//   - preset / store JSON                        → .json
//   - logs                                       → .log
//   - embedded ICC profiles                      → .icc
// Extend ONLY when a new benign writer is added. Executables/scripts are never here.
const ALLOWED_WRITE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp',
  '.xmp', '.json', '.log', '.icc',
]);

// All security rejections share this message prefix so callers (e.g. write-image-rating)
// can distinguish a hard security stop from a soft write failure by prefix.
const REJECT_PREFIX = 'Write path rejected';

/**
 * Compute the resolved + lowercased list of directories writes must never target.
 * Pure: every environment-derived value is passed in, so it's testable in plain Node.
 *
 * @param {object} o
 * @param {NodeJS.ProcessEnv} [o.env]   process.env (SystemRoot / ProgramFiles / APPDATA)
 * @param {string} [o.homeDir]          os.homedir()
 * @param {string} [o.resourcesPath]    process.resourcesPath (packaged bundle)
 * @param {string} [o.installDir]       path.dirname(app.getPath('exe'))
 * @param {string} [o.appDataDir]       app.getPath('appData') (roaming; Startup lives under it)
 * @returns {string[]} resolved, lowercased base dirs
 */
function computeDeniedBases({ env = {}, homeDir, resourcesPath, installDir, appDataDir } = {}) {
  const bases = [
    // System locations
    env.SystemRoot,
    env.windir,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    resourcesPath,
    installDir,
  ];

  // Per-user Startup folder — anything here (a .lnk/.exe/.bat) runs at every logon.
  // Derive from the roaming appData dir Electron reports, else from %APPDATA%.
  const appData = appDataDir || env.APPDATA;
  if (appData) {
    bases.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
  }

  // PowerShell profile dirs (profile.ps1 runs on every shell start) and the SSH key
  // dir (an authorized_keys / config overwrite is a persistent foothold).
  if (homeDir) {
    bases.push(path.join(homeDir, 'Documents', 'WindowsPowerShell'));
    bases.push(path.join(homeDir, 'Documents', 'PowerShell'));
    bases.push(path.join(homeDir, '.ssh'));
  }

  return bases.filter(Boolean).map((d) => path.resolve(d).toLowerCase());
}

function isAllowedWriteExtension(p) {
  return ALLOWED_WRITE_EXTENSIONS.has(path.extname(p).toLowerCase());
}

/**
 * Resolve `p` (which collapses any `..` traversal) and enforce the deny-list and, when
 * requested, the extension allow-list. Returns the resolved absolute path, or throws an
 * Error whose message starts with REJECT_PREFIX for any security rejection.
 *
 * @param {string} p
 * @param {object} [opts]
 * @param {string[]} [opts.deniedBases]            from computeDeniedBases()
 * @param {boolean}  [opts.requireAllowedExtension] enforce ALLOWED_WRITE_EXTENSIONS
 */
function validateWritePath(p, { deniedBases = [], requireAllowedExtension = false } = {}) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error('Invalid write path');
  }
  const resolved = path.resolve(p);
  const lower = resolved.toLowerCase();
  for (const base of deniedBases) {
    if (lower === base || lower.startsWith(base + path.sep)) {
      throw new Error(`${REJECT_PREFIX} (protected location): ${p}`);
    }
  }
  if (requireAllowedExtension && !isAllowedWriteExtension(resolved)) {
    throw new Error(`${REJECT_PREFIX} (extension not allowed): ${p}`);
  }
  return resolved;
}

module.exports = {
  ALLOWED_WRITE_EXTENSIONS,
  REJECT_PREFIX,
  computeDeniedBases,
  isAllowedWriteExtension,
  validateWritePath,
};
