import { logger } from '../utils/Logger';
import { rawImageService, RawImageData } from './RawImageService';
import { ValidationService } from './ValidationService';
import { errorHandlingService } from './ErrorHandlingService';
import { imageCacheService } from './ImageCacheService';
import { canvasPoolService } from './CanvasPoolService';
import { autoRawAdjustmentService, RAWDetectionResult } from './AutoRawAdjustmentService';
import { ImageProcessingPipeline } from './ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import { editPersistenceService } from './EditPersistenceService';
import { DEFAULT_RAW_DECODE_OPTIONS, RawDecodeOptions } from '../types/electron';

export interface ImageData {
  width: number;
  height: number;
  data: Float32Array;
  fileName: string;
  filePath: string;
  isRaw?: boolean;
  metadata?: Record<string, unknown>;
  autoAdjustmentResult?: RAWDetectionResult;
}

export interface BakedUpscaleInfo {
  scale: number;
  nativeWidth: number;
  nativeHeight: number;
}

export class ImageService {
  private static instance: ImageService;
  private currentImage: ImageData | null = null;
  private originalImageData: { data: Float32Array; width: number; height: number } | null = null;
  private imageLoadListeners: (() => void)[] = [];
  private processingPipeline: ImageProcessingPipeline | null = null;
  private loadGeneration = 0;
  private bakedUpscale: BakedUpscaleInfo | null = null;

  static getInstance(): ImageService {
    if (!ImageService.instance) {
      ImageService.instance = new ImageService();
    }
    return ImageService.instance;
  }

  addImageLoadListener(callback: () => void): () => void {
    this.imageLoadListeners.push(callback);
    // Return cleanup function
    return () => {
      const index = this.imageLoadListeners.indexOf(callback);
      if (index > -1) {
        this.imageLoadListeners.splice(index, 1);
      }
    };
  }

  setProcessingPipeline(pipeline: ImageProcessingPipeline): void {
    this.processingPipeline = pipeline;
  }

  getProcessingPipeline(): ImageProcessingPipeline | null {
    return this.processingPipeline;
  }

  private notifyImageLoaded(): void {
    this.imageLoadListeners.forEach(callback => {
      try {
        callback();
      } catch (error) {
        logger.error('Error in image load listener:', error);
      }
    });
  }

