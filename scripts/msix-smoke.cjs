#!/usr/bin/env node
/**
 * msix-smoke.cjs — validation smoke for the Microsoft Store (MSIX/appx) package.
 *
 * MODEL VERIFIED EMPIRICALLY (Windows 11 26200, installed signed package, real
 * app-model activation): full-trust MSIX Vitrine runs with NO AppData filesystem
 * virtualization — it reads AND writes the REAL %APPDATA%\photo_app, the same one
 * the NSIS-installed Vitrine uses. Edits (store/*.json), presets (Chromium
 * localStorage) and the RAW base-cache are therefore SHARED between the Store and
 * installer versions: full continuity, no container divergence, no migration. The
 * package container (%LOCALAPPDATA%\Packages\<PFN>\LocalCache\...\photo_app) is
 * never created. This harness asserts exactly that model.
 *
 * LAUNCH CONTRACT (all learned the hard way):
 *   - Launching the layout/installed exe DIRECTLY = plain Win32 process, NO package
 *     identity. Invoke-CommandInDesktopPackage = identity but a debug context, not
 *     the real activation path. The ONLY faithful launch is app-model activation —
 *     this harness uses an AppExecutionAlias (added to the TEST manifest) so it can
 *     activate for real AND pass --remote-debugging-port, then attaches over CDP.
 *   - The package must be INSTALLED (signed .appx + Add-AppxPackage). A dev-mode
 *     loose registration (Add-AppxPackage -Register) also skips virtualization and
 *     proves nothing about the shipped runtime.
 *   - Never hand-delete %LOCALAPPDATA%\Packages\<PFN>\LocalCache while registered —
 *     it wedges activation (hangs forever). Reset = Remove-AppxPackage + reinstall.
 *
 * WHAT IT CHECKS (two full app sessions):
 *   M0  The launched processes carry the package identity (tasklist /apps).
 *   M1  App boots (window + UI text).
 *   M2  SHARED-APPDATA MODEL: a storeSet() probe lands in the REAL store dir and the
 *       package container gains no photo_app dir (no virtualization).
 *   M3  NSIS-era edits readable: storeGet() of a pre-existing edit sidecar.
 *   M4  Presets: user's localStorage presets key visible (same profile as NSIS).
 *   M5  Real flow: open the RAW fixture to FULL quality (decode+GPU+cache OK).
 *   M6  Store hygiene: no unexpected new/changed files in the real store (only the
 *       probe — deleted at the end — and the opened image's own sidecar re-write).
 *   M7  Restart survival: session 2 reads back session 1's probes, then cleans up.
 *   M8  Window alive at the end; probes removed from the real profile.
 *
 * HOW TO RUN (see docs/STORE.md for the full local-validation recipe):
 *   node scripts/msix-smoke.cjs --alias vitrine-msix-test.exe --pfn <PackageFamilyName>
 * Env: SMOKE_ORF — RAW fixture; pick one that HAS a real edit sidecar so M3 is
 * meaningful (the harness tells you if it doesn't).
 * Exit 0 = all pass; 1 = a check failed; 2 = harness/activation failure.
 *
 * HARNESS CONTRACTS (see smoke-progressive.cjs + MEMORY playwright-smoke-harness):
 *   - 'electron-file-open' CustomEvent detail is a BARE path string.
 *   - Footer text via document.body.innerText.
 *   - Only dismiss the welcome via 'Get Started'/'Skip' (a role-based "Close" match
 *     can hit the frameless titlebar X and quit the app).
 */
/* global window, document, localStorage, CustomEvent */ // used inside win.evaluate() callbacks
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules', '@playwright', 'test'));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : dflt;
}
const ALIAS = arg('alias', process.env.MSIX_ALIAS || 'vitrine-msix-test.exe');
const PFN = arg('pfn', process.env.MSIX_PFN);
const ORF = process.env.SMOKE_ORF || path.join(os.homedir(), 'Pictures', '2024', '2024-09-19', 'P9190024.ORF');
if (!PFN) { console.error('usage: node scripts/msix-smoke.cjs --alias <execution-alias.exe> --pfn <PackageFamilyName>'); process.exit(2); }
const ALIAS_PATH = path.isAbsolute(ALIAS) ? ALIAS : path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', ALIAS);

const REAL_USERDATA = path.join(process.env.APPDATA, 'photo_app');
const REAL_STORE = path.join(REAL_USERDATA, 'store');
const CONTAINER_PHOTOAPP = path.join(process.env.LOCALAPPDATA, 'Packages', PFN, 'LocalCache', 'Roaming', 'photo_app');
const OUT_DIR = path.join(ROOT, 'release', 'msix-smoke-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

// storeSet keys become sha1(key).json under userData/store (electron/main.cjs storeFilePath).
const storeFile = (key) => `${crypto.createHash('sha1').update(String(key)).digest('hex')}.json`;
const PROBE_KEY = 'msix-validation-probe';
const PROBE_FILE = storeFile(PROBE_KEY);
const EDIT_KEY = `edits:${ORF}`; // EditPersistenceService.keyForPath format
const EDIT_FILE = storeFile(EDIT_KEY);
const LS_PROBE_KEY = 'msix-validation-ls-probe';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pass = (id, msg) => { results.push(`${id}_PASS`); console.log(`${id}_PASS ${msg}`); };
const fail = (id, msg) => { results.push(`${id}_FAIL`); console.log(`${id}_FAIL ${msg}`); };
const note = (id, msg) => { console.log(`${id}_NOTE ${msg}`); };
const bodyText = (win) => win.evaluate(() => document.body.innerText || '');
const parseDims = (t) => { const m = t && t.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/); return m ? [Number(m[1]), Number(m[2])] : null; };

