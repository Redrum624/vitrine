'use strict';

/**
 * Close guard for the main window. main.cjs's 'close' handler always prevents
 * the close and runs the renderer round trip (requestAppClose) and cleanup
 * (performAppCleanup) before destroying the window. The updater's "Restart and
 * install now" must get through that handler: electron-updater's
 * quitAndInstall starts the installer and then calls app.quit(), which fires
 * 'close' on the window.
 *
 *   confirmQuit()  asks the renderer's unsaved-work question (requestAppClose;
 *                  false aborts and the update stays queued for a normal quit).
 *                  On true it arms a bypass and resolves true WITHOUT running
 *                  performAppCleanup: the renderer is not told to clean up
 *                  until the quit really happens, so a failed install leaves
 *                  the app fully usable.
 *   handleClose    with the bypass armed, skips the question, runs
 *                  performAppCleanup once and destroys the window.
 *   disarmQuit()   drops the bypass (re-arms the guard) when the install did
 *                  not happen after all.
 *
 * A close that arrives while confirmQuit is awaiting the renderer is prevented
 * and ignored: the question is already being asked, and the answer decides.
 *
 * Dependencies are injected, so jest runs this without Electron.
 */
function createCloseGuard({ requestAppClose, performAppCleanup }) {
  let quitConfirmed = false;
  let confirming = false;
  let cleaningUp = false;

  /** Wire to `win.on('close', (event) => guard.handleClose(win, event))`. */
  async function handleClose(win, event) {
    event.preventDefault();
    if (confirming || cleaningUp) return; // a decision or the final cleanup is already running
    const shouldClose = quitConfirmed ? true : await requestAppClose(); // bypass: confirmQuit already asked
    if (!shouldClose) return;
    cleaningUp = true;
    try {
      await performAppCleanup();
    } finally {
      cleaningUp = false;
    }
    quitConfirmed = false;
    if (win && !win.isDestroyed()) win.destroy();
  }

  /** Resolves true when the app may quit now (and arms the bypass), false when
   * the renderer vetoed or a confirmation is already running. */
  async function confirmQuit() {
    if (confirming || cleaningUp) return false;
    confirming = true;
    try {
      const ok = await requestAppClose();
      if (ok !== true) return false;
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
