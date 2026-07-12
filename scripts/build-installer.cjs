// Runs electron-builder with TEMP/TMP pointed at the per-user temp directory.
//
// Why: an elevated shell inherits TEMP=C:\WINDOWS\TEMP. NSIS (makensis) writes its
// generated `!include` scripts there as nstXXXX.tmp files, but C:\WINDOWS\TEMP is swept
// by Windows (Storage Sense / Disk Cleanup / AV), so a temp file can vanish mid-compile:
//   !include: could not find: "C:\WINDOWS\TEMP\nstD500.tmp"  -> the installer build fails.
// The per-user temp (%LOCALAPPDATA%\Temp) is writable and not swept like that.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const userTemp = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp');
try { fs.mkdirSync(userTemp, { recursive: true }); } catch { /* already exists */ }

// Prepend node_modules/.bin so electron-builder resolves whether this runs via an npm
// script (npm adds .bin to PATH) or directly (it doesn't).
const binDir = path.join(__dirname, '..', 'node_modules', '.bin');
const env = {
  ...process.env,
  TEMP: userTemp,
  TMP: userTemp,
  PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
};
console.log(`[build-installer] electron-builder with TEMP=${userTemp}`);

const result = spawnSync('electron-builder', process.argv.slice(2), { stdio: 'inherit', env, shell: true });
process.exit(result.status == null ? 1 : result.status);
