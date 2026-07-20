/**
 * Vite `?worker&url` imports resolve to the emitted worker-chunk URL (build)
 * or the dev-server worker module URL (dev). The project does not include the
 * full vite/client type surface, so declare just this specifier shape.
 * Used by src/workers/createPipelineWorker.ts.
 */
declare module '*?worker&url' {
  const workerUrl: string;
  export default workerUrl;
}
