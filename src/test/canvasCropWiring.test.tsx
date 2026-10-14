/**
 * v1.40.0 Task 9b fix round 1 — Canvas crop wiring.
 *  - the displayed frame published with processedImageData (frameRect) reaches both the
 *    crop overlay and the handles as `displayFrame`; the handles are bounded by the full
 *    expanded canvas (owner decision: the suspended drag shows the whole rotated photo)
 *  - handle mousedown on a rotated photo suspends the crop (rect zeroed + the store's
 *    drag-suspension flag set + one reprocess); release clears the flag, supersedes the
 *    in-flight suspension pass and applies (one more reprocess)
 * The overlay/handle components are stubbed to capture their props.
 */
import { render, act } from '@testing-library/react';
import type { ImageFileInfo } from '../services/FileSystemService';

const captured: { overlay?: Record<string, unknown>; handles?: Record<string, unknown> } = {};
jest.mock('../components/Canvas/CropTransformOverlay', () => ({
  CropTransformOverlay: (props: Record<string, unknown>) => { captured.overlay = props; return null; },
}));
jest.mock('../components/Canvas/InteractiveCropHandles', () => ({
  InteractiveCropHandles: (props: Record<string, unknown>) => { captured.handles = props; return null; },
}));

const base = { data: new Float32Array(128 * 96 * 4).fill(0.5), width: 128, height: 96, filePath: '/a.orf' };
jest.mock('../services/ImageService', () => ({
  imageService: {
    loadImage: jest.fn(async () => {}),
    getCurrentImage: jest.fn(() => base),
  },
}));
jest.mock('../services/EditPersistenceService', () => ({
  editPersistenceService: {
    flush: jest.fn(),
    scheduleSave: jest.fn(),
    getSavedEditState: jest.fn(async () => null),
    restoreState: jest.fn(() => false),
    getSavedRawDecodeOptions: jest.fn(async () => null),
    validateSavedRawDecodeOptions: jest.fn((saved) => saved ?? null),
    validateBakedUpscaleIntent: jest.fn(() => null),
    restoreForPath: jest.fn(async () => false),
  },
}));
jest.mock('../services/CheckpointService', () => ({
  checkpointService: {
    flush: jest.fn(), loadForPath: jest.fn(async () => {}), getCheckpoints: jest.fn(() => [{ id: 1 }]), record: jest.fn(),
  },
}));
// One real crop adapter so the wiring drives genuine module state.
const mockCrop = new (require('../modules/CropPipelineModule').CropPipelineModule)();
jest.mock('../services/ImageProcessingPipeline', () => ({
  imageProcessingPipeline: {
    resetAllModules: jest.fn(),
    getModule: jest.fn((id: string) => (id === 'crop' ? mockCrop : null)),
    invalidateModuleCache: jest.fn(),
    clearCache: jest.fn(),
  },
}));
jest.mock('../services/NotificationService', () => ({ notificationService: { error: jest.fn() } }));
jest.mock('../shaders/GpuPreviewPipeline', () => ({
  gpuPreviewPipeline: { attach: jest.fn(() => false), present: jest.fn(), destroy: jest.fn(), isAvailable: jest.fn(() => false) },
}));

import { Canvas } from '../components/Layout/Canvas';
import { useAppStore } from '../stores/appStore';
import { FULL_FRAME } from '../components/Canvas/cropFrameMapping';

const IMG: ImageFileInfo = {
  id: 'a', name: 'a.orf', path: '/a.orf', size: 100, format: 'orf', type: 'image',
  lastModified: 0, dateModified: new Date(),
};

describe('Canvas crop wiring (Task 9b)', () => {
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let origRect: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    const ctx = new Proxy({}, {
      get: (_t, k) => (k === 'createImageData'
        ? (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h })
        : () => {}),
    });
    (HTMLCanvasElement.prototype.getContext as unknown) = jest.fn(() => ctx);
    origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as unknown as ReturnType<typeof origRect>;
    mockCrop.reset();
    mockCrop.setParams({ x: 0.1, y: 0.1, width: 0.6, height: 0.6, angle: 4, enabled: true });
    useAppStore.setState({
      selectedTool: 'crop', renderMode: 'cpu', cropDragSuspended: false, previewSupersedeVersion: 0, processingVersion: 0,
      processedImageData: null,
    });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLElement.prototype.getBoundingClientRect = origRect;
  });

  async function mount() {
    await act(async () => {
      render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG} />);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  test('displayFrame from the store reaches the overlay and the handles; bounds = full canvas', async () => {
    await mount(); // image open clears processedImageData; the first pass then publishes a frame
    const frame = { x: 0.1, y: 0.1, width: 0.6, height: 0.6 };
    await act(async () => {
      useAppStore.getState().setProcessedImageData({ data: new Float32Array(64 * 48 * 4), width: 64, height: 48, isPreview: true, frameRect: frame });
    });
    expect(captured.overlay?.displayFrame).toBe(frame);
    expect(captured.handles?.displayFrame).toBe(frame);
    expect(captured.handles?.boundsRect).toBe(FULL_FRAME);
  });

  test('drag start suspends (flag + one trigger); release clears the flag, supersedes and applies', async () => {
    await mount();
    const v0 = useAppStore.getState().processingVersion;
    await act(async () => { (captured.handles!.onDragStart as () => void)(); });
    expect(useAppStore.getState().cropDragSuspended).toBe(true);
    expect(mockCrop.getCropModule().getParams()).toMatchObject({ x: 0, y: 0, width: 1, height: 1, angle: 4 });
    expect(useAppStore.getState().processingVersion).toBe(v0 + 1);

    await act(async () => { (captured.handles!.onCropChange as (r: object) => void)({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }); });
    const s0 = useAppStore.getState().previewSupersedeVersion;
    await act(async () => { (captured.handles!.onDragEnd as () => void)(); });
    expect(useAppStore.getState().cropDragSuspended).toBe(false);
    expect(useAppStore.getState().previewSupersedeVersion).toBe(s0 + 1);
    expect(useAppStore.getState().processingVersion).toBe(v0 + 2);
    expect(mockCrop.getCropModule().getParams()).toMatchObject({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
  });
});
