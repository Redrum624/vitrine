/** @jest-environment node */
import { EventEmitter } from 'node:events';
const { createUpdater, registerUpdaterIpc } = require('../../electron/updater.cjs');

const EVENTS = ['checking-for-update', 'update-available', 'update-not-available', 'error', 'update-downloaded'];
const flush = () => new Promise((r) => setImmediate(r));

function fakeAutoUpdater() {
  const au = new EventEmitter() as EventEmitter & Record<string, unknown>;
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;
  au.checkForUpdates = jest.fn(async () => null);
  au.quitAndInstall = jest.fn();
  au.on('error', () => undefined); // electron-updater's own listener
  return au;
}

function make(over: Record<string, unknown> = {}) {
  const au = fakeAutoUpdater();
  const dialog = { showMessageBox: jest.fn(async (_w?: unknown, _o?: Record<string, string>) => ({ response: 0 })) };
  const fs = {
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    appendFileSync: jest.fn(),
    statSync: jest.fn(() => ({ size: 0 })),
    truncateSync: jest.fn(),
  };
  const confirmQuit = jest.fn(async () => true);
  const disarmQuit = jest.fn();
  const getter = jest.fn(() => au);
  const deps = {
    get autoUpdater() { return getter(); },
    isPackaged: true,
    isWindowsStore: false,
    portableDir: undefined,
    resourcesPath: '/res',
    fs,
    dialog,
    getWindow: () => ({}),
    confirmQuit,
    disarmQuit,
    logFile: '/ud/logs/updater.log',
    productName: 'Vitrine',
    currentVersion: '1.40.0',
    ...over,
  };
  return { updater: createUpdater(deps), au, dialog, fs, confirmQuit, disarmQuit, getter };
}

const listenerCounts = (au: EventEmitter) => EVENTS.map((e) => au.listenerCount(e));

describe('updater gates', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['store', { isWindowsStore: true }, 'disabled-store'],
    ['portable', { portableDir: '/portable' }, 'disabled-portable'],
    ['dev', { isPackaged: false }, 'disabled-dev'],
    ['no-config', { fs: { existsSync: () => false, mkdirSync: jest.fn(), appendFileSync: jest.fn(), statSync: jest.fn(() => ({ size: 0 })), truncateSync: jest.fn() } }, 'disabled-no-config'],
  ];
  it.each(cases)('%s gate never touches electron-updater', async (_n, over, state) => {
    const { updater, au, getter } = make(over);
    updater.start();
    expect(updater.getState()).toBe(state);
    expect(getter).not.toHaveBeenCalled();
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    const r = await updater.checkNow();
    expect(r).toBe(state);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it('dev gate beats no-config when both hold', () => {
    const noConfigFs = { existsSync: () => false, mkdirSync: jest.fn(), appendFileSync: jest.fn(), statSync: jest.fn(() => ({ size: 0 })), truncateSync: jest.fn() };
    const { updater, getter } = make({ isPackaged: false, fs: noConfigFs });
    updater.start();
    expect(updater.getState()).toBe('disabled-dev');
    expect(getter).not.toHaveBeenCalled();
  });

  it('portable box names the product', async () => {
    const { updater, dialog } = make({ portableDir: '/p' });
    await updater.checkNow();
    expect(dialog.showMessageBox.mock.calls[0][1]?.message).toMatch(/Vitrine releases page/);
  });

  it('checks gates in order: store beats portable beats dev', () => {
    const a = make({ isWindowsStore: true, portableDir: 'x', isPackaged: false });
    a.updater.start();
    expect(a.updater.getState()).toBe('disabled-store');
    const b = make({ portableDir: 'x', isPackaged: false });
    b.updater.start();
    expect(b.updater.getState()).toBe('disabled-portable');
  });

  it('shows a plain-words box for a disabled manual check', async () => {
    const { updater, dialog } = make({ isWindowsStore: true });
    await updater.checkNow();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox.mock.calls[0][1]?.message).toMatch(/Microsoft Store/);
  });
});

