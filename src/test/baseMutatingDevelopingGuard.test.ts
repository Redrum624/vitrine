/**
 * Final whole-branch review of the latency round, Critical #1: the guard rounds (L3 rounds
 * 1-2) gated the pixel-ANALYSIS actions, but the base-MUTATING handlers — rotate ×2, flip ×2,
 * Image/Canvas Size, and Enhance Upscale — still ran unguarded during the progressive-open
 * developing window. All of them bake into the base via
 * `imageService.updateCurrentImageData`, so during the ~5s window the background full-decode
 * swap (same generation/path/options — all three ImageService guards pass) silently replaces
 * the freshly transformed base with the un-transformed full decode: the edit un-does itself
 * seconds later. Worst case (Upscale): the swap clobbers the upscaled base while the
 * `bakedUpscale` marker stays set, so EditPersistenceService.flush() permanently
 * early-returns and ALL subsequent edits on that image silently stop persisting.
 *
 * These tests drive the REAL handlers — the module-level transform actions App.tsx exports
 * (dependency-injected like `openFolderFromDialog`, so no full-App render is needed) and the
 * real EnhanceService entry point — and assert the `guardDeveloping` contract established by
 * moduleAutoDevelopingGuard.test.tsx: while `developing` is true the action does NOT reach
 * `updateCurrentImageData` and DOES surface the info toast; once settled it proceeds.
 */
import {
  rotateCurrentImageCW,
  rotateCurrentImageCCW,
  flipCurrentImageHorizontal,
  flipCurrentImageVertical,
  resizeCurrentImage,
  TransformToasts,
} from '../App';
import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { notificationService } from '../services/NotificationService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

const mockCurrentImage = {
  data: new Float32Array(8 * 8 * 4).fill(0.5),
  width: 8,
  height: 8,
  filePath: 'C:/img/test.orf',
};

describe('base-mutating actions respect the developing window (final review, critical #1)', () => {
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    updateSpy = jest.spyOn(imageService, 'updateCurrentImageData').mockImplementation(() => {});
    jest.spyOn(imageService, 'getCurrentImage')
      .mockReturnValue(mockCurrentImage as unknown as ReturnType<typeof imageService.getCurrentImage>);
    useAppStore.getState().setDeveloping(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useAppStore.getState().setDeveloping(false);
  });

  const makeToasts = (): TransformToasts & { showInfo: jest.Mock; showSuccess: jest.Mock } => ({
    showInfo: jest.fn(),
    showSuccess: jest.fn(),
  });

  const transformCases: Array<[string, (t: TransformToasts) => void, string]> = [
    ['rotate CW', (t) => rotateCurrentImageCW(t), 'Rotate'],
    ['rotate CCW', (t) => rotateCurrentImageCCW(t), 'Rotate'],
    ['flip horizontal', (t) => flipCurrentImageHorizontal(t), 'Flip'],
    ['flip vertical', (t) => flipCurrentImageVertical(t), 'Flip'],
    ['image resize', (t) => resizeCurrentImage(t, 4, 4), 'Image Size'],
  ];

  it.each(transformCases)('%s: blocked + info toast while developing (base never mutated)', (_name, run, action) => {
    useAppStore.getState().setDeveloping(true);
    const toasts = makeToasts();

    run(toasts);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(toasts.showInfo).toHaveBeenCalledWith(action, expect.stringMatching(/developing/i));
    expect(toasts.showSuccess).not.toHaveBeenCalled();
  });

  it.each(transformCases)('%s: proceeds once developing settles', (_name, run) => {
    const toasts = makeToasts();

    run(toasts);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(toasts.showSuccess).toHaveBeenCalled();
    expect(toasts.showInfo).not.toHaveBeenCalled();
  });

  describe('EnhanceService.applyUpscale (service-level gate — single choke point)', () => {
    it('blocked + info toast while developing; never reads the base or mutates it', async () => {
      useAppStore.getState().setDeveloping(true);
      const infoSpy = jest.spyOn(notificationService, 'info').mockImplementation(() => 'id');
      const origSpy = jest.spyOn(imageService, 'getOriginalImage')
        .mockReturnValue(null as unknown as ReturnType<typeof imageService.getOriginalImage>);

      await expect(
        enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, enabled: true, upscale: true, scale: 2 }),
      ).resolves.toBeUndefined();

      expect(infoSpy).toHaveBeenCalledWith('Enhance Upscale', expect.stringMatching(/developing/i));
      expect(origSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('proceeds past the gate once developing settles (reaches the no-image check)', async () => {
      const infoSpy = jest.spyOn(notificationService, 'info').mockImplementation(() => 'id');
      jest.spyOn(imageService, 'getOriginalImage')
        .mockReturnValue(null as unknown as ReturnType<typeof imageService.getOriginalImage>);

      await expect(
        enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, enabled: true, upscale: true, scale: 2 }),
      ).rejects.toThrow('No image loaded');

      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});
