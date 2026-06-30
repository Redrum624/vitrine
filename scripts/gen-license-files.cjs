#!/usr/bin/env node
/**
 * gen-license-files.cjs
 * Copies LICENSE and THIRD-PARTY-LICENSES.md into the release/ directory
 * so they ship alongside the installer and portable executable.
 * Usage: node scripts/gen-license-files.cjs
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');

if (!fs.existsSync(RELEASE)) {
  fs.mkdirSync(RELEASE, { recursive: true });
}

const files = ['LICENSE', 'THIRD-PARTY-LICENSES.md'];

for (const file of files) {
  const src  = path.join(ROOT, file);
  const dest = path.join(RELEASE, file);
  if (!fs.existsSync(src)) {
    console.error(`[gen-license-files] Missing source file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`[gen-license-files] Copied ${file} -> release/${file}`);
}
