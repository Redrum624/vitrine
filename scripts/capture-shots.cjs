#!/usr/bin/env node
/**
 * capture-shots.cjs — README hero + feature screenshots, driven through Playwright's
 * Electron driver against the packaged Vitrine.exe.
 *
 * Two photos, by role:
 *   GENERAL (P9190034.JPG) — the appealing, already-edited render (the DNG's develop
 *     look). Vitrine displays a JPEG as-is (no raw re-decode), so this shows the
 *     finished look rather than a flat raw decode. Used for the hero + every
 *     adjustment/tool crop.
 *   RAW (P9190034.ORF) — the native Olympus RAW. Used for the RAW-specific shots:
 *     the RAW Decode panel, the camera/lens EXIF popover (richer maker metadata),
 *     and the Before/After (raw "before" -> Auto All-graded "after"). NOTE: this ORF
 *     can fail the full Bayer decode under the automated harness; the embedded
 *     preview + metadata still drive these shots.
 *
 * Produces docs/screenshot.png (hero) + docs/shots/*.png. Run `npm run build` and a
 * packaged build (release/win-unpacked/Vitrine.exe) first.
 */
/* global window, document, CustomEvent */ // referenced only inside win.evaluate() browser callbacks
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

// Stitch a before/after canvas pair side-by-side with labels. The app's own split
// Before/After view never finishes its 20MP re-render under the automated harness
// (stuck on "Applying…"), so we compose two clean single-pane captures instead.
async function composeBeforeAfter(beforePath, afterPath, outPath) {
  const targetH = 900, gap = 6, pad = 0;
  const meta = async (p) => sharp(p).metadata();
  const bm = await meta(beforePath), am = await meta(afterPath);
  const bW = Math.round((bm.width * targetH) / bm.height);
  const aW = Math.round((am.width * targetH) / am.height);
  const bBuf = await sharp(beforePath).resize(bW, targetH).toBuffer();
  const aBuf = await sharp(afterPath).resize(aW, targetH).toBuffer();
  const label = (t) => Buffer.from(
    `<svg width="240" height="40" xmlns="http://www.w3.org/2000/svg"><rect rx="7" width="${28 + t.length * 8.4}" height="30" fill="rgba(8,8,10,0.72)"/><text x="14" y="20" font-family="Segoe UI, -apple-system, sans-serif" font-size="15" font-weight="600" fill="#f2f2f4" letter-spacing="0.4">${t}</text></svg>`);
  const totalW = bW + gap + aW + pad * 2;
  const base = sharp({ create: { width: totalW, height: targetH, channels: 4, background: { r: 8, g: 8, b: 10, alpha: 1 } } });
  const out = await base.composite([
    { input: bBuf, left: pad, top: 0 },
    { input: aBuf, left: pad + bW + gap, top: 0 },
    { input: label('BEFORE  ·  RAW'), left: pad + 18, top: 18 },
    { input: label('AFTER  ·  Developed'), left: pad + bW + gap + 18, top: 18 },
  ]).png().toBuffer();
  await sharp(out).toFile(outPath);
}

