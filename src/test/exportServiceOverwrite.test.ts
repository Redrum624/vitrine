/**
 * v1.40.0: ExportService honours overwritePolicy ('replace' -> exact path, default -> _VIT_N)
 * and BatchProcessingService presets no longer default to Adobe RGB.
 */
import { exportService } from '../services/ExportService';
import { batchProcessingService } from '../services/BatchProcessingService';

describe('batch presets colour space', () => {
  it('no batch preset defaults to adobergb', () => {
    for (const p of batchProcessingService.getPresets()) {
      expect(p.exportOptions.colorSpace).not.toBe('adobergb');
    }
    expect(batchProcessingService.getPreset('print_batch')?.exportOptions.colorSpace).toBe('srgb');
  });
});

describe('ExportService overwritePolicy', () => {
  const run = async (policy?: 'replace' | 'keepBoth') => {
    jest.spyOn(exportService as never, 'createImageFile' as never).mockResolvedValue(undefined as never);
    jest.spyOn(exportService as never, 'getFileSize' as never).mockResolvedValue(1 as never);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      fileExists: async (p: string) => p === 'C:/out/photo_VIT.jpg',
    };
    return exportService.exportImage(
      new Float32Array(2 * 2 * 4), 2, 2,
      { format: 'jpeg', colorSpace: 'srgb', bitDepth: 8, outputDirectory: 'C:/out', overwritePolicy: policy },
      'C:\\p\\photo.ORF',
    );
  };
  afterEach(() => {
    jest.restoreAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('replace writes the exact existing path', async () => {
    expect((await run('replace')).outputPath).toBe('C:/out/photo_VIT.jpg');
  });
  it('keepBoth (and default) write _VIT_1', async () => {
    expect((await run('keepBoth')).outputPath).toBe('C:/out/photo_VIT_1.jpg');
    expect((await run()).outputPath).toBe('C:/out/photo_VIT_1.jpg');
  });
});
