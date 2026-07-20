/**
 * Q7 — EnhanceService drives the durable upscale intent: applyUpscale writes it (store + disk via
 * persistBakedUpscaleIntent), and a full revert erases it (store null + persistNow). The heavy
 * collaborators are mocked so we assert the intent wiring precisely. AI is unavailable here → the
 * deterministic ('standard') route runs (AI-route mode is covered by enhanceAiRouting.test.ts).
 */
const mockSetUpscaleIntent = jest.fn();
const mockPersistBaked = jest.fn();
const mockPersistNow = jest.fn();
const EDIT_STATE = { version: 1, modules: { basicadj: { exposure: 0.3 } } };

let curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  updateCurrentImageData: jest.fn(),
  setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(), setImageSwitchHook: jest.fn(),
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d), resetAllModules: jest.fn(), getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 })),
} }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: {
  serialize: jest.fn(() => EDIT_STATE), restore: jest.fn(),
  persistBakedUpscaleIntent: mockPersistBaked, persistNow: mockPersistNow,
} }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({
  setIsProcessing: jest.fn(), setUpscaleProgress: jest.fn(), setUpscaleMode: jest.fn(),
  setUpscaleIntent: mockSetUpscaleIntent, setDeblurIntent: jest.fn(), setBakeOrder: jest.fn(),
  notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn(),
}) } }));

import { enhanceService } from '../services/EnhanceService';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
});

describe('EnhanceService — durable upscale intent wiring (Q7)', () => {
  it('applyUpscale records the intent in the store and persists it to disk', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(mockSetUpscaleIntent).toHaveBeenCalledWith({ scale: 2, mode: 'standard' });
    // Persists the PRE-bake serialize() snapshot + the {scale, mode} marker.
    expect(mockPersistBaked).toHaveBeenCalledWith(EDIT_STATE, 2, 'standard');
  });

  it('a full revert clears the store intent (null) and durably erases it on disk', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    mockSetUpscaleIntent.mockClear();
    mockPersistNow.mockClear();

    enhanceService.revert();

    expect(enhanceService.canRevert()).toBe(false);
    expect(mockSetUpscaleIntent).toHaveBeenCalledWith(null);
    expect(mockPersistNow).toHaveBeenCalledTimes(1);
  });

  it('onImageSwitched clears the per-image intent (no bleed to the next image)', () => {
    enhanceService.onImageSwitched();
    expect(mockSetUpscaleIntent).toHaveBeenCalledWith(null);
  });
});
