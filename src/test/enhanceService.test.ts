let curOrig = { data: new Float32Array(4*4*4), width: 4, height: 4 };
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  updateCurrentImageData: jest.fn(), setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(),
  getModule: jest.fn(() => undefined), // No crop module active by default
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8*8*4).fill(0.5), base: new Float32Array(8*8*4).fill(0.5), width: 8, height: 8 })),
} }));
// AI unavailable here so these tests exercise the deterministic ('Standard') path. The AI route
// has its own suite in enhanceAiRouting.test.ts.
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: {
  isAvailable: jest.fn(async () => false), run: jest.fn(),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: { serialize: jest.fn(() => ({})), restore: jest.fn(), persistBakedUpscaleIntent: jest.fn(), persistNow: jest.fn(), suspendRedirectForStackedBake: jest.fn(), resumeRedirectAfterStackedUnwind: jest.fn() } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({ setIsProcessing: jest.fn(), setUpscaleProgress: jest.fn(), setUpscaleMode: jest.fn(), setUpscaleIntent: jest.fn(), setDeblurIntent: jest.fn(), setBakeOrder: jest.fn(), notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn() }) } }));

import { enhanceService, getUpscaleFeasibility, getDeblurFeasibility } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { enhanceWorkerClient } from '../services/EnhanceWorkerClient';
import { editPersistenceService } from '../services/EditPersistenceService';
import { checkpointService } from '../services/CheckpointService';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

// Reset service state (restore stack) and mocks before every test so tests don't bleed into each other.
beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  curOrig = { data: new Float32Array(4*4*4), width: 4, height: 4 };
});

describe('EnhanceService.applyUpscale', () => {
  it('swaps the working image to the ×scale result, sets B/A base, records a checkpoint, enables revert', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(imageService.setOriginalImage).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Enhanced ×2 (Standard)', 1);
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('calls setBakedUpscale with {scale, nativeWidth, nativeHeight} after a successful upscale', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(imageService.setBakedUpscale).toHaveBeenCalledWith({ scale: 2, nativeWidth: 4, nativeHeight: 4 });
  });

  it('rejects when the upscaled size exceeds the 160M-pixel memory guard', async () => {
    // 8000 × 6000 × scale 2 → 16000 × 12000 = 192 M pixels > 160 M — the guard still fires on truly huge output.
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 8000, height: 6000 });
    await expect(enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 })).rejects.toThrow(/memory limit/);
  });

  it('allows a normal ~20MP image at ×2 (does not trip the memory guard)', async () => {
    // 3904 × 5200 × scale 2 → 7808 × 10400 = 81.2 M pixels — under the 160 M cap (the real bug report).
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 3904, height: 5200 });
    await expect(enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 })).resolves.toBeUndefined();
  });

  it('rejects ×4 of the 20 MP bug-report image (5200×3904) with a message naming the limit and ×2', async () => {
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 5200, height: 3904 });
    const p = enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 });
    await expect(p).rejects.toThrow(/160 MP/);
    // The message must also tell the user the max feasible scale for THIS image (×2).
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 5200, height: 3904 });
    await expect(enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 })).rejects.toThrow(/×2/);
  });
});

describe('getUpscaleFeasibility', () => {
  it('reports ×4 infeasible for a 20 MP image (5200×3904) with maxFeasibleScale 2', () => {
    const f = getUpscaleFeasibility(5200, 3904, 4);
    expect(f.feasible).toBe(false);
    expect(f.outputPixels).toBe(324_812_800);
    expect(f.maxPixels).toBe(160_000_000);
    expect(f.maxFeasibleScale).toBe(2);
  });

  it('a ~10 MP image (3162×3162) is right under the cap at ×4 — feasible', () => {
    const f = getUpscaleFeasibility(3162, 3162, 4);
    expect(f.outputPixels).toBe(12648 * 12648); // 159,971,904 ≤ 160 M
    expect(f.feasible).toBe(true);
    expect(f.maxFeasibleScale).toBe(4);
  });

  it('maxFeasibleScale is null when even ×2 overflows the cap', () => {
    const f = getUpscaleFeasibility(30000, 30000, 2);
    expect(f.feasible).toBe(false);
    expect(f.maxFeasibleScale).toBeNull();
  });
});

