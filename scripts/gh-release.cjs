#!/usr/bin/env node
/**
 * gh-release.cjs
 * Creates (or updates) a GitHub release for the current package version.
 *
 * Usage: node scripts/gh-release.cjs
 *   - Reads version from package.json
 *   - Locates built artifacts in release/
 *   - Extracts release notes from CHANGELOG.md (## [version] section)
 *   - Runs: gh release create v<version> <files> --title "..." --notes-file <tmp>
 *   - If release already exists: gh release upload v<version> <files> --clobber
 *   - Before any upload: release/latest.yml must describe release/Vitrine-Setup-<version>.exe
 *     (name, sha512, size) and carry the package version, else nothing is published (exit 1)
 *   - After create/upload: reads the release back (gh release view --json) and the live feed
 *     (/releases/latest, then its latest.yml, as installed copies read them); any failed check
 *     exits 1. SUCCESS and the release URL are printed only when every check passes.
 *
 * Requires: gh CLI authenticated (gh auth status).
 */

'use strict';

const fs                        = require('fs');
const path                      = require('path');
const crypto                    = require('crypto');
const { spawnSync }             = require('child_process');
const os                        = require('os');
const { missingRequired, preUploadErrors } = require('./release-assets.cjs');
const { publishRepo, checkPublished, formatCheck } = require('./check-update-feed.cjs');

const ROOT    = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const REPO    = 'Redrum624/vitrine';

