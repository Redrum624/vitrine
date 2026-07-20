/**
 * Z1 — stacked upscale + deblur bake order (EnhanceService ↔ store sync).
 *
 * A reopen's one-click re-apply replays the persisted bakes in order, so EnhanceService must keep
 * the store's bakeOrder / upscaleIntent / deblurIntent in lock-step with its restore stack as bakes
 * are applied and (partially / fully) reverted. This suite drives the REAL EnhanceService + REAL
 * appStore against mocked IPC/AI clients and asserts the store markers after each transition — the
 * data a Canvas reopen would persist and a re-apply would replay.
 */
let curOrig = { data: new Float32Array(384 * 384 * 4), width: 384, height: 384 };

jest.mock('../services/ImageService', () => ({ imageService: {
  getOriginalImage: jest.fn(() => curOrig),
  getOriginalImageDimensions: jest.fn(() => ({ width: curOrig.width, height: curOrig.height })),
  getCurrentImage: jest.fn(() => ({ filePath: '/test/shot.orf', width: curOrig.width, height: curOrig.height })),
  updateCurrentImageData: jest.fn(),
  setOriginalImage: jest.fn((data, width, height) => { curOrig = { data, width, height }; }),
  setBakedUpscale: jest.fn(), clearBakedUpscale: jest.fn(), isBakedUpscaleActive: jest.fn(() => false),
  setBakedDeblur: jest.fn(), clearBakedDeblur: jest.fn(), isBakedDeblurActive: jest.fn(() => false),
  setImageSwitchHook: jest.fn(),
} }));
jest.mock('../services/ImageProcessingPipeline', () => ({ imageProcessingPipeline: {
  processImage: jest.fn(async (d: Float32Array) => d),
  resetAllModules: jest.fn(), getModule: jest.fn(() => undefined), getModules: jest.fn(() => new Map()),
  invalidateModuleCache: jest.fn(),
} }));
// EditPersistenceService is mocked — the disk-write coverage lives in editsOnBakedBasePersist.test.ts;
// here we assert the STORE markers + the persist/suspend CALL PATTERN EnhanceService maintains.
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: {
  serialize: jest.fn(() => ({ version: 1, modules: {} })), restore: jest.fn(), flush: jest.fn(),
  persistNow: jest.fn(), persistBakedUpscaleIntent: jest.fn(), persistBakedDeblurIntent: jest.fn(),
  suspendRedirectForStackedBake: jest.fn(), resumeRedirectAfterStackedUnwind: jest.fn(),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(768 * 768 * 4).fill(0.5), base: new Float32Array(768 * 768 * 4).fill(0.5), width: 768, height: 768 })),
} }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
jest.mock('../services/AiDeblurClient', () => ({ aiDeblurClient: {
  isAvailable: jest.fn(async () => true),
  run: jest.fn(async (_rgba: Uint8Array, w: number, h: number) => ({ data: new Uint8Array(w * h * 4).fill(128), width: w, height: h, backend: 'directml' })),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));

import { enhanceService } from '../services/EnhanceService';
import { editPersistenceService } from '../services/EditPersistenceService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  curOrig = { data: new Float32Array(384 * 384 * 4), width: 384, height: 384 };
  (window as unknown as { electronAPI: unknown }).electronAPI = { storeSet: jest.fn(), storeGet: jest.fn() };
  const s = useAppStore.getState();
  s.setUpscaleIntent(null); s.setDeblurIntent(false); s.setBakeOrder([]);
});

afterEach(() => {
  const s = useAppStore.getState();
  s.setUpscaleIntent(null); s.setDeblurIntent(false); s.setBakeOrder([]);
});

