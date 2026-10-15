/** @jest-environment node */
/**
 * Final-review fix 2: "Restart and install now" must not kill a running export, and an
 * unanswered close request must not count as YES for the install path.
 *  - createCloseRequester: renderer answer → {ok, reason}; timeout → the caller's fallback
 *    (window close keeps true; install passes false).
 *  - closeGuard.confirmQuit uses requestInstallClose when given and passes a refusal reason on.
 *  - updater: an 'export-in-progress' refusal shows the "install when you quit" box and defers.
 */
import { EventEmitter } from 'node:events';
const { createCloseRequester } = require('../../electron/closeRequest.cjs');
const { createCloseGuard } = require('../../electron/closeGuard.cjs');
const { createUpdater } = require('../../electron/updater.cjs');

const flush = () => new Promise((r) => setImmediate(r));

function fakeIpc() {
  const ipc = new EventEmitter();
  const win = { isDestroyed: () => false, webContents: { send: jest.fn() } };
  return { ipc, win };
}

describe('createCloseRequester', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves the renderer answer with its reason and removes its listener', async () => {
    const { ipc, win } = fakeIpc();
    const r = createCloseRequester({ ipcMain: ipc, getWindow: () => win, timeoutMs: 5000 });
    const p = r.request({ fallback: true });
    expect(win.webContents.send).toHaveBeenCalledWith('app-close-request');
    ipc.emit('app-close-response', {}, false, 'export-in-progress');
    await expect(p).resolves.toEqual({ ok: false, reason: 'export-in-progress', timedOut: false });
    expect(ipc.listenerCount('app-close-response')).toBe(0);
  });

  it('a timeout resolves the fallback: true for a window close, false for an install', async () => {
    const { ipc, win } = fakeIpc();
    const r = createCloseRequester({ ipcMain: ipc, getWindow: () => win, timeoutMs: 5000 });
    const close = r.request({ fallback: true });
    jest.advanceTimersByTime(5000);
    await expect(close).resolves.toEqual({ ok: true, reason: 'timeout', timedOut: true });
    const install = r.request({ fallback: false });
    jest.advanceTimersByTime(5000);
    await expect(install).resolves.toEqual({ ok: false, reason: 'timeout', timedOut: true });
    expect(ipc.listenerCount('app-close-response')).toBe(0);
  });

  it('no window → ok', async () => {
    const { ipc } = fakeIpc();
    const r = createCloseRequester({ ipcMain: ipc, getWindow: () => null, timeoutMs: 5000 });
    await expect(r.request({ fallback: false })).resolves.toEqual({ ok: true, reason: 'no-window', timedOut: false });
  });
});

describe('closeGuard.confirmQuit with requestInstallClose', () => {
  it('uses the install requester (not requestAppClose) and passes the refusal reason on', async () => {
    const requestAppClose = jest.fn(async () => true);
    const requestInstallClose = jest.fn(async () => ({ ok: false, reason: 'export-in-progress' }));
    const guard = createCloseGuard({ requestAppClose, requestInstallClose, performAppCleanup: jest.fn() });
    await expect(guard.confirmQuit()).resolves.toEqual({ ok: false, reason: 'export-in-progress' });
    expect(requestAppClose).not.toHaveBeenCalled();
    // No bypass armed: the next window close still asks.
    const win = { isDestroyed: () => false, destroy: jest.fn() };
    await guard.handleClose(win, { preventDefault: jest.fn() });
    expect(requestAppClose).toHaveBeenCalledTimes(1);
  });

  it('a timed-out install request is a NO', async () => {
    const requestInstallClose = jest.fn(async () => ({ ok: false, reason: 'timeout', timedOut: true }));
    const guard = createCloseGuard({ requestAppClose: jest.fn(async () => true), requestInstallClose, performAppCleanup: jest.fn() });
    const ans = await guard.confirmQuit();
    expect(ans).not.toBe(true);
  });

  it('an ok install request arms the bypass (true)', async () => {
    const guard = createCloseGuard({
      requestAppClose: jest.fn(async () => true),
      requestInstallClose: jest.fn(async () => ({ ok: true })),
      performAppCleanup: jest.fn(),
    });
    await expect(guard.confirmQuit()).resolves.toBe(true);
  });
});

describe('updater: export in progress', () => {
  function make(confirmQuit: jest.Mock) {
    const au = new EventEmitter() as EventEmitter & Record<string, unknown>;
    au.checkForUpdates = jest.fn(async () => null);
    au.quitAndInstall = jest.fn();
    au.on('error', () => undefined);
    const dialog = { showMessageBox: jest.fn(async (_w?: unknown, _o?: Record<string, unknown>) => ({ response: 0 })) };
    const fs = { existsSync: jest.fn(() => true), mkdirSync: jest.fn(), appendFileSync: jest.fn(), statSync: jest.fn(() => ({ size: 0 })), truncateSync: jest.fn() };
    const updater = createUpdater({
      get autoUpdater() { return au; },
      isPackaged: true, isWindowsStore: false, portableDir: undefined, resourcesPath: '/res', fs, dialog,
      getWindow: () => ({}), confirmQuit, disarmQuit: jest.fn(), logFile: '/ud/logs/updater.log',
      productName: 'Vitrine', currentVersion: '1.40.0',
    });
    return { updater, au, dialog, fs };
  }

  it('shows the export box, does not install, stays deferred', async () => {
    const { updater, au, dialog } = make(jest.fn(async () => ({ ok: false, reason: 'export-in-progress' })));
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush(); await flush();
    expect(au.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.getState()).toBe('deferred');
    const messages = dialog.showMessageBox.mock.calls.map((c) => String((c[1] as Record<string, unknown>).message));
    expect(messages).toContain('An export is in progress — the update will install when you quit.');
  });

  it('a timed-out confirmation does not install', async () => {
    const { updater, au } = make(jest.fn(async () => ({ ok: false, reason: 'timeout', timedOut: true })));
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush(); await flush();
    expect(au.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.getState()).toBe('deferred');
  });
});
