'use strict';

/**
 * Self-update from GitHub Releases through electron-updater (owner rule:
 * every Electron app can update itself). The feed is package.json
 * `build.publish`, which electron-builder writes into the installed app as
 * `resources/app-update.yml`; nothing here names an owner, a repository or a
 * token.
 *
 *   start()     once, from the main window's first 'ready-to-show' (so a
 *               prompt always has a parent). An unpackaged run is
 *               `disabled-dev` and a build without app-update.yml is
 *               `disabled-no-config`: both are logged and neither calls into
 *               electron-updater at all. Otherwise it turns on background
 *               download and install-at-quit, points electron-updater's own
 *               logger at the log file, subscribes to its events and checks
 *               once. A failed automatic check is logged and shows nothing.
 *   prompt      on 'update-downloaded': "Restart and install now" or "Later",
 *               one at a time, shown after any Check for Updates box that is
 *               still open. Now asks the close guard first (confirmQuit),
 *               because quitAndInstall starts the installer BEFORE it quits
 *               the app (electron-updater BaseUpdater.quitAndInstall), so the
 *               unsaved-work question must be answered before it is called.
 *               Later leaves the update to electron-updater's install at the
 *               next quit (`autoInstallOnAppQuit`), and the automatic path
 *               does not ask about that version again this session (a
 *               download a manual check started is asked about: that check's
 *               box promised it).
 *   checkNow()  Help > Check for Updates…: one message box, or the install
 *               prompt again when an update is already downloaded; nothing
 *               while the app is quitting to install or while the prompt is
 *               already up. Resolves to the resulting state (the IPC reply).
 *   dispose()   on 'will-quit': removes exactly the listeners start() added.
 *               Never removeAllListeners: electron-updater's own 'error'
 *               listener on the same emitter must stay (with no 'error'
 *               listener, emit('error') throws inside electron-updater).
 *
 * The close guard (closeGuard.cjs): confirmQuit resolving true arms a bypass
 * that lets the next window close through without asking, and it never
 * expires by itself. So every failed install calls disarmQuit(): a
 * quitAndInstall that throws, and an 'error' event while `installing`. For a
 * failed spawn, electron-updater reports the error after quitAndInstall has
 * returned and has already scheduled app.quit(); disarmed, that quit asks
 * about unsaved work again instead of slipping through.
 *
 * One install attempt per process: once quitAndInstall has returned, nothing
 * here calls confirmQuit or quitAndInstall again. After a failed spawn
 * electron-updater 6.8.9 keeps its `quitAndInstallCalled` set, ignores every
 * later quitAndInstall without an error or a quit, and skips its install at
 * quit (BaseUpdater.js:43-46, :75-77), so "Restart and install now" could
 * only arm the bypass for a quit that never comes. Instead the prompt and
 * Check for Updates show one box saying to restart the app: the next launch's
 * check finds the downloaded file in the updater's cache and offers it again
 * (DownloadedUpdateHelper.getValidCachedUpdateFile). This is the module's own
 * flag, not electron-updater's field, and there is no timer.
 *
 * The log (`<userData>/logs/updater.log`) holds one line per event,
 * `ISO-8601 LEVEL message`. The lines listed at createUpdater are an
 * interface: tools that check a packaged app match them verbatim, so they
 * change only together with those tools (updater.test.cjs case 14 pins each).
 * electron-updater's own messages go to the same file through the logger
 * adapter, first line only (its errors carry response headers, cookies
 * included, and stack frames with local paths). Logging never throws.
 *
 * No timers: the check runs at launch and on request, nothing else.
 *
 * Every dependency is injected, so jest runs this without Electron
 * (updater.test.cjs); main.cjs wires the real ones.
 */

const path = require('node:path');

/** A log over this size is emptied by start(), before its first line: a
 * declared design value (L7.5 brief), not a measured limit. */
const MAX_LOG_BYTES = 1024 * 1024;

