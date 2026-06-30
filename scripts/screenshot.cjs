#!/usr/bin/env node
/**
 * screenshot.cjs — launch the packaged renderer via Playwright's Electron driver
 * and capture a PNG of the main window. Reusable for smoke tests and the README hero.
 *
 * Usage:  node scripts/screenshot.cjs [outPath] [--tool <sidebarToolId>]
 *   outPath        where to write the PNG (default: docs/screenshot.png)
 *   --tool <id>    optional: click a sidebar tool before capturing (e.g. "enhance")
 *
 * Loads the built dist/ (production mode) — run `npm run build` first.
 * Exits non-zero with SCREENSHOT_FAIL if no window renders (e.g. headless session).
 */
const { _electron: electron } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const toolFlag = args.indexOf('--tool');
const tool = toolFlag !== -1 ? args[toolFlag + 1] : null;
const outPath = (args[0] && !args[0].startsWith('--')) ? args[0] : path.join(ROOT, 'docs', 'screenshot.png');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await electron.launch({
    args: [path.join(ROOT, 'electron', 'main.cjs')],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production' }, // force dist/index.html load (no dev server)
    timeout: 60000,
  });

  // The app opens a splash window first, then the main window (loads index.html).
  // Wait for the main window specifically.
  let win = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !win) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch { /* window may be mid-navigation */ }
      if (url.includes('index.html')) { win = w; break; }
    }
    if (!win) await delay(500);
  }
  if (!win) win = await app.firstWindow();

  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await delay(3500); // let React mount + first render settle

  // Dismiss the welcome modal if present (best-effort; ignore if absent).
  for (const label of ['Get Started', 'Close', 'Skip', 'Dismiss']) {
    try {
      const btn = win.getByRole('button', { name: label });
      if (await btn.count()) { await btn.first().click({ timeout: 1000 }); break; }
    } catch { /* ignore */ }
  }

  if (tool) {
    // Sidebar tools expose data-tool / aria-label / title; try a few selectors.
    const selectors = [`[data-tool="${tool}"]`, `[aria-label="${tool}" i]`, `[title="${tool}" i]`];
    for (const sel of selectors) {
      try {
        const el = win.locator(sel).first();
        if (await el.count()) { await el.click({ timeout: 1500 }); await delay(1200); break; }
      } catch { /* try next */ }
    }
  }

  await win.screenshot({ path: outPath });
  console.log('SCREENSHOT_OK ' + outPath);
  await app.close();
  process.exit(0);
})().catch(async (err) => {
  console.error('SCREENSHOT_FAIL', (err && err.message) || err);
  process.exit(1);
});
