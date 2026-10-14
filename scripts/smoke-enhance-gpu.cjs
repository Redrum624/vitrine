#!/usr/bin/env node
/**
 * smoke-enhance-gpu.cjs — packaged live check that Noise Reduction + Enhance sharpen render on
 * the resident GPU preview path (v1.40.0), not the CPU worker path.
 *
 * Drives release/win-unpacked/Vitrine.exe via Playwright _electron: open the RAW, wait for full
 * quality, Enhance panel -> NR on (Apply) -> Sharpen on, 5 slider changes at fit, Actual Size
 * (100%), 3 more slider changes. Records per-change timestamps (change-times.json) and
 * screenshots (NR off / NR on / NR+sharpen) with mean-abs-diff; samples nvidia-smi VRAM.
 * Render-path evidence is read afterwards from the app FILE log
 * (%USERPROFILE%\Photo Editor Pro\logs\app-<date>.log) using the launch time printed here.
 *
 * Harness contracts: 'electron-file-open' detail is a BARE path string; footer via
 * document.body.innerText; kill ONLY the spawned PID. Fixture must be a smoke fixture
 * (C:\Users\Razer\Pictures\2024\2024-09-19), never the owner's photos; reset afterwards with
 * `node scripts/reset-smoke-fixtures.cjs`.
 *   node scripts/smoke-enhance-gpu.cjs      (env: SMOKE_ORF, SMOKE_EXE)
 */
/* global window, document, CustomEvent, HTMLInputElement, Event */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { _electron: electron } = require(path.join(ROOT, 'node_modules', '@playwright', 'test'));
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const EXE = process.env.SMOKE_EXE || path.join(ROOT, 'release', 'win-unpacked', 'Vitrine.exe');
const ORF = process.env.SMOKE_ORF || path.join(os.homedir(), 'Pictures', '2024', '2024-09-19', 'P9190024.ORF');
const OUT_DIR = path.join(ROOT, 'release', 'smoke-enhance-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = (win) => win.evaluate(() => document.body.innerText || '');
const parseDims = (t) => { const m = t && t.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/); return m ? [Number(m[1]), Number(m[2])] : null; };
const vram = () => { try { return execSync('nvidia-smi --query-gpu=memory.used --format=csv,noheader').toString().trim(); } catch { return 'n/a'; } };
const log = (...a) => console.log(...a);

async function shotCanvas(win, name) {
  const box = await win.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 200 || r.height < 200) continue;
      if (!best || r.width * r.height > best.w * best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return best;
  });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (!box) { await win.screenshot({ path: file }); return file; }
  // Central crop avoids floating glass chrome overlapping the canvas edges.
  const clip = { x: Math.round(box.x + box.w * 0.25), y: Math.round(box.y + box.h * 0.25), width: Math.round(box.w * 0.5), height: Math.round(box.h * 0.5) };
  await win.screenshot({ path: file, clip });
  return file;
}

async function meanAbsDiff(a, b) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) return `size mismatch ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`;
  let s = 0; let n = 0; let maxd = 0;
  for (let i = 0; i < A.data.length; i++) { const d = Math.abs(A.data[i] - B.data[i]); s += d; if (d > maxd) maxd = d; n++; }
  return { meanAbsDiff: +(s / n).toFixed(4), maxDiff: maxd };
}