  /**
   * @param beforeNotify Optional synchronous hook fired right AFTER the base is decoded (so the
   *   real dimensions are known) but BEFORE notifyImageLoaded() runs — the load listeners that
   *   trigger the first pipeline pass. The open flow uses it to seed restored per-image edits so
   *   the first pass renders the edited image directly (no unedited-defaults flash, no double
   *   pass). Only fires when this decode is still current (the generation guard skips it for a
   *   superseded load, so it never seeds a stale image).
   *   In a progressive RAW open it fires on the fast PREVIEW render (real preview dims) — the
   *   restored edit geometry is normalized (0-1), so it re-bakes correctly when the full decode
   *   swaps in at full dims (see LocalAdjustmentsModule.processImage's resolution rebuild).
   * @param onFullDecode Optional — passing it OPTS INTO progressive RAW open (interactive editor
   *   only; batch/export omit it so they always get the full-resolution decode). Called with the
   *   TRUE (full-decode) dimensions once the background full decode has swapped the base in place,
   *   so the caller can upgrade any preview-dimension bookkeeping (e.g. the gallery tile's dims).
   */
  async loadImage(
    filePath: string,
    beforeNotify?: (result: ImageData) => void,
    onFullDecode?: (width: number, height: number) => void,
  ): Promise<ImageData> {
    const thisGeneration = ++this.loadGeneration;
    this.bakedUpscale = null; // Clear baked marker on any fresh image load
    // Reset the "Developing full quality…" affordance for EVERY new load — synchronously, before
    // any cache lookup or decode. Without this, switching away from a still-developing RAW (e.g.
    // to a warm/cached or non-RAW image) left the affordance stuck on forever: it was only ever
    // cleared by the PREVIOUS open's developFullDecode finally, which is generation-gated and
    // therefore skips clearing once a newer load has started (by design, so a newer open's own
    // flag isn't clobbered) — but nothing else was resetting it for the newer load. The cold-RAW
    // progressive-open branch below re-sets it true right after, if this load takes that path.
    useAppStore.getState().setDeveloping(false);

    const result = await errorHandlingService.withErrorHandling(
      async () => {
        // Validate file path
        const pathValidation = ValidationService.validateFilePath(filePath);
        if (!pathValidation.valid) {
          throw new Error(`Invalid file path: ${pathValidation.error}`);
        }

        logger.info(`Loading image from: ${filePath}`);

        // Check the session base cache first. A hit means this path was decoded earlier this
        // session (initial decode or RAW re-decode) — serve those pixels and skip the expensive
        // decode entirely. This lookup is synchronous and happens before any await, so no newer
        // load can have superseded us yet (the generation guard below covers the async decode path).
        const cacheEntry = imageCacheService.getBase(filePath);
        if (cacheEntry) {
          const result: ImageData = {
            width: cacheEntry.width,
            height: cacheEntry.height,
            // Copy so the working image never aliases the cache's buffer — matches the fresh-decode
            // invariant (currentImage.data is independent of the cached copy) and keeps an in-place
            // working-image mutation from ever corrupting the cached base pixels.
            data: new Float32Array(cacheEntry.data),
            fileName: filePath.split(/[/\\]/).pop() || 'unknown',
            filePath,
            isRaw: cacheEntry.metadata?.isRaw as boolean,
            metadata: cacheEntry.metadata,
            autoAdjustmentResult: cacheEntry.metadata?.autoAdjustmentResult as RAWDetectionResult | undefined
          };

          this.currentImage = result;
          // Snapshot the original for instant before/after comparison
          this.snapshotOriginal(result);
          logger.info(`Image loaded from base cache: ${result.width}x${result.height} - skipping decode`);
          // Seed restored per-image edits BEFORE notifying (so the first pass renders edited).
          // Guarded like notifyImageLoaded's listener loop: a throwing caller must not abort this
          // load or skip the notify below.
          try {
            beforeNotify?.(result);
          } catch (error) {
            logger.error('Error in beforeNotify (cache-hit path):', error);
          }
          // Behave like a fresh load minus the decode: notify listeners so the histogram/adjustment
          // panels reprocess. This notify is the single reprocess trigger for the open — the edits
          // (if any) are already applied by the hook above, so no second pass is needed.
          this.notifyImageLoaded();
          return result;
        }

        let result: ImageData;

        // Check if it's a RAW file
        if (rawImageService.isRawFile(filePath)) {
          logger.info('RAW file detected, using RAW processing with auto-adjustments');
          // Decode the base with the current image's decode options. The Canvas open flow sets
          // these from per-image persistence (or DEFAULT_RAW_DECODE_OPTIONS) BEFORE calling
          // loadImage, so the initial decode matches the user's last-chosen demosaic/highlights.
          const decodeOptions = useAppStore.getState().rawDecodeOptions;

          // PROGRESSIVE OPEN (interactive editor only — gated on onFullDecode + the preview IPC):
          // paint the camera's embedded-JPEG preview near-instantly, run the full 16-bit LibRaw
          // decode in the BACKGROUND, and swap the base in place when it lands. Time-to-first-image
          // drops from ~5s (full decode) to <1s (embedded preview). Batch/export omit onFullDecode,
          // so they always take the full-resolution path below.
          let rawData: RawImageData;
          if (onFullDecode && typeof window !== 'undefined' && window.electronAPI?.decodeRawPreview) {
            // Start the full decode NOW so the dcraw_emu subprocess overlaps the sharp preview
            // extraction (the subprocess doesn't block the main event loop).
            const fullPromise = rawImageService.loadRawImage(filePath, decodeOptions);
            fullPromise.catch(() => { /* handled in developFullDecode / below */ });

            let preview: RawImageData | null = null;
            try {
              preview = await rawImageService.loadRawPreview(filePath);
            } catch (previewError) {
              logger.warn('Embedded preview unavailable; opening via full decode', previewError);
            }

            if (preview && thisGeneration === this.loadGeneration) {
              const previewResult: ImageData = {
                width: preview.width,
                height: preview.height,
                data: preview.data,
                fileName: preview.fileName,
                filePath: preview.filePath,
                isRaw: true,
                metadata: preview.metadata,
              };
              // The preview is NOT written to the base cache — the cache must only ever hold the
              // full 16-bit decode (a reopen must never serve the low-res preview as the base).
              this.currentImage = previewResult;
              this.snapshotOriginal(previewResult);
              // Seed restored edits at PREVIEW dims (normalized geometry → re-bakes on the swap).
              try {
                beforeNotify?.(previewResult);
              } catch (error) {
                logger.error('Error in beforeNotify (progressive-preview path):', error);
              }
              this.notifyImageLoaded(); // FIRST PASS — edited preview on screen, fast
              useAppStore.getState().setDeveloping(true);
              // Background: await the full decode, then swap the base in place (guarded).
              void this.developFullDecode(filePath, thisGeneration, fullPromise, decodeOptions, onFullDecode);
              return previewResult;
            }

            // Preview failed or superseded: fall through with the SAME full promise (no double decode).
            rawData = await fullPromise;
          } else {
            rawData = await rawImageService.loadRawImage(filePath, decodeOptions);
          }

          // Validate dimensions
          const dimensionValidation = ValidationService.validateDimensions(rawData.width, rawData.height);
          if (!dimensionValidation.valid) {
            throw new Error(`Invalid image dimensions: ${dimensionValidation.error}`);
          }

          // Skip auto-adjustments when LibRaw successfully processes the file
          // LibRaw already provides properly processed RGB data with accurate colors
          let autoAdjustmentResult: RAWDetectionResult | undefined;

          // Check if this was processed by LibRaw (flag set by RawImageService)
          const isLibRawProcessed = (rawData as { isLibRawProcessed?: boolean }).isLibRawProcessed === true;

          if (isLibRawProcessed) {
            logger.info('LibRaw processed file detected, skipping all auto-adjustments to preserve accurate colors');
          } else if (this.processingPipeline) {
            // Only apply auto-adjustments for fallback processing methods
            try {
              autoAdjustmentResult = await autoRawAdjustmentService.detectAndApplyRAWAdjustments(
                filePath,
                this.processingPipeline
              );

              if (autoAdjustmentResult.isRAW && autoAdjustmentResult.confidence > 0.5) {
                logger.info(`Auto-adjustments applied for RAW file (fallback processing):`, {
                  camera: `${rawData.metadata.make} ${rawData.metadata.model}`,
                  adjustments: autoAdjustmentResult.reasoning
                });
              }
            } catch (autoAdjustError) {
              logger.warn('Failed to apply auto-adjustments, proceeding without:', autoAdjustError);
            }
          } else {
            logger.info('No processing pipeline available, skipping auto-adjustments');
          }

          result = {
            width: rawData.width,
            height: rawData.height,
            data: rawData.data,
            fileName: rawData.fileName,
            filePath: rawData.filePath,
            isRaw: true,
            metadata: rawData.metadata,
            autoAdjustmentResult
          };

          // Cache the decoded base under the size-agnostic base key so a reopen serves it
          // without re-running the (multi-second) LibRaw decode.
          imageCacheService.setBase(
            filePath,
            rawData.data,
            rawData.width,
            rawData.height,
            { isRaw: true, autoAdjustmentResult, ...rawData.metadata }
          );

          logger.info(`RAW image loaded successfully: ${result.width}x${result.height}`);
        } else {
          // Handle regular image files (double-check this is not a RAW file)
          if (rawImageService.isRawFile(filePath)) {
            throw new Error(`RAW file ${filePath} should not reach regular image loading path`);
          }
          result = await this.loadRegularImage(filePath);

          // Cache the decoded base under the size-agnostic base key so a reopen serves it
          // without re-reading/re-decoding the file.
          imageCacheService.setBase(
            filePath,
            result.data,
            result.width,
            result.height,
            { isRaw: false, ...result.metadata }
          );
        }

        // Guard against stale loads (user switched images during loading)
        if (thisGeneration !== this.loadGeneration) {
          logger.info('Image load superseded by newer request, discarding');
          return result;
        }

        this.currentImage = result;
        // Snapshot the original for instant before/after comparison
        this.snapshotOriginal(result);
        // Seed restored per-image edits BEFORE notifying, so the first pipeline pass triggered
        // by the load listeners renders the edited image directly (no unedited-defaults flash).
        try {
          beforeNotify?.(result);
        } catch (error) {
          logger.error('Error in beforeNotify (full-decode path):', error);
        }
        this.notifyImageLoaded();
        return result;
      },
      'ImageService.loadImage',
      'io'
    );

    if (!result) {
      throw new Error('Failed to load image');
    }

    return result;
  }

