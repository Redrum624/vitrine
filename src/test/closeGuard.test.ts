/** @jest-environment node */
const { createCloseGuard } = require('../../electron/closeGuard.cjs');

function setup(shouldClose = true) {
  const requestAppClose = jest.fn(async () => shouldClose);
  const performAppCleanup = jest.fn(async () => undefined);
  const guard = createCloseGuard({ requestAppClose, performAppCleanup });
  const win = { isDestroyed: jest.fn(() => false), destroy: jest.fn() };
  const event = () => ({ preventDefault: jest.fn() });
  return { guard, requestAppClose, performAppCleanup, win, event };
}

describe('closeGuard', () => {
  it('a normal close is prevented, asked, cleaned up and destroyed', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup();
    const e = event();
    await guard.handleClose(win, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(performAppCleanup).toHaveBeenCalledTimes(1);
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('a vetoed close destroys nothing', async () => {
    const { guard, performAppCleanup, win, event } = setup(false);
    await guard.handleClose(win, event());
    expect(performAppCleanup).not.toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('confirmQuit false aborts without cleanup or bypass', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup(false);
    expect(await guard.confirmQuit()).toBe(false);
    expect(performAppCleanup).not.toHaveBeenCalled();
    const e = event();
    await guard.handleClose(win, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(2);
  });

  it('after confirmQuit true the next close passes through without asking again', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup();
    expect(await guard.confirmQuit()).toBe(true);
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(performAppCleanup).toHaveBeenCalledTimes(1);
    const e = event();
    await guard.handleClose(win, e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('disarmQuit restores the normal guarded close', async () => {
    const { guard, requestAppClose, win, event } = setup();
    await guard.confirmQuit();
    guard.disarmQuit();
    const e = event();
    await guard.handleClose(win, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(2);
  });

  it('a second confirmQuit while one is running resolves false', async () => {
    const { guard } = setup();
    const [a, b] = await Promise.all([guard.confirmQuit(), guard.confirmQuit()]);
    expect([a, b]).toEqual([true, false]);
  });
});