(async () => {
  const vramBefore = vram();
  const launchMs = Date.now();
  log('LAUNCH_ISO', new Date(launchMs).toISOString(), 'LAUNCH_EPOCH_MS', launchMs);
  const app = await electron.launch({ executablePath: EXE, timeout: 60000 });
  const pid = app.process().pid;
  log('SPAWNED_PID', pid);
  const changes = [];
  const out = { launchMs, pid, vram: { before: vramBefore }, changes, diffs: {} };
  try {
    let win = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !win) {
      for (const w of app.windows()) { let u = ''; try { u = w.url(); } catch { /* not ready */ } if (u.includes('index.html')) { win = w; break; } }
      if (!win) await delay(400);
    }
    if (!win) win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded').catch(() => {});
    await delay(3500);
    for (const label of ['Get Started', 'Skip']) {
      try { const b = win.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1000 }); break; } } catch { /* absent */ }
    }

    // Open + wait full quality
    await win.evaluate((p) => { window.dispatchEvent(new CustomEvent('electron-file-open', { detail: p })); }, ORF);
    const dl = Date.now() + 60000; let full = false;
    while (Date.now() < dl) {
      const dev = await win.getByText(/developing full quality/i).count().catch(() => 0);
      const dims = parseDims(await bodyText(win).catch(() => ''));
      if (!dev && dims && Math.max(...dims) >= 3000) { full = true; break; }
      await delay(150);
    }
    log('FULL_QUALITY', full);
    await delay(4000);

    // Enhance panel
    await win.getByRole('button', { name: 'Enhance', exact: true }).first().click();
    await delay(1500);
    const nrTile = win.locator('button[aria-pressed]', { hasText: 'Noise Reduction' }).first();
    const shTile = win.locator('button[aria-pressed]', { hasText: 'Sharpen' }).first();
    const apply = win.getByRole('button', { name: /Apply Enhance/ }).first();

    const states = async (tag) => { const v = { tag, nr: await nrTile.getAttribute('aria-pressed'), sharpen: await shTile.getAttribute('aria-pressed') }; (out.states = out.states || []).push(v); log('STATE', JSON.stringify(v)); };
    await states('initial');
    for (const tile of [nrTile, shTile]) {
      if ((await tile.getAttribute('aria-pressed')) === 'true') { await tile.click(); await delay(1500); }
    }
    await delay(4000);
    await states('normalised-to-off');
    await win.screenshot({ path: path.join(OUT_DIR, '0-panel-initial.png') });
    const base = await shotCanvas(win, '1-nr-off');
    out.vram.afterOpen = vram();

    // NR on (default strength 50), Apply arms the module live.
    await nrTile.click(); await delay(500);
    await states('after NR click');
    const tApply = Date.now();
    await apply.click();
    changes.push({ what: 'NR on + Apply', t: tApply, zoom: 'fit' });
    await delay(6000);
    await states('after Apply');
    const nrOn = await shotCanvas(win, '2-nr-on');

    // Sharpen on (live write-through once armed)
    const tSh = Date.now();
    await shTile.click();
    changes.push({ what: 'Sharpen on', t: tSh, zoom: 'fit' });
    await delay(6000);
    await states('after Sharpen click');
    const shOn = await shotCanvas(win, '3-nr-sharpen-on');
    out.vram.afterNrSharpenFit = vram();

    const slider = async (name, hi, zoom, i) => {
      const s = win.getByRole('slider', { name }).first();
      const v0 = await s.getAttribute('aria-valuenow');
      const t = Date.now();
      const v1 = await s.evaluate((el, high) => {
        const min = Number(el.min), max = Number(el.max);
        const v = min + (max - min) * (high ? 0.7 : 0.3);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      }, hi);
      changes.push({ what: name, t, zoom, i, v0, v1 });
      await delay(3500);
    };
    for (let i = 0; i < 5; i++) {
      await slider(i % 2 ? 'Noise reduction strength' : 'Sharpen strength', i % 4 < 2, 'fit', i + 1);
    }

    // 100% zoom
    const tZ = Date.now();
    await win.getByTitle(/Actual Size/).first().click();
    changes.push({ what: 'Actual Size click', t: tZ, zoom: '100%' });
    await delay(5000);
    out.zoomText = (await bodyText(win)).match(/\d{2,3}%/g);
    for (let i = 0; i < 3; i++) {
      await slider(i % 2 ? 'Noise reduction strength' : 'Sharpen strength', i % 4 < 2, '100%', i + 6);
    }
    out.vram.after100 = vram();
    await shotCanvas(win, '4-100pct');

    out.diffs.nrOff_vs_nrOn = await meanAbsDiff(base, nrOn);
    out.diffs.nrOn_vs_nrSharpen = await meanAbsDiff(nrOn, shOn);
    out.diffs.nrOff_vs_nrSharpen = await meanAbsDiff(base, shOn);
  } finally {
    out.endMs = Date.now();
    fs.writeFileSync(path.join(OUT_DIR, 'run.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
    await app.close().catch(() => {});
    await delay(2000);
    try { process.kill(pid, 0); process.kill(pid); log('KILLED_PID', pid); } catch { log('PID_GONE', pid); }
  }
})().catch((e) => { console.error('SMOKE_CRASH', (e && e.message) || e); process.exit(2); });
