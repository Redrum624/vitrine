#!/usr/bin/env node
/**
 * smoke-final-live.cjs — packaged live verification for v1.40.0: crop drag/straighten render
 * route + cost + wedge check, straighten-slider drag cost, radial mask live drag, Enhance
 * NR+sharpen route, VRAM sampling. Evidence = app FILE log byte-offset windows recorded per
 * stage (stages.json) + screenshots in release/smoke-final-shots/.
 * Harness contracts: 'electron-file-open' detail is a BARE path string; kill ONLY the spawned PID.
 * Fixture must be under C:\Users\Razer\Pictures\2024\2024-09-19; reset afterwards with
 * `node scripts/reset-smoke-fixtures.cjs`.      node scripts/smoke-final-live.cjs
 */
/* global window, document, CustomEvent, HTMLInputElement, Event */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { _electron: electron } = require(path.join(ROOT, 'node_modules', '@playwright', 'test'));
const EXE = process.env.SMOKE_EXE || path.join(ROOT, 'release', 'win-unpacked', 'Vitrine.exe');
const ORF = process.env.SMOKE_ORF || path.join(os.homedir(), 'Pictures', '2024', '2024-09-19', 'P9190024.ORF');
const OUT = path.join(ROOT, 'release', 'smoke-final-shots');
fs.mkdirSync(OUT, { recursive: true });
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const LOG = path.join(os.homedir(), 'Photo Editor Pro', 'logs', `app-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);

const MODE = process.env.SMOKE_MODE || 'all'; // crop | enhance-mask | all
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = (win) => win.evaluate(() => document.body.innerText || '');
const parseDims = (t) => { const m = t && t.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/); return m ? [Number(m[1]), Number(m[2])] : null; };
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return 'n/a'; } };
const logSize = () => { try { return fs.statSync(LOG).size; } catch { return 0; } };
const stages = [];
async function stage(name, fn) {
  await delay(1200);
  const a = logSize();
  const t0 = Date.now();
  let err = null;
  try { await fn(); } catch (e) { err = String((e && e.message) || e).split('\n')[0]; console.log('STAGE_ERR', name, err); }
  await delay(1500);
  stages.push({ name, from: a, to: logSize(), t0, t1: Date.now(), err });
  console.log('STAGE', name, a, logSize(), err || '');
}

(async () => {
  const launchMs = Date.now();
  console.log('LAUNCH_ISO', new Date(launchMs).toISOString(), 'LOG', LOG);
  const logStart = logSize();
  const app = await electron.launch({ executablePath: EXE, timeout: 60000 });
  const pid = app.process().pid;
  console.log('SPAWNED_PID', pid);
  const out = { launchMs, pid, logStart, vram: {}, stages };
  const vram = (tag) => {
    const kids = sh(`powershell -NoProfile -Command "function k($p){$p;Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$p) | % { k $_.ProcessId }}; (k ${pid}) -join ','"`);
    out.vram[tag] = {
      total: sh('nvidia-smi --query-gpu=memory.used --format=csv,noheader'),
      apps: sh('nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader'),
      descendants: kids,
    };
    console.log('VRAM', tag, JSON.stringify(out.vram[tag]));
  };
  let win = null;

    async function sharpenProbe() {
      const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
      await win.getByRole('button', { name: 'Enhance', exact: true }).first().click(); await delay(1500);
      const tiles = {};
      for (const n of ['Upscale', 'Sharpen', 'Noise Reduction']) tiles[n] = win.locator('button[aria-pressed]', { hasText: n }).first();
      for (const n of ['Upscale', 'Sharpen', 'Noise Reduction']) if ((await tiles[n].getAttribute('aria-pressed')) === 'true') { await tiles[n].click(); await delay(1500); }
      await delay(3000);
      const grab = async (name) => { const f = path.join(OUT, `sp-${name}.png`); await win.screenshot({ path: f, timeout: 120000, clip: { x: 500, y: 250, width: 800, height: 450 } }); return f; };
      const diff = async (a, b) => { const A = await sharp(a).removeAlpha().raw().toBuffer(); const B = await sharp(b).removeAlpha().raw().toBuffer(); let x = 0; for (let i = 0; i < A.length; i++) x += Math.abs(A[i] - B[i]); return +(x / A.length).toFixed(4); };
      const off = await grab('off');
      let n0 = logSize();
      await stage('sp-sharpen-tile-on', async () => { await tiles.Sharpen.click(); await delay(4000); });
      const on = await grab('on');
      console.log('SP tile on diff', await diff(off, on), 'tilepressed', await tiles.Sharpen.getAttribute('aria-pressed'));
      await stage('sp-apply', async () => { await win.getByRole('button', { name: /Apply Enhance/ }).first().click(); await delay(6000); });
      const ap = await grab('applied');
      console.log('SP applied diff vs off', await diff(off, ap), 'btn still there', await win.getByRole('button', { name: /Apply Enhance/ }).count());
      const sl = win.getByRole('slider', { name: 'Sharpen strength' }).first();
      const bb = await sl.boundingBox();
      console.log('SP slider value', await sl.inputValue());
      await stage('sp-mouse-drag-max', async () => { await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await win.mouse.down(); await win.mouse.move(bb.x + bb.width - 2, bb.y + bb.height / 2, { steps: 8 }); await win.mouse.up(); await delay(4000); });
      console.log('SP slider value', await sl.inputValue());
      const mx = await grab('max');
      console.log('SP on->max diff', await diff(ap, mx));
      await stage('sp-mouse-drag-min', async () => { await win.mouse.move(bb.x + bb.width - 2, bb.y + bb.height / 2); await win.mouse.down(); await win.mouse.move(bb.x + 2, bb.y + bb.height / 2, { steps: 8 }); await win.mouse.up(); await delay(4000); });
      console.log('SP slider value', await sl.inputValue());
      const mn = await grab('min');
      console.log('SP max->min diff', await diff(mx, mn), 'min->off', await diff(mn, off));
    }
  const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await win.screenshot({ path: f, timeout: 120000 }); return f; };
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && !win) {
      for (const w of app.windows()) { let u = ''; try { u = w.url(); } catch { /* */ } if (u.includes('index.html')) { win = w; break; } }
      if (!win) await delay(400);
    }
    if (!win) win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded').catch(() => {});
    await delay(3500);
    for (const label of ['Get Started', 'Skip']) {
      try { const b = win.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1000 }); break; } } catch { /* */ }
    }
    vram('startup');

    await stage('open', async () => {
      await win.evaluate((p) => { window.dispatchEvent(new CustomEvent('electron-file-open', { detail: p })); }, ORF);
      const dl = Date.now() + 60000;
      while (Date.now() < dl) {
        const dev = await win.getByText(/developing full quality/i).count().catch(() => 0);
        const dims = parseDims(await bodyText(win).catch(() => ''));
        if (!dev && dims && Math.max(...dims) >= 3000) break;
        await delay(150);
      }
      await delay(4000);
    });
    out.buttons = await win.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.title || b.innerText || '').trim()).filter(Boolean).slice(0, 80));
    await shot('00-opened');

    if (MODE !== 'enhance-mask' && MODE !== 'sharpen') {
    // ---- b/c: crop
    await stage('crop-open', async () => {
      await win.getByRole('button', { name: /crop/i }).first().click();
      await delay(2500);
    });
    await shot('01-crop-open');
    const rot = () => win.getByRole('slider', { name: /rotation/i }).first();
    const dragSlider = async (fromFrac, toFrac, steps, label) => {
      const s = rot();
      const bb = await s.boundingBox();
      const y = bb.y + bb.height / 2;
      const x = (f) => bb.x + 8 + (bb.width - 16) * f;
      await win.mouse.move(x(fromFrac), y);
      await win.mouse.down();
      for (let i = 1; i <= steps; i++) { await win.mouse.move(x(fromFrac + (toFrac - fromFrac) * i / steps), y); await delay(250); }
      await win.mouse.up();
      console.log(label, 'value', await s.inputValue().catch(() => null));
    };
    await stage('straighten-drag-10', async () => { await dragSlider(0.5, 0.8, 10, 'straighten'); });
    await stage('straighten-chip-+2', async () => { await win.getByRole('button', { name: '+2°' }).first().click(); await delay(2500); console.log('after chip', await rot().inputValue()); });
    await shot('02-straightened');
    out.handleTypes = await win.evaluate(() => [...document.querySelectorAll('[data-testid^="crop-handle-"]')].map((e) => e.getAttribute('data-testid')));
    const corner = out.handleTypes.find((t) => /nw|top-left|tl/i.test(t)) || out.handleTypes.find((t) => t !== 'crop-handle-center');
    out.cornerHandle = corner;
    for (let i = 0; i < 5; i++) {
      await stage(`crop-drag-${i + 1}`, async () => {
        const b = await win.locator(`[data-testid="${corner}"]`).first().boundingBox();
        const cx = b.x + b.width / 2; const cy = b.y + b.height / 2;
        await win.mouse.move(cx, cy);
        await win.mouse.down();
        const dx = 30 + i * 6; const dy = 20 + i * 4;
        for (let k = 1; k <= 8; k++) { await win.mouse.move(cx + dx * k / 8, cy + dy * k / 8); await delay(80); }
        await win.mouse.up();
      });
    }
    await shot('03-after-crop-drags');
    await stage('crop-final-settle', async () => { await delay(3000); });
    await shot('04-crop-settled');

    }
    if (MODE === 'sharpen') {
    await sharpenProbe();
    } else if (MODE !== 'crop') {
    // ---- e: Enhance
    await stage('enhance-open', async () => {
      await win.getByRole('button', { name: 'Enhance', exact: true }).first().click();
      await delay(1500);
    });
    const nrTile = win.locator('button[aria-pressed]', { hasText: 'Noise Reduction' }).first();
    const shTile = win.locator('button[aria-pressed]', { hasText: 'Sharpen' }).first();
    const apply = win.getByRole('button', { name: /Apply Enhance/ }).first();
    await stage('enhance-normalise-off', async () => {
      // Enhance prefs persist (durable store): Upscale may be armed from an earlier session; Apply would then bake an AI upscale.
      for (const name of ['Upscale', 'Sharpen', 'Noise Reduction']) {
        const t = win.locator('button[aria-pressed]', { hasText: name }).first();
        if ((await t.getAttribute('aria-pressed')) === 'true') { await t.click(); await delay(1500); }
      }
      await delay(3000);
    });
    await stage('enhance-nr-on-apply', async () => {
      if ((await nrTile.getAttribute('aria-pressed')) !== 'true') await nrTile.click();
      await delay(500);
      await apply.click();
      await delay(5000);
    });
    await stage('enhance-sharpen-on', async () => {
      if ((await shTile.getAttribute('aria-pressed')) !== 'true') await shTile.click();
      await delay(5000);
    });
    const setSlider = async (name, frac) => {
      const s = win.getByRole('slider', { name }).first();
      await s.evaluate((el, f) => {
        const min = Number(el.min), max = Number(el.max);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(min + (max - min) * f));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, frac);
      await delay(3000);
    };
    for (let i = 0; i < 4; i++) {
      await stage(`enhance-slider-${i + 1}`, async () => setSlider(i % 2 ? 'Noise reduction strength' : 'Sharpen strength', i < 2 ? 0.7 : 0.3));
    }
    await win.screenshot({ path: path.join(OUT, '05a-sharpen-lo.png'), timeout: 120000 }).catch(() => {});
    await stage('sharpen-to-0', async () => setSlider('Sharpen strength', 0));
    await win.screenshot({ path: path.join(OUT, '05b-sharpen-0.png'), timeout: 120000 }).catch(() => {});
    await stage('sharpen-to-1', async () => setSlider('Sharpen strength', 1));
    await win.screenshot({ path: path.join(OUT, '05c-sharpen-1.png'), timeout: 120000 }).catch(() => {});
    vram('fit-nr-sharpen');
    await shot('05-enhance-fit');
    await stage('actual-size', async () => { await win.getByTitle(/Actual Size/).first().click(); await delay(5000); });
    for (let i = 0; i < 2; i++) {
      await stage(`enhance-100-slider-${i + 1}`, async () => setSlider(i % 2 ? 'Noise reduction strength' : 'Sharpen strength', i ? 0.8 : 0.2));
    }
    vram('100pct-nr-sharpen');
    await shot('06-enhance-100');
    await win.getByTitle(/Fit/i).first().click().catch(() => {});
    await delay(2500);

    // ---- d: mask
    await stage('mask-open', async () => {
      await win.getByRole('button', { name: 'Basic Adjustments' }).first().click();
      await delay(2000);
    });
    await stage('mask-create-radial', async () => {
      await win.getByRole('button', { name: /Circle/ }).first().click();
      await delay(2500);
    });
    await shot('07-mask-created');
    await stage('mask-exposure', async () => {
      await setSlider('Exposure', 1.0); // first Exposure slider = the selected mask's, +1 (max)
      console.log('exposure', await win.getByRole('slider', { name: 'Exposure' }).first().inputValue());
      await delay(1500);
    });
    const box = await win.evaluate(() => {
      let best = null;
      for (const c of document.querySelectorAll('canvas')) { const r = c.getBoundingClientRect(); if (r.width < 200) continue; if (!best || r.width * r.height > best.w * best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height }; }
      return best;
    });
    out.canvasBox = box;
    await shot('08-mask-start');
    const cx = box.x + box.w / 2; const cy = box.y + box.h / 2;
    await stage('mask-drag', async () => {
      await win.mouse.move(cx, cy);
      await win.mouse.down();
      await delay(300);
      for (let k = 1; k <= 12; k++) {
        await win.mouse.move(cx + box.w * 0.25 * k / 12, cy - box.h * 0.1 * k / 12);
        await delay(120);
        if (k === 6) await shot('09-mask-mid-drag');
      }
      await win.mouse.up();
    });
    await shot('10-mask-end');
    await delay(1000);
    }
  } catch (e) {
    console.error('SMOKE_ERR', (e && e.stack) || e);
    out.fatal = String((e && e.message) || e);
  } finally {
    out.endMs = Date.now();
    out.logEnd = logSize();
    fs.writeFileSync(path.join(OUT, 'stages.json'), JSON.stringify(out, null, 2));
    await app.close().catch(() => {});
    await delay(2000);
    try { process.kill(pid, 0); process.kill(pid); console.log('KILLED_PID', pid); } catch { console.log('PID_GONE', pid); }
  }
})().catch((e) => { console.error('SMOKE_CRASH', (e && e.message) || e); process.exit(2); });