describe('updater enabled path', () => {
  it('checks exactly once at start and sets download flags', () => {
    const { updater, au } = make();
    updater.start();
    updater.start();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(au.autoDownload).toBe(true);
    expect(au.autoInstallOnAppQuit).toBe(true);
  });

  it('update-downloaded prompts; Restart installs only after confirmQuit true', async () => {
    const { updater, au, dialog, confirmQuit } = make();
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    const opts = dialog.showMessageBox.mock.calls[0][1] as unknown as { buttons: string[] };
    expect(opts.buttons).toEqual(['Restart and install now', 'Later']);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(au.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(confirmQuit.mock.invocationCallOrder[0]).toBeLessThan(
      (au.quitAndInstall as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('an error event raised by quitAndInstall re-arms the guard', async () => {
    const { updater, au, disarmQuit } = make();
    (au.quitAndInstall as jest.Mock).mockImplementation(() => { au.emit('error', new Error('spawn failed')); });
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    expect(disarmQuit).toHaveBeenCalled();
    expect(updater.getState()).toBe('error');
  });

  it('Later does not install or confirm', async () => {
    const { updater, au, dialog, confirmQuit } = make();
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(au.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.getState()).toBe('deferred');
  });

  it('confirmQuit false does not install', async () => {
    const { updater, au, confirmQuit } = make();
    confirmQuit.mockResolvedValue(false);
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    expect(au.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.getState()).toBe('deferred');
  });

  it('quitAndInstall throwing disarms the close guard', async () => {
    const { updater, au, disarmQuit } = make();
    (au.quitAndInstall as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    expect(disarmQuit).toHaveBeenCalled();
    expect(updater.getState()).toBe('error');
  });

  it('with the real close guard: failed quitAndInstall re-arms, no cleanup ran, next close asks normally', async () => {
    const { createCloseGuard } = require('../../electron/closeGuard.cjs');
    const requestAppClose = jest.fn(async () => true);
    const performAppCleanup = jest.fn(async () => undefined);
    const guard = createCloseGuard({ requestAppClose, performAppCleanup });
    const { updater, au } = make({
      confirmQuit: () => guard.confirmQuit(),
      disarmQuit: () => guard.disarmQuit(),
    });
    (au.quitAndInstall as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
    updater.start();
    au.emit('update-downloaded', { version: '1.41.0' });
    await flush();
    expect(performAppCleanup).not.toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    const win = { isDestroyed: () => false, destroy: jest.fn() };
    await guard.handleClose(win, { preventDefault: jest.fn() });
    expect(requestAppClose).toHaveBeenCalledTimes(2);
    expect(performAppCleanup).toHaveBeenCalledTimes(1);
  });

  it('dispose restores listener counts to baseline', () => {
    const { updater, au } = make();
    const baseline = listenerCounts(au);
    updater.start();
    expect(listenerCounts(au)).not.toEqual(baseline);
    updater.dispose();
    expect(listenerCounts(au)).toEqual(baseline);
  });

  it('manual check on an up-to-date app reports it', async () => {
    const { updater, au, dialog } = make();
    (au.checkForUpdates as jest.Mock).mockImplementation(async () => {
      au.emit('update-not-available', {});
      return null;
    });
    updater.start();
    await flush();
    dialog.showMessageBox.mockClear();
    await updater.checkNow();
    expect(dialog.showMessageBox.mock.calls[0][1]?.message).toMatch(/latest version/);
  });

  it('registerUpdaterIpc wires updater:check to checkNow', async () => {
    const { updater } = make({ isPackaged: false });
    const ipcMain = { handle: jest.fn() };
    registerUpdaterIpc(ipcMain, updater);
    expect(ipcMain.handle.mock.calls[0][0]).toBe('updater:check');
    const state = await ipcMain.handle.mock.calls[0][1]();
    expect(state).toBe('disabled-dev');
  });
});
