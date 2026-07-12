/**
 * Regression test: Canvas must NOT redraw the PREVIOUS image at full resolution
 * during an image switch.
 *
 * Root cause (perf profile, latency round 4): on image open, `loadImage` clears the
 * render cache and sets `processedImageData` to null while imageService still holds
 * the OUTGOING image's decoded buffer (the new decode is in flight). That null flip
 * fires redrawCanvas, which — with no processed data — fell through to
 * `drawLoadedImageOptimized(currentImageData.data)`, blitting the OLD 20MP frame
 * (~0.65-0.9s) and delaying the new decode's dispatch to ~+914ms.
 *
 * The fix guards the base draw by source identity (`isBaseImageStale`): when the
 * loaded pixels' filePath differs from the image being displayed, skip the full-res
 * redraw and leave the (already-cleared) canvas blank until the new data lands.
 *
 * Part 1 unit-tests the pure guard. Part 2 renders Canvas in the mid-switch state
 * (imageService still returning image A while displayImage is B, processedImageData
 * null) and asserts the expensive draw path — `ctx.createImageData`, only reached by
 * a real base render — does NOT run; the matching-path control proves it still draws
 * when the base belongs to the displayed image.
 */
import { render, act } from '@testing-library/react';
import { Canvas, isBaseImageStale } from '../components/Layout/Canvas';
import { useAppStore } from '../stores/appStore';
import { imageService } from '../services/ImageService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { checkpointService } from '../services/CheckpointService';
import type { ImageFileInfo } from '../services/FileSystemService';

jest.mock('../services/ImageService', () => ({
  imageService: {
    loadImage: jest.fn(async () => {}),
    getCurrentImage: jest.fn(() => null),
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
    flush: jest.fn(),
    loadForPath: jest.fn(async () => {}),
    getCheckpoints: jest.fn(() => [{ id: 1 }]),
    record: jest.fn(),
  },
}));
jest.mock('../services/ImageProcessingPipeline', () => ({
  imageProcessingPipeline: {
    resetAllModules: jest.fn(),
    getModule: jest.fn(() => null),
    invalidateModuleCache: jest.fn(),
    clearCache: jest.fn(),
  },
}));
jest.mock('../services/NotificationService', () => ({ notificationService: { error: jest.fn() } }));
jest.mock('../shaders/GpuPreviewPipeline', () => ({
  gpuPreviewPipeline: { attach: jest.fn(() => false), present: jest.fn(), destroy: jest.fn(), isAvailable: jest.fn(() => false) },
}));

describe('isBaseImageStale', () => {
  it('is true when the loaded base belongs to a different image than the displayed one', () => {
    expect(isBaseImageStale('/a.orf', '/b.orf')).toBe(true);
  });
  it('is false when the loaded base matches the displayed image', () => {
    expect(isBaseImageStale('/a.orf', '/a.orf')).toBe(false);
  });
  it('is false when either path is missing (never skip a draw on incomplete info)', () => {
    expect(isBaseImageStale(undefined, '/b.orf')).toBe(false);
    expect(isBaseImageStale('/a.orf', undefined)).toBe(false);
    expect(isBaseImageStale(null, null)).toBe(false);
  });
});

const IMG_B: ImageFileInfo = {
  id: 'b', name: 'b.orf', path: '/b.orf', size: 100, format: 'orf', type: 'image',
  lastModified: 0, dateModified: new Date(),
};

// 128x128 (not tiny): drawLoadedImageOptimized's hash-sampling loop steps by
// floor(min(w,h)/4/10), which is 0 for sub-40px images — a realistic size keeps that
// path finite so the control's full draw completes.
const baseA = { data: new Float32Array(128 * 128 * 4).fill(0.5), width: 128, height: 128, filePath: '/a.orf' };
const baseB = { data: new Float32Array(128 * 128 * 4).fill(0.5), width: 128, height: 128, filePath: '/b.orf' };

describe('Canvas — skips the stale full-res base draw during an image switch', () => {
  // Shared spy 2D context so the base-render call (ctx.createImageData) is observable
  // across the canvas + the temp canvases drawLoadedImageOptimized creates.
  let ctx: Record<string, jest.Mock>;
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ processedImageData: null, renderMode: 'cpu', imageDimensions: {} });
    (editPersistenceService.getSavedEditState as jest.Mock).mockResolvedValue(null);
    (editPersistenceService.restoreState as jest.Mock).mockReturnValue(false);
    (checkpointService.getCheckpoints as jest.Mock).mockReturnValue([{ id: 1 }]);

    ctx = {
      fillRect: jest.fn(), clearRect: jest.fn(), setTransform: jest.fn(), drawImage: jest.fn(),
      putImageData: jest.fn(), save: jest.fn(), restore: jest.fn(),
      beginPath: jest.fn(), arc: jest.fn(), fill: jest.fn(), fillText: jest.fn(),
      createImageData: jest.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h })),
    };
    origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype.getContext as unknown) = jest.fn(() => ctx);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  it('does NOT run the base render while imageService still holds the previous image', async () => {
    // Mid-switch: switching TO B, but B has not finished decoding — imageService still
    // returns A. processedImageData is null. Guard must skip the stale base draw.
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(baseA);
    (imageService.loadImage as jest.Mock).mockResolvedValue(undefined);

    await act(async () => {
      render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_B} />);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(ctx.createImageData).not.toHaveBeenCalled();
  });

  it('DOES run the base render once the loaded base matches the displayed image (control)', async () => {
    // Non-racy: imageService returns B, matching the displayed image → draw proceeds.
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(baseB);
    (imageService.loadImage as jest.Mock).mockResolvedValue(undefined);

    await act(async () => {
      render(<Canvas onFitWindow={() => {}} onActualSize={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} zoom={1} currentImage={IMG_B} />);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(ctx.createImageData).toHaveBeenCalled();
  });
});
