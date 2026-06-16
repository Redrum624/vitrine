// Jest stub for src/workers/pipelineWorkerUrl.ts (which uses import.meta.url,
// unsupported by ts-jest's CommonJS transform). Tests never spawn a real Worker.
module.exports = { pipelineWorkerUrl: 'pipeline.worker.js' };
