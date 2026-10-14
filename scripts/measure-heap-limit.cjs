'use strict';
/**
 * Measures the renderer JS heap limit Electron actually grants for a given
 * --max-old-space-size. Run as the Electron main script:
 *
 *   npx electron scripts/measure-heap-limit.cjs            # default limit
 *   npx electron scripts/measure-heap-limit.cjs 8192       # flag in MB
 *
 * Prints "RESULT flag=<MB|none> limitMB=<n>". Used for the v1.40.0 memory preset
 * (flags above ~3.5 GB do not raise the limit on Electron 43, so none is shipped).
 */
const { app, BrowserWindow } = require('electron');

const flagMB = process.argv.slice(1).find((a) => /^\d+$/.test(a));
if (flagMB) app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${flagMB}`);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<p>x</p>');
  const bytes = await win.webContents.executeJavaScript('performance.memory.jsHeapSizeLimit');
  console.log(`RESULT flag=${flagMB || 'none'} limitMB=${Math.round(bytes / 1048576)}`);
  app.exit(0);
});