describe('EnhanceService — stacked upscale + deblur bake order', () => {
  it('applying upscale then deblur records the order and both intents in the store', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(useAppStore.getState().bakeOrder).toEqual(['upscale']);
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 2, mode: 'standard' });
    expect(useAppStore.getState().deblurIntent).toBe(false);

    await enhanceService.applyMotionDeblur();
    expect(useAppStore.getState().bakeOrder).toEqual(['upscale', 'deblur']);
    expect(useAppStore.getState().deblurIntent).toBe(true);
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 2, mode: 'standard' }); // upscale still below
  });

  it('a PARTIAL unwind pops the top deblur level: bakeOrder + deblurIntent shrink, the upscale intent stays', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyMotionDeblur();
    expect(enhanceService.getRestoreDepth()).toBe(2);

    enhanceService.revert(); // pop deblur, upscale ×2 remains
    expect(enhanceService.getRestoreDepth()).toBe(1);
    expect(useAppStore.getState().bakeOrder).toEqual(['upscale']);
    expect(useAppStore.getState().deblurIntent).toBe(false);
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 2, mode: 'standard' });
  });

  it('a FULL unwind clears every durable marker', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyMotionDeblur();
    enhanceService.revert(); // -> depth 1
    enhanceService.revert(); // -> depth 0

    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(useAppStore.getState().bakeOrder).toEqual([]);
    expect(useAppStore.getState().deblurIntent).toBe(false);
    expect(useAppStore.getState().upscaleIntent).toBeNull();
  });
});

describe('EnhanceService — a STACKED bake is in-session only (review MEDIUM fix)', () => {
  it('the second (stacked) bake does NOT persist its intent — it suspends the redirect instead', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(editPersistenceService.persistBakedUpscaleIntent).toHaveBeenCalledTimes(1);
    expect(editPersistenceService.suspendRedirectForStackedBake).not.toHaveBeenCalled();

    await enhanceService.applyMotionDeblur(); // stacks onto the live upscale
    // Disk must keep the FIRST bake's pre-bake modules + intent — no second persist write.
    expect(editPersistenceService.persistBakedDeblurIntent).not.toHaveBeenCalled();
    expect(editPersistenceService.suspendRedirectForStackedBake).toHaveBeenCalledTimes(1);
  });

  it('a stacked second UPSCALE also skips its persist (kind-agnostic)', async () => {
    await enhanceService.applyMotionDeblur();
    expect(editPersistenceService.persistBakedDeblurIntent).toHaveBeenCalledTimes(1);

    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    expect(editPersistenceService.persistBakedUpscaleIntent).not.toHaveBeenCalled();
    expect(editPersistenceService.suspendRedirectForStackedBake).toHaveBeenCalledTimes(1);
  });

  it('partial unwinds NEVER write; the 2→1 landing resumes the redirect; only the full unwind persists', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    await enhanceService.applyMotionDeblur();
    await enhanceService.applyMotionDeblur(); // depth 3
    expect(enhanceService.getRestoreDepth()).toBe(3);
    (editPersistenceService.persistNow as jest.Mock).mockClear();

    enhanceService.revert(); // 3 → 2: still stacked — suspension stays, no write
    expect(enhanceService.getRestoreDepth()).toBe(2);
    expect(editPersistenceService.persistNow).not.toHaveBeenCalled();
    expect(editPersistenceService.resumeRedirectAfterStackedUnwind).not.toHaveBeenCalled();

    enhanceService.revert(); // 2 → 1: re-arm the redirect WITHOUT writing (re-review MEDIUM fix —
    // the S1-era persistNow here clobbered the pre-first-bake modules with the popped level's)
    expect(enhanceService.getRestoreDepth()).toBe(1);
    expect(editPersistenceService.persistNow).not.toHaveBeenCalled();
    expect(editPersistenceService.resumeRedirectAfterStackedUnwind).toHaveBeenCalledTimes(1);

    enhanceService.revert(); // 1 → 0: full unwind — the ONLY unwind write (marker-free erase)
    expect(enhanceService.getRestoreDepth()).toBe(0);
    expect(editPersistenceService.persistNow).toHaveBeenCalledTimes(1);
  });
});
