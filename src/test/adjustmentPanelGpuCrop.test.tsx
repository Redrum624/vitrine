/**
 * v1.40.0 Task 10b — an active crop/straighten renders on the GPU preview path.
 *
 * Before 10b an active crop was always a CPU bridge, so every cropped frame ran the whole
 * pipeline on the CPU (bicubic 0.8-1.8 s at 1280 px, plus the worker hang). With the GPU
 * crop route ON, AdjustmentPanel must:
 *  - route an active crop to 'gpu' (REAL buildPassList, REAL CropPipelineModule);
 *  - publish the POST-crop dims (== CropModule.getOutputDimensions) and the frameRect the
 *    pass rendered — not the pre-crop preview dims;
 *  - pass the drag-suspension flag into buildPassList (whole expanded canvas while dragging);
 *  - on failedSteps ['crop'] mark 'crop' GPU-unsafe ONCE and re-run (the re-run is CPU).
 */
const W = 40;
const H = 30;
const mockCurrentImage = {
  data: new Float32Array(W * H * 4).fill(0.5),
  width: W,
  height: H,
  filePath: 'C:/img/crop.orf',
};

jest.mock('../services/ImageService', () => ({ imageService: {
  getCurrentImage: jest.fn(() => mockCurrentImage),
  getOriginalImage: jest.fn(() => mockCurrentImage),
  addImageLoadListener: jest.fn(() => () => {}),
  setProcessingPipeline: jest.fn(),
} }));

jest.mock('../services/ImageProcessingPipeline', () => {
  const { CropPipelineModule } = jest.requireActual('../modules/CropPipelineModule');
  const crop = new CropPipelineModule();
  return { imageProcessingPipeline: {
    __crop: crop,
    getModule: jest.fn((id: string) => (id === 'crop' ? crop : undefined)),
    getOrderedModules: jest.fn(() => [crop]),
    isModuleActive: jest.fn((id: string) => id === 'crop' && crop.getEnabled() && !crop.isNoOp()),
    invalidateModuleCache: jest.fn(),
    resetAllModules: jest.fn(),
    getStats: jest.fn(() => ({ enabledModules: 1, moduleCount: 1 })),
    processImage: jest.fn(async (d: Float32Array) => d),
  } };
});

// The GPU pipeline stand-in reports exactly what the real render() reports: the geometry
// step's output dims + frameRect, or the source dims without one.
const mockGpu = { srcW: 0, srcH: 0, outW: 0, outH: 0, failCrop: false };
jest.mock('../shaders/GpuPreviewPipeline', () => ({ gpuPreviewPipeline: {
  isAvailable: jest.fn(() => true),
  getMaxTextureSize: jest.fn(() => 16384),
  setSource: jest.fn((_d: Float32Array, w: number, h: number) => { mockGpu.srcW = w; mockGpu.srcH = h; }),
  setDehazeParam: jest.fn(),
  render: jest.fn((passes: Array<{ geometryStep?: { geom: { outW: number; outH: number }; frameRect: unknown } }>) => {
    const step = passes[0]?.geometryStep;
    if (step && mockGpu.failCrop) {
      mockGpu.outW = mockGpu.srcW; mockGpu.outH = mockGpu.srcH;
      return { width: mockGpu.srcW, height: mockGpu.srcH, failedSteps: ['crop'] };
    }
    mockGpu.outW = step ? step.geom.outW : mockGpu.srcW;
    mockGpu.outH = step ? step.geom.outH : mockGpu.srcH;
    return step
      ? { width: step.geom.outW, height: step.geom.outH, frameRect: step.frameRect }
      : { width: mockGpu.srcW, height: mockGpu.srcH };
  }),
  readback: jest.fn(() => new Float32Array(mockGpu.outW * mockGpu.outH * 4)),
  getSize: jest.fn(() => ({ width: mockGpu.outW, height: mockGpu.outH })),
} }));

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
import { gpuPreviewPipeline } from '../shaders/GpuPreviewPipeline';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { setGpuUnsafeModuleIds, getGpuUnsafeModuleIds } from '../shaders/passDescriptors';
import { cropRenderGeometry, frameRectOf } from '../modules/cropGeometry';
import type { CropPipelineModule } from '../modules/CropPipelineModule';
import type { ProcessedImageData } from '../types';
import { useAppStore } from '../stores/appStore';

