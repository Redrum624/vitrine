import { resolveExportSource } from '../components/Dialogs/resolveExportSource';

// ---- mock imageService ----
const mockIsBakedUpscaleActive = jest.fn<boolean, []>();
const mockIsBakedDeblurActive = jest.fn<boolean, []>();
const mockGetCurrentImage = jest.fn();
const mockLoadImageForExport = jest.fn();

jest.mock('../services/ImageService', () => ({
  imageService: {
    isBakedUpscaleActive: (...args: unknown[]) => mockIsBakedUpscaleActive(...(args as [])),
    isBakedDeblurActive: (...args: unknown[]) => mockIsBakedDeblurActive(...(args as [])),
    getCurrentImage: (...args: unknown[]) => mockGetCurrentImage(...args),
    loadImageForExport: (...args: unknown[]) => mockLoadImageForExport(...args),
  },
}));

describe('resolveExportSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsBakedDeblurActive.mockReturnValue(false);
  });

  it('returns the baked buffer and dims when upscale is active — does NOT call loadImageForExport', async () => {
    const bakedData = new Float32Array([1, 2, 3, 4]);
    mockIsBakedUpscaleActive.mockReturnValue(true);
    mockGetCurrentImage.mockReturnValue({
      data: bakedData,
      width: 400,
      height: 200,
      fileName: 'shot.orf',
      filePath: '/shots/shot.orf',
    });

    const result = await resolveExportSource('/shots/shot.orf');

    expect(result.data).toBe(bakedData);
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
    expect(mockLoadImageForExport).not.toHaveBeenCalled();
  });

  it('returns the baked buffer (native dims) when motion-deblur is active — does NOT re-decode', async () => {
    const bakedData = new Float32Array([1, 2, 3, 4]);
    mockIsBakedUpscaleActive.mockReturnValue(false);
    mockIsBakedDeblurActive.mockReturnValue(true);
    mockGetCurrentImage.mockReturnValue({ data: bakedData, width: 400, height: 200, filePath: '/shots/shot.orf' });

    const result = await resolveExportSource('/shots/shot.orf');

    expect(result.data).toBe(bakedData);
    expect(result.width).toBe(400);
    expect(mockLoadImageForExport).not.toHaveBeenCalled();
  });

  it('calls loadImageForExport and returns its result when no baked upscale is active', async () => {
    const fileData = new Float32Array([5, 6, 7, 8]);
    mockIsBakedUpscaleActive.mockReturnValue(false);
    mockLoadImageForExport.mockResolvedValue({
      data: fileData,
      width: 200,
      height: 100,
      fileName: 'shot.jpg',
      filePath: '/shots/shot.jpg',
    });

    const result = await resolveExportSource('/shots/shot.jpg');

    expect(mockLoadImageForExport).toHaveBeenCalledWith('/shots/shot.jpg');
    expect(result.data).toBe(fileData);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('falls through to loadImageForExport if baked is active but getCurrentImage returns null', async () => {
    const fileData = new Float32Array([9, 10, 11, 12]);
    mockIsBakedUpscaleActive.mockReturnValue(true);
    mockGetCurrentImage.mockReturnValue(null);
    mockLoadImageForExport.mockResolvedValue({
      data: fileData,
      width: 100,
      height: 50,
      fileName: 'shot.orf',
      filePath: '/shots/shot.orf',
    });

    const result = await resolveExportSource('/shots/shot.orf');

    expect(mockLoadImageForExport).toHaveBeenCalledWith('/shots/shot.orf');
    expect(result.data).toBe(fileData);
  });
});
