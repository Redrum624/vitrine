/**
 * Stacked-bake partial-revert disk coherence (round-8 S1, superseded by the Z1 re-review fix).
 *
 * HISTORY: the round-8 S1 fix made _popAndRestore's partial-unwind branch persistNow() the
 * re-seeded remaining level (back then BOTH stacked bakes persisted, so disk held the just-popped
 * level and needed correcting). The Z1 stacked-corner fix then made stacked (second+) bakes
 * IN-SESSION ONLY — they never write disk — which turned that S1 write from a correction into a
 * CLOBBER: at a 2→1 landing, serialize() reflects the just-restored POPPED level's edit state
 * (post-first-bake params, or pure neutral), so writing it destroyed the pre-first-bake modules
 * and dropped editsOnBakedBase (Z1 re-review MEDIUM, reviewer repro below). Final design: NO disk
 * write at any partial landing — the disk already holds the FIRST bake's correct state; the 2→1
 * landing only re-arms the flush redirect (resumeRedirectAfterStackedUnwind).
 *
 * This suite exercises the REAL EditPersistenceService (not mocked) and the REAL appStore against
 * a mocked window.electronAPI.storeSet, so the assertions land at the persistence level. The
 * pipeline mock carries ONE stateful fake module (basicadj) so serialize()/restore() move real
 * params through the bake/unwind cycle without depending on Web Workers under Jest.
 */
let curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
const storeSetMock = jest.fn();

