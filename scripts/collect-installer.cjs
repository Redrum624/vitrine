#!/usr/bin/env node
/**
 * collect-installer.cjs
 *
 * Copies just the user-facing distributables into a clean `installer/` folder at the repo root:
 *   - Vitrine-Setup-<version>.exe      (the NSIS installer)
 *   - Vitrine-<version>-portable.exe   (no-install single-exe build)
 *   - Vitrine-Setup-<version>.exe.blockmap + latest.yml (what electron-updater reads)
 *   - Vitrine-<version>-README.txt     (plain-text readme)
 *   - SHA256SUMS.txt                   (checksums of both exes, from gen-checksums.cjs)
 *   - LICENSE                          (project license)
 *   - THIRD-PARTY-LICENSES.md          (required: BSD/LGPL attribution must accompany the build)
 *
 * Everything else electron-builder drops in `release/` (win-unpacked, etc.) is left behind.
 * Run automatically at the end of `build:win`; can also be run standalone after a build.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const INSTALLER = path.join(ROOT, 'installer');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const INSTALLER_NAME = `Vitrine-Setup-${VERSION}.exe`;

const WANTED = [
  INSTALLER_NAME,
  `${INSTALLER_NAME}.blockmap`,
  'latest.yml',
  `Vitrine-${VERSION}-portable.exe`,
  `Vitrine-${VERSION}-README.txt`,
  'SHA256SUMS.txt',
  'LICENSE',
  'THIRD-PARTY-LICENSES.md',
];

/**
 * Pure check that latest.yml describes exactly the installer we ship: the
 * `url` of every files[] entry and the top-level `path` equal the installer's
 * file name, and the top-level `sha512` equals the installer's base64 sha512.
 * A mismatch makes every installed copy fail its update download.
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateLatestYml(ymlText, installerName, installerSha512, installerSize) {
  const errors = [];
  const unq = (v) => v.replace(/^['"]|['"]$/g, '');
  const entries = [];
  let inFiles = false;
  for (const line of ymlText.split('\n')) {
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (inFiles && /^\S/.test(line)) inFiles = false;
    if (!inFiles) continue;
    const m = line.match(/^\s*(-\s+)?(url|sha512|size):\s*(.+?)\s*$/);
    if (!m) continue;
    if (m[1] && m[2] === 'url') entries.push({});
    if (entries.length) entries[entries.length - 1][m[2]] = m[3];
  }
  const pathM = ymlText.match(/^path:\s*(.+?)\s*$/m);
  const shaM = ymlText.match(/^sha512:\s*(.+?)\s*$/m);
  if (entries.length === 0) errors.push('latest.yml has no files[].url');
  for (const e of entries) {
    const u = e.url === undefined ? '' : unq(e.url);
    if (u !== installerName) errors.push(`latest.yml url "${u}" != installer "${installerName}"`);
    if (e.sha512 !== undefined && unq(e.sha512) !== installerSha512) {
      errors.push(`latest.yml files[].sha512 for "${u}" does not match the installer`);
    }
    if (installerSize !== undefined && e.size !== undefined && Number(unq(e.size)) !== installerSize) {
      errors.push(`latest.yml files[].size ${e.size} != installer size ${installerSize}`);
    }
  }
  if (!pathM) errors.push('latest.yml has no path');
  else if (unq(pathM[1]) !== installerName) {
    errors.push(`latest.yml path "${pathM[1]}" != installer "${installerName}"`);
  }
  if (!shaM) errors.push('latest.yml has no sha512');
  else if (unq(shaM[1]) !== installerSha512) {
    errors.push('latest.yml sha512 does not match the installer');
  }
  return { ok: errors.length === 0, errors };
}

function main() {
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

  const buf = fs.readFileSync(path.join(INSTALLER, INSTALLER_NAME));
  const sha = crypto.createHash('sha512').update(buf).digest('base64');
  const v = validateLatestYml(fs.readFileSync(path.join(INSTALLER, 'latest.yml'), 'utf8'), INSTALLER_NAME, sha, buf.length);
  if (!v.ok) {
    for (const e of v.errors) console.error(`[collect-installer] ${e}`);
    process.exit(1);
  }
  console.log('[collect-installer] latest.yml matches the installer (name + sha512)');
}

if (require.main === module) main();

module.exports = { validateLatestYml };
