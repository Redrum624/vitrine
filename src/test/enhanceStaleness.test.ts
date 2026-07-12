// Unit tests for the EnhanceService staleness snapshot (P7 item 3). The upstream-params hash is
// derived from imageProcessingPipeline.getModules(); we mock the pipeline so `moduleParams` is a
// controllable knob and assert isEnhanceStale() flips exactly when a NON-enhance module changes.
let moduleParams: Record<string, Record<string, unknown>> = {};
function makeModules(): Map<string, { getParams: () => Record<string, unknown> }> {
  return new Map(Object.entries(moduleParams).map(([id, p]) => [id, { getParams: () => p }]));
}

jest.mock('../services/ImageService', () => ({ imageService: {
  setImageSwitchHook: jest.fn(),
  getOriginalImage: jest.fn(), updateCurrentImageData: jest.fn(), setOriginalImage: jest.fn(),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  getModules: jest.fn(() => makeModules()),
  processImage: jest.fn(), resetAllModules: jest.fn(), getModule: jest.fn(() => undefined),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: { run: jest.fn() } }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: { serialize: jest.fn(() => ({})), restore: jest.fn() } }));
jest.mock('../stores/appStore', () => ({ useAppStore: { getState: () => ({
  setIsProcessing: jest.fn(), setUpscaleProgress: jest.fn(), setUpscaleMode: jest.fn(), setUpscaleIntent: jest.fn(),
  setDeblurIntent: jest.fn(), setBakeOrder: jest.fn(),
  notifyExternalParamsChange: jest.fn(), triggerReprocessing: jest.fn(),
}) } }));

import { enhanceService } from '../services/EnhanceService';

beforeEach(() => {
  enhanceService.onImageSwitched(); // reset the applied-upstream snapshot
  moduleParams = { exposure: { exposure: 0 }, 'noise-reduction': { enabled: false }, enhance: { sharpness: 0.4 } };
});

describe('EnhanceService — staleness snapshot (P7 item 3)', () => {
  it('is NOT stale before any Apply Enhance', () => {
    expect(enhanceService.isEnhanceStale()).toBe(false);
  });

  it('is NOT stale immediately after markEnhanceApplied (snapshot == current)', () => {
    enhanceService.markEnhanceApplied();
    expect(enhanceService.isEnhanceStale()).toBe(false);
  });

  it('becomes stale when an UPSTREAM (non-enhance) param changes', () => {
    enhanceService.markEnhanceApplied();
    moduleParams.exposure = { exposure: 1.0 };
    expect(enhanceService.isEnhanceStale()).toBe(true);
  });

  it('does NOT become stale when only enhance\'s OWN params change (excluded from the hash)', () => {
    enhanceService.markEnhanceApplied();
    moduleParams.enhance = { sharpness: 0.9 };
    expect(enhanceService.isEnhanceStale()).toBe(false);
  });

  it('treats noise-reduction (an upstream module that feeds enhance) as staleness-relevant', () => {
    enhanceService.markEnhanceApplied();
    moduleParams['noise-reduction'] = { enabled: true, strength: 60 };
    expect(enhanceService.isEnhanceStale()).toBe(true);
  });

  it('clears when re-applied after an upstream change', () => {
    enhanceService.markEnhanceApplied();
    moduleParams.exposure = { exposure: 1.0 };
    expect(enhanceService.isEnhanceStale()).toBe(true);
    enhanceService.markEnhanceApplied(); // re-apply re-snapshots the now-current upstream
    expect(enhanceService.isEnhanceStale()).toBe(false);
  });

  it('resets on image switch (the per-image scope choke point)', () => {
    enhanceService.markEnhanceApplied();
    moduleParams.exposure = { exposure: 1.0 };
    expect(enhanceService.isEnhanceStale()).toBe(true);
    enhanceService.onImageSwitched();
    expect(enhanceService.isEnhanceStale()).toBe(false);
  });
});
