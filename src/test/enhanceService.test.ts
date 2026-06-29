jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => ({ data: new Float32Array(4*4*4), width: 4, height: 4 })),
  updateCurrentImageData: jest.fn(), setOriginalImage: jest.fn(),
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
import { checkpointService } from '../services/CheckpointService';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

describe('EnhanceService.applyUpscale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('swaps the working image to the ×scale result, sets B/A base, records a checkpoint, enables revert', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(imageService.setOriginalImage).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(checkpointService.record).toHaveBeenCalledWith('Enhanced ×2');
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('rejects when the upscaled size exceeds the guard', async () => {
    (imageService.getOriginalImage as jest.Mock).mockReturnValueOnce({ data: new Float32Array(4), width: 10000, height: 10000 });
    await expect(enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 })).rejects.toThrow(/too large/);
  });
});
