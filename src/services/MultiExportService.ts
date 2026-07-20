import { imageService } from './ImageService';
import { editPersistenceService } from './EditPersistenceService';
import { exportService, ExportOptions } from './ExportService';
import { decideExportProcessing } from './exportRouting';
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

/** Decoded source + saved edits for one image — the unit the decode-ahead stage produces. */
interface DecodedForExport {
  img: { width: number; height: number; data: Float32Array };
  savedState: Awaited<ReturnType<typeof editPersistenceService.getSavedEditState>>;
}

/**
 * Exports many images with shared settings, applying EACH image's own persisted
 * edits. The pipeline is a singleton holding one image's edits at a time, so the
 * PROCESSING stage runs strictly sequentially and, per image, resets the modules then
 * restores that image's saved edits before processing. The editor's pre-export state is
 * snapshotted up front and restored in `finally` so the canvas is left untouched (the
 * caller should trigger a reprocess afterward).
 *
 * Batch pipelining (2026-07-20 export-speed task): the per-photo stages overlap in a
 * bounded 2-deep pipeline —
 *   - DECODE-AHEAD: while photo N processes, photo N+1's decode + saved-state read runs
 *     (decode never touches module state, so it is safe alongside processing).
 *   - ENCODE OVERLAP: photo N's sharp encode/write (main process) is fired and TRACKED,
 *     not awaited — photo N+1 decodes and processes while it writes. At most ONE encode
 *     is in flight (awaited before the next fires), and its result is recorded against
 *     the right photo, so per-photo status stays accurate.
 * Peak memory is bounded: 1 encoding buffer + at most 2 full-res working buffers
 * (decode-ahead input + processing output), matching the pre-existing envelope +1 buffer.
 *
 * NOTE on ordering: photo N+1's edits are restored ONLY after photo N's processImage has
 * resolved. The worker route snapshots module params synchronously at call time, but its
 * internal main-thread FALLBACK (worker crash mid-flight) re-reads live module state —
 * restoring N+1's edits during N's processing would let that fallback process N with
 * N+1's edits. Do not "optimize" the restore into the decode-ahead stage.
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

    const decodeAhead = (path: string): Promise<DecodedForExport> => (async () => ({
      img: await imageService.loadImageForExport(path),
      // Fetch the state explicitly (instead of restoreForPath) so we can detect an unapplied
      // upscale intent from the SAME read used to restore — no extra IPC (Q7).
      savedState: await editPersistenceService.getSavedEditState(path),
    }))();

    // Decode-ahead slot (≤1 deep) and the tracked in-flight encode (≤1 deep; never rejects —
    // its outcome is recorded into `summary` inside the wrapper).
    let next: { path: string; promise: Promise<DecodedForExport> } | null =
      paths.length > 0 ? { path: paths[0], promise: decodeAhead(paths[0]) } : null;
    let pendingEncode: Promise<void> | null = null;

    try {
      for (let i = 0; i < paths.length; i++) {
        if (isCancelled()) break;
        const path = paths[i];
        onProgress(i, baseNameOf(path));

        try {
          // Consume the decode-ahead result when it matches this photo (it always does in the
          // happy path; after a decode failure the slot is empty and we decode inline).
          const cur = next && next.path === path ? next.promise : decodeAhead(path);
          next = null;
          const { img, savedState } = await cur;
          // Kick off the NEXT photo's decode while THIS one processes (bounded: one ahead).
          if (i + 1 < paths.length && !isCancelled()) {
            next = { path: paths[i + 1], promise: decodeAhead(paths[i + 1]) };
          }

          // Apply THIS image's saved edits. Reset first so an image with no saved
          // edits exports cleanly instead of inheriting the previous image's edits.
          pipeline?.resetAllModules();
          editPersistenceService.restoreState(savedState, img.width, img.height, path);
          // Z1: an unapplied durable upscale OR deblur intent means this image exports on its
          // pre-bake base — record it so the completion toast never silently drops the enhancement.
          if (savedState?.bakedUpscale || savedState?.bakedDeblur) summary.upscaleSkipped.push(baseNameOf(path));

          // Process at full resolution — through the worker pool when it is healthy and the
          // routing rules allow (see exportRouting.ts), else on the main thread exactly as
          // before. cacheResults=false keeps full-res module results out of the pipeline cache.
          let data: Float32Array = img.data;
          let width = img.width;
          let height = img.height;
          if (pipeline) {
            const context = { width: img.width, height: img.height, channels: 4, isExport: true };
            const route = decideExportProcessing(pipeline, img.width, img.height);
            logger.info(`[MultiExport] ${baseNameOf(path)}: processing route ${route.useWebWorkers ? 'worker' : 'main'} (${route.reason})`);
            const processed = await pipeline.processImage(img.data, context, { useWebWorkers: route.useWebWorkers, cacheResults: false });
            if (processed && typeof processed === 'object' && 'data' in processed) {
              const p = processed as unknown as { data: Float32Array; width: number; height: number };
              data = p.data;
              width = p.width;
              height = p.height;
            } else if (processed instanceof Float32Array) {
              data = processed;
              // Context dims, not img dims — an active crop mutates
              // context.width/height and returns a smaller buffer (same
              // corruption class as the single-export fix in ExportDialog).
              // The worker route ALSO writes its true output dims back into
              // this context (ImageProcessingPipeline.processWithWebWorkers).
              width = context.width;
              height = context.height;
            }
          }

          // Resolve a non-clobbering output name: <base>_VIT.<ext>, then _VIT_1, …
          // `emitted` covers names chosen this run whose files may still be encoding.
          let index = 0;
          let name = suffixedName(baseNameOf(path), ext, index);
          while (emitted.has(name.toLowerCase()) || (await this.fileExists(joinPath(outputDirectory, name)))) {
            index++;
            name = suffixedName(baseNameOf(path), ext, index);
          }
          emitted.add(name.toLowerCase());

          // ≤1 encode in flight: wait out the PREVIOUS photo's write, then fire this one and
          // move on — the next photo decodes/processes while sharp encodes this buffer.
          if (pendingEncode) await pendingEncode;
          pendingEncode = (async () => {
            try {
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
          })();
        } catch (e) {
          summary.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (pendingEncode) {
        await pendingEncode;
        pendingEncode = null;
      }
      onProgress(paths.length, '');
    } finally {
      // Belt-and-braces: if an exception skipped the drain above, settle the tracked encode
      // (it never rejects) and silence an abandoned decode-ahead so it can't surface as an
      // unhandled rejection after cancellation/errors.
      if (pendingEncode) await pendingEncode;
      if (next) next.promise.catch(() => { /* abandoned decode-ahead */ });
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
