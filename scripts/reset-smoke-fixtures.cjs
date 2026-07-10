#!/usr/bin/env node
/**
 * scripts/reset-smoke-fixtures.cjs
 *
 * Wipes persisted EditPersistenceService edit-state entries (the `edits:<filePath>`
 * store keys — see src/services/EditPersistenceService.ts) for every image file found
 * under a given folder. Smoke-test fixtures accumulate edits across repeated runs
 * (module params, Local Adjustment layers, RAW decode options) that then leak into
 * the next smoke run's screenshots/assertions — run this between sessions to reset
 * the fixture folder back to a clean, unedited state.
 *
 * The generic key-value store lives under Electron's userData dir:
 *   %APPDATA%/photo_app/store/<sha1(key)>.json   (Windows; "photo_app" is the
 *   unpackaged app name — package.json's top-level "name" field, which is what
 *   Electron's app.getPath('userData') actually uses in dev, NOT build.productName)
 * Each key is content-hashed (see storeFilePath() in electron/main.cjs), so there is
 * no index file listing which hash belongs to which path — this script recomputes
 * the hash for the `edits:<path>` key of every image file it finds under the target
 * folder and deletes the matching JSON file if present.
 *
 * Scope: this script ONLY touches EditPersistenceService's `edits:` keys. It does
 * NOT touch CheckpointService's separate `history:<path>` keys (the undo/redo
 * checkpoint timeline) — that is intentionally a different store namespace and out
 * of scope here.
 *
 * Usage:
 *   node scripts/reset-smoke-fixtures.cjs [folder] [--dry-run]
 *
 *   folder     Defaults to C:\Users\<user>\Pictures\2024\2024-09-19
 *   --dry-run  Print what would be deleted without touching any files.
 *
 * Runs as plain Node (no Electron) against the same userData path Electron computes
 * at runtime, so close the app before running this to avoid racing a live storeSet.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/**
 * Mirrors src/services/FileSystemService.ts's own IMAGE_EXTENSIONS — only files the
 * app itself recognizes as images ever get scanned into an ImageFileInfo and thus
 * ever get an `edits:<path>` entry, so this list is the correct universe to search.
 */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
  '.orf', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2', '.pef',
]);

const DEFAULT_FOLDER = 'C:\\Users\\<user>\\Pictures\\2024\\2024-09-19';
// Matches package.json's top-level "name" — the unpackaged app's userData folder name.
const APP_NAME = 'photo_app';

/** Mirrors EditPersistenceService.keyForPath() — the key EVERY per-image edit-state entry is stored under. */
function keyForPath(filePath) {
  return `edits:${filePath}`;
}

/** Mirrors storeFilePath() in electron/main.cjs — content-hashed filename for a store key. */
function storeFilePath(storeDir, key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex');
  return path.join(storeDir, `${hash}.json`);
}

/** The generic store's directory under Electron's userData path (see electron/main.cjs STORE_DIR). */
function getUserDataStoreDir(appName = APP_NAME) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, appName, 'store');
}

/** Every image file directly under `folder` (non-recursive — matches a single fixture folder). */
function listImageFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXTENSIONS.has(path.extname(d.name).toLowerCase()))
    .map((d) => path.join(folder, d.name));
}

/** Pure planning step: which store files would be targeted for a list of image paths. Testable without touching disk. */
function planDeletions(storeDir, imagePaths) {
  return imagePaths.map((imgPath) => ({
    imagePath: imgPath,
    storeFile: storeFilePath(storeDir, keyForPath(imgPath)),
  }));
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((a) => !a.startsWith('--')) || DEFAULT_FOLDER;

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Folder not found: ${folder}`);
    process.exitCode = 1;
    return;
  }

  const storeDir = getUserDataStoreDir();
  const images = listImageFiles(folder);
  console.log(`Found ${images.length} image file(s) under ${folder}`);

  const plan = planDeletions(storeDir, images);
  let deleted = 0;
  for (const { imagePath, storeFile } of plan) {
    if (!fs.existsSync(storeFile)) continue;
    if (dryRun) {
      console.log(`[dry-run] would delete ${storeFile} (${imagePath})`);
    } else {
      fs.unlinkSync(storeFile);
      console.log(`deleted ${storeFile} (${imagePath})`);
    }
    deleted++;
  }
  console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deleted} of ${images.length} persisted-edit entr${deleted === 1 ? 'y' : 'ies'}.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  IMAGE_EXTENSIONS,
  DEFAULT_FOLDER,
  APP_NAME,
  keyForPath,
  storeFilePath,
  getUserDataStoreDir,
  listImageFiles,
  planDeletions,
};
