let curOrig = { data: new Float32Array(4*4*4), width: 4, height: 4 };
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  updateCurrentImageData: jest.fn(), setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8*8*4), base: new Float32Array(8*8*4), width: 8, height: 8 })),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: { serialize: jest.fn(() => ({})), restore: jest.fn() } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({ setIsProcessing: jest.fn(), notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn() }) } }));

import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
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
    expect(checkpointService.record).toHaveBeenCalledWith('Enhanced ×2');
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('calls setBakedUpscale with {scale, nativeWidth, nativeHeight} after a successful upscale', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(imageService.setBakedUpscale).toHaveBeenCalledWith({ scale: 2, nativeWidth: 4, nativeHeight: 4 });
  });

  it('rejects when the upscaled size exceeds the 40M-pixel guard (not just the old 80M cap)', async () => {
    // 4000 × 3000 × scale 2 → 8000 × 6000 = 48 M pixels > 40 M  and  < 80 M — proves the threshold moved down
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 4000, height: 3000 });
    await expect(enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 })).rejects.toThrow(/too large/);
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
