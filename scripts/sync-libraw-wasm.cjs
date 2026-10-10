#!/usr/bin/env node
/**
 * sync-libraw-wasm.cjs
 *
 * Copy the libraw-wasm runtime (`libraw.js` + `libraw.wasm`) from the installed
 * `libraw-wasm` package next to the patched `public/libraw/worker.js`.
 *
 * Why this exists: worker.js loads both files from its own directory, but they are
 * git-ignored build outputs, so a fresh clone had only worker.js. The wasm rung of the
 * RAW decode chain (electron/librawWasmNode.cjs) then aborted inside the worker and the
 * open waited out its 60s watchdog before falling back to the upscaled embedded JPEG —
 * on every RAW open whenever the native dcraw_emu was absent too. Runs on postinstall
 * and before every build, so dev runs and packaged builds (extraResources ships
 * public/libraw) always carry the runtime.
 *
 * Also warns when the native LibRaw binary (vendor/libraw/dcraw_emu.exe, git-ignored)
 * is missing: RAW still decodes through libraw-wasm, just slower.
 *
 * Never fails the install/build: a missing source package is reported, not fatal.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNTIME_FILES = ['libraw.js', 'libraw.wasm'];

/**
 * Copy each runtime file from srcDir to destDir when it is missing or differs in size.
 * Returns { copied, upToDate, missingSource }.
 */
function syncRuntime(srcDir, destDir) {
  const result = { copied: [], upToDate: [], missingSource: [] };
  for (const name of RUNTIME_FILES) {
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(src)) {
      result.missingSource.push(name);
      continue;
    }
    const same = fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size;
    if (same) {
      result.upToDate.push(name);
      continue;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    result.copied.push(name);
  }
  return result;
}

function main() {
  const srcDir = path.join(ROOT, 'node_modules', 'libraw-wasm', 'dist');
  const destDir = path.join(ROOT, 'public', 'libraw');
  const { copied, missingSource } = syncRuntime(srcDir, destDir);

  if (copied.length) console.log(`[libraw] copied ${copied.join(', ')} → public/libraw`);
  if (missingSource.length) {
    console.warn(
      `[libraw] WARNING: ${missingSource.join(', ')} not found in node_modules/libraw-wasm/dist — ` +
      'install dependencies first; RAW files will fall back to the embedded JPEG.',
    );
  }
  if (!fs.existsSync(path.join(ROOT, 'vendor', 'libraw', 'dcraw_emu.exe'))) {
    console.warn(
      '[libraw] note: vendor/libraw/dcraw_emu.exe not found — RAW files decode with libraw-wasm ' +
      '(slower). See docs/LIBRAW_INTEGRATION.md.',
    );
  }
}

if (require.main === module) main();

module.exports = { syncRuntime, RUNTIME_FILES };
