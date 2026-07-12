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
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(), getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4), base: new Float32Array(8 * 8 * 4), width: 8, height: 8 })),
} }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: mockAiIsAvailable, run: mockAiRun } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: { serialize: jest.fn(() => ({})), restore: jest.fn(), persistBakedUpscaleIntent: jest.fn(), persistNow: jest.fn() } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({
  setIsProcessing: jest.fn(), setUpscaleProgress: mockSetUpscaleProgress, setUpscaleMode: mockSetUpscaleMode, setUpscaleIntent: jest.fn(),
  setDeblurIntent: jest.fn(), setBakeOrder: jest.fn(),
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
    // AI tile progress is scaled into [0, 0.9]; the top 10% is reserved for the renderer-side
    // finishing pass (Q2), so done/total 1/2 reports 0.45 (not 0.5).
    expect(mockSetUpscaleProgress).toHaveBeenCalledWith(0.45);
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

describe('EnhanceService.applyUpscale — AI route applies the Enhance sliders (Q2)', () => {
  // Chroma-noisy 8×8 model output so denoiseStrength has measurable work.
  const aiOut = (() => {
    const u = new Uint8Array(8 * 8 * 4);
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 8 * 8; i++) {
      u[i * 4] = 128 + Math.round((rnd() - 0.5) * 80);
      u[i * 4 + 1] = 128 + Math.round((rnd() - 0.5) * 40);
      u[i * 4 + 2] = 128 + Math.round((rnd() - 0.5) * 80);
      u[i * 4 + 3] = 255;
    }
    return u;
  })();
  const aiFloat = Float32Array.from(aiOut, (v) => v / 255);
  const bytesEqual = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

  beforeEach(() => {
    mockAiIsAvailable.mockResolvedValue(true);
    mockAiRun.mockResolvedValue({ data: aiOut.slice(), width: 8, height: 8, backend: 'directml' });
  });

  it('neutral sliders → displayed buffer is byte-identical to the raw AI output (no silent change)', async () => {
    await enhanceService.applyUpscale({
      ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2,
      denoiseStrength: 0, alpha: 0, sharpness: 0, chromaClean: false,
    });
    const shown = (imageService.updateCurrentImageData as jest.Mock).mock.calls[0][0] as Float32Array;
    expect(bytesEqual(shown, aiFloat)).toBe(true);
  });

  it('denoiseStrength>0 → displayed buffer differs from the raw AI output (slider is live on AI)', async () => {
    await enhanceService.applyUpscale({
      ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2,
      denoiseStrength: 10, alpha: 0, sharpness: 0, chromaClean: false,
    });
    const shown = (imageService.updateCurrentImageData as jest.Mock).mock.calls[0][0] as Float32Array;
    expect(bytesEqual(shown, aiFloat)).toBe(false);
  });
});
