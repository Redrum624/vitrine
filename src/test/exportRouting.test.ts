/**
 * Decision-table tests for the export processing route (exportRouting.ts) — the export-side
 * sibling of previewRouting.test coverage. Pure function first, then the live wrapper that reads
 * worker-pool health + pipeline NR state.
 */

const isHealthy = jest.fn(() => true);
jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { isHealthy: () => isHealthy() },
}));

import { chooseExportProcessing, decideExportProcessing, EXPORT_TILED_MIN_PIXELS } from '../services/exportRouting';

describe('chooseExportProcessing — decision table', () => {
  const base = { workersHealthy: true, nrActive: false, width: 5184, height: 3888 }; // 20MP

  it('routes a healthy, NR-off, ≤48MP export through the worker pool', () => {
    expect(chooseExportProcessing(base)).toEqual({ useWebWorkers: true, reason: 'worker-pool' });
  });

  it('unhealthy pool → main thread (graceful degradation, same as the preview path)', () => {
    expect(chooseExportProcessing({ ...base, workersHealthy: false }))
      .toEqual({ useWebWorkers: false, reason: 'workers-unhealthy' });
  });

  it('active Noise Reduction → main thread (NR GPU NLM needs the renderer WebGL2; a worker would silently drop it)', () => {
    expect(chooseExportProcessing({ ...base, nrActive: true }))
      .toEqual({ useWebWorkers: false, reason: 'nr-needs-renderer-gpu' });
  });

  it('above the pool TILED threshold (>48MP) → main thread (tiled path not parity-proven for exports)', () => {
    expect(chooseExportProcessing({ ...base, width: 10000, height: 6000 }))
      .toEqual({ useWebWorkers: false, reason: 'tiled-path-not-parity-proven' });
    // exactly AT the threshold still uses the single-worker whole-image path
    expect(chooseExportProcessing({ ...base, width: 8000, height: 6000 }).useWebWorkers).toBe(true);
  });

  it('BOTH dims ≤4096 → main thread (keeps the renderer-GPU module passes and their pre-W3 output)', () => {
    expect(chooseExportProcessing({ ...base, width: 4096, height: 4096 }))
      .toEqual({ useWebWorkers: false, reason: 'small-image-gpu-parity' });
    expect(chooseExportProcessing({ ...base, width: 4000, height: 3000 }))
      .toEqual({ useWebWorkers: false, reason: 'small-image-gpu-parity' });
  });

  it('>4096 on EITHER dim (no NR, ≤48MP) → worker (past the GPU per-side cap, main thread was CPU anyway)', () => {
    expect(chooseExportProcessing({ ...base, width: 4097, height: 2000 }))
      .toEqual({ useWebWorkers: true, reason: 'worker-pool' });
    expect(chooseExportProcessing({ ...base, width: 2000, height: 4097 }))
      .toEqual({ useWebWorkers: true, reason: 'worker-pool' });
  });

  it('threshold constant mirrors WebWorkerImageProcessor.largeImageThreshold (read from the source of truth)', () => {
    // Read the REAL module (the top-of-file mock only stubs the singleton's isHealthy) so a
    // drift in largeImageThreshold fails this test instead of a literal asserting itself.
    const { webWorkerImageProcessor: real } =
      jest.requireActual<typeof import('../services/WebWorkerImageProcessor')>('../services/WebWorkerImageProcessor');
    expect(EXPORT_TILED_MIN_PIXELS).toBe(real.getStats().largeImageThreshold);
  });

  it('NR takes precedence over size only after health (rule order is stable for log forensics)', () => {
    expect(chooseExportProcessing({ workersHealthy: false, nrActive: true, width: 10000, height: 6000 }).reason)
      .toBe('workers-unhealthy');
  });
});

describe('decideExportProcessing — live wrapper', () => {
  beforeEach(() => {
    isHealthy.mockReset();
    isHealthy.mockReturnValue(true);
  });

  const pipelineWith = (nr: boolean) => ({
    isModuleActive: (id: string) => (id === 'noise-reduction' ? nr : false),
  });

  it('reads pool health from webWorkerImageProcessor.isHealthy()', () => {
    expect(decideExportProcessing(pipelineWith(false), 5184, 3888).useWebWorkers).toBe(true);
    isHealthy.mockReturnValue(false);
    expect(decideExportProcessing(pipelineWith(false), 5184, 3888))
      .toEqual({ useWebWorkers: false, reason: 'workers-unhealthy' });
  });

  it('reads NR activity from pipeline.isModuleActive', () => {
    expect(decideExportProcessing(pipelineWith(true), 5184, 3888).reason).toBe('nr-needs-renderer-gpu');
  });

  it('a missing pipeline routes like NR-off (defensive null handling)', () => {
    expect(decideExportProcessing(null, 5184, 3888).useWebWorkers).toBe(true);
  });

  it('small exports (both dims ≤4096) stay on the main thread through the live wrapper too', () => {
    expect(decideExportProcessing(pipelineWith(false), 4000, 3000))
      .toEqual({ useWebWorkers: false, reason: 'small-image-gpu-parity' });
  });
});
