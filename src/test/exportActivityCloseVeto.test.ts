/**
 * Final-review fix 2 (renderer side): while ANY export runs (single, multi, batch) the
 * renderer refuses an app close with reason 'export-in-progress' — quitting would kill the
 * export mid-write (truncated file; under "Replace" the original is lost).
 */
const sendCloseResponse = jest.fn();
jest.mock('../services/ElectronService', () => ({
  electronService: { sendCloseResponse, cleanup: jest.fn() },
}));
const warning = jest.fn();
jest.mock('../services/NotificationService', () => ({
  notificationService: { warning, success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { beginExport, trackExport, isExportInProgress } from '../services/exportActivity';
import { appLifecycleService } from '../services/AppLifecycleService';
import { exportService } from '../services/ExportService';
import { batchProcessingService } from '../services/BatchProcessingService';
import { imageService } from '../services/ImageService';
import type { ImageFileInfo } from '../services/FileSystemService';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  jest.restoreAllMocks();
  sendCloseResponse.mockClear();
  warning.mockClear();
});

describe('exportActivity counter', () => {
  it('nests, and each end is idempotent', () => {
    expect(isExportInProgress()).toBe(false);
    const a = beginExport();
    const b = beginExport();
    a(); a();
    expect(isExportInProgress()).toBe(true);
    b();
    expect(isExportInProgress()).toBe(false);
  });
  it('trackExport releases on throw', async () => {
    await expect(trackExport(async () => { expect(isExportInProgress()).toBe(true); throw new Error('x'); })).rejects.toThrow('x');
    expect(isExportInProgress()).toBe(false);
  });
});

describe('AppLifecycleService close veto', () => {
  it('refuses with export-in-progress while an export runs, without opening a dialog', async () => {
    const end = beginExport();
    window.dispatchEvent(new CustomEvent('electron-app-close-request'));
    await flush();
    expect(sendCloseResponse).toHaveBeenCalledWith(false, 'export-in-progress');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(warning).toHaveBeenCalled();
    end();
    window.dispatchEvent(new CustomEvent('electron-app-close-request'));
    await flush();
    expect(sendCloseResponse).toHaveBeenLastCalledWith(true, expect.any(String));
    expect(appLifecycleService.isAppClosing()).toBe(false);
  });
});

describe('export paths register as in progress', () => {
  it('ExportService.exportImage is in progress while it writes the file', async () => {
    let during: boolean | undefined;
    jest.spyOn(exportService as never, 'createImageFile' as never).mockImplementation((async () => { during = isExportInProgress(); }) as never);
    jest.spyOn(exportService as never, 'getFileSize' as never).mockResolvedValue(1 as never);
    (window as unknown as { electronAPI: unknown }).electronAPI = { fileExists: async () => false };
    await exportService.exportImage(new Float32Array(16), 2, 2, { format: 'jpeg', colorSpace: 'srgb', bitDepth: 8, outputDirectory: 'C:/out' }, 'C:/p/a.jpg');
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(during).toBe(true);
    expect(isExportInProgress()).toBe(false);
  });

  it('a batch job is in progress while it runs', async () => {
    let during: boolean | undefined;
    jest.spyOn(imageService, 'decodeForExport').mockImplementation(async () => { during = isExportInProgress(); throw new Error('decode failed'); });
    const img = { id: 'a', path: 'C:/p/a.jpg', name: 'a.jpg' } as unknown as ImageFileInfo;
    const jobId = batchProcessingService.createJobFromPreset(batchProcessingService.getPresets()[0].id, 'j', [img])!;
    await batchProcessingService.startBatchJob(jobId);
    for (let i = 0; i < 20 && during === undefined; i++) await flush();
    await new Promise((r) => setTimeout(r, 100));
    expect(during).toBe(true);
    expect(isExportInProgress()).toBe(false);
  });
});
