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
    await guard.handleClose(win, event());
    expect(requestAppClose).toHaveBeenCalledTimes(2);
  });

  it('confirmQuit true runs no cleanup; the bypassed close asks nothing, cleans up once and destroys', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup();
    expect(await guard.confirmQuit()).toBe(true);
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(performAppCleanup).not.toHaveBeenCalled();
    await guard.handleClose(win, event());
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(performAppCleanup).toHaveBeenCalledTimes(1);
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });

  it('disarmQuit re-arms: cleanup never ran, and a later close asks normally', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup();
    await guard.confirmQuit();
    guard.disarmQuit(); // the install failed
    expect(performAppCleanup).not.toHaveBeenCalled();
    await guard.handleClose(win, event());
    expect(requestAppClose).toHaveBeenCalledTimes(2);
    expect(performAppCleanup).toHaveBeenCalledTimes(1);
  });

  it('a close during confirmQuit is prevented and ignored', async () => {
    const { guard, requestAppClose, performAppCleanup, win, event } = setup();
    let answer: (v: boolean) => void = () => undefined;
    requestAppClose.mockImplementationOnce(() => new Promise<boolean>((r) => { answer = r; }));
    const pending = guard.confirmQuit();
    const e = event();
    await guard.handleClose(win, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(requestAppClose).toHaveBeenCalledTimes(1);
    expect(performAppCleanup).not.toHaveBeenCalled();
    answer(true);
    expect(await pending).toBe(true);
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it('a second confirmQuit while one is running resolves false', async () => {
    const { guard } = setup();
    const [a, b] = await Promise.all([guard.confirmQuit(), guard.confirmQuit()]);
    expect([a, b]).toEqual([true, false]);
  });
});
