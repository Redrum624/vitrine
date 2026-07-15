// TDD step 1: failing tests for the pure buildDcrawFlags function.
// The function lives in electron/rawDecoder.cjs; imported via require so ts-jest
// treats it as CommonJS (matching the jest.config.js transform setup).
const { buildDcrawFlags } = require('../../electron/rawDecoder.cjs') as {
  buildDcrawFlags: (opts: { demosaic: string; highlightMode: string; cameraMatch?: boolean }) => string[];
};

const BASE_FLAGS = ['-w', '-o', '1', '-6', '-g', '2.4', '12.92'];

/** Helper: assert consecutive pair [flag, value] appears in the array. */
function expectPair(flags: string[], flag: string, value: string) {
  const idx = flags.indexOf(flag);
  expect(idx).toBeGreaterThan(-1);
  expect(flags[idx + 1]).toBe(value);
}

describe('buildDcrawFlags', () => {
  it('DCB + blend → -q 4 and -H 2', () => {
    const flags = buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'blend' });
    expectPair(flags, '-q', '4');
    expectPair(flags, '-H', '2');
  });

  it('AHD → -q 3', () => {
    const flags = buildDcrawFlags({ demosaic: 'ahd', highlightMode: 'off' });
    expectPair(flags, '-q', '3');
  });

  it('highlight off → no -H flag at all', () => {
    const flags = buildDcrawFlags({ demosaic: 'ahd', highlightMode: 'off' });
    expect(flags).not.toContain('-H');
  });

  it('highlight reconstruct → -H 5', () => {
    const flags = buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'reconstruct' });
    expectPair(flags, '-H', '5');
  });

  it('always contains all base flags', () => {
    const flags = buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'blend' });
    for (const f of BASE_FLAGS) {
      expect(flags).toContain(f);
    }
  });

  it('base flags always present regardless of options', () => {
    const flags = buildDcrawFlags({ demosaic: 'ahd', highlightMode: 'reconstruct' });
    for (const f of BASE_FLAGS) {
      expect(flags).toContain(f);
    }
  });

  it('cameraMatch → -W (stable un-auto-brightened input for the fit)', () => {
    expect(buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true })).toContain('-W');
  });

  it('no cameraMatch (false or absent) → no -W', () => {
    expect(buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'blend', cameraMatch: false })).not.toContain('-W');
    expect(buildDcrawFlags({ demosaic: 'dcb', highlightMode: 'blend' })).not.toContain('-W');
  });
});