describe('getDeblurFeasibility', () => {
  it('a 20 MP image (5200×3904) is well under the 160 MP cap — feasible', () => {
    const f = getDeblurFeasibility(5200, 3904);
    expect(f.inputPixels).toBe(20_300_800);
    expect(f.maxPixels).toBe(160_000_000);
    expect(f.feasible).toBe(true);
  });

  it('reports infeasible for a pathological >160 MP image (13000×13000)', () => {
    const f = getDeblurFeasibility(13000, 13000);
    expect(f.inputPixels).toBe(169_000_000);
    expect(f.feasible).toBe(false);
  });

  it('is exactly at the cap boundary — feasible at ==, infeasible one pixel over', () => {
    const atCap = getDeblurFeasibility(16000, 10000); // 160,000,000 exactly
    expect(atCap.inputPixels).toBe(160_000_000);
    expect(atCap.feasible).toBe(true);
    const overCap = getDeblurFeasibility(16000, 10001);
    expect(overCap.feasible).toBe(false);
  });
});

describe('EnhanceService.revert', () => {
  it('restores the pre-upscale image + edit state and clears the restore point', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(enhanceService.canRevert()).toBe(true);
    jest.clearAllMocks();
    enhanceService.revert();
    expect(imageProcessingPipeline.resetAllModules).toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 4, 4);
    expect(imageService.setOriginalImage).toHaveBeenCalledWith(expect.any(Float32Array), 4, 4);
    expect(editPersistenceService.restore).toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(false);
  });

  it('is a no-op when there is no restore point', () => {
    jest.clearAllMocks();
    enhanceService.revert();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(editPersistenceService.restore).not.toHaveBeenCalled();
  });

  it('calls clearBakedUpscale when the last revert empties the stack', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    jest.clearAllMocks();
    enhanceService.revert();
    expect(imageService.clearBakedUpscale).toHaveBeenCalled();
    expect(imageService.setBakedUpscale).not.toHaveBeenCalled();
  });
});

describe('EnhanceService — two successive upscales then two reverts', () => {
  it('preserves the native original across two upscale levels', async () => {
    // First upscale: native 4×4 → 8×8
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(enhanceService.getRestoreDepth()).toBe(1);

    // Second upscale: worker still returns 8×8 in the mock but the snapshot is taken from getOriginalImage
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(enhanceService.getRestoreDepth()).toBe(2);
    expect(enhanceService.canRevert()).toBe(true);

    // First revert: pops top level — baked marker must be updated (not cleared)
    jest.clearAllMocks();
    enhanceService.revert();
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(imageService.clearBakedUpscale).not.toHaveBeenCalled();
    expect(imageService.setBakedUpscale).toHaveBeenCalled(); // marker updated to remaining level
    expect(enhanceService.getRestoreDepth()).toBe(1);
    expect(enhanceService.canRevert()).toBe(true);

    // Second revert: empties the stack — should clear marker, restore native dims
    jest.clearAllMocks();
    enhanceService.revert();
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 4, 4);
    expect(imageService.clearBakedUpscale).toHaveBeenCalled();
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(enhanceService.canRevert()).toBe(false);
  });
});

describe('EnhanceService.unwindToDepth', () => {
  it('pops multiple levels and clears the baked marker when unwinding to 0', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(enhanceService.getRestoreDepth()).toBe(2);

    jest.clearAllMocks();
    enhanceService.unwindToDepth(0);
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(enhanceService.canRevert()).toBe(false);
    expect(imageService.clearBakedUpscale).toHaveBeenCalled();
  });

  it('is a no-op when already at or below the target depth', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    jest.clearAllMocks();
    enhanceService.unwindToDepth(2); // already depth 1, 2 > 1 so no pop
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
  });
});

describe('EnhanceService — upscale with active Crop (I2 regression)', () => {
  it('passes PROCESSED dims (not native) to the enhance worker when Crop reduces the image', async () => {
    // Native image is 4×4, but an active crop makes the processed output 2×3.
    (imageProcessingPipeline.getModule as jest.Mock).mockReturnValueOnce({
      getOutputDimensions: (_w: number, _h: number) => ({ width: 2, height: 3 }),
    });
    // processImage returns a buffer sized for the 2×3 cropped image.
    (imageProcessingPipeline.processImage as jest.Mock).mockResolvedValueOnce(new Float32Array(2 * 3 * 4));

    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });

    // Worker must be called with CROPPED dims (2×3), not native dims (4×4).
    expect(enhanceWorkerClient.run).toHaveBeenCalledWith(
      expect.any(Float32Array),
      2,
      3,
      expect.any(Object),
    );
    // Baked marker must reflect the pre-upscale PROCESSED dims, not native.
    expect(imageService.setBakedUpscale).toHaveBeenCalledWith({ scale: 2, nativeWidth: 2, nativeHeight: 3 });
  });
});