const crop = (imageProcessingPipeline as unknown as { __crop: CropPipelineModule }).__crop;
const renderMock = gpuPreviewPipeline.render as jest.Mock;
const processImageMock = imageProcessingPipeline.processImage as jest.Mock;

async function flush(steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await act(async () => { jest.advanceTimersByTime(50); });
  }
}

function shown(): ProcessedImageData {
  const p = useAppStore.getState().processedImageData;
  if (!p || p instanceof Float32Array) throw new Error('no processed frame published');
  return p;
}

describe('AdjustmentPanel — active crop on the GPU route (Task 10b)', () => {
  let setRenderMode: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    setGpuUnsafeModuleIds([]);
    renderMock.mockClear();
    processImageMock.mockClear();
    mockGpu.failCrop = false;
    crop.reset();
    crop.setParams({ enabled: true, angle: 3, x: 0.1, y: 0.1, width: 0.7, height: 0.75 });
    setRenderMode = jest.fn();
    useAppStore.setState({
      processingVersion: 0, externalParamsVersion: 0, isProcessing: false, setRenderMode,
      processedImageData: null, cropDragSuspended: false,
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    setGpuUnsafeModuleIds([]);
  });

  it('routes the active crop to gpu and publishes the post-crop dims + frameRect', async () => {
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    await flush(4);

    expect(setRenderMode).toHaveBeenCalledWith('gpu');
    expect(setRenderMode).not.toHaveBeenCalledWith('cpu');
    expect(processImageMock).not.toHaveBeenCalled();

    const dims = crop.getCropModule().getOutputDimensions(W, H);
    expect([dims.width, dims.height]).not.toEqual([W, H]);
    const p = shown();
    expect({ width: p.width, height: p.height }).toEqual(dims);
    expect(p.data.length).toBe(dims.width * dims.height * 4);
    expect(p.frameRect).toEqual(frameRectOf(crop.getCropModule().getRenderGeometry(W, H)));
    // The GPU result size is published synchronously with the bump (Canvas sizing source).
    expect(useAppStore.getState().gpuResultGeometry).toEqual({
      width: dims.width, height: dims.height, frameRect: p.frameRect,
    });
  });

  it('passes the drag-suspension flag into buildPassList (whole expanded canvas)', async () => {
    crop.setParams({ x: 0, y: 0, width: 1, height: 1 });
    useAppStore.setState({ cropDragSuspended: true });
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    await flush(4);

    const passes = renderMock.mock.calls[0][0] as Array<{ geometryStep?: { geom: { outW: number; outH: number } } }>;
    const geom = cropRenderGeometry(crop.getParams() as never, W, H, true);
    expect(passes[0].geometryStep!.geom).toEqual(geom);
    expect([geom.outW, geom.outH]).toEqual([geom.expW, geom.expH]);
    expect({ width: shown().width, height: shown().height }).toEqual({ width: geom.outW, height: geom.outH });
  });

  it("failedSteps ['crop'] marks crop unsafe once and re-runs the frame on the CPU", async () => {
    mockGpu.failCrop = true;
    await act(async () => { render(<AdjustmentPanel selectedModule={null} currentImage={null} />); });
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(getGpuUnsafeModuleIds().has('crop')).toBe(true);
    expect(setRenderMode).not.toHaveBeenCalledWith('gpu');

    await flush(10);
    // The re-run builds crop as a CPU bridge → the CPU route renders it; never a 2nd GPU try.
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(processImageMock).toHaveBeenCalledTimes(1);
    expect(setRenderMode).toHaveBeenCalledWith('cpu');
  });
});
