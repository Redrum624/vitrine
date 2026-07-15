#!/usr/bin/env node
/**
 * gen-checksums.cjs
 *
 * Writes release/SHA256SUMS.txt covering the executable distributables of the
 * current version (NSIS installer + portable exe). Runs at the end of
 * `build:win`, before collect-installer, so the checksums ship in `installer/`
 * and get uploaded with the GitHub release (gh-release.cjs also embeds them in
 * the release notes).
 *
 * Format is the standard `sha256sum` layout — one `<hash>  <filename>` line per
 * file — verifiable on Windows with:
 *   CertUtil -hashfile "Vitrine Setup <version>.exe" SHA256
 * or cross-platform with `sha256sum -c SHA256SUMS.txt`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const TARGETS = [
  `Vitrine Setup ${VERSION}.exe`,
  `Vitrine ${VERSION} portable.exe`,
];

const lines = [];
const missing = [];
for (const name of TARGETS) {
  const full = path.join(RELEASE, name);
  if (!fs.existsSync(full)) {
    missing.push(name);
    console.warn(`[gen-checksums] MISSING: ${name}`);
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  lines.push(`${hash}  ${name}`);
  console.log(`[gen-checksums] ${hash}  ${name}`);
}

if (lines.length === 0) {
  console.error('[gen-checksums] ERROR: no distributables found in release/ — run the build first.');
  process.exit(1);
}

const out = path.join(RELEASE, 'SHA256SUMS.txt');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`[gen-checksums] ${lines.length}/${TARGETS.length} hashes -> ${path.relative(ROOT, out)}`);
if (missing.length) {
  console.error(`[gen-checksums] Missing expected file(s): ${missing.join(', ')}`);
  process.exit(1);
}