const STATES = Object.freeze([
  'idle', // created, start() not called yet
  'disabled-store', // Microsoft Store (MSIX) build: the Store delivers updates
  'disabled-portable', // portable exe: never self-updates
  'disabled-dev', // unpackaged run: updates are checked only in an installed build
  'disabled-no-config', // installed build without resources/app-update.yml
  'checking',
  'up-to-date',
  'downloading', // a newer version was found and is downloading in the background
  'ready', // downloaded, the prompt is up or about to be
  'deferred', // the user chose Later (or the close guard said no): installs at the next quit
  'installing', // quitAndInstall was called; the app is quitting
  'error', // the last check, download or install failed (logged)
]);

/** The first line of an error's message (or of any value), trimmed. */
function firstLine(value) {
  const text = value instanceof Error ? value.message : String(value);
  return text.split(/\r?\n/)[0].trim();
}

/** The code an error carries (electron-updater's `ERR_UPDATER_*`,
 * `HTTP_ERROR_<status>`, a Node system code), else its name. */
function errorCode(err) {
  if (err && (typeof err.code === 'string' || typeof err.code === 'number') && err.code !== '') {
    return String(err.code);
  }
  if (err && typeof err.name === 'string' && err.name !== '') return err.name;
  return 'Error';
}

/**
 * @param {object} deps
 * @param {object} deps.autoUpdater electron-updater's `autoUpdater`. Read only
 *   once start() is past the dev and no-config gates: main.cjs passes a
 *   getter, because reading it constructs electron-updater's updater.
 * @param {boolean} deps.isPackaged `app.isPackaged`
 * @param {boolean} [deps.isWindowsStore] `process.windowsStore === true` (MSIX build)
 * @param {string} [deps.portableDir] `process.env.PORTABLE_EXECUTABLE_DIR` (set only by the portable exe)
 * @param {string} deps.resourcesPath `process.resourcesPath`
 * @param {object} deps.fs node:fs (existsSync, mkdirSync, appendFileSync, statSync, truncateSync)
 * @param {object} deps.dialog Electron's dialog (showMessageBox)
 * @param {() => object | null} deps.getWindow the main window, the parent of every box
 * @param {(win: object | null) => Promise<boolean>} deps.confirmQuit the close guard's
 * @param {() => void} deps.disarmQuit the close guard's
 * @param {string} deps.logFile `<userData>/logs/updater.log`
 * @param {string} deps.productName package.json productName
 * @param {string} deps.currentVersion `app.getVersion()`
 * @param {() => Date} [deps.now]
 *
 * Interface log lines: `started <productName> <version>`, `disabled-store`,
 * `disabled-portable`, `disabled-dev`, `disabled-no-config`, `checking`, `update available <version>`,
 * `update not available`, `update downloaded <version>`, `prompt answer now`,
 * `prompt answer later`, `install postponed: unsaved work`,
 * `installing <version>`, `error <code>: <first line>`.
 */
