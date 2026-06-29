import { EnhanceWorkerClient } from '../services/EnhanceWorkerClient';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

class FakeWorker {
  listeners: ((e: { data: unknown }) => void)[] = [];
  posted: { msg: unknown; transfer: unknown }[] = [];
  addEventListener(_t: string, cb: (e: { data: unknown }) => void): void { this.listeners.push(cb); }
  removeEventListener(_t: string, cb: (e: { data: unknown }) => void): void { this.listeners = this.listeners.filter((l: (e: { data: unknown }) => void) => l !== cb); }
  postMessage(msg: { id: number }, transfer: unknown): void {
    this.posted.push({ msg, transfer });
    queueMicrotask(() => this.listeners.forEach((l: (e: { data: unknown }) => void) => l({ data: { type: 'ENHANCE_COMPLETE', id: msg.id, enhanced: new Float32Array(4), base: new Float32Array(4), width: 2, height: 2 } })));
  }
  terminate(): void {}
}

describe('EnhanceWorkerClient', () => {
  it('posts ENHANCE and resolves on ENHANCE_COMPLETE', async () => {
    const fake = new FakeWorker();
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    const rgba = new Float32Array([0.5,0.5,0.5,1]);
    const r = await client.run(rgba, 1, 1, DEFAULT_ENHANCE_PARAMS);
    expect((fake.posted[0].msg as { type: string }).type).toBe('ENHANCE');
    expect(r.width).toBe(2); expect(r.base.length).toBe(4);
  });
  it('rejects on ENHANCE_ERROR', async () => {
    const fake = new FakeWorker();
    fake.postMessage = function (this: FakeWorker, msg: { id: number }): void { queueMicrotask(() => this.listeners.forEach((l: (e: { data: unknown }) => void) => l({ data: { type: 'ENHANCE_ERROR', id: msg.id, error: 'boom' } }))); } as never;
    const client = new EnhanceWorkerClient(() => fake as unknown as Worker);
    await expect(client.run(new Float32Array([0,0,0,1]), 1, 1, DEFAULT_ENHANCE_PARAMS)).rejects.toThrow('boom');
  });
});