  /**
   * Background half of a progressive RAW open: await the full 16-bit LibRaw decode, then SWAP
   * it in for the fast embedded preview currently on screen — updating the base cache, the
   * before/after snapshot, and the working base (updateCurrentImageData bumps baseImageVersion
   * so the GPU re-uploads and reprocesses at full resolution; the restored edits, already in the
   * pipeline modules, re-apply — normalized mask geometry re-bakes at the full dims). Mirrors
   * RawImageService.reDecode's swap sequence and identity guard.
   *
   * All guards run BEFORE any mutation, so a superseded open never corrupts state or writes a
   * stale base to the cache:
   *  - generation: a newer loadImage() started → discard (that open owns the screen + affordance).
   *  - identity: the current image is no longer this path → discard.
   *  - decode-options: the user changed demosaic/highlight via the RAW Decode panel (reDecode)
   *    while we were decoding → discard, so this stale-options full decode never overwrites the
   *    reDecode's fresh base.
   */
  private async developFullDecode(
    filePath: string,
    generation: number,
    fullPromise: Promise<RawImageData>,
    decodeOptions: RawDecodeOptions,
    onFullDecode?: (width: number, height: number) => void,
  ): Promise<void> {
    try {
      const rawData = await fullPromise;

      if (generation !== this.loadGeneration) {
        logger.info(`Progressive full decode of ${filePath} discarded: superseded by a newer open`);
        return;
      }
      const stillCurrent = this.currentImage;
      if (!stillCurrent || stillCurrent.filePath !== filePath) {
        logger.info(`Progressive full decode of ${filePath} discarded: current image changed`);
        return;
      }
      const opts = useAppStore.getState().rawDecodeOptions;
      if (opts.demosaic !== decodeOptions.demosaic || opts.highlightMode !== decodeOptions.highlightMode) {
        logger.info(`Progressive full decode of ${filePath} discarded: decode options changed (re-decode superseded it)`);
        return;
      }

      const dimensionValidation = ValidationService.validateDimensions(rawData.width, rawData.height);
      if (!dimensionValidation.valid) {
        logger.warn(`Progressive full decode produced invalid dimensions: ${dimensionValidation.error}`);
        return;
      }

      // Swap the base to the full 16-bit decode. Base cache gets the FULL decode only.
      imageCacheService.setBase(
        filePath,
        rawData.data,
        rawData.width,
        rawData.height,
        { isRaw: true, autoAdjustmentResult: undefined, ...rawData.metadata },
      );
      this.processingPipeline?.clearCache(); // module results cached against preview dims are stale
      this.setOriginalImage(new Float32Array(rawData.data), rawData.width, rawData.height);
      // Replace the working base + bump baseImageVersion + notify → single reprocess at full dims.
      this.updateCurrentImageData(rawData.data, rawData.width, rawData.height);
      onFullDecode?.(rawData.width, rawData.height);
      logger.info(`Progressive open: full decode swapped in for ${filePath} (${rawData.width}x${rawData.height})`);
    } catch (error) {
      logger.error(`Progressive full decode failed for ${filePath}; keeping the preview`, error);
    } finally {
      // Only clear the affordance if THIS open still owns it (a newer open sets it true again).
      if (generation === this.loadGeneration) {
        useAppStore.getState().setDeveloping(false);
      }
    }
  }

