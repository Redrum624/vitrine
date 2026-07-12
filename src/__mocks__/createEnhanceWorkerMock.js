// Jest stub for src/utils/createEnhanceWorker.ts (which uses import.meta.url,
// unsupported by ts-jest's CommonJS transform). Tests inject a FakeWorker.
module.exports = { createEnhanceWorker: () => {} };
