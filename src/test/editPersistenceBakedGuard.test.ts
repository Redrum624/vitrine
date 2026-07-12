import { editPersistenceService } from '../services/EditPersistenceService';
import { imageService } from '../services/ImageService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

jest.mock('../services/ImageService');

describe('EditPersistenceService – Baked upscale guard', () => {
  const mockImageService = imageService as jest.Mocked<typeof imageService>;
  let storeSetMock: jest.Mock;

  beforeEach(() => {
    // Mock window.electronAPI.storeSet
    storeSetMock = jest.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      storeSet: storeSetMock,
      storeGet: jest.fn(),
    };

    // Default: not baked, image exists
    mockImageService.getCurrentImage.mockReturnValue({
      filePath: '/test/image.jpg',
      url: 'blob:...',
      width: 100,
      height: 100,
      bitDepth: 8,
    } as unknown as ReturnType<typeof imageService.getCurrentImage>);
    mockImageService.isBakedUpscaleActive.mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
    imageProcessingPipeline.resetAllModules();
  });

  it('does NOT persist edits when a baked upscale is active', () => {
    // Arrange: make an edit and set baseline (simulating a loaded image)
    const basicadj = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
    editPersistenceService.serialize(); // seed baseline
    basicadj.setParams({ exposure: 0.5 });

    // Act: with baked upscale active
    mockImageService.isBakedUpscaleActive.mockReturnValue(true);
    editPersistenceService.flush();

    // Assert: storeSet was NOT called
    expect(storeSetMock).not.toHaveBeenCalled();
  });

  it('persists edits normally when baked upscale is NOT active', () => {
    // Arrange: make an edit and set baseline
    const basicadj = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
    editPersistenceService.serialize(); // seed baseline
    basicadj.setParams({ exposure: 0.5 });

    // Act: with baked upscale NOT active
    mockImageService.isBakedUpscaleActive.mockReturnValue(false);
    editPersistenceService.flush();

    // Assert: storeSet WAS called (edit persisted)
    expect(storeSetMock).toHaveBeenCalledTimes(1);
    expect(storeSetMock).toHaveBeenCalledWith(
      'edits:/test/image.jpg',
      expect.objectContaining({ version: 1 })
    );
  });

  it('does NOT persist when baked even if state differs from baseline', () => {
    // Arrange: make multiple edits
    const basicadj = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
    basicadj.setParams({ exposure: 0.3 });
    editPersistenceService.serialize(); // seed baseline
    basicadj.setParams({ exposure: 0.7 }); // change state

    // Act: with baked upscale active
    mockImageService.isBakedUpscaleActive.mockReturnValue(true);
    editPersistenceService.flush();

    // Assert: storeSet was NOT called, even though state differs
    expect(storeSetMock).not.toHaveBeenCalled();
  });

  it('still skips persist if state is unchanged (baseline-diff check)', async () => {
    // Arrange: initialize baseline properly via restoreForPath (no edits after this)
    await editPersistenceService.restoreForPath('/test/image.jpg', 100, 100);

    // Act: with baked upscale NOT active
    mockImageService.isBakedUpscaleActive.mockReturnValue(false);
    editPersistenceService.flush();

    // Assert: storeSet was NOT called (baseline-diff check still applies)
    expect(storeSetMock).not.toHaveBeenCalled();
  });
});
