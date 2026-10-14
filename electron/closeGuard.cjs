'use strict';

/**
 * Close guard for the main window. main.cjs's 'close' handler always prevents
 * the close and runs the renderer round trip (requestAppClose) and cleanup
 * (performAppCleanup) before destroying the window. The updater's "Restart and
 * install now" must get through that handler: electron-updater's
 * quitAndInstall starts the installer and then calls app.quit(), which fires
 * 'close' on the window.
 *
 *   confirmQuit()  runs the same question first (requestAppClose; false aborts,
 *                  the update stays queued for a normal quit) and then the
 *                  cleanup, then disarms the close handler: the next 'close'
 *                  passes through without asking a second time.
 *   disarmQuit()   drops that bypass when the install did not happen after all.
 *
 * Dependencies are injected, so jest runs this without Electron.
 */
function createCloseGuard({ requestAppClose, performAppCleanup }) {
  let quitConfirmed = false;
  let confirming = false;

  /** Wire to `win.on('close', (event) => guard.handleClose(win, event))`. */
  async function handleClose(win, event) {
    if (quitConfirmed) {
      // confirmQuit already asked and cleaned up for this exact close: let it through.
      return;
    }
    event.preventDefault();
    const shouldClose = await requestAppClose();
    if (shouldClose) {
      await performAppCleanup();
      if (win && !win.isDestroyed()) win.destroy();
    }
  }

  /** Resolves true when the app may quit now (and arms the bypass), false when
   * the renderer vetoed or a confirmation is already running. */
  async function confirmQuit() {
    if (confirming) return false;
    confirming = true;
    try {
      const ok = await requestAppClose();
      if (ok !== true) return false;
      await performAppCleanup();
      quitConfirmed = true;
      return true;
    } catch {
      quitConfirmed = false;
      return false;
    } finally {
      confirming = false;
    }
  }

  function disarmQuit() {
    quitConfirmed = false;
  }

  return { handleClose, confirmQuit, disarmQuit };
}

module.exports = { createCloseGuard };
