// Guards at the Enhance bake commit boundary (2026-07-20 audit, task W2):
//   F1 (CRITICAL) — a bake completing after the user switched photos mid-await must NOT commit
//       (setOriginalImage / restore-point push / persist) onto the newly displayed photo.
//   F2 (IMPORTANT) — a malformed result buffer (wrong length / non-finite / all-zero — the
//       v1.32.0 wavelet-stub class) must be rejected BEFORE setOriginalImage, leaving the
//       previous base untouched.
// Fixtures here are realistic (non-zero, alpha=1-ish fills): a real pipeline buffer always has
// alpha 1.0, which is exactly why an all-zero sample is a safe corruption signal in F2.

let curOrig = { data: new Float32Array(4 * 4 * 4).fill(0.5), width: 4, height: 4 };
let curImage: { filePath: string } | null = { filePath: 'C:/pics/A.orf' };
let loadGen = 1;
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  getCurrentImage: jest.fn(() => curImage),
  getLoadGeneration: jest.fn(() => loadGen),
  updateCurrentImageData: jest.fn(), setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(),
  getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 })),
} }));
// AI upscale unavailable → deterministic route; AI deblur available → deblur runs.
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: {
  isAvailable: jest.fn(async () => false), run: jest.fn(),
} }));
jest.mock('../services/AiDeblurClient', () => ({ aiDeblurClient: {
  isAvailable: jest.fn(async () => true),
  run: jest.fn(async (_rgba: Uint8Array, w: number, h: number) => ({ data: new Uint8Array(w * h * 4).fill(128), width: w, height: h, backend: 'directml' })),
} }));
jest.mock('../shaders/GpuPreviewPipeline', () => ({ gpuPreviewPipeline: {
  isAvailable: jest.fn(() => false), runEnhanceChain: jest.fn(() => null),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: {
  serialize: jest.fn(() => ({})), restore: jest.fn(), persistBakedUpscaleIntent: jest.fn(), persistBakedDeblurIntent: jest.fn(),
  persistNow: jest.fn(), suspendRedirectForStackedBake: jest.fn(), resumeRedirectAfterStackedUnwind: jest.fn(),
} }));
jest.mock('../services/NotificationService', () => ({ notificationService: {
  info: jest.fn(), warning: jest.fn(), error: jest.fn(),
} }));
jest.mock('../stores/appStore', () => {
  const state = {
    setIsProcessing: jest.fn(), setUpscaleProgress: jest.fn(), setDeblurProgress: jest.fn(),
    setUpscaleMode: jest.fn(), setUpscaleIntent: jest.fn(), setDeblurIntent: jest.fn(),
    setBakeOrder: jest.fn(), notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn(),
    developing: false, deblurIntent: false, upscaleIntent: null, bakeOrder: [] as string[],
  };
  return { useAppStore: { getState: () => state } };
});

import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { enhanceWorkerClient } from '../services/EnhanceWorkerClient';
import { aiDeblurClient } from '../services/AiDeblurClient';
import { editPersistenceService } from '../services/EditPersistenceService';
import { checkpointService } from '../services/CheckpointService';
import { notificationService } from '../services/NotificationService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

const UP = { ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 as const };

/** Simulate a mid-bake image switch: new file + a bumped load generation (what loadImage does). */
function switchImageTo(filePath: string): void {
  curImage = { filePath };
  loadGen += 1;
}

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  curOrig = { data: new Float32Array(4 * 4 * 4).fill(0.5), width: 4, height: 4 };
  curImage = { filePath: 'C:/pics/A.orf' };
  loadGen = 1;
});

