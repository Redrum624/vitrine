import { AiUpscaleClient } from '../services/AiUpscaleClient';

function setApi(api: unknown): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
}

describe('AiUpscaleClient', () => {
  afterEach(() => { setApi(undefined); jest.clearAllMocks(); });

  it('isAvailable returns the IPC value and caches it (no re-invoke)', async () => {
    const aiUpscaleAvailable = jest.fn().mockResolvedValue(true);
    setApi({ aiUpscaleAvailable, aiUpscale: jest.fn(), onAiUpscaleProgress: jest.fn(() => () => {}) });
    const client = new AiUpscaleClient();
    expect(await client.isAvailable()).toBe(true);
    expect(await client.isAvailable()).toBe(true);
    expect(aiUpscaleAvailable).toHaveBeenCalledTimes(1);
  });

  it('caches a false availability result too', async () => {
    const aiUpscaleAvailable = jest.fn().mockResolvedValue(false);
    setApi({ aiUpscaleAvailable, aiUpscale: jest.fn(), onAiUpscaleProgress: jest.fn(() => () => {}) });
    const client = new AiUpscaleClient();
    expect(await client.isAvailable()).toBe(false);
    expect(await client.isAvailable()).toBe(false);
    expect(aiUpscaleAvailable).toHaveBeenCalledTimes(1);
  });

  it('run calls aiUpscale, forwards progress, and unsubscribes after', async () => {
    const result = { data: new Uint8Array([1, 2, 3, 4]), width: 4, height: 2, backend: 'directml' };
    const unsub = jest.fn();
    let progressCb: ((p: { done: number; total: number }) => void) | null = null;
    const onAiUpscaleProgress = jest.fn((cb: (p: { done: number; total: number }) => void) => { progressCb = cb; return unsub; });
    const aiUpscale = jest.fn().mockImplementation(async () => { progressCb?.({ done: 1, total: 2 }); return result; });
    setApi({ aiUpscaleAvailable: jest.fn().mockResolvedValue(true), aiUpscale, onAiUpscaleProgress });

    const client = new AiUpscaleClient();
    const seen: Array<{ done: number; total: number }> = [];
    const rgba = new Uint8Array(4 * 2 * 4);
    const r = await client.run(rgba, 4, 2, 2, (p) => seen.push(p));

    expect(aiUpscale).toHaveBeenCalledWith(rgba, 4, 2, 2);
    expect(r).toEqual(result);
    expect(seen).toEqual([{ done: 1, total: 2 }]);
    expect(onAiUpscaleProgress).toHaveBeenCalledTimes(1);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('run still unsubscribes when aiUpscale rejects', async () => {
    const unsub = jest.fn();
    const onAiUpscaleProgress = jest.fn(() => unsub);
    const aiUpscale = jest.fn().mockRejectedValue(new Error('boom'));
    setApi({ aiUpscaleAvailable: jest.fn().mockResolvedValue(true), aiUpscale, onAiUpscaleProgress });
    const client = new AiUpscaleClient();
    await expect(client.run(new Uint8Array(4), 1, 1, 2, () => {})).rejects.toThrow('boom');
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('isAvailable resolves false when electronAPI is absent (web/jsdom)', async () => {
    setApi(undefined);
    const client = new AiUpscaleClient();
    expect(await client.isAvailable()).toBe(false);
  });

  it('run rejects when electronAPI is absent', async () => {
    setApi(undefined);
    const client = new AiUpscaleClient();
    await expect(client.run(new Uint8Array(4), 1, 1, 2)).rejects.toThrow();
  });
});