const ROOT = path.join(__dirname, '..');
// Point these at your own photos via the SHOT_GENERAL / SHOT_RAW env vars. GENERAL
// should be a finished/edited image (JPG/PNG) — it becomes the hero + tool crops;
// RAW should be a camera RAW (ORF/CR2/NEF/ARW/DNG…) — it drives the RAW-only shots.
const GENERAL = process.env.SHOT_GENERAL || path.join(os.homedir(), 'Pictures', 'sample.jpg');
const RAW = process.env.SHOT_RAW || path.join(os.homedir(), 'Pictures', 'sample.orf');
const SHOTS = path.join(ROOT, 'docs', 'shots');
const EXE = process.env.SHOT_EXE || path.join(ROOT, 'release', 'win-unpacked', 'Vitrine.exe');
const W = 2560, H = 1600;
fs.mkdirSync(SHOTS, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const done = [];

async function main() {
  const app = await electron.launch({ executablePath: EXE, timeout: 60000 });

  let win = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !win) {
    for (const w of app.windows()) {
      let url = ''; try { url = w.url(); } catch { /* mid-nav */ }
      if (url.includes('index.html')) { win = w; break; }
    }
    if (!win) await delay(500);
  }
  if (!win) win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await delay(3000);

  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const all = BrowserWindow.getAllWindows();
    const main = all.find((b) => { try { return b.webContents.getURL().includes('index.html'); } catch { return false; } }) || all[0];
    if (main) { if (main.isMaximized()) main.unmaximize(); main.setContentSize(w, h); main.center(); }
  }, { w: W, h: H });
  await delay(1200);

  // Dismiss the welcome modal. NEVER match 'Close'/'Dismiss' by role — that also hits
  // the frameless titlebar's Close (X) control and quits the app.
  for (const label of ['Get Started', 'Skip']) {
    try { const b = win.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1000 }); break; } } catch { /* absent */ }
  }
  await delay(800);

  // Load a photo via the documented CustomEvent (bare path string). Waits for load +
  // any RAW full-quality decode ("Developing full quality…" clears). Returns whether
  // an image rendered at all.
  async function loadImage(p) {
    await win.evaluate((x) => window.dispatchEvent(new CustomEvent('electron-file-open', { detail: x })), p.replace(/\\/g, '/'));
    const nameRe = rx(path.basename(p));
    const dl = Date.now() + 50000;
    let rendered = false;
    while (Date.now() < dl) {
      const txt = await win.evaluate(() => document.body.innerText || '').catch(() => '');
      const loaded = !/no image loaded/i.test(txt) && (/(\d{3,5})\s*[×x]\s*(\d{3,5})/.test(txt) || new RegExp(nameRe, 'i').test(txt));
      const developing = /developing full quality/i.test(txt);
      if (loaded) rendered = true;
      if (loaded && !developing) break;
      await delay(400);
    }
    await delay(4000);
    return rendered;
  }

  const clickTool = (label) => win.evaluate((l) => {
    const el = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === l || b.title === l);
    if (el) { el.click(); return true; }
    return false;
  }, label);

  const clickText = (src) => win.evaluate((s) => {
    const re = new RegExp(s, 'i');
    const el = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
      .find((e) => re.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40);
    if (el) { el.click(); return true; }
    return false;
  }, src);

  const panelBox = (heading) => win.evaluate((h) => {
    const cards = Array.from(document.querySelectorAll('.glass-card'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 40 && r.height > 40 && r.x > window.innerWidth * 0.45);
    const byText = cards.find(({ el }) => (el.textContent || '').toLowerCase().includes(h.toLowerCase()));
    const pick = byText || cards.sort((a, b) => b.r.height - a.r.height)[0];
    if (!pick) return null;
    const { x, y, width, height } = pick.r;
    return { x, y, width, height };
  }, heading);

  async function shotFull(name) {
    const out = name === 'hero' ? path.join(ROOT, 'docs', 'screenshot.png') : path.join(SHOTS, `${name}.png`);
    await win.screenshot({ path: out });
    done.push(name); log('SHOT_FULL', out);
  }

  // Wait until the app is done rendering (no "Applying…" / "Developing full quality…"
  // overlay), then a short settle. Prevents capturing a mid-render blurred frame.
  async function waitIdle(maxMs = 18000) {
    const dl = Date.now() + maxMs;
    while (Date.now() < dl) {
      const txt = await win.evaluate(() => document.body.innerText || '').catch(() => '');
      if (!/applying|developing full quality/i.test(txt)) break;
      await delay(300);
    }
    await delay(1400);
  }

  async function shotPanel(name, heading, pad = 14) {
    const box = await panelBox(heading).catch(() => null);
    if (!box) { log('SHOT_CROP_FAIL', name, 'no matching card'); return; }
    const clip = {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: Math.min(W - Math.max(0, box.x - pad), box.width + pad * 2),
      height: Math.min(H - Math.max(0, box.y - pad), box.height + pad * 2),
    };
    await win.screenshot({ path: path.join(SHOTS, `${name}.png`), clip });
    done.push(name); log('SHOT_CROP', name, `${Math.round(clip.width)}x${Math.round(clip.height)}`);
  }

  // Crop the full window to the largest visible <canvas> (the photo) — used to
  // compose the Before/After from two clean single-pane frames.
  const canvasRect = () => win.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('canvas'))
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 200 && r.height > 200)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    if (!cs.length) return null;
    const r = cs[0];
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  async function captureCanvas(outPath) {
    const rc = await canvasRect();
    if (!rc) { log('CANVAS_MISS', path.basename(outPath)); return false; }
    await win.screenshot({ path: outPath, clip: rc });
    return true;
  }
  const beforePath = path.join(SHOTS, '_ba_before.png');
  const afterPath = path.join(SHOTS, '_ba_after.png');

  // ═══════════════ PHASE 1 — GENERAL (edited JPG, appealing) ═══════════════
  log('PHASE1_GENERAL', GENERAL);
  await loadImage(GENERAL);
  // Clicking Histogram from the clean default turns it on AND auto-opens the last
  // module (Basic Adjustments) beneath it — the rich hero. Never re-click the active
  // module while histogram is on (that closes both).
  await clickTool('Histogram'); await delay(1700);
  await shotFull('hero');
  await captureCanvas(afterPath);   // the developed JPG canvas = Before/After "after"
  await shotPanel('histogram', 'HISTOGRAM', 10);
  await shotPanel('basic-adjustments', 'Basic Adjustments');

  const dngPanels = [
    ['enhance', 'Enhance', 'Enhance'],
    ['tone-curve', 'Tone Curve', 'Tone Curve'],
    ['color-balance', 'Color Balance', 'Color Balance'],
    ['white-balance', 'White Balance', 'White Balance'],
    ['lens-corrections', 'Lens Corrections', 'Lens'],
    ['crop-transform', 'Crop & Transform', 'Crop'],
  ];
  for (const [name, label, heading] of dngPanels) {
    const ok = await clickTool(label); await delay(1400);
    if (ok) await shotPanel(name, heading); else log('TOOL_MISS', label);
  }

  // ═══════════════ PHASE 2 — RAW ORF (RAW features + before/after) ═══════════════
  log('PHASE2_RAW', RAW);
  const orfOk = await loadImage(RAW);
  if (!orfOk) log('ORF_DECODE_WARN', 'ORF did not confirm a render; RAW shots use preview/metadata');

  // selectedTool is 'crop' from phase 1; open Basic Adjustments (RAW Decode pins above it).
  await clickTool('Basic Adjustments'); await delay(1300); await waitIdle();
  await captureCanvas(beforePath);   // the raw ORF canvas = Before/After "before"

  // RAW Decode panel (expanded) — native Bayer RAW: demosaic + highlight controls.
  await clickText('^RAW Decode$'); await delay(1000);
  await shotPanel('raw-decode', 'RAW Decode', 12);

  // Camera / lens identification — EXIF popover (click the filename chip).
  try {
    await clickText(rx(path.basename(RAW))); await delay(1200);
    const pop = win.locator('.glass-card, [role="dialog"]').filter({ hasText: /ISO|f\/|mm|Camera|Make|Lens|Aperture/i }).first();
    if (await pop.count()) {
      await pop.screenshot({ path: path.join(SHOTS, 'exif.png') }); // element-precise (no background sliver)
      done.push('exif'); log('SHOT_CROP', 'exif');
    } else { log('EXIF_MISS', 'no popover'); }
    await win.keyboard.press('Escape').catch(() => {}); await delay(500);
  } catch (e) { log('EXIF_FAIL', String((e && e.message) || e).split('\n')[0]); }

  // Before/After — composed from the raw ORF canvas (before) and the developed JPG
  // canvas (after), each captured cleanly in its own phase. The app's live split
  // view and Auto All both stall on the 20MP RAW render under the harness, so this
  // side-by-side compose is the reliable path and shows raw -> developed.
  try {
    if (fs.existsSync(beforePath) && fs.existsSync(afterPath)) {
      await composeBeforeAfter(beforePath, afterPath, path.join(SHOTS, 'before-after.png'));
      fs.rmSync(beforePath, { force: true }); fs.rmSync(afterPath, { force: true });
      done.push('before-after'); log('SHOT_COMPOSE', 'before-after');
    } else { log('BA_FAIL', `missing canvas caps (before=${fs.existsSync(beforePath)} after=${fs.existsSync(afterPath)})`); }
  } catch (e) { log('BA_FAIL', String((e && e.message) || e).split('\n')[0]); }

  log('DONE', done.length, 'shots');
  await app.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => { console.error('CAPTURE_FAIL', (e && e.message) || e); process.exit(1); });
