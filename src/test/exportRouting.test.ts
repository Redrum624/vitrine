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

  it('threshold constant mirrors WebWorkerImageProcessor.largeImageThreshold (8000x6000)', () => {
    expect(EXPORT_TILED_MIN_PIXELS).toBe(8000 * 6000);
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
});
