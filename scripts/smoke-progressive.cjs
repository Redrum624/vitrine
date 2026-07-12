#!/usr/bin/env node
/**
 * smoke-progressive.cjs — packaged two-session smoke for the progressive RAW open +
 * disk-persisted base cache (v1.16.0 / v1.17.0 machinery).
 *
 * WHAT IT CHECKS (drives the packaged exe via Playwright's _electron, two full app sessions):
 *   S1  Session 1 (cold, disk miss): the fast embedded PREVIEW paints quickly (< 4s).
 *   S2  Session 1: FULL quality lands (developing affordance clears + full-res dims in footer).
 *   S3  Session 2 (relaunch): preview paints quickly again.
 *   S4  Session 2 (warm disk): full quality lands FAST (< 3.5s) — proof the disk base cache hit
 *       (a cold session-1 full decode is ~5-7s).
 *   S5  Cache-dir sanity: userData/base-cache holds a .bin + .json pair. The userData PATH is
 *       fetched with a require-free `app.evaluate(({app}) => app.getPath('userData'))` (packaged
 *       builds block `require()` inside app.evaluate), then the directory is read with Node's own
 *       fs in THIS harness process — no require injected into the app context.
 *   S6  Window is still alive at the end (no crash).
 *
 * HOW TO RUN (build the packaged app first — release/win-unpacked must exist):
 *   npm run build:win           # produces release/win-unpacked/Vitrine.exe
 *   node scripts/smoke-progressive.cjs
 * Optional env overrides:
 *   SMOKE_ORF   — absolute path to the RAW fixture to open (default below).
 *   SMOKE_EXE   — absolute path to the packaged exe (default release/win-unpacked/...).
 * Exit code 0 = all checks passed; 1 = a check failed; 2 = harness crash. Screenshots and
 * timings are written under release/smoke-progressive-shots/ (release/ is gitignored).
 *
 * HARNESS CONTRACTS (learned the hard way — see MEMORY playwright-smoke-harness):
 *   - 'electron-file-open' CustomEvent detail is a BARE path string, not an object.
 *   - The footer text is read via document.body.innerText (no stable testid).
 *   - The packaged exe lives in release/win-unpacked/, NOT dist/.
 *   - Toasts linger for seconds — never assert "no toast" immediately after one appears.
 */
/* global window, document, CustomEvent */ // referenced only inside win.evaluate() browser callbacks
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { _electron: electron } = require(path.join(ROOT, 'node_modules', '@playwright', 'test'));
const EXE = process.env.SMOKE_EXE || path.join(ROOT, 'release', 'win-unpacked', 'Vitrine.exe');
const ORF = process.env.SMOKE_ORF || path.join(os.homedir(), 'Pictures', '2024', '2024-09-19', 'P9190024.ORF');
const OUT_DIR = path.join(ROOT, 'release', 'smoke-progressive-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pass = (id, msg) => { results.push(`${id}_PASS`); console.log(`${id}_PASS ${msg}`); };
const fail = (id, msg) => { results.push(`${id}_FAIL`); console.log(`${id}_FAIL ${msg}`); };
const bodyText = (win) => win.evaluate(() => document.body.innerText || '');
const parseDims = (t) => { const m = t && t.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/); return m ? [Number(m[1]), Number(m[2])] : null; };

async function launchMain() {
  const app = await electron.launch({ executablePath: EXE, timeout: 60000 });
  let win = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !win) {
    for (const w of app.windows()) {
      let url = ''; try { url = w.url(); } catch { /* window not ready */ }
      if (url.includes('index.html')) { win = w; break; }
    }
    if (!win) await delay(400);
  }
  if (!win) win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await delay(3500);
  for (const label of ['Get Started', 'Skip']) {
    try { const b = win.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1000 }); break; } } catch { /* welcome variant absent */ }
  }
  return { app, win };
}

