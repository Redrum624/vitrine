import { imageService } from './ImageService';
import { editPersistenceService } from './EditPersistenceService';
import { exportService, ExportOptions } from './ExportService';
import { suffixedName, baseNameOf } from '../utils/exportFilename';
import { logger } from '../utils/Logger';

export interface MultiExportSummary {
  /** Output filenames that were written successfully. */
  exported: string[];
  /** Images that failed, with the error message. */
  failed: { path: string; error: string }[];
  /**
   * Base names of images whose saved state carried an unapplied upscale intent (Q7). Batch export
   * re-derives edits per image but does NOT re-run the (multi-second, per-image) upscale bake — so
   * these exported at native resolution. Surfaced in the completion toast so the loss is never
   * silent; the user opens each and re-applies to export upscaled.
   */
  upscaleSkipped: string[];
}

export interface MultiExportControls {
  /** Destination folder all files are written into. */
  outputDirectory: string;
  /** Called before each image with the 0-based index and the image's base name. */
  onProgress: (current: number, currentName: string) => void;
  /** Polled before each image; return true to stop after the current one. */
  isCancelled: () => boolean;
}

const extForFormat = (format?: string): string => (format === 'jpeg' ? 'jpg' : format ?? 'jpg');

const joinPath = (dir: string, name: string): string => `${dir.replace(/[/\\]+$/, '')}/${name}`;

/**
 * Exports many images with shared settings, applying EACH image's own persisted
 * edits. The pipeline is a singleton holding one image's edits at a time, so this
 * runs strictly sequentially and, per image, resets the modules then restores that
 * image's saved edits before processing. The editor's pre-export state is snapshotted
 * up front and restored in `finally` so the canvas is left untouched (the caller
 * should trigger a reprocess afterward).
 */
class MultiExportService {
  async exportMany(
    paths: string[],
    options: Partial<ExportOptions>,
    controls: MultiExportControls,
  ): Promise<MultiExportSummary> {
    const { outputDirectory, onProgress, isCancelled } = controls;
    const summary: MultiExportSummary = { exported: [], failed: [], upscaleSkipped: [] };
    const emitted = new Set<string>(); // lowercased names already chosen this run
    const ext = extForFormat(options.format);

    // Persist the current image's unsaved edits, then snapshot the live editor state.
    editPersistenceService.flush();
    const snapshot = editPersistenceService.serialize();
    const current = imageService.getCurrentImage();
    const pipeline = imageService.getProcessingPipeline();

    try {
      for (let i = 0; i < paths.length; i++) {
        if (isCancelled()) break;
        const path = paths[i];
        onProgress(i, baseNameOf(path));

        try {
          const img = await imageService.loadImageForExport(path);

          // Apply THIS image's saved edits. Reset first so an image with no saved
          // edits exports cleanly instead of inheriting the previous image's edits.
          // Fetch the state explicitly (instead of restoreForPath) so we can detect an unapplied
          // upscale intent from the SAME read used to restore — no extra IPC (Q7).
          const savedState = await editPersistenceService.getSavedEditState(path);
          pipeline?.resetAllModules();
          editPersistenceService.restoreState(savedState, img.width, img.height, path);
          // Z1: an unapplied durable upscale OR deblur intent means this image exports on its
          // pre-bake base — record it so the completion toast never silently drops the enhancement.
          if (savedState?.bakedUpscale || savedState?.bakedDeblur) summary.upscaleSkipped.push(baseNameOf(path));

          // Process at full resolution on the main thread (matches ExportDialog).
          // cacheResults=false keeps full-res module results out of the pipeline cache.
          let data: Float32Array = img.data;
          let width = img.width;
          let height = img.height;
          if (pipeline) {
            const context = { width: img.width, height: img.height, channels: 4 };
            const processed = await pipeline.processImage(img.data, context, { useWebWorkers: false, cacheResults: false });
            if (processed && typeof processed === 'object' && 'data' in processed) {
              const p = processed as unknown as { data: Float32Array; width: number; height: number };
              data = p.data;
              width = p.width;
              height = p.height;
            } else if (processed instanceof Float32Array) {
              data = processed;
            }
          }

          // Resolve a non-clobbering output name: <base>_PEP.<ext>, then _PEP_1, …
          let index = 0;
          let name = suffixedName(baseNameOf(path), ext, index);
          while (emitted.has(name.toLowerCase()) || (await this.fileExists(joinPath(outputDirectory, name)))) {
            index++;
            name = suffixedName(baseNameOf(path), ext, index);
          }
          emitted.add(name.toLowerCase());

          const result = await exportService.exportImage(
            data,
            width,
            height,
            { ...options, outputDirectory, filename: name },
            path,
          );

          if (result.success) summary.exported.push(name);
          else summary.failed.push({ path, error: result.error ?? 'Unknown export error' });
        } catch (e) {
          summary.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
        }
      }
      onProgress(paths.length, '');
    } finally {
      // Restore the editor to its pre-export state (caller triggers a reprocess).
      if (current) {
        pipeline?.resetAllModules();
        editPersistenceService.restore(snapshot, current.width, current.height);
      }
    }

    return summary;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      return (await window.electronAPI?.fileExists?.(path)) ?? false;
    } catch (e) {
      logger.warn('fileExists check failed', e);
      return false;
    }
  }
}

export const multiExportService = new MultiExportService();
