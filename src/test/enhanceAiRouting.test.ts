// AI-vs-deterministic routing in EnhanceService.applyUpscale (Phase-2 Task 6).
const mockSetUpscaleMode = jest.fn();
const mockSetUpscaleProgress = jest.fn();
const mockAiIsAvailable = jest.fn();
const mockAiRun = jest.fn();

let curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  updateCurrentImageData: jest.fn(),
  setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(), getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4), base: new Float32Array(8 * 8 * 4), width: 8, height: 8 })),
} }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: mockAiIsAvailable, run: mockAiRun } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: { serialize: jest.fn(() => ({})), restore: jest.fn() } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({
  setIsProcessing: jest.fn(), setUpscaleProgress: mockSetUpscaleProgress, setUpscaleMode: mockSetUpscaleMode,
  notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn(),
}) } }));

import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { enhanceWorkerClient } from '../services/EnhanceWorkerClient';
import { checkpointService } from '../services/CheckpointService';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
});

const params = { ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 as const };

describe('EnhanceService.applyUpscale — AI routing', () => {
  it('uses the AI upscaler (not the worker) when available; mode=ai, (AI) checkpoint, progress', async () => {
    mockAiIsAvailable.mockResolvedValue(true);
    mockAiRun.mockImplementation(async (_rgba, _w, _h, _scale, onProgress) => {
      onProgress?.({ done: 1, total: 2 });
      onProgress?.({ done: 2, total: 2 });
      return { data: new Uint8Array(8 * 8 * 4), width: 8, height: 8, backend: 'directml' };
    });

    await enhanceService.applyUpscale(params);

    expect(mockAiRun).toHaveBeenCalledWith(expect.any(Uint8Array), 4, 4, 2, expect.any(Function));
    expect(enhanceWorkerClient.run).not.toHaveBeenCalled();
    expect(mockSetUpscaleMode).toHaveBeenCalledWith('ai');
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Enhanced ×2 (AI)', 1);
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8);
    expect(mockSetUpscaleProgress).toHaveBeenCalledWith(0.5);
    expect(mockSetUpscaleProgress).toHaveBeenLastCalledWith(null); // cleared in finally
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('uses the deterministic worker when AI is unavailable; mode=standard, (Standard) checkpoint', async () => {
    mockAiIsAvailable.mockResolvedValue(false);

    await enhanceService.applyUpscale(params);

    expect(mockAiRun).not.toHaveBeenCalled();
    expect(enhanceWorkerClient.run).toHaveBeenCalled();
    expect(mockSetUpscaleMode).toHaveBeenCalledWith('standard');
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Enhanced ×2 (Standard)', 1);
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('falls back to the deterministic worker when the AI run rejects mid-way', async () => {
    mockAiIsAvailable.mockResolvedValue(true);
    mockAiRun.mockRejectedValue(new Error('DirectML device lost'));

    await enhanceService.applyUpscale(params);

    expect(mockAiRun).toHaveBeenCalled();
    expect(enhanceWorkerClient.run).toHaveBeenCalled(); // fell back, still produced a result
    expect(mockSetUpscaleMode).toHaveBeenLastCalledWith('standard');
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Enhanced ×2 (Standard)', 1);
    expect(enhanceService.canRevert()).toBe(true);
  });
});
