/**
 * Q7 — durable-across-restart upscale INTENT persistence (EditPersistenceService layer).
 *
 * The upscaled PIXELS are never persisted (4× of 122MB ≈ 2GB). Instead serialize() emits a
 * `bakedUpscale: {scale, mode}` marker from the store's upscaleIntent, and two dedicated writers
 * put it on disk (persistBakedUpscaleIntent on bake) / erase it (persistNow on full revert).
 *
 * The load-bearing invariant this suite pins is the P2 "progressive destruction" lesson: after a
 * reopen seeds the flush baseline from serialize(), that baseline MUST already carry the marker —
 * otherwise the very next unrelated edit's flush() writes a marker-free state and silently destroys
 * the persisted intent. ImageService is auto-mocked (getCurrentImage / isBakedUpscaleActive); the
 * REAL pipeline + REAL store are used so serialize()/restore() exercise production code paths.
 */
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { useAppStore } from '../stores/appStore';

jest.mock('../services/ImageService');

describe('EditPersistenceService — durable upscale intent (Q7)', () => {
  const mockImageService = imageService as jest.Mocked<typeof imageService>;
  let storeSetMock: jest.Mock;

  beforeEach(() => {
    storeSetMock = jest.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      storeSet: storeSetMock,
      storeGet: jest.fn(),
    };
    mockImageService.getCurrentImage.mockReturnValue({
      filePath: '/test/shot.orf', url: 'blob:', width: 100, height: 100, bitDepth: 16,
    } as unknown as ReturnType<typeof imageService.getCurrentImage>);
    mockImageService.isBakedUpscaleActive.mockReturnValue(false);
    useAppStore.getState().setUpscaleIntent(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
    imageProcessingPipeline.resetAllModules();
    useAppStore.getState().setUpscaleIntent(null);
  });

  describe('serialize round-trip + schema tolerance', () => {
    it('emits bakedUpscale from the store upscaleIntent', () => {
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      expect(editPersistenceService.serialize().bakedUpscale).toEqual({ scale: 2, mode: 'ai' });
    });

    it('omits bakedUpscale when there is no intent', () => {
      useAppStore.getState().setUpscaleIntent(null);
      expect(editPersistenceService.serialize().bakedUpscale).toBeUndefined();
    });

    it('restores an OLD saved state that predates the field (no bakedUpscale) cleanly', () => {
      // version 1, no bakedUpscale key — the tolerance contract: restore returns true, no throw.
      expect(editPersistenceService.restore({ version: 1, modules: {} }, 100, 100)).toBe(true);
    });

    it('restores a state that DOES carry the marker without throwing (marker is a store concern)', () => {
      const state = { version: 1, modules: {}, bakedUpscale: { scale: 4 as const, mode: 'standard' as const } };
      expect(editPersistenceService.restore(state, 100, 100)).toBe(true);
    });
  });

  describe('persistBakedUpscaleIntent — the one write that survives a bake', () => {
    it('writes {...preBakeState, bakedUpscale:{scale,mode}} under the image key', () => {
      const preBake = { version: 1, modules: { basicadj: { exposure: 0.4 } } };
      editPersistenceService.persistBakedUpscaleIntent(preBake, 2, 'ai');
      expect(storeSetMock).toHaveBeenCalledWith(
        'edits:/test/shot.orf',
        expect.objectContaining({ modules: { basicadj: { exposure: 0.4 } }, bakedUpscale: { scale: 2, mode: 'ai' } }),
      );
    });

    it('no-ops when there is no current image path', () => {
      mockImageService.getCurrentImage.mockReturnValue(null as unknown as ReturnType<typeof imageService.getCurrentImage>);
      editPersistenceService.persistBakedUpscaleIntent({ version: 1, modules: {} }, 2, 'ai');
      expect(storeSetMock).not.toHaveBeenCalled();
    });
  });

  describe('persistNow — durably CLEARS the intent on full revert', () => {
    it('writes a marker-free state when the store intent has been cleared', () => {
      useAppStore.getState().setUpscaleIntent(null);
      editPersistenceService.persistNow();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      expect(storeSetMock.mock.calls[0][1].bakedUpscale).toBeUndefined();
    });
  });

  describe('flush baseline includes the marker (P2 progressive-destruction guard)', () => {
    it('a later unrelated edit flush RE-writes the intent instead of destroying it', () => {
      // Reopen: store the persisted intent, then seed the flush baseline via restoreState — this is
      // exactly the Canvas open-flow order (setUpscaleIntent BEFORE restoreState).
      useAppStore.getState().setUpscaleIntent({ scale: 2, mode: 'ai' });
      editPersistenceService.restoreState({ version: 1, modules: {} }, 100, 100, '/test/shot.orf');

      // Make an unrelated edit and flush (the base is NOT baked → flush proceeds normally).
      const basicadj = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
      basicadj.setParams({ exposure: 0.5 });
      editPersistenceService.flush();

      expect(storeSetMock).toHaveBeenCalledTimes(1);
      // The marker MUST survive the edit's save — the whole point of emitting it from serialize().
      expect(storeSetMock.mock.calls[0][1].bakedUpscale).toEqual({ scale: 2, mode: 'ai' });
    });

    it('once the intent is cleared, a subsequent edit flush no longer carries the marker', () => {
      useAppStore.getState().setUpscaleIntent(null);
      editPersistenceService.restoreState({ version: 1, modules: {} }, 100, 100, '/test/shot.orf');
      const basicadj = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
      basicadj.setParams({ exposure: 0.25 });
      editPersistenceService.flush();
      expect(storeSetMock).toHaveBeenCalledTimes(1);
      expect(storeSetMock.mock.calls[0][1].bakedUpscale).toBeUndefined();
    });
  });
});

