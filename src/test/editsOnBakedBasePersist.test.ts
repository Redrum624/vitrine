/**
 * Z1 — edits-after-a-bake persistence + cross-session deblur intent (EditPersistenceService layer).
 *
 * The standing MEDIUM: after an upscale/deblur bake the pipeline modules are reset to NEUTRAL (the
 * pre-bake edits are baked into the new base pixels), so a plain flush of that neutral state would
 * clobber the user's saved PRE-bake edits. The pre-Z1 code SUPPRESSED the flush — which lost every
 * edit made AFTER the bake on quit. Z1 turns the suppression into a REDIRECT: post-bake edits are
 * written into `editsOnBakedBase` on top of the frozen pre-bake top-level, and replayed on re-apply.
 * This suite also pins the deblur cross-session intent (mirror of the upscale Q7 marker) and the
 * stacked bakeOrder.
 *
 * Harness mirrors editPersistenceUpscaleIntent.test.ts: ImageService is auto-mocked (getCurrentImage
 * / isBaked*Active), the REAL pipeline + REAL store exercise serialize()/restore()/flush() through
 * production code paths, and window.electronAPI.storeSet is a spy.
 */
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { useAppStore } from '../stores/appStore';

jest.mock('../services/ImageService');

describe('EditPersistenceService — edits after a bake persist + deblur intent (Z1)', () => {
  const mockImageService = imageService as jest.Mocked<typeof imageService>;
  let storeSetMock: jest.Mock;

  const basicadj = () => imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
  const lastWrite = () => storeSetMock.mock.calls[storeSetMock.mock.calls.length - 1][1];

  beforeEach(() => {
    storeSetMock = jest.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { storeSet: storeSetMock, storeGet: jest.fn() };
    mockImageService.getCurrentImage.mockReturnValue({
      filePath: '/test/shot.orf', width: 100, height: 100,
    } as unknown as ReturnType<typeof imageService.getCurrentImage>);
    mockImageService.isBakedUpscaleActive.mockReturnValue(false);
    mockImageService.isBakedDeblurActive.mockReturnValue(false);
    const s = useAppStore.getState();
    s.setUpscaleIntent(null);
    s.setDeblurIntent(false);
    s.setBakeOrder([]);
    imageProcessingPipeline.resetAllModules();
    // Clear any redirect state carried over from a prior test (a fresh restore has no active bake).
    editPersistenceService.restoreState(null, 100, 100, '/test/shot.orf');
  });

  afterEach(() => {
    jest.clearAllMocks();
    imageProcessingPipeline.resetAllModules();
    const s = useAppStore.getState();
    s.setUpscaleIntent(null);
    s.setDeblurIntent(false);
    s.setBakeOrder([]);
  });

  describe('serialize round-trip — deblur + bakeOrder markers', () => {
    it('emits bakedDeblur {} from the store deblurIntent, omits it otherwise', () => {
      useAppStore.getState().setDeblurIntent(true);
      expect(editPersistenceService.serialize().bakedDeblur).toEqual({});
      useAppStore.getState().setDeblurIntent(false);
      expect(editPersistenceService.serialize().bakedDeblur).toBeUndefined();
    });

    it('emits bakeOrder only when >1 bake is stacked (a single bake is described by its marker alone)', () => {
      useAppStore.getState().setBakeOrder(['upscale', 'deblur']);
      expect(editPersistenceService.serialize().bakeOrder).toEqual(['upscale', 'deblur']);
      useAppStore.getState().setBakeOrder(['upscale']);
      expect(editPersistenceService.serialize().bakeOrder).toBeUndefined();
    });

    it('does NOT emit editsOnBakedBase from serialize (a persistence-only concern — keeps checkpoints orthogonal)', () => {
      basicadj().setParams({ exposure: 0.4 });
      expect(editPersistenceService.serialize()).not.toHaveProperty('editsOnBakedBase');
    });
  });

  describe('old-state tolerance (optional, never version-bumped)', () => {
    it('restores an OLD state predating every Z1 field cleanly', () => {
      expect(editPersistenceService.restore({ version: 1, modules: {} }, 100, 100)).toBe(true);
    });
    it('restores a state carrying editsOnBakedBase + bakedDeblur + bakeOrder without throwing', () => {
      const state = {
        version: 1, modules: {}, bakedDeblur: {}, bakeOrder: ['upscale', 'deblur'] as ('upscale' | 'deblur')[],
        editsOnBakedBase: { modules: { basicadj: { exposure: 0.3 } } },
      };
      expect(editPersistenceService.restore(state, 100, 100)).toBe(true);
    });
  });

  describe('post-bake flush REDIRECT (upscale)', () => {
    beforeEach(() => {
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      useAppStore.getState().setBakeOrder(['upscale']);
      // Bake: persist the PRE-bake top-level + freeze the redirect base (modules are neutral now).
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: { basicadj: { exposure: 0.4 } } }, 2, 'ai');
      storeSetMock.mockClear();
    });

    it('an UNTOUCHED post-bake state writes nothing (baseline reset at bake time)', () => {
      editPersistenceService.flush();
      expect(storeSetMock).not.toHaveBeenCalled();
    });

    it('a post-bake edit REDIRECTS into editsOnBakedBase, leaving the pre-bake modules + intent untouched', () => {
      basicadj().setParams({ contrast: 0.3 });
      editPersistenceService.flush();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      const w = lastWrite();
      // Pre-bake top-level is frozen (the persisted native-dims modules) …
      expect(w.modules).toEqual({ basicadj: { exposure: 0.4 } });
      expect(w.bakedUpscale).toEqual({ scale: 2, mode: 'ai' });
      // … and the post-bake edit lives in editsOnBakedBase (full live-pipeline snapshot).
      expect(w.editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ contrast: 0.3 }));
    });

    it('a second post-bake edit REPLACES editsOnBakedBase (pre-bake modules stay frozen across redirects)', () => {
      basicadj().setParams({ contrast: 0.3 });
      editPersistenceService.flush();
      basicadj().setParams({ exposure: 0.9 });
      storeSetMock.mockClear();
      editPersistenceService.flush();
      const w = lastWrite();
      expect(w.modules).toEqual({ basicadj: { exposure: 0.4 } }); // still the pre-bake state
      expect(w.editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ exposure: 0.9 }));
    });
  });

  describe('post-bake flush REDIRECT (deblur intent round-trip)', () => {
    it('persistBakedDeblurIntent writes the pre-deblur state + bakedDeblur marker', () => {
      mockImageService.isBakedDeblurActive.mockReturnValue(true);
      useAppStore.getState().setDeblurIntent(true);
      useAppStore.getState().setBakeOrder(['deblur']);
      editPersistenceService.persistBakedDeblurIntent({ version: 1, modules: { basicadj: { exposure: 0.2 } } });
      expect(storeSetMock).toHaveBeenCalledWith(
        'edits:/test/shot.orf',
        expect.objectContaining({ modules: { basicadj: { exposure: 0.2 } }, bakedDeblur: {} }),
      );
    });

    it('post-deblur edits redirect into editsOnBakedBase (same mechanism as upscale)', () => {
      mockImageService.isBakedDeblurActive.mockReturnValue(true);
      useAppStore.getState().setDeblurIntent(true);
      editPersistenceService.persistBakedDeblurIntent({ version: 1, modules: {} });
      storeSetMock.mockClear();
      basicadj().setParams({ exposure: 0.5 });
      editPersistenceService.flush();
      expect(lastWrite().editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ exposure: 0.5 }));
      expect(lastWrite().bakedDeblur).toEqual({});
    });
  });

  describe('edit WITHOUT re-apply invalidates editsOnBakedBase (two timelines must not merge)', () => {
    it('after reopen (base NOT baked), the first edit flush drops editsOnBakedBase but keeps the intent', () => {
      // Reopen: seed intent, restore the saved state (base is native — not baked).
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      editPersistenceService.restoreState(
        { version: 1, modules: {}, bakedUpscale: { scale: 2, mode: 'ai' }, editsOnBakedBase: { modules: { basicadj: { contrast: 0.3 } } } },
        100, 100, '/test/shot.orf',
      );
      storeSetMock.mockClear();
      basicadj().setParams({ exposure: 0.5 }); // edit the un-baked native base
      editPersistenceService.flush();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      const w = lastWrite();
      expect(w.editsOnBakedBase).toBeUndefined(); // invalidated
      expect(w.bakedUpscale).toEqual({ scale: 2, mode: 'ai' }); // intent notice stays
    });
  });

  describe('P2 progressive-destruction guard extends to the deblur marker (both directions)', () => {
    it('a later unrelated edit flush RE-writes bakedDeblur instead of destroying it', () => {
      useAppStore.getState().setDeblurIntent(true);
      editPersistenceService.restoreState({ version: 1, modules: {} }, 100, 100, '/test/shot.orf');
      basicadj().setParams({ exposure: 0.5 });
      editPersistenceService.flush(); // base NOT baked → normal path
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      expect(lastWrite().bakedDeblur).toEqual({});
    });

    it('once the deblur intent is cleared, a subsequent edit flush no longer carries the marker', () => {
      useAppStore.getState().setDeblurIntent(false);
      editPersistenceService.restoreState({ version: 1, modules: {} }, 100, 100, '/test/shot.orf');
      basicadj().setParams({ exposure: 0.25 });
      editPersistenceService.flush();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      expect(lastWrite().bakedDeblur).toBeUndefined();
    });
  });

  describe('persistNow — full vs partial unwind of the redirect state', () => {
    it('FULL unwind (no bake active, intents cleared) writes a marker-free, editsOnBakedBase-free state', () => {
      // First establish a live redirect with an editsOnBakedBase written to disk …
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: {} }, 2, 'ai');
      basicadj().setParams({ exposure: 0.5 });
      editPersistenceService.flush();
      // … then a full revert: markers cleared, base no longer baked.
      mockImageService.isBakedUpscaleActive.mockReturnValue(false);
      imageProcessingPipeline.resetAllModules();
      useAppStore.getState().setUpscaleIntent(null);
      useAppStore.getState().setBakeOrder([]);
      storeSetMock.mockClear();
      editPersistenceService.persistNow();
      const w = lastWrite();
      expect(w.editsOnBakedBase).toBeUndefined();
      expect(w.bakedUpscale).toBeUndefined();
      expect(w.bakedDeblur).toBeUndefined();
    });

    it('PARTIAL unwind pops the top level editsOnBakedBase; the remaining level re-seeds a fresh redirect', () => {
      // Two stacked upscales, a post-bake edit made on the ×4 level.
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 4, mode: 'standard' });
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: {} }, 4, 'standard');
      basicadj().setParams({ exposure: 0.6 });
      editPersistenceService.flush(); // ×4-level editsOnBakedBase written

      // Partial unwind → remaining ×2 level; bake still active. persistNow re-seeds + drops the pop.
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'standard' });
      imageProcessingPipeline.resetAllModules(); // _popAndRestore restores the remaining level's params
      storeSetMock.mockClear();
      editPersistenceService.persistNow();
      const popped = lastWrite();
      expect(popped.editsOnBakedBase).toBeUndefined(); // the ×4 level's edits were popped
      expect(popped.bakedUpscale).toEqual({ scale: 2, mode: 'standard' });

      // A further post-bake edit redirects into a FRESH editsOnBakedBase for the remaining level.
      basicadj().setParams({ exposure: 0.9 });
      storeSetMock.mockClear();
      editPersistenceService.flush();
      expect(lastWrite().editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ exposure: 0.9 }));
    });
  });

  describe('applyPostBakeEdits — replay on re-apply', () => {
    it('applies the saved editsOnBakedBase module params to the (re-baked) pipeline', () => {
      editPersistenceService.applyPostBakeEdits({ modules: { basicadj: { exposure: 0.7 } } }, 100, 100);
      expect(basicadj().getParams().exposure).toBeCloseTo(0.7);
    });
  });
});
