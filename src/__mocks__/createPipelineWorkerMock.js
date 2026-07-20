// Jest stub for src/workers/createPipelineWorker.ts (whose Vite `?worker&url`
// import ts-jest cannot resolve). Rejecting mirrors jsdom's missing Worker
// global: initialize() lands in its catch and routes to the main thread.
module.exports = {
  createPipelineWorker: () => Promise.reject(new Error('createPipelineWorker is stubbed in jest')),
};