function snapshotStore() {
  if (!fs.existsSync(REAL_STORE)) return new Map();
  const map = new Map();
  for (const f of fs.readdirSync(REAL_STORE)) {
    const st = fs.statSync(path.join(REAL_STORE, f));
    map.set(f, `${st.size}:${st.mtimeMs}`);
  }
  return map;
}

const vitrineRunning = () => {
  try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq Vitrine.exe', '/NH'], { encoding: 'utf8' }).includes('Vitrine.exe'); }
  catch { return false; }
};
const identityProcesses = () => {
  try { return execFileSync('tasklist', ['/apps', '/FI', 'IMAGENAME eq Vitrine.exe'], { encoding: 'utf8' }); }
  catch { return ''; }
};

function cdpUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Real app-model activation via the execution alias (identity + real runtime),
// with the CDP port passed through as a normal argument.
async function launchMain(port) {
  if (vitrineRunning()) {
    console.error('ABORT: a Vitrine.exe process is already running — close it first (results would be ambiguous).');
    process.exit(2);
  }
  spawn(ALIAS_PATH, [`--remote-debugging-port=${port}`], { stdio: 'ignore', detached: true }).unref();

  let up = false;
  const bootDeadline = Date.now() + 45000;
  while (Date.now() < bootDeadline && !(up = await cdpUp(port))) await delay(500);
  if (!up) throw new Error(`CDP endpoint on :${port} never came up — alias activation failed?`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let win = null;
  const winDeadline = Date.now() + 45000;
  while (Date.now() < winDeadline && !win) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        let url = ''; try { url = p.url(); } catch { /* target settling */ }
        if (url.includes('index.html')) { win = p; break; }
      }
      if (win) break;
    }
    if (!win) await delay(400);
  }
  if (!win) throw new Error('main window page never appeared over CDP');
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await delay(3500);
  for (const label of ['Get Started', 'Skip']) {
    try { const b = win.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1000 }); break; } } catch { /* welcome variant absent */ }
  }
  return { browser, win };
}

// Graceful close so Chromium flushes localStorage/leveldb; escalate only if needed.
async function closeApp(browser, win) {
  try { await win.evaluate(() => window.close()); } catch { /* window may already be closing */ }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && vitrineRunning()) await delay(500);
  if (vitrineRunning()) {
    note('CLOSE', 'graceful close timed out — killing Vitrine.exe');
    try { execFileSync('taskkill', ['/F', '/IM', 'Vitrine.exe'], { stdio: 'ignore' }); } catch { /* already gone */ }
    await delay(1000);
  }
  try { await browser.close(); } catch { /* connection already dropped */ }
}

async function openAndWaitFull(win, tag) {
  const t0 = Date.now();
  await win.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('electron-file-open', { detail: p }));
  }, ORF);
  const devLoc = win.getByText(/developing full quality/i);
  let tPreview = -1, tFull = -1;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const dev = await devLoc.count().catch(() => 0);
    const txt = await bodyText(win).catch(() => '');
    const dims = parseDims(txt);
    const loaded = !/no image loaded/i.test(txt) && (/\.(ORF|JPe?G|PNG|DNG)/i.test(txt) || dims);
    if (loaded && tPreview === -1) tPreview = Date.now() - t0;
    if (tPreview !== -1 && !dev && dims && Math.max(...dims) >= 3000) { tFull = Date.now() - t0; break; }
    await delay(100);
  }
  await win.screenshot({ path: path.join(OUT_DIR, `${tag}.png`) }).catch(() => {});
  return { tPreview, tFull };
}

