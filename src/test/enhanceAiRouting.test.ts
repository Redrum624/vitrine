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
const mockRunAiFinish = jest.fn();
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 })),
  runAiFinish: mockRunAiFinish,
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
      return { data: new Uint8Array(8 * 8 * 4).fill(128), width: 8, height: 8, backend: 'directml' };
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

  it('neutral sliders never touch the enhance worker (pass-through skips the finishing pass entirely)', async () => {
    await enhanceService.applyUpscale({
      ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2,
      denoiseStrength: 0, alpha: 0, sharpness: 0, chromaClean: false,
    });
    expect(mockRunAiFinish).not.toHaveBeenCalled();
  });
});

// W4 R2: both bake develop passes must run with cacheResults:false — the full-res per-module
// results (~320MB Float32 each at 20MP) have no consumer (resetAllModules runs post-bake) and
// would evict the preview-size entries the slider fast path relies on.
describe('EnhanceService.applyUpscale — develop pass caching (W4 R2)', () => {
  it('the develop pass runs with cacheResults:false', async () => {
    mockAiIsAvailable.mockResolvedValue(false);
    await enhanceService.applyUpscale(params);
    const { imageProcessingPipeline } = jest.requireMock('../services/ImageProcessingPipeline');
    const call = (imageProcessingPipeline.processImage as jest.Mock).mock.calls[0];
    expect(call[2]).toMatchObject({ useWebWorkers: true, cacheResults: false });
  });
});

// W4 R4: the AI-route finishing pass (enhanceAiUpscaled orchestration) must run in the enhance
// worker — before this it ran whole-buffer on the renderer MAIN thread at output resolution,
// freezing the UI parked at 92% progress. A worker failure falls back to the main thread (never
// to the deterministic route — the AI inference already succeeded).
describe('EnhanceService.applyUpscale — AI finishing pass off the main thread (W4 R4)', () => {
  const aiOut = new Uint8Array(8 * 8 * 4).fill(128);
  const sliderParams = {
    ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 as const,
    denoiseStrength: 10, alpha: 0, sharpness: 0, chromaClean: false,
  };

  beforeEach(() => {
    mockAiIsAvailable.mockResolvedValue(true);
    mockAiRun.mockResolvedValue({ data: aiOut.slice(), width: 8, height: 8, backend: 'directml' });
  });

  it('routes the finishing pass through enhanceWorkerClient.runAiFinish; the worker result is displayed', async () => {
    const finished = new Float32Array(8 * 8 * 4).fill(0.25);
    mockRunAiFinish.mockResolvedValue(finished.slice());

    await enhanceService.applyUpscale(sliderParams);

    expect(mockRunAiFinish).toHaveBeenCalledWith(expect.any(Float32Array), 8, 8, expect.objectContaining({ denoiseStrength: 10 }));
    const shown = (imageService.updateCurrentImageData as jest.Mock).mock.calls[0][0] as Float32Array;
    expect(shown.every((v) => v === 0.25)).toBe(true);
    expect(mockSetUpscaleMode).toHaveBeenCalledWith('ai');
  });

  it('a worker-finish failure falls back to the MAIN-thread finish — still the AI route, base preserved', async () => {
    mockRunAiFinish.mockRejectedValue(new Error('enhance worker crashed: boom'));

    await enhanceService.applyUpscale(sliderParams);

    // Fallback applied the denoise on the main thread: displayed differs from the raw AI output…
    const shown = (imageService.updateCurrentImageData as jest.Mock).mock.calls[0][0] as Float32Array;
    const aiFloat = Float32Array.from(aiOut, (v) => v / 255);
    // …the committed base is still the clean model output at the right size…
    const committedBase = (imageService.setOriginalImage as jest.Mock).mock.calls[0][0] as Float32Array;
    expect(committedBase.length).toBe(aiFloat.length);
    expect(shown.length).toBe(aiFloat.length);
    // …and the route stayed AI (never demoted to the deterministic worker).
    expect(enhanceWorkerClient.run).not.toHaveBeenCalled();
    expect(mockSetUpscaleMode).toHaveBeenCalledWith('ai');
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Enhanced ×2 (AI)', 1);
  });
});
