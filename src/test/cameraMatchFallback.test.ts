/**
 * @jest-environment node
 */
/**
 * A failed camera match must never leave the dark base on screen. The native rung decodes with
 * auto-brighten OFF (-W) when matching, because the match sets the final tone; if the match then
 * fails (e.g. its worker can't load in a packaged build), that base used to be shown — and cached
 * — as is: a dark, flat image (reported on a PEN-F ORF). Now the native rung re-decodes the normal
 * auto-brightened way and the result is flagged `cameraMatched: false` so it is never cached.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const applyCameraMatch = jest.fn();
jest.mock('../../electron/cameraMatch.cjs', () => ({ applyCameraMatch: (...a: unknown[]) => applyCameraMatch(...a) }));

type Decoded = { data: ArrayBuffer; width: number; height: number; channels: number; bitDepth: number; cameraMatched?: boolean; tag?: string };
type Opts = { demosaic: string; highlightMode: string; cameraMatch?: boolean };
const { decodeRawFile } = require('../../electron/rawDecoder.cjs') as {
  decodeRawFile: (p: string, log: unknown, o: Opts, rungs: Record<string, unknown>) => Promise<Decoded>;
};

const quiet = { log: () => {}, warn: () => {} };
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-fallback-')), 'x.ORF');
fs.writeFileSync(file, Buffer.alloc(16));
const base = (tag: string): Decoded => ({ data: new ArrayBuffer(6), width: 1, height: 1, channels: 3, bitDepth: 16, tag });
const MATCH = { demosaic: 'dcb', highlightMode: 'blend', cameraMatch: true };

describe('camera match fallback', () => {
  beforeEach(() => applyCameraMatch.mockReset());

  it('re-decodes the native rung with auto-brighten when the match fails', async () => {
    applyCameraMatch.mockImplementation(async (d: Decoded) => d); // same object back = skipped/failed
    const native = jest.fn(async (_p: string, _l: unknown, o: Opts) => base(o.cameraMatch ? 'dark -W' : 'brightened'));
    const r = await decodeRawFile(file, quiet, MATCH, { decodeNative: native });
    expect(native).toHaveBeenCalledTimes(2);
    expect(native.mock.calls[1][2].cameraMatch).toBe(false);
    expect(r.tag).toBe('brightened');
    expect(r.cameraMatched).toBe(false);
  });

  it('keeps a successful match and flags it', async () => {
    applyCameraMatch.mockImplementation(async (d: Decoded) => ({ ...d, tag: 'matched' }));
    const native = jest.fn(async () => base('dark -W'));
    const r = await decodeRawFile(file, quiet, MATCH, { decodeNative: native });
    expect(native).toHaveBeenCalledTimes(1);
    expect(r.tag).toBe('matched');
    expect(r.cameraMatched).toBe(true);
  });

  it('flags a failed match on the wasm rung without re-decoding (wasm never disables auto-brighten)', async () => {
    applyCameraMatch.mockImplementation(async (d: Decoded) => d);
    const native = jest.fn(async () => { throw new Error('no dcraw_emu'); });
    const wasm = jest.fn(async () => base('wasm'));
    const r = await decodeRawFile(file, quiet, MATCH, { decodeNative: native, decodeWasm: wasm });
    expect(wasm).toHaveBeenCalledTimes(1);
    expect(r.tag).toBe('wasm');
    expect(r.cameraMatched).toBe(false);
  });

  it('points the worker at app.asar.unpacked in a packaged build', () => {
    jest.isolateModules(() => {
      const { workerScriptPath } = jest.requireActual('../../electron/cameraMatch.cjs') as { workerScriptPath: (dir?: string) => string };
      const packaged = path.join(path.sep, 'Vitrine', 'resources', 'app.asar', 'electron');
      expect(workerScriptPath(packaged)).toBe(path.join(path.sep, 'Vitrine', 'resources', 'app.asar.unpacked', 'electron', 'cameraMatchWorker.cjs'));
      const dev = path.join(path.sep, 'src', 'vitrine', 'electron');
      expect(workerScriptPath(dev)).toBe(path.join(dev, 'cameraMatchWorker.cjs'));
    });
  });
});
