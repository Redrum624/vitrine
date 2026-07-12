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

    it('a 2→1 landing (resumeRedirectAfterStackedUnwind) KEEPS editsOnBakedBase and writes NOTHING (re-review MEDIUM)', () => {
      // First bake persists; a between-bakes edit redirect-writes editsOnBakedBase for THAT level.
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'standard' });
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: { basicadj: { exposure: 0.4 } } }, 2, 'standard');
      basicadj().setParams({ contrast: 0.3 });
      editPersistenceService.flush(); // editsOnBakedBase = {contrast 0.3} on the frozen pre-bake top

      // Second bake stacks → suspension; unwinding back to the single level re-arms WITHOUT writing
      // (the S1-era persistNow here clobbered disk.modules with the popped level's params and
      // dropped editsOnBakedBase — the reviewer-reproduced regression).
      editPersistenceService.suspendRedirectForStackedBake();
      storeSetMock.mockClear();
      editPersistenceService.resumeRedirectAfterStackedUnwind();
      expect(storeSetMock).not.toHaveBeenCalled(); // disk untouched: pre-bake modules + editsOnBakedBase intact

      // A further post-bake edit redirects on top of the STILL-FROZEN first-bake state.
      basicadj().setParams({ exposure: 0.9 });
      editPersistenceService.flush();
      const w = lastWrite();
      expect(w.modules).toEqual({ basicadj: { exposure: 0.4 } }); // pre-first-bake grading intact
      expect(w.editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ exposure: 0.9 }));
    });
  });

  describe('applyPostBakeEdits — replay on re-apply', () => {
    it('applies the saved editsOnBakedBase module params to the (re-baked) pipeline', () => {
      editPersistenceService.applyPostBakeEdits({ modules: { basicadj: { exposure: 0.7 } } }, 100, 100);
      expect(basicadj().getParams().exposure).toBeCloseTo(0.7);
    });
  });

  describe('STACKED bake — second bake is in-session only (review MEDIUM fix)', () => {
    beforeEach(() => {
      // First bake persists the pre-FIRST-bake modules + intent (the only durable write).
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: { basicadj: { exposure: 0.4 } } }, 2, 'ai');
    });

    it('the first bake write keeps the pre-first-bake modules and carries NO second-bake marker', () => {
      const w = lastWrite();
      expect(w.modules).toEqual({ basicadj: { exposure: 0.4 } });
      expect(w.bakedUpscale).toEqual({ scale: 2, mode: 'ai' });
      expect(w.bakedDeblur).toBeUndefined();
    });

    it('after suspendRedirectForStackedBake, post-second-bake edits write NOTHING (disk stays frozen)', () => {
      // Second bake stacks (deblur on the live upscale): EnhanceService suspends instead of persisting.
      mockImageService.isBakedDeblurActive.mockReturnValue(true);
      editPersistenceService.suspendRedirectForStackedBake();
      storeSetMock.mockClear();
      basicadj().setParams({ contrast: 0.5 });
      editPersistenceService.flush();
      expect(storeSetMock).not.toHaveBeenCalled(); // editsOnBakedBase NOT written post-second-bake
    });

    it('a partial unwind landing on the single remaining level resumes the redirect WITHOUT a write', () => {
      editPersistenceService.suspendRedirectForStackedBake();
      // Unwind 2→1: _popAndRestore restores the first level's params then re-arms the redirect.
      mockImageService.isBakedDeblurActive.mockReturnValue(false);
      imageProcessingPipeline.resetAllModules();
      storeSetMock.mockClear();
      editPersistenceService.resumeRedirectAfterStackedUnwind();
      expect(storeSetMock).not.toHaveBeenCalled(); // no disk write at the landing (re-review MEDIUM)
      // The redirect works again: a post-bake edit writes a fresh editsOnBakedBase.
      basicadj().setParams({ exposure: 0.9 });
      editPersistenceService.flush();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      expect(lastWrite().editsOnBakedBase.modules.basicadj).toEqual(expect.objectContaining({ exposure: 0.9 }));
    });
  });

  describe('persistPostBakeEdits — mid-replay failure re-attach (review LOW fix)', () => {
    it('re-writes the frozen pre-bake top-level + the given editsOnBakedBase', () => {
      mockImageService.isBakedUpscaleActive.mockReturnValue(true);
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      // The first replayed bake's persist consumed editsOnBakedBase from disk …
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: { basicadj: { exposure: 0.4 } } }, 2, 'ai');
      storeSetMock.mockClear();
      // … a later bake failed; the already-read edits are re-attached.
      editPersistenceService.persistPostBakeEdits({ modules: { basicadj: { contrast: 0.3 } } });
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      const w = lastWrite();
      expect(w.modules).toEqual({ basicadj: { exposure: 0.4 } }); // pre-bake top-level intact
      expect(w.bakedUpscale).toEqual({ scale: 2, mode: 'ai' });
      expect(w.editsOnBakedBase).toEqual({ modules: { basicadj: { contrast: 0.3 } } });
      // Baselines re-seeded: an unchanged follow-up flush writes nothing more.
      storeSetMock.mockClear();
      editPersistenceService.flush();
      expect(storeSetMock).not.toHaveBeenCalled();
    });

    it('no-ops when NO bake persisted this session (disk untouched — the edits are still there)', () => {
      // Fresh restore → bakedBaseState is null.
      editPersistenceService.persistPostBakeEdits({ modules: { basicadj: { contrast: 0.3 } } });
      expect(storeSetMock).not.toHaveBeenCalled();
    });
  });
});
