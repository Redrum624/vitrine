import { choosePreviewRoute, choosePreviewPath } from '../services/previewRouting';

const base = {
  gpuAvailable: true,
  activeCpuBridgeCount: 1, // GPU-ineligible
  passCount: 3,
  width: 1600,
  height: 1280, // ~2MP
};

describe('choosePreviewRoute NR guard', () => {
  it('NR active + GPU-ineligible 2MP -> main / nr-needs-renderer-gpu', () => {
    expect(choosePreviewRoute({ ...base, nrActive: true })).toEqual({ path: 'main', reason: 'nr-needs-renderer-gpu' });
  });
  it('NR active + GPU-eligible -> gpu', () => {
    expect(choosePreviewRoute({ ...base, activeCpuBridgeCount: 0, nrActive: true })).toEqual({ path: 'gpu', reason: 'gpu' });
  });
  it('NR inactive 2MP -> worker (unchanged)', () => {
    expect(choosePreviewRoute({ ...base, nrActive: false })).toEqual({ path: 'worker', reason: 'worker' });
    expect(choosePreviewRoute({ ...base })).toEqual({ path: 'worker', reason: 'worker' });
  });
  it('NR active + unhealthy workers -> main', () => {
    expect(choosePreviewRoute({ ...base, nrActive: true, workersHealthy: false }).path).toBe('main');
  });
  it('non-NR reasons', () => {
    expect(choosePreviewRoute({ ...base, workersHealthy: false })).toEqual({ path: 'main', reason: 'workers-unhealthy' });
    expect(choosePreviewRoute({ ...base, width: 100, height: 100 })).toEqual({ path: 'main', reason: 'small-main' });
  });
  it('choosePreviewPath wrapper returns path only', () => {
    expect(choosePreviewPath({ ...base, nrActive: true })).toBe('main');
  });
});