describe('F1 — cross-image bake commit guard (identity re-check)', () => {
  it('upscale: switching photos during the develop pass aborts before the enhance route even runs', async () => {
    (imageProcessingPipeline.processImage as jest.Mock).mockImplementationOnce(async (d: Float32Array) => {
      switchImageTo('C:/pics/B.orf');
      return d;
    });
    await expect(enhanceService.applyUpscale(UP)).resolves.toBeUndefined();
    expect(enhanceWorkerClient.run).not.toHaveBeenCalled();
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(editPersistenceService.persistBakedUpscaleIntent).not.toHaveBeenCalled();
    expect(checkpointService.recordLabeled).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(notificationService.warning).toHaveBeenCalledWith('Photo changed', expect.stringContaining('canceled'));
    expect(useAppStore.getState().setIsProcessing).toHaveBeenLastCalledWith(false);
  });

  it('upscale: switching photos during the worker run aborts every commit-side effect', async () => {
    (enhanceWorkerClient.run as jest.Mock).mockImplementationOnce(async () => {
      switchImageTo('C:/pics/B.orf');
      return { enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 };
    });
    await expect(enhanceService.applyUpscale(UP)).resolves.toBeUndefined();
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(imageService.setBakedUpscale).not.toHaveBeenCalled();
    expect(editPersistenceService.persistBakedUpscaleIntent).not.toHaveBeenCalled();
    expect(checkpointService.recordLabeled).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(notificationService.warning).toHaveBeenCalledWith('Photo changed', expect.stringContaining('canceled'));
    expect(useAppStore.getState().setIsProcessing).toHaveBeenLastCalledWith(false);
  });

  it('upscale: a re-open of the SAME file (load generation bump, same path) also aborts', async () => {
    (enhanceWorkerClient.run as jest.Mock).mockImplementationOnce(async () => {
      loadGen += 1; // same filePath — only the load token moved (fresh open of the same photo)
      return { enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 };
    });
    await expect(enhanceService.applyUpscale(UP)).resolves.toBeUndefined();
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(editPersistenceService.persistBakedUpscaleIntent).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
  });

  it('deblur: switching photos during the AI run aborts every commit-side effect', async () => {
    curOrig = { data: new Float32Array(400 * 400 * 4).fill(0.5), width: 400, height: 400 };
    (aiDeblurClient.run as jest.Mock).mockImplementationOnce(async (_r: Uint8Array, w: number, h: number) => {
      switchImageTo('C:/pics/B.orf');
      return { data: new Uint8Array(w * h * 4).fill(128), width: w, height: h, backend: 'directml' };
    });
    await expect(enhanceService.applyMotionDeblur()).resolves.toBeUndefined();
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(imageService.setBakedDeblur).not.toHaveBeenCalled();
    expect(editPersistenceService.persistBakedDeblurIntent).not.toHaveBeenCalled();
    expect(checkpointService.recordLabeled).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(notificationService.warning).toHaveBeenCalledWith('Photo changed', expect.stringContaining('canceled'));
    expect(useAppStore.getState().setIsProcessing).toHaveBeenLastCalledWith(false);
  });

  it('happy path (no switch) still commits and persists normally', async () => {
    await enhanceService.applyUpscale(UP);
    expect(imageService.setOriginalImage).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(editPersistenceService.persistBakedUpscaleIntent).toHaveBeenCalledTimes(1);
    expect(enhanceService.getRestoreDepth()).toBe(1);
    expect(notificationService.warning).not.toHaveBeenCalled();
  });
});

describe('F2 — buffer sanity guard before permanent base replacement', () => {
  it('rejects a wrong-length enhanced buffer (the v1.32.0 quarter-res class) and leaves the base untouched', async () => {
    (enhanceWorkerClient.run as jest.Mock).mockResolvedValueOnce({
      enhanced: new Float32Array((8 * 8 * 4) / 4).fill(0.5), // quarter-length for the claimed 8×8
      base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8,
    });
    await expect(enhanceService.applyUpscale(UP)).rejects.toThrow(/untouched/);
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
  });

  it('rejects a wrong-length base buffer and leaves the base untouched', async () => {
    (enhanceWorkerClient.run as jest.Mock).mockResolvedValueOnce({
      enhanced: new Float32Array(8 * 8 * 4).fill(0.5),
      base: new Float32Array(8 * 8 * 4 - 8).fill(0.5), width: 8, height: 8,
    });
    await expect(enhanceService.applyUpscale(UP)).rejects.toThrow(/untouched/);
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
  });

  it('rejects a non-finite (NaN) result buffer', async () => {
    const bad = new Float32Array(8 * 8 * 4).fill(0.5);
    bad[3] = Number.NaN;
    (enhanceWorkerClient.run as jest.Mock).mockResolvedValueOnce({
      enhanced: bad, base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8,
    });
    await expect(enhanceService.applyUpscale(UP)).rejects.toThrow(/untouched/);
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
  });

  it('rejects an all-zero result buffer (alpha included — impossible for a real RGBA pipeline buffer)', async () => {
    (enhanceWorkerClient.run as jest.Mock).mockResolvedValueOnce({
      enhanced: new Float32Array(8 * 8 * 4), base: new Float32Array(8 * 8 * 4), width: 8, height: 8,
    });
    await expect(enhanceService.applyUpscale(UP)).rejects.toThrow(/untouched/);
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
  });

  it('deblur: rejects a wrong-length AI output buffer and leaves the base untouched', async () => {
    curOrig = { data: new Float32Array(400 * 400 * 4).fill(0.5), width: 400, height: 400 };
    (aiDeblurClient.run as jest.Mock).mockResolvedValueOnce({
      data: new Uint8Array(100).fill(128), width: 400, height: 400, backend: 'directml',
    });
    await expect(enhanceService.applyMotionDeblur()).rejects.toThrow(/untouched/);
    expect(imageService.setOriginalImage).not.toHaveBeenCalled();
    expect(imageService.setBakedDeblur).not.toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(useAppStore.getState().setIsProcessing).toHaveBeenLastCalledWith(false);
  });
});