  private async loadRegularImage(filePath: string): Promise<ImageData> {
    // Create an HTML image element to load the file
    const img = new Image();

    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          // Validate dimensions
          const dimensionValidation = ValidationService.validateDimensions(img.width, img.height);
          if (!dimensionValidation.valid) {
            reject(new Error(`Invalid image dimensions: ${dimensionValidation.error}`));
            return;
          }

          // Use canvas pool for memory efficiency
          const result = canvasPoolService.withCanvas(img.width, img.height, (_, ctx) => {
            // Draw image to canvas
            ctx.drawImage(img, 0, 0);

            // Get image data
            const imageData = ctx.getImageData(0, 0, img.width, img.height);

            // Convert to Float32Array for processing
            const floatData = new Float32Array(imageData.data.length);
            for (let i = 0; i < imageData.data.length; i++) {
              floatData[i] = imageData.data[i] / 255.0; // Normalize to 0-1
            }

            return {
              width: img.width,
              height: img.height,
              data: floatData,
              fileName: filePath.split(/[\\/]/).pop() || 'unknown',
              filePath: filePath,
              isRaw: false
            } as ImageData;
          });

          logger.info(`Regular image loaded successfully: ${result.width}x${result.height}`);
          resolve(result);
        } catch (error) {
          logger.error('Failed to process image data:', error);
          reject(error);
        }
      };

      img.onerror = () => {
        const error = new Error(`Failed to load image: ${filePath}`);
        logger.error('Image load error:', error);
        reject(error);
      };

      // Load the image using Electron's secure file reading for images
      if (typeof window !== 'undefined' && window.electronAPI) {
        // Electron environment - read as data URL
        window.electronAPI.readImageAsDataURL(filePath)
          .then((dataUrl: string) => {
            img.src = dataUrl;
          })
          .catch((error: Error) => {
            logger.error('Failed to read image file via Electron:', error);
            reject(error);
          });
      } else {
        // Browser environment - cannot load local files directly due to security restrictions
        const error = new Error('Cannot load local files in browser environment without proper file handling');
        logger.error('Browser security restriction:', error);
        reject(error);
      }
    });
  }

  getCurrentImage(): ImageData | null {
    return this.currentImage;
  }

  /**
   * Returns the pristine original image data as it was at load time.
   * Used for instant before/after comparison without re-reading from disk.
   */
  getOriginalImage(): { data: Float32Array; width: number; height: number } | null {
    return this.originalImageData;
  }

  /**
   * Take a deep copy of the image data at load time so comparisons are instant.
   * Runs asynchronously in a microtask to avoid blocking the initial render.
   */
  private snapshotOriginal(image: ImageData): void {
    // Use queueMicrotask so the copy doesn't block the first paint
    queueMicrotask(() => {
      this.originalImageData = {
        data: new Float32Array(image.data),
        width: image.width,
        height: image.height,
      };
      logger.info(`Original image snapshot cached: ${image.width}x${image.height} (${(image.data.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    });
  }

  /**
   * Overwrite the original snapshot used by getOriginalImage() for Before/After comparison.
   * Called by EnhanceService after an upscale so the "Before" side reflects the
   * clean-resize base at the new larger dimensions rather than the original load.
   */
  setOriginalImage(data: Float32Array, width: number, height: number): void {
    this.originalImageData = { data, width, height };
  }

  /**
   * Update the current image data with processed data.
   * Used when applying crop/transform changes permanently.
   */
  updateCurrentImageData(data: Float32Array, width: number, height: number): void {
    if (this.currentImage) {
      this.currentImage = {
        ...this.currentImage,
        data,
        width,
        height
      };
      logger.info(`Updated current image data: ${width}x${height}`);
      // The base pixels were replaced in place — path/dimensions may be unchanged
      // (a RAW re-decode changes neither), so signal consumers that cache off those
      // (e.g. the GPU resident-source upload) to refresh from the new pixels.
      useAppStore.getState().bumpBaseImageVersion();
      this.notifyImageLoaded();
    }
  }

  // Load image at full resolution for export (bypasses performance optimizations)
  async loadImageForExport(filePath: string): Promise<ImageData> {
    // RAW files: the `read-image-as-data-url` IPC returns only a small embedded
    // preview (≈300×200), which the full-res pipeline would scramble into garbage.
    // Decode the RAW at full resolution instead (same path as decodeForExport).
    if (rawImageService.isRawFile(filePath)) {
      return this.decodeForExport(filePath);
    }

    const result = await errorHandlingService.withErrorHandling(
      async () => {
        logger.info(`Loading full-resolution image for export: ${filePath}`);

        // Load image at full resolution without downsampling
        const img = new Image();

        return new Promise<ImageData>((resolve, reject) => {
          img.onload = () => {
            try {
              logger.info(`Full-resolution image loaded: ${img.width}x${img.height}`);

              // Use canvas to extract image data at full resolution
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
              }

              canvas.width = img.width;
              canvas.height = img.height;

              // Draw image at full resolution
              ctx.drawImage(img, 0, 0);

              // Get image data
              const imageData = ctx.getImageData(0, 0, img.width, img.height);

              // Convert to Float32Array for processing pipeline
              const floatData = new Float32Array(imageData.data.length);
              for (let i = 0; i < imageData.data.length; i++) {
                floatData[i] = imageData.data[i] / 255.0; // Convert to 0-1 range
              }

              resolve({
                width: img.width,
                height: img.height,
                data: floatData,
                fileName: filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown',
                filePath: filePath
              });
            } catch (error) {
              reject(error);
            }
          };

          img.onerror = () => {
            reject(new Error(`Failed to load image: ${filePath}`));
          };

          // Use Electron IPC to read the file (direct file:// URLs are blocked by CSP)
          if (typeof window !== 'undefined' && window.electronAPI?.readImageAsDataURL) {
            window.electronAPI.readImageAsDataURL(filePath)
              .then((dataUrl: string) => { img.src = dataUrl; })
              .catch((err: Error) => {
                logger.error('Failed to read image via Electron for export:', err);
                reject(err);
              });
          } else {
            img.src = filePath; // Browser fallback (blob URLs, etc.)
          }
        });
      },
      'ImageService.loadImageForExport',
      'io'
    );

    if (!result) {
      throw new Error('Failed to load full-resolution image for export');
    }

    return result;
  }

  /**
   * Decode a file to full-resolution RGBA Float32 pixels for batch/collection
   * export WITHOUT touching the live editor singleton. Runs the same RAW /
   * regular decode as loadImage, but skips every side effect: it does NOT set
   * `this.currentImage`, snapshot the original, populate the image cache or fire
   * notifyImageLoaded(). This keeps the user's open image on screen and avoids a
   * per-image reprocess/remount during a batch export.
   *
   * Note: this returns SOURCE pixels (RAW neutral demosaic for RAW, decoded
   * file pixels otherwise) — the editor's adjustment pipeline is NOT applied
   * here. See OutputCollectionService.exportCollection for that limitation.
   */
  async decodeForExport(filePath: string): Promise<ImageData> {
    const pathValidation = ValidationService.validateFilePath(filePath);
    if (!pathValidation.valid) {
      throw new Error(`Invalid file path: ${pathValidation.error}`);
    }

    logger.info(`Decoding image for export (no editor side effects): ${filePath}`);

    if (rawImageService.isRawFile(filePath)) {
      // Honor the per-image decode options so the export matches what the user sees in the
      // preview: the CURRENTLY open image's options live in the store (source of truth while
      // it's open); any OTHER file's options were persisted by EditPersistenceService the last
      // time it was open. Neither present -> DEFAULT_RAW_DECODE_OPTIONS.
      const isCurrentImage = this.getCurrentImage()?.filePath === filePath;
      const decodeOptions = isCurrentImage
        ? useAppStore.getState().rawDecodeOptions
        : (await editPersistenceService.getSavedRawDecodeOptions(filePath)) ?? DEFAULT_RAW_DECODE_OPTIONS;

      const rawData = await rawImageService.loadRawImage(filePath, decodeOptions);

      const dimensionValidation = ValidationService.validateDimensions(rawData.width, rawData.height);
      if (!dimensionValidation.valid) {
        throw new Error(`Invalid image dimensions: ${dimensionValidation.error}`);
      }

      return {
        width: rawData.width,
        height: rawData.height,
        data: rawData.data,
        fileName: rawData.fileName,
        filePath: rawData.filePath,
        isRaw: true,
        metadata: rawData.metadata
      };
    }

    return this.loadRegularImage(filePath);
  }

  clearImage(): void {
    this.currentImage = null;
    this.bakedUpscale = null;
    logger.info('Image cleared');
  }

  /**
   * Mark the current working image as a baked upscale result.
   * Stores scale factor and the native (pre-upscale) dimensions.
   */
  setBakedUpscale(info: BakedUpscaleInfo): void {
    this.bakedUpscale = info;
  }

  /**
   * Clear the baked upscale marker.
   */
  clearBakedUpscale(): void {
    this.bakedUpscale = null;
  }

  /**
   * Check if the current working image is a baked upscale result.
   */
  isBakedUpscaleActive(): boolean {
    return this.bakedUpscale !== null;
  }

  /**
   * Retrieve the baked upscale info (scale + native dimensions).
   */
  getBakedUpscale(): BakedUpscaleInfo | null {
    return this.bakedUpscale;
  }
}

export const imageService = ImageService.getInstance();