function createUpdater(deps) {
  const { isPackaged, isWindowsStore, portableDir, resourcesPath, fs, dialog, getWindow, confirmQuit, disarmQuit, logFile, productName, currentVersion } =
    deps;

  let state = 'idle';
  let started = false;
  let disposed = false;
  let library = null; // deps.autoUpdater, once read
  /** [emitter, event, handler] for every listener start() added. */
  let subscriptions = [];
  let promptOpen = false; // the prompt's re-entrancy latch, held until its answer is acted on
  let availableVersion = null; // the version electron-updater found and is downloading
  let readyVersion = null; // the last version electron-updater reported downloaded
  let deferredVersion = null; // the version the user put off this session
  let lastError = null;
  let errorEvents = 0; // 'error' events seen, so a failed check is logged once, not twice
  let manualCheck = null; // the checkNow() in flight; a second call shares it
  let manualCheckRunning = false; // a manual check's checkForUpdates() is in flight
  let promisedVersion = null; // a manual check's "you will be asked when it is ready" was about this version
  let openBox = null; // the Check for Updates box on screen, which a prompt waits for
  let installAttempted = false; // quitAndInstall has returned once in this process

  function now() {
    return typeof deps.now === 'function' ? deps.now() : new Date();
  }

  function write(level, message) {
    try {
      const text = String(message).replace(/\s*[\r\n]+\s*/g, ' ');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `${now().toISOString()} ${level} ${text}\n`);
    } catch {
      // Logging never throws: a full disk or a locked file must not take the
      // updater, or electron-updater's event dispatch, down with it.
    }
  }

  function logError(err) {
    lastError = err;
    write('ERROR', `error ${errorCode(err)}: ${firstLine(err)}`);
  }

  function truncateOversizedLog() {
    try {
      if (fs.statSync(logFile).size > MAX_LOG_BYTES) fs.truncateSync(logFile, 0);
    } catch {
      // No log yet (a first launch), or it cannot be read: the next write
      // creates or appends to it.
    }
  }

  function disarm() {
    try {
      disarmQuit();
    } catch {
      // The guard's own failure must not escape into electron-updater's event dispatch.
    }
  }

  // electron-updater's Logger, first line only: its error text embeds the HTTP
  // response headers, set-cookie values included, and stack frames with local
  // paths (builder-util-runtime httpExecutor.js createHttpError). No `debug`:
  // it is optional, electron-updater checks for it, and when present it dumps
  // its whole differential-download plan into it (DifferentialDownloader.doDownload).
  const loggerAdapter = Object.freeze({
    info: (message) => write('INFO', firstLine(message)),
    warn: (message) => write('WARN', firstLine(message)),
    error: (message) => {
      // AppUpdater's constructor listener repeats every 'error' event as
      // `Error: <stack>` (AppUpdater.js:201-203). While onError is subscribed,
      // that event is already logged as `error <code>: <first line>`, so the
      // copy is dropped. After dispose() it is the only record of an install
      // that fails at quit, so it is kept.
      if (subscriptions.length > 0 && String(message).startsWith('Error: ')) return;
      write('ERROR', firstLine(message));
    },
  });

  function versionOf(info) {
    return info && info.version;
  }

  // Named handlers, kept so dispose() can remove exactly these.
  function onCheckingForUpdate() {
    state = 'checking';
    write('INFO', 'checking');
  }

  function onUpdateAvailable(info) {
    availableVersion = versionOf(info);
    if (manualCheckRunning) promisedVersion = availableVersion;
    state = 'downloading';
    write('INFO', `update available ${availableVersion}`);
  }

  function onUpdateNotAvailable() {
    state = 'up-to-date';
    write('INFO', 'update not available');
  }

  function onError(err) {
    errorEvents += 1;
    // The install failed. For a failed spawn electron-updater has already
    // scheduled app.quit() (BaseUpdater.quitAndInstall), and that quit must
    // not slip past the close guard on the bypass confirmQuit armed: drop it,
    // so the quit asks about unsaved work again.
    if (state === 'installing') disarm();
    state = 'error';
    logError(err);
  }

  function onUpdateDownloaded(info) {
    const version = versionOf(info);
    readyVersion = version;
    write('INFO', `update downloaded ${version}`);
    const promised = version === promisedVersion;
    if (promised) promisedVersion = null;
    if (version === deferredVersion && !promised) {
      state = 'deferred'; // put off this session: the automatic path does not ask again
      return;
    }
    state = 'ready';
    // Never on top of a Check for Updates box: after it closes.
    const gate = openBox;
    if (gate) {
      void gate.then(() => prompt(version));
    } else {
      void prompt(version);
    }
  }

  function subscribe(emitter, event, handler) {
    emitter.on(event, handler);
    subscriptions.push([emitter, event, handler]);
  }

  /** Shows a message box parented to the main window; resolves to the
   * clicked button, or null when the box could not be shown. */
  async function showBox(options) {
    if (disposed) return null;
    try {
      const result = await dialog.showMessageBox(getWindow(), options);
      return result && typeof result.response === 'number' ? result.response : null;
    } catch (err) {
      write('WARN', `message box failed: ${firstLine(err)}`);
      return null;
    }
  }

  /** A Check for Updates box. While it is on screen, `openBox` holds it, so an
   * install prompt waits for it instead of opening on top of it. */
  async function tell(type, message, detail) {
    const options = { type, title: 'Check for Updates', message };
    if (detail !== undefined) options.detail = detail;
    const box = showBox(options);
    openBox = box;
    try {
      return await box;
    } finally {
      if (openBox === box) openBox = null;
    }
  }

  function defer(version) {
    deferredVersion = version;
    state = 'deferred';
  }

  /** In place of the prompt once an install has been attempted in this
   * process (see "One install attempt per process" at the top). */
  async function showRestartBox(version) {
    disarm(); // nothing may be left armed for a quit this path never starts
    state = 'error';
    write('WARN', `restart required to install ${version}`);
    await showBox({
      type: 'warning',
      title: 'Restart required',
      message: `Restart ${productName} to install ${version}.`,
      detail:
        'An install started earlier in this session did not finish, and it cannot be retried until the app restarts. ' +
        'The downloaded update is kept: when the app starts again, it offers the update without downloading it again.',
    });
  }

  async function prompt(version) {
    if (promptOpen || disposed) return;
    promptOpen = true;
    try {
      if (installAttempted) {
        await showRestartBox(version);
        return;
      }
      const response = await showBox({
        type: 'info',
        title: 'Update ready',
        message: `${productName} ${version} is ready to install.`,
        detail: 'Choose Later to install it the next time you quit.',
        buttons: ['Restart and install now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      // Not shown (or the app is quitting): nothing was answered, so the
      // update stays `ready` and checkNow shows the prompt again.
      if (response === null || disposed) return;
      if (response !== 0) {
        write('INFO', 'prompt answer later');
        defer(version);
        return;
      }
      write('INFO', 'prompt answer now');
      let ok;
      try {
        ok = (await confirmQuit(getWindow())) === true;
      } catch (err) {
        // Outside the guard's contract (it resolves true or false). Fail
        // closed: no install now, and no bypass left behind.
        disarm();
        defer(version);
        logError(err);
        return;
      }
      if (!ok) {
        defer(version); // treated as Later: installs at the next quit
        write('INFO', 'install postponed: unsaved work');
        return;
      }
      state = 'installing';
      write('INFO', `installing ${version}`);
      try {
        library.quitAndInstall(true, true); // silent install, then run the app again
        installAttempted = true; // it returned: never again in this process
      } catch (err) {
        // An 'error' event raised inside quitAndInstall has already disarmed
        // and logged this failure.
        if (state === 'installing') {
          disarm();
          state = 'error';
          logError(err);
        }
      }
    } finally {
      promptOpen = false;
    }
  }

  /** One check. Never rejects; every failure ends up as one `error` line. */
  async function runCheck() {
    const errorsBefore = errorEvents;
    try {
      const result = await library.checkForUpdates();
      // A background download that fails rejects this promise AND emits
      // 'error'. The event is the report; the rejection only must not go unhandled.
      if (result && result.downloadPromise && typeof result.downloadPromise.catch === 'function') {
        result.downloadPromise.catch(() => {});
      }
    } catch (err) {
      // electron-updater emits 'error' for a failed check and then rejects
      // with the same error, and the event has logged it. Log here only when
      // no event came.
      if (errorEvents === errorsBefore) onError(err);
    }
  }

  function configExists() {
    try {
      return fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
    } catch {
      return false;
    }
  }

  function start() {
    if (started || disposed) return;
    started = true;
    truncateOversizedLog();
    write('INFO', `started ${productName} ${currentVersion}`);
    // Gate order matters: Store, portable, dev, no-config. None of them
    // touches electron-updater or the network.
    if (isWindowsStore === true) {
      state = 'disabled-store';
      write('INFO', 'disabled-store');
      return;
    }
    if (typeof portableDir === 'string' && portableDir !== '') {
      state = 'disabled-portable';
      write('INFO', 'disabled-portable');
      return;
    }
    if (!isPackaged) {
      state = 'disabled-dev';
      write('INFO', 'disabled-dev');
      return;
    }
    if (!configExists()) {
      state = 'disabled-no-config';
      write('INFO', 'disabled-no-config');
      return;
    }
    try {
      library = deps.autoUpdater;
      library.autoDownload = true;
      library.autoInstallOnAppQuit = true;
      library.logger = loggerAdapter;
      subscribe(library, 'checking-for-update', onCheckingForUpdate);
      subscribe(library, 'update-available', onUpdateAvailable);
      subscribe(library, 'update-not-available', onUpdateNotAvailable);
      subscribe(library, 'error', onError);
      subscribe(library, 'update-downloaded', onUpdateDownloaded);
    } catch (err) {
      // electron-updater could not be loaded or set up (a packaging defect
      // that left it out of app.asar, say): logged, and the app runs on.
      library = null;
      onError(err);
      return;
    }
    void runCheck();
  }

  async function answerManualCheck() {
    if (state === 'idle') start();
    switch (state) {
      case 'disabled-store':
        await tell('info', 'Updates for this build come through the Microsoft Store.');
        return state;
      case 'disabled-portable':
        await tell('info', 'The portable build does not update itself. Download the latest version from the Vitrine releases page.');
        return state;
      case 'disabled-dev':
        await tell('info', 'Updates are checked only in an installed build.');
        return state;
      case 'disabled-no-config':
        await tell('info', 'This build has no update feed configured.');
        return state;
      case 'ready':
      case 'deferred':
        await prompt(readyVersion);
        return state;
      case 'installing':
        return state; // the app is quitting to install; a check could only race that quit
      default:
        break;
    }
    if (installAttempted) {
      // Nothing can be installed until a restart, so no check: say that.
      await prompt(readyVersion);
      return state;
    }
    if (library === null) {
      // electron-updater could not be set up (start() logged why): nothing to
      // check with, so say that instead.
      if (state === 'error') await tell('error', 'Could not check for updates.', firstLine(lastError));
      return state;
    }
    if (disposed) return state; // quitting
    manualCheckRunning = true;
    try {
      await runCheck();
    } finally {
      manualCheckRunning = false;
    }
    switch (state) {
      case 'up-to-date':
        await tell('info', `${productName} ${currentVersion} is the latest version.`);
        break;
      case 'downloading':
        await tell('info', `Downloading ${availableVersion}; you will be asked when it is ready.`);
        break;
      case 'error':
        await tell('error', 'Could not check for updates.', firstLine(lastError));
        break;
      default:
        break; // ready or deferred: the install prompt is the answer
    }
    return state;
  }

  function checkNow() {
    if (manualCheck) return manualCheck;
    manualCheck = answerManualCheck()
      .catch(() => state)
      .finally(() => {
        manualCheck = null;
      });
    return manualCheck;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [emitter, event, handler] of subscriptions) emitter.removeListener(event, handler);
    subscriptions = [];
  }

  function getState() {
    return state;
  }

  return { start, checkNow, dispose, getState };
}

/** Help > Check for Updates… reaches checkNow through this one channel
 * (preload.cjs `checkForUpdates`). */
function registerUpdaterIpc(ipcMain, updater) {
  ipcMain.handle('updater:check', () => updater.checkNow());
}

module.exports = { createUpdater, registerUpdaterIpc, STATES, MAX_LOG_BYTES };
