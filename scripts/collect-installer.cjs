#!/usr/bin/env node
/**
 * collect-installer.cjs
 *
 * Copies just the user-facing distributables into a clean `installer/` folder at the repo root:
 *   - Vitrine Setup <version>.exe      (the NSIS installer)
 *   - Vitrine <version> portable.exe   (no-install single-exe build)
 *   - Vitrine <version> README.txt     (plain-text readme)
 *   - SHA256SUMS.txt                   (checksums of both exes, from gen-checksums.cjs)
 *   - LICENSE                          (project license)
 *   - THIRD-PARTY-LICENSES.md          (required: BSD/LGPL attribution must accompany the build)
 *
 * Everything else electron-builder drops in `release/` (win-unpacked, .blockmap, etc.) is left behind.
 * Run automatically at the end of `build:win`; can also be run standalone after a build.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const INSTALLER = path.join(ROOT, 'installer');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const WANTED = [
  `Vitrine Setup ${VERSION}.exe`,
  `Vitrine ${VERSION} portable.exe`,
  `Vitrine ${VERSION} README.txt`,
  'SHA256SUMS.txt',
  'LICENSE',
  'THIRD-PARTY-LICENSES.md',
];

// Clean + recreate so the folder always reflects exactly this build.
fs.rmSync(INSTALLER, { recursive: true, force: true });
fs.mkdirSync(INSTALLER, { recursive: true });

let copied = 0;
const missing = [];
for (const name of WANTED) {
  const src = path.join(RELEASE, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(INSTALLER, name));
    console.log(`[collect-installer] + ${name}`);
    copied++;
  } else {
    missing.push(name);
    console.warn(`[collect-installer] MISSING: ${name}`);
  }
}

console.log(`[collect-installer] ${copied}/${WANTED.length} files -> installer/`);
if (missing.length) {
  console.error(`[collect-installer] Missing required file(s): ${missing.join(', ')}`);
  process.exit(1);
}
