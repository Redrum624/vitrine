/**
 * v1.40.0 Task 9b — single apply ("after applying there is a second applying").
 *
 * Root cause (R2): a trigger landing while a pass is in flight armed an
 * unconditional replay in the pass's finally, so an unchanged state was
 * rendered twice; and a worker failure fell back to a main-thread render of
 * the LIVE params (the crop released mid-pass), after which the replay painted
 * the identical crop again.
 *
 * Contracts:
 *  - a trigger during an in-flight pass whose state signature is unchanged
 *    does NOT replay (processImage called once)
 *  - a trigger during an in-flight pass whose state DID change replays once
 *  - worker failure: the fallback renders the POSTED params — when the live
 *    params differ it drops the result (the replay renders the live state)
 *    instead of painting live params under the stale pass
 *  - supersede (crop release): a pass stuck in the worker is marked stale and
 *    the release pass starts at once instead of queueing behind it; the stale
 *    result never paints
 */
const mockCurrentImage = {
  data: new Float32Array(16 * 16 * 4).fill(0.5),
  width: 16,
  height: 16,
  filePath: 'C:/img/test.orf',
};

// One live, mutable module so the panel's state signature can change mid-pass.
const liveParams: { value: number } = { value: 1 };
const fakeModule = {
  getId: () => 'basicadj',
  getName: () => 'Basic',
  isEnabled: true,
  getParams: () => ({ exposure: liveParams.value }),
};

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModule: jest.fn(() => undefined),
  getOrderedModules: jest.fn(() => [fakeModule]),
  isModuleActive: jest.fn(() => false),
  invalidateModuleCache: jest.fn(),
  resetAllModules: jest.fn(),
  getStats: jest.fn(() => ({ enabledModules: 1, moduleCount: 1 })),
  processImage: jest.fn(async (d: Float32Array) => {
    await new Promise((r) => setTimeout(r, 500));
    return d;
  }),
} }));

jest.mock('../shaders/GpuPreviewPipeline', () => ({ gpuPreviewPipeline: {
  isAvailable: jest.fn(() => false),
  getMaxTextureSize: jest.fn(() => 16384),
  setSource: jest.fn(),
  setDehazeParam: jest.fn(),
  render: jest.fn(),
  readback: jest.fn(() => new Float32Array(4)),
} }));

jest.mock('../shaders/passDescriptors', () => ({
  buildPassList: jest.fn(() => ({ passes: [], cpuBridges: [] })),
  getGpuUnsafeModuleIds: jest.fn(() => new Set<string>()),
  setGpuUnsafeModuleIds: jest.fn(),
}));

const mockRoute = { path: 'main' as 'main' | 'worker' | 'gpu' };
jest.mock('../services/previewRouting', () => ({
  choosePreviewRoute: jest.fn(() => ({ path: mockRoute.path, reason: 'test' })),
}));

jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { processImage: jest.fn(), isHealthy: jest.fn(() => true) },
}));

jest.mock('../services/ProgressivePreviewService', () => ({
  progressivePreviewService: { cancelActiveRequests: jest.fn() },
}));

jest.mock('../services/AdaptiveDebounceService', () => ({ adaptiveDebounceService: {
  debounce: jest.fn((_key: string, cb: () => void) => { setTimeout(cb, 50); }),
  cancelAll: jest.fn(),
  clearHistory: jest.fn(),
} }));

import { render, act, cleanup } from '@testing-library/react';
import { AdjustmentPanel } from '../components/Panels/AdjustmentPanel';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { webWorkerImageProcessor } from '../services/WebWorkerImageProcessor';
import { useAppStore } from '../stores/appStore';

const mainProcess = imageProcessingPipeline.processImage as jest.Mock;
// The real setter, captured before any spy: zustand copies state props into each new state
// object, so a restored spy from a previous test would otherwise linger as a no-op.
const realSetProcessed = useAppStore.getState().setProcessedImageData;
const workerProcess = webWorkerImageProcessor.processImage as jest.Mock;

async function flush(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    await act(async () => { jest.advanceTimersByTime(50); });
  }
}

async function mountPanel() {
  await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
}