// Stateful fake module: lets the reviewer-repro test assert WHICH params end up on disk.
const fakeBasicAdj = {
  params: {} as Record<string, unknown>,
  getParams() { return { ...this.params }; },
  setParams(p: Record<string, unknown>) { Object.assign(this.params, p); },
};

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
  resetAllModules: jest.fn(() => { fakeBasicAdj.params = {}; }),
  getModule: jest.fn((id: string) => (id === 'basicadj' ? fakeBasicAdj : undefined)),
  getModules: jest.fn(() => new Map<string, unknown>([['basicadj', fakeBasicAdj]])),
  invalidateModuleCache: jest.fn(),
} }));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 })),
} }));
// AI upscale unavailable — stacked upscales take the deterministic ('standard') route.
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: { isAvailable: jest.fn(async () => false), run: jest.fn() } }));
// AI deblur available — the reviewer-repro test stacks a deblur onto a live upscale.
jest.mock('../services/AiDeblurClient', () => ({ aiDeblurClient: {
  isAvailable: jest.fn(async () => true),
  run: jest.fn(async (_rgba: Uint8Array, w: number, h: number) => ({ data: new Uint8Array(w * h * 4).fill(128), width: w, height: h, backend: 'directml' })),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: { record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn() } }));

import { enhanceService } from '../services/EnhanceService';
import { enhanceWorkerClient } from '../services/EnhanceWorkerClient';
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

beforeEach(() => {
  while (enhanceService.canRevert()) enhanceService.revert();
  jest.clearAllMocks();
  // jest.clearAllMocks wiped the mock implementations declared in the factories — reinstate the
  // stateful ones the tests rely on.
  (imageService.setOriginalImage as jest.Mock).mockImplementation((data, width, height) => { curOrig = { data, width, height }; });
  (imageService.getOriginalImage as jest.Mock).mockImplementation(() => curOrig);
  (imageService.getCurrentImage as jest.Mock).mockImplementation(() => ({ filePath: '/test/shot.orf', url: 'blob:', width: curOrig.width, height: curOrig.height }));
  // mockReturnValue set inside a test survives clearAllMocks — reset the marker mocks explicitly.
  (imageService.isBakedUpscaleActive as jest.Mock).mockImplementation(() => false);
  (imageService.isBakedDeblurActive as jest.Mock).mockImplementation(() => false);
  storeSetMock.mockClear();
  fakeBasicAdj.params = {};
  curOrig = { data: new Float32Array(4 * 4 * 4), width: 4, height: 4 };
  (window as unknown as { electronAPI: unknown }).electronAPI = { storeSet: storeSetMock, storeGet: jest.fn() };
  const s = useAppStore.getState();
  s.setUpscaleIntent(null); s.setDeblurIntent(false); s.setBakeOrder([]);
  // Fresh-open equivalent: clears baselines + any redirect/suspension state on the real service.
  editPersistenceService.restoreState(null, 4, 4, '/test/shot.orf');
  storeSetMock.mockClear();
});

afterEach(() => {
  const s = useAppStore.getState();
  s.setUpscaleIntent(null); s.setDeblurIntent(false); s.setBakeOrder([]);
});

describe('EnhanceService — stacked-bake partial revert leaves the disk untouched (final design)', () => {
  it('a partial unwind (2 bakes -> 1) needs NO write — the second bake never persisted, disk already holds the remaining level', async () => {
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    // Bake 1 is the ONLY durable write: pre-bake modules + its intent.
    expect(storeSetMock).toHaveBeenCalledTimes(1);
    expect(storeSetMock).toHaveBeenCalledWith(
      'edits:/test/shot.orf',
      expect.objectContaining({ bakedUpscale: { scale: 2, mode: 'standard' } }),
    );

    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 4 });
    expect(enhanceService.getRestoreDepth()).toBe(2);
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 4, mode: 'standard' });
    expect(storeSetMock).toHaveBeenCalledTimes(1); // stacked bake wrote NOTHING

    storeSetMock.mockClear();
    enhanceService.revert(); // partial unwind: pops the ×4 level, ×2 remains active
    expect(enhanceService.getRestoreDepth()).toBe(1);

    // The store intent is re-seeded to the remaining (×2) level...
    expect(useAppStore.getState().upscaleIntent).toEqual({ scale: 2, mode: 'standard' });
    // ...and — the re-review fix — the disk is NOT touched: it already holds the ×2 state, and the
    // S1-era write here would have clobbered the pre-first-bake modules with the popped level's.
    expect(storeSetMock).not.toHaveBeenCalled();
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

describe('Z1 re-review MEDIUM regression — the reviewer repro (edit → upscale → edit → deblur → revert once)', () => {
  const lastWrite = () => storeSetMock.mock.calls[storeSetMock.mock.calls.length - 1][1];

  async function runRepro(unwindOnce: () => void) {
    // Image large enough for the deblur floor; the upscale worker returns 768×768.
    curOrig = { data: new Float32Array(4 * 4 * 4), width: 384, height: 384 };
    (enhanceWorkerClient.run as jest.Mock).mockResolvedValueOnce({
      enhanced: new Float32Array(768 * 768 * 4).fill(0.5), base: new Float32Array(768 * 768 * 4).fill(0.5), width: 768, height: 768,
    });

    // 1. Pre-bake grading.
    fakeBasicAdj.setParams({ exposure: 0.4 });
    // 2. Upscale bakes → persists {modules:{basicadj:{exposure:0.4}}, bakedUpscale} and resets modules.
    await enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });
    (imageService.isBakedUpscaleActive as jest.Mock).mockReturnValue(true);
    // 3. Post-bake edit → flush REDIRECT writes editsOnBakedBase on the frozen pre-bake top-level.
    fakeBasicAdj.setParams({ contrast: 0.3 });
    editPersistenceService.flush();
    expect(lastWrite().modules).toEqual({ basicadj: { exposure: 0.4 } });
    expect(lastWrite().editsOnBakedBase).toEqual({ modules: { basicadj: { contrast: 0.3 } } });
    // 4. Stacked deblur — in-session only (no write, redirect suspended).
    await enhanceService.applyMotionDeblur();
    (imageService.isBakedDeblurActive as jest.Mock).mockReturnValue(true);
    expect(enhanceService.getRestoreDepth()).toBe(2);

    // 5. Unwind ONCE back to the upscale level.
    storeSetMock.mockClear();
    (imageService.isBakedDeblurActive as jest.Mock).mockReturnValue(false);
    unwindOnce();
    expect(enhanceService.getRestoreDepth()).toBe(1);

    // THE REGRESSION: the S1-era write here replaced disk.modules with the restored post-bake
    // params ({contrast:0.3}) and dropped editsOnBakedBase — the exposure 0.4 grading was gone.
    // Final design: NO write — disk still holds the pre-first-bake modules + editsOnBakedBase.
    expect(storeSetMock).not.toHaveBeenCalled();

    // The redirect resumed against the first bake's frozen state: an unchanged flush writes
    // nothing (the restored {contrast:0.3} matches the persisted editsOnBakedBase)...
    editPersistenceService.flush();
    expect(storeSetMock).not.toHaveBeenCalled();
    // ...and a NEW post-pop edit redirect-writes on the STILL-INTACT pre-first-bake top-level.
    fakeBasicAdj.setParams({ contrast: 0.6 });
    editPersistenceService.flush();
    expect(storeSetMock).toHaveBeenCalledTimes(1);
    expect(lastWrite().modules).toEqual({ basicadj: { exposure: 0.4 } }); // grading intact
    expect(lastWrite().bakedUpscale).toEqual({ scale: 2, mode: 'standard' });
    expect(lastWrite().editsOnBakedBase).toEqual({ modules: { basicadj: { contrast: 0.6 } } });
  }

  it('via revert(): disk.modules still carries exposure 0.4 and editsOnBakedBase survives the pop', async () => {
    await runRepro(() => enhanceService.revert());
  });

  it('via a History restore (unwindToDepth 1): same guarantee through the checkpoint bridge path', async () => {
    await runRepro(() => enhanceService.unwindToDepth(1));
  });
});