(async () => {
  const realBefore = snapshotStore();
  const hadRealEditSidecar = realBefore.has(EDIT_FILE);
  note('SETUP', `real store: ${realBefore.size} files; fixture sidecar ${EDIT_FILE} pre-exists: ${hadRealEditSidecar}`);
  if (!hadRealEditSidecar) note('SETUP', 'M3 will be skipped — set SMOKE_ORF to an image that has saved edits');

  // ── SESSION 1 (CDP port 9231) ──
  let { browser, win } = await launchMain(9231);

  // M0: package identity on the running processes.
  const apps = identityProcesses();
  if (apps.includes(PFN.split('_')[0])) pass('M0', 'Vitrine processes carry the package identity');
  else fail('M0', `tasklist /apps shows no packaged Vitrine: ${apps.slice(0, 200)}`);

  // M1: booted
  const boot = await bodyText(win).catch(() => '');
  if (boot.length > 0) pass('M1', 'app booted, UI text present');
  else fail('M1', 'no UI text after launch');

  // M2: shared-AppData model — probe lands in the REAL store; container stays empty.
  await win.evaluate((k) => window.electronAPI.storeSet(k, { msix: true, v: 1 }), PROBE_KEY);
  await delay(1200); // async fs write
  const inReal = fs.existsSync(path.join(REAL_STORE, PROBE_FILE));
  const containerAppeared = fs.existsSync(CONTAINER_PHOTOAPP);
  if (inReal && !containerAppeared) {
    pass('M2', 'write went to the REAL %APPDATA%\\photo_app (shared with the NSIS install); no container copy created');
  } else if (!inReal && containerAppeared) {
    fail('M2', 'writes are VIRTUALIZED into the package container on this OS — Store/NSIS data would diverge; revisit docs/STORE.md guidance');
  } else {
    fail('M2', `unexpected state: probe in real=${inReal}, container photo_app=${containerAppeared}`);
  }

  // M3: NSIS-era edits readable (this IS "edits survive" for existing users).
  if (hadRealEditSidecar) {
    const migrated = await win.evaluate((k) => window.electronAPI.storeGet(k), EDIT_KEY);
    if (migrated) pass('M3', 'pre-existing (NSIS-era) edit sidecar readable from the Store build');
    else fail('M3', 'real edit sidecar exists on disk but storeGet returned null');
  } else {
    note('M3', 'SKIP — no pre-existing sidecar for the fixture');
  }

  // M4: presets — same Chromium profile, so the user's presets key should be there.
  await win.evaluate((k) => localStorage.setItem(k, 'v1'), LS_PROBE_KEY);
  const presetsRaw = await win.evaluate(() => localStorage.getItem('photo_editor_presets'));
  if (presetsRaw) pass('M4', `user presets visible (${presetsRaw.length} chars) — presets survive`);
  else note('M4', 'no user presets key found (none saved on this machine; localStorage layer still probed via M7)');

  // M5: real flow — open the RAW fixture to full quality.
  const s1 = await openAndWaitFull(win, '1-msix-full');
  if (s1.tFull !== -1) pass('M5', `RAW open to FULL quality at +${(s1.tFull / 1000).toFixed(1)}s (preview +${s1.tPreview}ms)`);
  else fail('M5', `full quality never confirmed (preview ${s1.tPreview}ms)`);

  await delay(3000); // let write-through land
  await closeApp(browser, win);
  await delay(1500);

  // M6: real store hygiene — only the probe (ours) and the opened image's own
  // sidecar re-write are acceptable changes; nothing else appears or vanishes.
  const realAfter = snapshotStore();
  const dirty = [];
  for (const [f, sig] of realAfter) {
    if (f === PROBE_FILE || f === EDIT_FILE) continue;
    if (!realBefore.has(f) || realBefore.get(f) !== sig) dirty.push(f);
  }
  for (const f of realBefore.keys()) if (!realAfter.has(f)) dirty.push(`${f} (deleted)`);
  if (dirty.length === 0) pass('M6', `real store clean (${realAfter.size} files; only expected touches: probe + opened image's sidecar)`);
  else fail('M6', `unexpected real-store changes: ${dirty.slice(0, 5).join(', ')}`);

  // ── SESSION 2 (CDP port 9232): restart survival + cleanup ──
  ({ browser, win } = await launchMain(9232));
  const probeBack = await win.evaluate((k) => window.electronAPI.storeGet(k), PROBE_KEY);
  const lsBack = await win.evaluate((k) => localStorage.getItem(k), LS_PROBE_KEY);
  if (probeBack && probeBack.msix === true) pass('M7', 'store probe survived restart');
  else fail('M7', `store probe lost after restart: ${JSON.stringify(probeBack)}`);
  if (lsBack === 'v1') pass('M7b', 'localStorage probe survived restart');
  else fail('M7b', `localStorage probe lost: ${JSON.stringify(lsBack)}`);
  if (hadRealEditSidecar) {
    const editBack = await win.evaluate((k) => window.electronAPI.storeGet(k), EDIT_KEY);
    if (editBack) pass('M7c', 'NSIS-era edit sidecar still readable in session 2');
    else fail('M7c', 'NSIS-era edit sidecar unreadable in session 2');
  }

  // Cleanup: probes live in the REAL profile now — remove them.
  await win.evaluate((k) => window.electronAPI.storeDelete(k), PROBE_KEY);
  await win.evaluate((k) => localStorage.removeItem(k), LS_PROBE_KEY);
  await delay(800);

  // M8: stability + cleanup verified.
  let alive = true;
  try { await win.evaluate(() => document.title); } catch { alive = false; }
  const probeGone = !fs.existsSync(path.join(REAL_STORE, PROBE_FILE));
  if (alive && probeGone) pass('M8', 'window alive; probes removed from the real profile');
  else fail('M8', `alive=${alive} probeGone=${probeGone}`);

  await closeApp(browser, win);
  const failed = results.filter((r) => r.includes('_FAIL')).length;
  console.log(`SMOKE_${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed}/${results.length} checks`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('SMOKE_CRASH', (err && err.message) || err); process.exit(2); });
