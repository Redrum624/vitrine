// Builds the Microsoft Store (MSIX/appx) package.
//
// Identity: the Store requires exact identity values assigned by Partner Center
// (Product management -> Product identity). Those live in store-identity.json at the
// repo root (gitignored — they are account-specific, not source). Without that file
// this script builds with clearly-labeled LOCAL TEST identity values: the output is
// installable locally via dev-mode loose registration for validation, but MUST NOT
// be uploaded to the Store.
//
// Same TEMP fix as build-installer.cjs: elevated shells inherit C:\WINDOWS\TEMP,
// which Windows sweeps mid-build; point electron-builder at the per-user temp.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const identityFile = path.join(root, 'store-identity.json');

let identity;
if (fs.existsSync(identityFile)) {
  identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
  for (const field of ['identityName', 'publisher', 'publisherDisplayName']) {
    if (!identity[field] || typeof identity[field] !== 'string') {
      console.error(`[build-store] store-identity.json is missing "${field}" — copy it from Partner Center > Product identity.`);
      process.exit(1);
    }
  }
  console.log(`[build-store] STORE identity: ${identity.identityName} (${identity.publisherDisplayName})`);
} else {
  identity = {
    identityName: 'VitrineLocalTest',
    publisher: 'CN=Vitrine Local Test',
    publisherDisplayName: 'Vitrine Local Test',
  };
  console.warn('[build-store] *** LOCAL TEST identity — package is for dev-mode validation only, NOT Store upload. ***');
  console.warn('[build-store] Create store-identity.json with the Partner Center values for a real Store build.');
}

const userTemp = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp');
try { fs.mkdirSync(userTemp, { recursive: true }); } catch { /* already exists */ }

const binDir = path.join(root, 'node_modules', '.bin');
const env = {
  ...process.env,
  TEMP: userTemp,
  TMP: userTemp,
  PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
};

// shell:true joins args with spaces — quote values that may contain them so cmd
// hands each -c override to electron-builder as a single argv entry.
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
const args = [
  '--win', 'appx', '--publish=never',
  q(`-c.appx.identityName=${identity.identityName}`),
  q(`-c.appx.publisher=${identity.publisher}`),
  q(`-c.appx.publisherDisplayName=${identity.publisherDisplayName}`),
  ...process.argv.slice(2),
];

console.log(`[build-store] electron-builder ${args.join(' ')}`);
const result = spawnSync('electron-builder', args, { stdio: 'inherit', env, shell: true });
process.exit(result.status == null ? 1 : result.status);