describe('AdjustmentPanel single apply (replay signature)', () => {
  let setProcessed: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    liveParams.value = 1;
    mockRoute.path = 'main';
    useAppStore.setState({
      processingVersion: 0, externalParamsVersion: 0, isProcessing: false, processedImageData: null,
      cropDragSuspended: false, setProcessedImageData: realSetProcessed,
    });
    mainProcess.mockClear();
    workerProcess.mockReset();
    setProcessed = jest.spyOn(useAppStore.getState(), 'setProcessedImageData');
  });

  afterEach(() => {
    cleanup();
    setProcessed.mockRestore();
    jest.useRealTimers();
  });

  test('a trigger during an in-flight pass with an UNCHANGED signature does not replay', async () => {
    await mountPanel();
    expect(mainProcess).toHaveBeenCalledTimes(1); // mount pass, in flight for 500ms
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(2000);
    expect(mainProcess).toHaveBeenCalledTimes(1);
  });

  test('a trigger during an in-flight pass with a CHANGED signature replays once', async () => {
    await mountPanel();
    liveParams.value = 2;
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(2000);
    expect(mainProcess).toHaveBeenCalledTimes(2);
  });

  test('worker failure with live params changed mid-pass: fallback does NOT render live params', async () => {
    mockRoute.path = 'worker';
    let failFirst: (e: Error) => void = () => {};
    workerProcess.mockImplementationOnce(() => new Promise((_res, rej) => { failFirst = rej; }));
    workerProcess.mockImplementation(async (img: { data: Float32Array; width: number; height: number }) =>
      ({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height }));

    await mountPanel();
    expect(workerProcess).toHaveBeenCalledTimes(1);
    const posted = workerProcess.mock.calls[0][1];
    expect(posted[0].params).toEqual({ exposure: 1 });

    // Live state moves on (the crop is released) and a trigger lands mid-pass.
    liveParams.value = 2;
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await act(async () => { failFirst(new Error('timeout')); });
    await flush(2000);

    // No main-thread fallback render of the live (unposted) params...
    expect(mainProcess).not.toHaveBeenCalled();
    // ...the replay renders the live state through the worker exactly once.
    expect(workerProcess).toHaveBeenCalledTimes(2);
    expect(workerProcess.mock.calls[1][1][0].params).toEqual({ exposure: 2 });
    expect(setProcessed).toHaveBeenCalledTimes(1);
  });

  test('worker failure with live params unchanged: fallback renders (posted == live)', async () => {
    mockRoute.path = 'worker';
    workerProcess.mockImplementation(async () => { throw new Error('crash'); });
    await mountPanel();
    await flush(1000);
    expect(mainProcess).toHaveBeenCalledTimes(1);
    expect(setProcessed).toHaveBeenCalledTimes(1);
  });

  test('fix 4: a dropped fallback ARMS the replay even with no trigger pending', async () => {
    mockRoute.path = 'worker';
    let failFirst: (e: Error) => void = () => {};
    workerProcess.mockImplementationOnce(() => new Promise((_res, rej) => { failFirst = rej; }));
    workerProcess.mockImplementation(async (img: { data: Float32Array; width: number; height: number }) =>
      ({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height }));
    await mountPanel();
    liveParams.value = 7; // live moves on WITHOUT a trigger (mid-drag param writes)
    await act(async () => { failFirst(new Error('timeout')); });
    await flush(2000);
    expect(mainProcess).not.toHaveBeenCalled();
    expect(workerProcess).toHaveBeenCalledTimes(2);
    expect(workerProcess.mock.calls[1][1][0].params).toEqual({ exposure: 7 });
    expect(setProcessed).toHaveBeenCalledTimes(1);
  });

  test('fix 1: the drag-suspension flag rides the pass context (main and worker), and only while set', async () => {
    mockRoute.path = 'worker';
    workerProcess.mockImplementation(async (img: { data: Float32Array; width: number; height: number }) =>
      ({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height }));
    useAppStore.setState({ cropDragSuspended: true });
    await mountPanel();
    expect(workerProcess.mock.calls[0][0].cropSuspended).toBe(true);
    useAppStore.setState({ cropDragSuspended: false });
    mockRoute.path = 'main';
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(1000);
    expect(mainProcess).toHaveBeenCalledTimes(1);
    expect(mainProcess.mock.calls[0][1].cropSuspended).toBe(false);
  });

  test('fix 2: the GPU route publishes the displayed frame SYNCHRONOUSLY when geometry changes', async () => {
    mockRoute.path = 'gpu';
    // A CPU crop frame is on screen (different dims + a frameRect).
    useAppStore.setState({
      processedImageData: { data: new Float32Array(4), width: 8, height: 6, isPreview: true, frameRect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
    });
    await mountPanel(); // no timers advanced: the 150ms readback has NOT fired
    const shown = useAppStore.getState().processedImageData as { width: number; height: number; frameRect?: unknown };
    expect(shown.width).toBe(16);
    expect(shown.height).toBe(16);
    expect(shown.frameRect).toBeUndefined();
  });

  test('fix 3: a pending GPU readback never overwrites a newer CPU frame', async () => {
    mockRoute.path = 'gpu';
    // Same geometry as the GPU output ⇒ the throttled (150ms) readback path is taken.
    useAppStore.setState({ processedImageData: { data: new Float32Array(4), width: 16, height: 16, isPreview: true } });
    await mountPanel();
    // A CPU pass (crop applied) starts at once and paints before the readback is due.
    mockRoute.path = 'main';
    const cpuFrame = new Float32Array(16 * 16 * 4).fill(0.25);
    mainProcess.mockImplementationOnce(async () => cpuFrame);
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(100); // debounce 50ms → CPU pass paints (~t=50-100ms)
    await flush(500); // well past the 150ms readback
    const shown = useAppStore.getState().processedImageData as { data: Float32Array };
    expect(shown.data).toBe(cpuFrame);
  });

  test('supersede: a pass stuck in the worker is marked stale; the release pass starts at once', async () => {
    mockRoute.path = 'worker';
    let resolveStuck: (v: unknown) => void = () => {};
    workerProcess.mockImplementationOnce((img: { data: Float32Array; width: number; height: number }) =>
      new Promise((res) => { resolveStuck = () => res({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height, frameRect: { x: 0, y: 0, width: 1, height: 1 } }); }));
    workerProcess.mockImplementation(async (img: { data: Float32Array; width: number; height: number }) =>
      ({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height, frameRect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }));

    await mountPanel(); // suspension pass: stuck in the worker
    expect(workerProcess).toHaveBeenCalledTimes(1);

    liveParams.value = 3; // released crop
    await act(async () => {
      useAppStore.getState().supersedeInFlightPreview();
      useAppStore.getState().triggerReprocessing();
    });
    await flush(200);
    // Release pass ran without waiting for the stuck one.
    expect(workerProcess).toHaveBeenCalledTimes(2);
    expect(setProcessed).toHaveBeenCalledTimes(1);
    const shown = setProcessed.mock.calls[0][0];
    expect(shown.frameRect).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });

    // The stuck pass finally returns: stale, never painted, no replay.
    await act(async () => { resolveStuck(undefined); });
    await flush(1000);
    expect(setProcessed).toHaveBeenCalledTimes(1);
    expect(workerProcess).toHaveBeenCalledTimes(2);
    expect(mainProcess).not.toHaveBeenCalled();
  });

  // ── Task 12b: last value wins ────────────────────────────────────────────────
  test('12b: ANY changed-state trigger supersedes a pass parked on a worker; stale result never paints', async () => {
    mockRoute.path = 'worker';
    let resolveStuck: (v: unknown) => void = () => {};
    workerProcess.mockImplementationOnce((img: { data: Float32Array; width: number; height: number }) =>
      new Promise((res) => { resolveStuck = () => res({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height }); }));
    workerProcess.mockImplementation(async (img: { data: Float32Array; width: number; height: number }) =>
      ({ success: true, data: img.data, processingTime: 1, width: img.width, height: img.height }));

    await mountPanel();
    expect(workerProcess).toHaveBeenCalledTimes(1);
    liveParams.value = 9; // the latest wheel value
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(200);
    // The latest value paints next, without waiting for the stuck pass.
    expect(workerProcess).toHaveBeenCalledTimes(2);
    expect(workerProcess.mock.calls[1][1][0].params).toEqual({ exposure: 9 });
    expect(setProcessed).toHaveBeenCalledTimes(1);

    await act(async () => { resolveStuck(undefined); });
    await flush(1000);
    expect(setProcessed).toHaveBeenCalledTimes(1); // stale result dropped
    expect(workerProcess).toHaveBeenCalledTimes(2);
  });

  test('12b: a trigger inside the 50ms window with no pass in flight still renders the latest value', async () => {
    mockRoute.path = 'main';
    mainProcess.mockImplementation(async (d: Float32Array) => d); // instant passes
    await mountPanel();
    await flush(100);
    const before = mainProcess.mock.calls.length;
    liveParams.value = 5;
    // Call straight after a pass finished: inside the throttle window.
    await act(async () => { useAppStore.getState().triggerReprocessing(); });
    await flush(600);
    expect(mainProcess.mock.calls.length).toBeGreaterThan(before);
    mainProcess.mockImplementation(async (d: Float32Array) => {
      await new Promise((r) => setTimeout(r, 500));
      return d;
    });
  });
});
