/**
 * Resolves the bundled URL of the Vite module worker.
 *
 * Isolated into its own file ON PURPOSE: `import.meta.url` is a syntax-level ES
 * module construct that ts-jest (which compiles the suite as CommonJS) cannot
 * parse. WebWorkerImageProcessor is imported transitively by many jest tests via
 * ImageProcessingPipeline, so the worker-URL expression must NOT live there.
 * jest maps this module to a stub (see jest.config.cjs moduleNameMapper), so the
 * real `import.meta.url` is only ever evaluated by Vite/Electron at runtime.
 *
 * Vite 7 statically detects this `new URL('./pipeline.worker.ts', import.meta.url)`
 * + `{ type: 'module' }` Worker pattern and emits the worker as a hashed chunk in
 * the build output, rewriting the URL to the bundled asset path.
 */
export const pipelineWorkerUrl = new URL('./pipeline.worker.ts', import.meta.url);