/**
 * Round-8 S1 item 1: Canvas.tsx seeded `savedState?.bakedUpscale` into the store UNVALIDATED —
 * unlike rawDecodeOptions, which routes through validateSavedRawDecodeOptions before reaching
 * the store/decoder (see editPersistenceRawOptionsValidation.test.ts). validateBakedUpscaleIntent
 * is the synchronous shape guard closing that gap: a corrupt/out-of-enum persisted value must not
 * seed a fabricated upscale intent (which would surface a bogus "re-apply" notice / export
 * warning). Unlike decode options there is no safe DEFAULT to substitute, so corrupt input → null.
 */
describe('validateBakedUpscaleIntent — synchronous Canvas-path guard', () => {
  it('returns a valid {scale:2, mode:"ai"} intent unchanged', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ scale: 2, mode: 'ai' }))
      .toEqual({ scale: 2, mode: 'ai' });
  });

  it('returns a valid {scale:4, mode:"standard"} intent unchanged', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ scale: 4, mode: 'standard' }))
      .toEqual({ scale: 4, mode: 'standard' });
  });

  it('returns null for an out-of-enum scale (e.g. 3)', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ scale: 3, mode: 'ai' })).toBeNull();
  });

  it('returns null for an out-of-enum mode', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ scale: 2, mode: 'x' })).toBeNull();
  });

  it('returns null when scale is missing', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ mode: 'ai' })).toBeNull();
  });

  it('returns null when mode is missing', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent({ scale: 2 })).toBeNull();
  });

  it('returns null for a structurally-corrupt (non-object) value', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent('not-an-object')).toBeNull();
    expect(editPersistenceService.validateBakedUpscaleIntent(42)).toBeNull();
    expect(editPersistenceService.validateBakedUpscaleIntent(['x'])).toBeNull();
  });

  it('returns null for an absent (undefined/null) value', () => {
    expect(editPersistenceService.validateBakedUpscaleIntent(undefined)).toBeNull();
    expect(editPersistenceService.validateBakedUpscaleIntent(null)).toBeNull();
  });
});
