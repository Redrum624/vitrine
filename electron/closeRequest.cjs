'use strict';

/**
 * The main → renderer close question ('app-close-request' / 'app-close-response').
 *
 *   request({ fallback }) resolves { ok, reason, timedOut }. The renderer
 *   answers with (shouldClose, reason); reason 'export-in-progress' means an
 *   export is writing files and the app must not quit now.
 *
 * `fallback` is the answer used when the renderer does not reply within
 * `timeoutMs` (or the round trip throws): a normal window close keeps the
 * historical "proceed" (true), so a hung renderer can still be closed; the
 * updater's "Restart and install now" passes false, so an unanswered question
 * aborts the install (it stays queued for a normal quit).
 *
 * Dependencies are injected, so jest runs this without Electron.
 */
function createCloseRequester({ ipcMain, getWindow, timeoutMs = 5000, log = console }) {
  function request({ fallback }) {
    let win;
    try {
      win = getWindow();
    } catch {
      win = null;
    }
    if (!win || win.isDestroyed()) return Promise.resolve({ ok: true, reason: 'no-window', timedOut: false });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (answer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener('app-close-response', onResponse);
        resolve(answer);
      };
      const onResponse = (_event, shouldClose, reason) => {
        log.log(`Renderer close response: ${shouldClose ? 'proceed' : 'cancel'} - ${reason || 'no reason'}`);
        finish({ ok: shouldClose === true, reason, timedOut: false });
      };
      const timer = setTimeout(() => {
        log.warn(`Renderer did not respond to close request; treating it as ${fallback ? 'proceed' : 'cancel'}`);
        finish({ ok: fallback, reason: 'timeout', timedOut: true });
      }, timeoutMs);
      ipcMain.on('app-close-response', onResponse);
      try {
        win.webContents.send('app-close-request');
      } catch (err) {
        log.error('Error during close request:', err);
        finish({ ok: fallback, reason: 'error', timedOut: false });
      }
    });
  }

  return { request };
}

module.exports = { createCloseRequester };
