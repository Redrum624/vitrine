/**
 * Round-8 S1 item 2 — stacked-bake partial-revert stale disk intent.
 *
 * EnhanceService._popAndRestore's partial-unwind branch (restoreStack still non-empty after a
 * pop) re-seeds the store's upscaleIntent to the REMAINING level's {scale, mode} but, before this
 * fix, never persisted that re-seed to disk. flush() early-returns while a bake is still active
 * (isBakedUpscaleActive stays true — a level remains), so a quit right after a partial unwind left
 * the durable store holding the JUST-POPPED (now-wrong) level's intent — a stale marker a future
 * reopen would wrongly offer to re-apply.
 *
 * This suite exercises the REAL EditPersistenceService (not mocked) and the REAL appStore against
 * a mocked window.electronAPI.storeSet, so the assertion lands at the persistence level (mirrors
 * editPersistenceUpscaleIntent.test.ts's approach): after a partial unwind, the disk write must
 * carry the REMAINING level's {scale, mode}. ImageProcessingPipeline is mocked (identity
 * processImage, empty module map) so serialize()/restore() exercise real code paths without
 * depending on Web Workers under Jest.
 */
let curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
const storeSetMock = jest.fn();

jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  getCurrentImage: jest.fn(() => ({ filePath: '/test/shot.orf', url: 'blob:', width: curOrig.width, height: curOrig.height })),
  updateCurrentImageData: jest.fn(),
  setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(),
  clearBakedUpscale: jest.fn(),
  setBakedDeblur: jest.fn(),
  clearBakedDeblur: jest.fn(),
  setImageSwitchHook: jest.fn(),
  isBakedUpscaleActive: jest.fn(() => false),
  isBakedDeblurActive: jest.fn(() => false),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d),
  resetAllModules: jest.fn(),
  getModule: jest.fn(() => undefined),
  getModules: jest.fn(() => new Map()),
  invalidateModuleCache: jest.fn(),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4), base: new Float32Array(8 * 8 * 4), width: 8, height: 8 })),
} }));
// AI unavailable — both stacked bakes take the deterministic ('standard') route.
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));

import { enhanceService } from '../services/EnhanceService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  storeSetMock.mockClear();
  curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
  (window as unknown as { electronAPI: unknown }).electronAPI = { storeSet: storeSetMock, storeGet: jest.fn() };
  useAppStore.getState().setUpscaleIntent(null);
});

afterEach(() => {
  useAppStore.getState().setUpscaleIntent(null);
});

describe('EnhanceService — stacked-bake partial revert persists the re-seeded intent', () => {
  it('a partial unwind (2 bakes -> 1) writes the REMAINING level intent to disk, not the just-popped one', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 });
    expect(enhanceService.getRestoreDepth()).toBe(2);
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 4, mode: 'standard' });

    storeSetMock.mockClear();
    enhanceService.revert(); // partial unwind: pops the ×4 level, ×2 remains active
    expect(enhanceService.getRestoreDepth()).toBe(1);

    // The store intent is re-seeded to the remaining (×2) level...
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 2, mode: 'standard' });
    // ...and — the fix under test — that re-seed is DURABLY WRITTEN, not left disk-stale at ×4.
    expect(storeSetMock).toHaveBeenCalledTimes(1);
    expect(storeSetMock).toHaveBeenCalledWith(
      'edits:/test/shot.orf',
      expect.objectContaining({ bakedUpscale: { scale: 2, mode: 'standard' } }),
    );
  });

  it('a FULL unwind from a 2-level stack still durably clears the intent (existing full-revert contract, unchanged)', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 });
    enhanceService.revert(); // -> depth 1
    storeSetMock.mockClear();

    enhanceService.revert(); // -> depth 0, full unwind
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(useAppStore.getState().upscaleIntent).toBeNull();
    expect(storeSetMock).toHaveBeenCalledTimes(1);
    expect(storeSetMock.mock.calls[0][1].bakedUpscale).toBeUndefined();
  });
});
