export function createEnhanceWorker(): Worker {
  return new Worker(new URL('../workers/enhance.worker.ts', import.meta.url), { type: 'module' });
}
