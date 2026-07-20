// Jest stub for src/utils/createEnhanceWorker.ts (whose Vite `?worker&url`
// import ts-jest cannot resolve). Rejecting mirrors jsdom's missing Worker
// global: EnhanceWorkerClient.run rejects, and callers (EnhanceService) fall
// back to their main-thread paths. Tests inject a FakeWorker via the
// workerFactory constructor parameter instead.
module.exports = {
  createEnhanceWorker: () => Promise.reject(new Error('createEnhanceWorker is stubbed in jest')),
};