// Open the ORF and wait until FULL quality: developing affordance gone AND full-res dims in footer.
// Returns {tPreview, tFull, sawDeveloping} in ms from dispatch.
async function openAndWaitFull(win, tag) {
  const t0 = Date.now();
  await win.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('electron-file-open', { detail: p }));
  }, ORF);
  const devLoc = win.getByText(/developing full quality/i);
  let tPreview = -1, sawDeveloping = false, tFull = -1;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const dev = await devLoc.count().catch(() => 0);
    const txt = await bodyText(win).catch(() => '');
    const dims = parseDims(txt);
    const loaded = !/no image loaded/i.test(txt) && (/\.ORF/i.test(txt) || dims);
    if (loaded && tPreview === -1) tPreview = Date.now() - t0;
    if (dev) sawDeveloping = true;
    if (tPreview !== -1 && !dev && dims && Math.max(...dims) >= 3000) { tFull = Date.now() - t0; break; }
    await delay(80);
  }
  await win.screenshot({ path: path.join(OUT_DIR, `${tag}.png`) });
  return { tPreview, tFull, sawDeveloping };
}

(async () => {
  // ── SESSION 1 (cold: disk miss expected) ──
  let { app, win } = await launchMain();
  const s1 = await openAndWaitFull(win, '1-session1-full');
  if (s1.tPreview !== -1 && s1.tPreview < 4000) pass('S1', `session-1 preview at +${s1.tPreview}ms`);
  else fail('S1', `session-1 preview: +${s1.tPreview}ms`);
  if (s1.tFull !== -1) pass('S2', `session-1 full quality at +${(s1.tFull / 1000).toFixed(1)}s (developing seen: ${s1.sawDeveloping})`);
  else fail('S2', 'session-1 full quality never confirmed within 40s');

  // Give the fire-and-forget disk write-through a moment to land, then quit.
  await delay(3000);
  await app.close().catch(() => {});
  await delay(1500);

  // ── SESSION 2 (warm disk: full quality should land fast) ──
  ({ app, win } = await launchMain());
  const s2 = await openAndWaitFull(win, '2-session2-full');
  if (s2.tPreview !== -1 && s2.tPreview < 4000) pass('S3', `session-2 preview at +${s2.tPreview}ms`);
  else fail('S3', `session-2 preview: +${s2.tPreview}ms`);
  if (s2.tFull !== -1 && s2.tFull < 3500) pass('S4', `session-2 FULL QUALITY at +${(s2.tFull / 1000).toFixed(2)}s (cold was ~${(s1.tFull / 1000).toFixed(1)}s) — disk cache hit`);
  else if (s2.tFull !== -1) fail('S4', `session-2 full quality too slow for a disk hit: +${(s2.tFull / 1000).toFixed(1)}s (cold was ${(s1.tFull / 1000).toFixed(1)}s)`);
  else fail('S4', 'session-2 full quality never confirmed');

  // ── S5: cache dir sanity — read via Node fs directly (packaged builds block require() inside
  //         app.evaluate). Only the userData PATH comes from the app (require-free getPath). ──
  try {
    const userData = await app.evaluate(({ app: eApp }) => eApp.getPath('userData'));
    const dir = path.join(userData, 'base-cache');
    if (!fs.existsSync(dir)) {
      fail('S5', `base-cache dir missing: ${dir}`);
    } else {
      const files = fs.readdirSync(dir);
      const bins = files.filter((f) => f.endsWith('.bin'));
      const jsons = files.filter((f) => f.endsWith('.json'));
      if (bins.length >= 1 && jsons.length >= bins.length) {
        pass('S5', `base-cache dir: ${bins.length} .bin + ${jsons.length} .json`);
      } else {
        fail('S5', `base-cache dir state unexpected in ${dir}: [${files.slice(0, 10).join(', ')}]`);
      }
    }
  } catch (e) { fail('S5', 'cache-dir check error: ' + e.message); }

  // ── S6: stability ──
  try { await win.evaluate(() => document.title); pass('S6', 'window alive'); }
  catch { fail('S6', 'window dead'); }

  await app.close().catch(() => {});
  const failed = results.filter((r) => r.includes('_FAIL')).length;
  console.log(`SMOKE_${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed}/${results.length} checks`);
  console.log(`TIMINGS cold_full=${s1.tFull}ms warm_disk_full=${s2.tFull}ms preview1=${s1.tPreview}ms preview2=${s2.tPreview}ms`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error('SMOKE_CRASH', (err && err.message) || err); process.exit(2); });
