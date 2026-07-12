/**
 * P6 item 6: librawWasmNode.buildWasmOptions must warn at most ONCE per process for an unknown
 * highlightMode. It runs once per decoded file, so warning on every call spams the log across a
 * batch. Each test uses jest.isolateModules to get a fresh module (resetting the warn-once latch).
 */
type LibrawWasm = {
  buildWasmOptions: (
    options: { demosaic?: string; highlightMode?: string },
    log?: { warn: (m: string) => void; log: (m: string) => void },
  ) => { userQual: number; highlight?: number };
};

const loadFresh = (): LibrawWasm => {
  let mod!: LibrawWasm;
  jest.isolateModules(() => {
    mod = require('../../electron/librawWasmNode.cjs') as LibrawWasm;
  });
  return mod;
};

describe('buildWasmOptions — warn-once for unknown highlight modes', () => {
  it('warns only ONCE across repeated unknown highlight modes', () => {
    const mod = loadFresh();
    const log = { warn: jest.fn(), log: jest.fn() };
    mod.buildWasmOptions({ demosaic: 'dcb', highlightMode: 'bogus' }, log);
    mod.buildWasmOptions({ demosaic: 'dcb', highlightMode: 'also-bogus' }, log);
    mod.buildWasmOptions({ demosaic: 'dcb', highlightMode: 'still-bogus' }, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('still maps a valid highlight mode with no warning', () => {
    const mod = loadFresh();
    const log = { warn: jest.fn(), log: jest.fn() };
    const opts = mod.buildWasmOptions({ demosaic: 'ahd', highlightMode: 'reconstruct' }, log);
    expect(opts.highlight).toBe(5); // reconstruct → 5
    expect(log.warn).not.toHaveBeenCalled();
  });
});
