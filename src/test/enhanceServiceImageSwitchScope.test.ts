/**
 * Round-4 re-review finding: EnhanceService.restoreStack survived image switches, so revert()
 * — itself base-MUTATING via imageService.updateCurrentImageData — could restore ANOTHER image's
 * pre-upscale pixels (and edit state) as the working image after a switch. This suite pins two
 * guarantees:
 *   (a) switching the working image (a fresh ImageService.loadImage OR clearImage) drops the
 *       revert stack, so canRevert() is false for the new image; and
 *   (b) revert() during the progressive-open `developing` window is blocked with the standard
 *       info toast and never reaches updateCurrentImageData (mirrors applyUpscale's service-level
 *       gate, baseMutatingDevelopingGuard.test.ts).
 *
 * ImageService is REAL here (so its loadImage/clearImage choke points fire the image-switch hook
 * EnhanceService registers at module load); only the heavy enhance-only collaborators are mocked.
 * Decode IPC is stubbed via window.electronAPI, matching imageServiceLazyOriginalSnapshot.test.ts.
 */
jest.mock('../services/ImageProcessingPipeline', () => ({
  ImageProcessingPipeline: class {},
  imageProcessingPipeline: {
    processImage: jest.fn(async (d: Float32Array) => d),
    resetAllModules: jest.fn(),
    getModule: jest.fn(() => undefined),
  },
}));
jest.mock('../services/EnhanceWorkerClient', () => ({ enhanceWorkerClient: {
  run: jest.fn(async () => ({ enhanced: new Float32Array(8 * 8 * 4).fill(0.5), base: new Float32Array(8 * 8 * 4).fill(0.5), width: 8, height: 8 })),
} }));
jest.mock('../services/AiUpscaleClient', () => ({ aiUpscaleClient: {
  isAvailable: jest.fn(async () => false), run: jest.fn(),
} }));
jest.mock('../services/CheckpointService', () => ({ checkpointService: {
  record: jest.fn(), recordLabeled: jest.fn(), setBakeBridge: jest.fn(),
} }));
jest.mock('../services/EditPersistenceService', () => ({ editPersistenceService: {
  serialize: jest.fn(() => ({})), restore: jest.fn(), persistBakedUpscaleIntent: jest.fn(), persistNow: jest.fn(),
} }));

import { enhanceService } from '../services/EnhanceService';
import { imageService } from '../services/ImageService';
import { imageCacheService } from '../services/ImageCacheService';
import { notificationService } from '../services/NotificationService';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

// A native-decode IPC payload: 4×2, 3-channel, 16-bit, every pixel set to `fill`.
const makeDecodePayload = (fill: number) => {
  const px = new Uint16Array(4 * 2 * 3).fill(fill);
  return { data: px.buffer.slice(0), width: 4, height: 2, channels: 3, bitDepth: 16 };
};

const upscale2x = () =>
  enhanceService.applyUpscale({ ...DEFAULT_ENHANCE_PARAMS, upscale: true, scale: 2 });

beforeEach(() => {
  imageCacheService.clear();
  imageService.clearImage(); // also drops any leftover revert stack via the switch hook
  useAppStore.getState().setDeveloping(false);
  useAppStore.getState().setRawDecodeOptions(DEFAULT_RAW_DECODE_OPTIONS);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    decodeRawFile: jest.fn().mockImplementation(async () => makeDecodePayload(16384)),
    storeGet: jest.fn(),
    storeSet: jest.fn(),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  imageCacheService.clear();
  imageService.clearImage();
  useAppStore.getState().setDeveloping(false);
});

describe('EnhanceService — revert stack is scoped per image (round-4 re-review finding)', () => {
  it('drops the revert stack on a fresh loadImage, so canRevert() is false for the new image', async () => {
    await imageService.loadImage('/photo.orf');
    await upscale2x();
    expect(enhanceService.canRevert()).toBe(true);

    await imageService.loadImage('/other.orf'); // image switch
    expect(enhanceService.canRevert()).toBe(false);
  });

  it('drops the revert stack on clearImage', async () => {
    await imageService.loadImage('/photo.orf');
    await upscale2x();
    expect(enhanceService.canRevert()).toBe(true);

    imageService.clearImage();
    expect(enhanceService.canRevert()).toBe(false);
  });
});

describe('EnhanceService.revert respects the developing window', () => {
  it('blocked + info toast while developing; never calls updateCurrentImageData; stack untouched', async () => {
    await imageService.loadImage('/photo.orf');
    await upscale2x();
    expect(enhanceService.canRevert()).toBe(true);

    useAppStore.getState().setDeveloping(true);
    const infoSpy = jest.spyOn(notificationService, 'info').mockImplementation(() => 'id');
    const updateSpy = jest.spyOn(imageService, 'updateCurrentImageData');

    enhanceService.revert();

    expect(infoSpy).toHaveBeenCalledWith('Enhance Revert', expect.stringMatching(/developing/i));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(enhanceService.canRevert()).toBe(true); // stack retained — retryable once settled
  });

  it('proceeds once developing settles: restores the pre-upscale base and empties the stack', async () => {
    await imageService.loadImage('/photo.orf');
    await upscale2x();

    const infoSpy = jest.spyOn(notificationService, 'info').mockImplementation(() => 'id');
    const updateSpy = jest.spyOn(imageService, 'updateCurrentImageData');

    enhanceService.revert();

    expect(infoSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(expect.any(Float32Array), 4, 2); // native pre-upscale dims
    expect(enhanceService.canRevert()).toBe(false);
  });
});
