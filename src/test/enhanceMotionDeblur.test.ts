/**
 * Contract tests for EnhanceService.applyMotionDeblur (AI motion deblur bake) at the mocked-IPC
 * level. Verifies the load-bearing invariants from the S3 spike + Task S4 plan:
 *   - the 384px floor DECLINES small images with a clear notice and NO IPC call;
 *   - apply is gated by guardDeveloping (no bake during the progressive-open developing window);
 *   - unavailable backend is a hard stop (no deterministic fallback exists for motion blur);
 *   - a successful apply BAKES a same-dimension base (setBakedDeblur + updateCurrentImageData) and
 *     records a checkpoint; revert round-trips (restores the pre-deblur base, clears the marker);
 *   - deblurProgress is driven during the run and cleared in finally.
 */

const mockSetDeblurProgress = jest.fn();
const mockInfo = jest.fn();
const mockAiIsAvailable = jest.fn();
const mockAiRun = jest.fn();
const mockFlush = jest.fn();
let mockDeveloping = false;

let curOrig = { data: new Float32Array(384 * 384 * 4), width: 384, height: 384 };
let curDims: { width: number; height: number } | null = { width: 384, height: 384 };

jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  getOriginalImageDimensions: jest.fn(() => curDims),
  updateCurrentImageData: jest.fn(),
  setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(), isBakedDeblurActive: jest.fn(() => false),
  setImageSwitchHook: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(), getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/AiDeblurClient', () => ({ aiDeblurClient: { isAvailable: mockAiIsAvailable, run: mockAiRun } }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: { run: jest.fn() } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
const mockPersistDeblur = jest.fn();
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: {
  serialize: jest.fn(() => ({})), restore: jest.fn(), flush: mockFlush, persistNow: jest.fn(),
  persistBakedUpscaleIntent: jest.fn(), persistBakedDeblurIntent: mockPersistDeblur,
} }));
jest.mock('../services/NotificationService', () => ({ notificationService: { info: mockInfo } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({
  developing: mockDeveloping,
  setIsProcessing: jest.fn(), setDeblurProgress: mockSetDeblurProgress,
  setUpscaleMode: jest.fn(), setUpscaleIntent: jest.fn(),
  setDeblurIntent: jest.fn(), setBakeOrder: jest.fn(),
  notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn(),
}) } }));

import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { aiDeblurClient } from '../services/AiDeblurClient';
import { checkpointService } from '../services/CheckpointService';

function setImage(w: number, h: number) {
  curOrig = { data: new Float32Array(w * h * 4), width: w, height: h };
  curDims = { width: w, height: h };
}

beforeEach(() => {
  mockDeveloping = false;
  mockAiIsAvailable.mockResolvedValue(true);
  mockAiRun.mockReset();
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  mockAiIsAvailable.mockResolvedValue(true);
  setImage(384, 384);
});

const okRun = () => mockAiRun.mockImplementation(async (_rgba: Uint8Array, w: number, h: number, onProgress?: (p: { done: number; total: number }) => void) => {
  onProgress?.({ done: 1, total: 2 });
  onProgress?.({ done: 2, total: 2 });
  return { data: new Uint8Array(w * h * 4), width: w, height: h, backend: 'directml' };
});

describe('EnhanceService.applyMotionDeblur — 384px floor', () => {
  it('declines a sub-384 image with a clear notice and makes NO IPC call', async () => {
    setImage(300, 300);
    await expect(enhanceService.applyMotionDeblur()).rejects.toThrow(/384/);
    expect(mockAiRun).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(false);
  });

  it('declines when only ONE axis is below the floor', async () => {
    setImage(383, 1000);
    await expect(enhanceService.applyMotionDeblur()).rejects.toThrow(/384/);
    expect(mockAiRun).not.toHaveBeenCalled();
  });
});

describe('EnhanceService.applyMotionDeblur — feasibility cap', () => {
  it('declines a pathologically large image (>160 MP) with a clear notice and NO IPC call', async () => {
    // Reported dims exceed the cap; the underlying `data` array is intentionally tiny — the
    // cap check runs on width×height BEFORE the buffer is ever copied, so a real ~2.5 GB
    // allocation is neither needed nor safe in a test process. See getDeblurFeasibility's
    // own boundary-math unit tests (enhanceService.test.ts) for the exact pixel-count edges.
    curOrig = { data: new Float32Array(4), width: 16000, height: 10001 }; // 160,016,000 px
    curDims = { width: 16000, height: 10001 };
    await expect(enhanceService.applyMotionDeblur()).rejects.toThrow(/MP/);
    expect(mockAiIsAvailable).not.toHaveBeenCalled();
    expect(mockAiRun).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(false);
  });
});

describe('EnhanceService.applyMotionDeblur — guardDeveloping', () => {
  it('no-ops (no IPC, no bake) while the image is developing, showing an info notice', async () => {
    okRun();
    mockDeveloping = true;
    await enhanceService.applyMotionDeblur();
    expect(mockInfo).toHaveBeenCalled();
    expect(aiDeblurClient.run).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(false);
  });
});

describe('EnhanceService.applyMotionDeblur — availability', () => {
  it('throws (no fallback) when the AI backend is unavailable; no bake', async () => {
    okRun();
    mockAiIsAvailable.mockResolvedValue(false);
    await expect(enhanceService.applyMotionDeblur()).rejects.toThrow(/unavailable/i);
    expect(mockAiRun).not.toHaveBeenCalled();
    expect(imageService.updateCurrentImageData).not.toHaveBeenCalled();
  });
});

describe('EnhanceService.applyMotionDeblur — bake + revert', () => {
  it('bakes a same-dimension base through guardDeveloping, sets the marker, records a checkpoint', async () => {
    okRun();
    await enhanceService.applyMotionDeblur();

    expect(mockAiRun).toHaveBeenCalledWith(expect.any(Uint8Array), 384, 384, expect.any(Function));
    // Same dimensions in as out (deblur does not resize).
    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 384, 384);
    expect(imageService.setOriginalImage).toHaveBeenCalledWith(expect.any(Float32Array), 384, 384);
    expect(imageService.setBakedDeblur).toHaveBeenCalled();
    expect(checkpointService.recordLabeled).toHaveBeenCalledWith('Motion deblur (AI)', 1);
    // Z1: the durable deblur intent (pre-deblur edits + bakedDeblur marker) is written to disk via
    // persistBakedDeblurIntent — replacing the pre-Z1 plain flush (which persisted no intent).
    expect(mockPersistDeblur).toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(true);
  });

  it('drives deblurProgress during the run (0 → fractions) and clears to null in finally', async () => {
    okRun();
    await enhanceService.applyMotionDeblur();
    expect(mockSetDeblurProgress).toHaveBeenCalledWith(0);
    expect(mockSetDeblurProgress).toHaveBeenCalledWith(0.5);
    expect(mockSetDeblurProgress).toHaveBeenLastCalledWith(null);
  });

  it('revert restores the pre-deblur base, clears the marker, and empties the stack', async () => {
    okRun();
    await enhanceService.applyMotionDeblur();
    (imageService.updateCurrentImageData as jest.Mock).mockClear();

    enhanceService.revert();

    expect(imageService.updateCurrentImageData).toHaveBeenCalledWith(expect.any(Float32Array), 384, 384);
    expect(imageService.clearBakedDeblur).toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(false);
  });
});