// ---------------------------------------------------------------------------
// Helper: run gh with an explicit arg array (no shell interpolation)
// ---------------------------------------------------------------------------
function gh(...args) {
  console.log(`[gh-release] $ gh ${args.join(' ')}`);
  const result = spawnSync('gh', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  if (result.error) {
    console.error(`[gh-release] spawn error: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. Read version
// ---------------------------------------------------------------------------
const pkg     = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const TAG     = `v${VERSION}`;

console.log(`[gh-release] Targeting release ${TAG}`);

// ---------------------------------------------------------------------------
// 2. Locate artifacts
// ---------------------------------------------------------------------------
const CANDIDATES = [
  `Vitrine-Setup-${VERSION}.exe`,
  `Vitrine-Setup-${VERSION}.exe.blockmap`, // electron-updater delta downloads
  'latest.yml',                             // electron-updater feed: REQUIRED or installed copies cannot update
  `Vitrine-${VERSION}-portable.exe`,
  `Vitrine-${VERSION}-README.txt`,
  'SHA256SUMS.txt',
  'LICENSE',
  'THIRD-PARTY-LICENSES.md',
];

const existing = [];
const missing  = [];

for (const name of CANDIDATES) {
  const full = path.join(RELEASE, name);
  if (fs.existsSync(full)) {
    existing.push(full);
    console.log(`[gh-release]   Found: ${name}`);
  } else {
    missing.push(name);
    console.warn(`[gh-release]   MISSING (skipping): ${name}`);
  }
}

// The updater's assets are mandatory: fail before creating/uploading anything.
const fatal = missingRequired(existing.map((f) => path.basename(f)), VERSION);
if (fatal.length) {
  console.error(`[gh-release] ERROR: required updater asset(s) missing from release/: ${fatal.join(', ')}. Run npm run build:win first.`);
  process.exit(1);
}

if (existing.length === 0) {
  console.error('[gh-release] ERROR: No artifacts found in release/. Run npm run build:win first.');
  process.exit(1);
}

// latest.yml must describe the installer being uploaded, under this version: a mismatch makes every
// installed copy fail its update (wrong name/size/sha512) or skip it (wrong version).
const INSTALLER_NAME = `Vitrine-Setup-${VERSION}.exe`;
const installerBuf   = fs.readFileSync(path.join(RELEASE, INSTALLER_NAME));
const INSTALLER_SIZE = installerBuf.length;
const gateErrors = preUploadErrors(fs.readFileSync(path.join(RELEASE, 'latest.yml'), 'utf8'), {
  installerName: INSTALLER_NAME,
  installerSha512: crypto.createHash('sha512').update(installerBuf).digest('base64'),
  installerSize: INSTALLER_SIZE,
  version: VERSION,
});
if (gateErrors.length) {
  for (const e of gateErrors) console.error(`[gh-release] ERROR: ${e}`);
  console.error('[gh-release] Nothing was published. Rebuild with npm run build:win.');
  process.exit(1);
}
console.log(`[gh-release] release/latest.yml matches ${INSTALLER_NAME} (name, sha512, size) and version ${VERSION}`);

// The feed installed copies read (build.publish, the source of app-update.yml); checked after publishing.
let feedRepo;
try {
  feedRepo = publishRepo(pkg);
} catch (e) {
  console.error(`[gh-release] ERROR: ${e.message}. Nothing was published.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Extract release notes from CHANGELOG.md
// ---------------------------------------------------------------------------
const changelogPath = path.join(ROOT, 'CHANGELOG.md');
let notes = `Release ${TAG}`;

if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  // Match ## [VERSION] section up to the next ## [ or end of file
  const re = new RegExp(
    `## \\[${escapeRegex(VERSION)}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
  );
  const m = changelog.match(re);
  if (m) {
    notes = m[1].trim();
    console.log(`[gh-release] Extracted ${notes.split('\n').length} lines of release notes from CHANGELOG.md`);
  } else {
    console.warn(`[gh-release] WARNING: No CHANGELOG section found for [${VERSION}], using default notes.`);
  }
} else {
  console.warn('[gh-release] WARNING: CHANGELOG.md not found, using default notes.');
}

// ---------------------------------------------------------------------------
// 3b. Append SHA256 checksums to the notes (generated by gen-checksums.cjs in
//     build:win) so users can verify downloads without opening SHA256SUMS.txt.
// ---------------------------------------------------------------------------
const sumsPath = path.join(RELEASE, 'SHA256SUMS.txt');
if (fs.existsSync(sumsPath)) {
  const sums = fs.readFileSync(sumsPath, 'utf8').trim();
  notes += `\n\n### SHA256 checksums\n\n\`\`\`\n${sums}\n\`\`\`\n\nVerify on Windows: \`CertUtil -hashfile "<downloaded file>" SHA256\``;
  console.log('[gh-release] Appended SHA256 checksums to release notes.');
} else {
  console.warn('[gh-release] WARNING: SHA256SUMS.txt not found — notes will have no checksum section.');
}

// ---------------------------------------------------------------------------
// 4. Write notes to a temp file (keeps args clean — no shell quoting needed)
// ---------------------------------------------------------------------------
const notesFile = path.join(os.tmpdir(), `gh-release-notes-${VERSION}.md`);
fs.writeFileSync(notesFile, notes, 'utf8');

// ---------------------------------------------------------------------------
// 5. Check whether the release already exists
// ---------------------------------------------------------------------------
function releaseExists() {
  const r = gh('release', 'view', TAG, '--repo', REPO);
  return r.status === 0;
}

// ---------------------------------------------------------------------------
// 6. Create or update the release
// ---------------------------------------------------------------------------
let releaseUrl = '';

if (releaseExists()) {
  console.log(`[gh-release] Release ${TAG} already exists — uploading/clobbering assets.`);
  const up = gh('release', 'upload', TAG, ...existing, '--clobber', '--repo', REPO);
  if (up.status !== 0) {
    console.error('[gh-release] ERROR: gh release upload failed.');
    process.exit(1);
  }
  const view = gh('release', 'view', TAG, '--repo', REPO, '--json', 'url');
  if (view.status === 0) {
    try { releaseUrl = JSON.parse(view.stdout).url; } catch { /* ignore */ }
  }
} else {
  const title = `Vitrine ${TAG}`;
  const create = gh(
    'release', 'create', TAG,
    ...existing,
    '--title', title,
    '--notes-file', notesFile,
    '--repo', REPO,
  );
  if (create.status !== 0) {
    console.error('[gh-release] ERROR: gh release create failed.');
    process.exit(1);
  }
  releaseUrl = (create.stdout || '').trim();
}

try { fs.unlinkSync(notesFile); } catch { /* best-effort cleanup */ }

// ---------------------------------------------------------------------------
// 7. Read the release back and the live feed, as installed copies read them
//    (owner/repo from build.publish, the source of the installed app-update.yml)
// ---------------------------------------------------------------------------
checkPublished({ ...feedRepo, version: VERSION, installerName: INSTALLER_NAME, installerSize: INSTALLER_SIZE }).then(
  (checks) => {
    const failed = checks.filter((c) => c.error);
    for (const c of checks) console.log(`[gh-release]   ${formatCheck(c)}`);
    if (failed.length) {
      console.error(`[gh-release] ERROR: ${TAG} is on GitHub but installed copies cannot see or verify it (${failed.length} failed check(s) above).`);
      console.error('[gh-release] Fix the release on GitHub, then re-check (read-only): node scripts/check-update-feed.cjs');
      console.error(`[gh-release] Release URL: ${releaseUrl}`);
      process.exit(1);
    }
    // -------------------------------------------------------------------------
    // 8. Done
    // -------------------------------------------------------------------------
    console.log('');
    console.log('[gh-release] SUCCESS');
    console.log(`[gh-release] Release URL: ${releaseUrl}`);
    if (missing.length) {
      console.log(`[gh-release] Missing artifacts (not uploaded): ${missing.join(', ')}`);
    }
  },
  (e) => {
    console.error(`[gh-release] ERROR: could not read ${TAG} back: ${e.message}`);
    console.error('[gh-release] Re-check (read-only): node scripts/check-update-feed.cjs');
    process.exit(1);
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
