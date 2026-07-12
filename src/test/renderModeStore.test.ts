/**
 * Pure-logic tests for the GPU live-path store slice added in Task 6:
 *   - renderMode      ('gpu' | 'cpu')  — which display path the Canvas uses
 *   - gpuResultVersion (number)        — bumped each time a GPU render completes
 *
 * These are store-only (no WebGL) so they run in jsdom/Jest.
 */
import { useAppStore } from '../stores/appStore';

const getState = () => useAppStore.getState();

beforeEach(() => {
  // Reset to the safe default before each test.
  getState().setRenderMode('cpu');
});

describe('renderMode', () => {
  it('defaults to cpu (safe path)', () => {
    expect(getState().renderMode).toBe('cpu');
  });

  it('setRenderMode flips to gpu and back', () => {
    getState().setRenderMode('gpu');
    expect(getState().renderMode).toBe('gpu');
    getState().setRenderMode('cpu');
    expect(getState().renderMode).toBe('cpu');
  });
});

describe('gpuResultVersion', () => {
  it('bumpGpuResult increments monotonically', () => {
    const start = getState().gpuResultVersion;
    getState().bumpGpuResult();
    getState().bumpGpuResult();
    expect(getState().gpuResultVersion).toBe(start + 2);
  });
});
