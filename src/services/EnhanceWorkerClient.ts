import { EnhanceParams } from '../utils/enhanceChain';
import { createEnhanceWorker } from '../utils/createEnhanceWorker';

export interface EnhanceWorkerResult { enhanced: Float32Array; base: Float32Array; width: number; height: number }

export class EnhanceWorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  constructor(private workerFactory?: () => Worker) {}
  private get w(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory ? this.workerFactory() : createEnhanceWorker();
    }
    return this.worker;
  }
  run(rgba: Float32Array, width: number, height: number, params: EnhanceParams): Promise<EnhanceWorkerResult> {
    const id = ++this.seq; const w = this.w;
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const m = e.data as { type: string; id: number; error?: string } & EnhanceWorkerResult;
        if (m.id !== id) return;
        w.removeEventListener('message', onMsg);
        if (m.type === 'ENHANCE_COMPLETE') resolve({ enhanced: m.enhanced, base: m.base, width: m.width, height: m.height });
        else reject(new Error(m.error || 'enhance worker failed'));
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'ENHANCE', id, data: { rgba, width, height, params } }, [rgba.buffer]);
    });
  }
  dispose(): void { this.worker?.terminate(); this.worker = null; }
}
export const enhanceWorkerClient = new EnhanceWorkerClient();
