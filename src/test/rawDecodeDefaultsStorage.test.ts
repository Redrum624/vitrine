/**
 * RAW Decode defaults memory (v1.31.0) — the last user-chosen decode options
 * become the default for never-opened RAW files, across pictures and sessions.
 * Persisted via the MAIN-PROCESS durable store (storeGet/storeSet), NOT
 * localStorage — a renderer localStorage write was live-proven to vanish when
 * the app quit shortly after. Contract: round-trip; cameraMatch stored as an
 * explicit boolean; corrupt payloads degrade to factory defaults; no-Electron
 * environments degrade to factory defaults.
 */
import {
  saveRawDecodeDefaults,
  loadRawDecodeDefaults,
  RAW_DECODE_DEFAULTS_KEY,
} from '../utils/rawDecodeDefaultsStorage';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

describe('rawDecodeDefaultsStorage', () => {
  let mem: Record<string, unknown>;

  beforeEach(() => {
    mem = {};
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      storeGet: jest.fn(async (k: string) => (k in mem ? mem[k] : null)),
      storeSet: jest.fn(async (k: string, v: unknown) => { mem[k] = v; return true; }),
    };
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  test('round-trips the chosen options through the durable store', async () => {
    saveRawDecodeDefaults({ demosaic: 'ahd', highlightMode: 'reconstruct', cameraMatch: false });
    await Promise.resolve(); // let the fire-and-forget storeSet land
    expect(await loadRawDecodeDefaults()).toEqual({
      demosaic: 'ahd',
      highlightMode: 'reconstruct',
      cameraMatch: false,
    });
  });

  test('absent cameraMatch is stored as an explicit false', async () => {
    saveRawDecodeDefaults({ demosaic: 'dcb', highlightMode: 'off' });
    await Promise.resolve();
    expect((mem[RAW_DECODE_DEFAULTS_KEY] as { cameraMatch: boolean }).cameraMatch).toBe(false);
  });

  test('unset store yields factory defaults', async () => {
    expect(await loadRawDecodeDefaults()).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  test('out-of-enum values degrade to factory defaults', async () => {
    mem[RAW_DECODE_DEFAULTS_KEY] = { demosaic: 'xtrans', highlightMode: 'blend' };
    expect(await loadRawDecodeDefaults()).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  test('a rejecting store IPC degrades to factory defaults', async () => {
    (window as unknown as { electronAPI: { storeGet: jest.Mock } }).electronAPI.storeGet =
      jest.fn(async () => { throw new Error('ipc dead'); });
    expect(await loadRawDecodeDefaults()).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  test('no electronAPI degrades to factory defaults (and save is a no-op)', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(() => saveRawDecodeDefaults({ demosaic: 'ahd', highlightMode: 'off' })).not.toThrow();
    expect(await loadRawDecodeDefaults()).toEqual(DEFAULT_RAW_DECODE_OPTIONS);
  });

  test('load returns a fresh object each time (no shared mutable state)', async () => {
    saveRawDecodeDefaults({ demosaic: 'ahd', highlightMode: 'blend', cameraMatch: true });
    await Promise.resolve();
    const a = await loadRawDecodeDefaults();
    a.demosaic = 'dcb';
    expect((await loadRawDecodeDefaults()).demosaic).toBe('ahd');
  });
});
