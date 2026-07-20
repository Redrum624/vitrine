import { logger } from '../utils/Logger';
import { rawImageService, RawImageData } from './RawImageService';
import { ValidationService } from './ValidationService';
import { errorHandlingService } from './ErrorHandlingService';
import { imageCacheService, CacheEntry } from './ImageCacheService';
import { canvasPoolService } from './CanvasPoolService';
import { autoRawAdjustmentService, RAWDetectionResult } from './AutoRawAdjustmentService';
import { ImageProcessingPipeline } from './ImageProcessingPipeline';
import { useAppStore } from '../stores/appStore';
import { editPersistenceService } from './EditPersistenceService';
import { RawDecodeOptions } from '../types/electron';
import { loadRawDecodeDefaults } from '../utils/rawDecodeDefaultsStorage';

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
  // Deferred (not-yet-copied) reference to the pre-edit base pixels — see deferOriginalSnapshot's
  // doc comment for the full lazy/copy-on-write design.
  private pendingOriginalSource: { data: Float32Array; width: number; height: number } | null = null;
  private imageLoadListeners: (() => void)[] = [];
  private processingPipeline: ImageProcessingPipeline | null = null;
  private loadGeneration = 0;
  private bakedUpscale: BakedUpscaleInfo | null = null;
  // Marks the working base as a baked AI motion-deblur result. Like `bakedUpscale`, it suppresses
  // EditPersistenceService.flush() (so the post-bake reset-to-neutral module state never clobbers
  // the user's PRE-deblur saved edits) and steers export to the baked pixels. Boolean (not an
  // {scale,dims} info) because deblur does not change dimensions. Scoped per-image alongside
  // `bakedUpscale`: cleared on every fresh load / clearImage, and by EnhanceService's revert.
  private bakedDeblur = false;
  // Single hook fired when the WORKING IMAGE IS SWITCHED (fresh loadImage / clearImage) — see
  // setImageSwitchHook. Used to drop per-image transient state that lives outside ImageService
  // (currently EnhanceService's revert stack), scoped alongside the `bakedUpscale` marker.
  private imageSwitchHook: (() => void) | null = null;

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
    interactive: boolean = true,
  ): Promise<ImageData> {
    const thisGeneration = ++this.loadGeneration;
    this.bakedUpscale = null; // Clear baked markers on any fresh image load
    this.bakedDeblur = false;
    this.notifyImageSwitched(); // drop per-image transient state scoped to the previous image (EnhanceService's revert stack)
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
        if (cacheEntry && !this.baseCacheOptionsMismatch(cacheEntry)) {
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
          // Defer the original snapshot for instant before/after comparison — no copy yet.
          this.deferOriginalSnapshot(result);
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
            const fullPromise = rawImageService.loadRawImage(filePath, decodeOptions, interactive);
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
              this.deferOriginalSnapshot(previewResult);
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
            rawData = await rawImageService.loadRawImage(filePath, decodeOptions, interactive);
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
                this.processingPipeline,
                interactive, // batch opens (interactive=false) must not write-through the histogram decode
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
          // without re-running the (multi-second) LibRaw decode. WRITE-BEFORE-GUARD (deliberate,
          // symmetric with developFullDecode): this write happens BEFORE the stale-load generation
          // guard below, so even a decode that the user has already switched away from still pays
          // forward to the next reopen. The base cache is path-keyed and options-coherent, so a
          // superseded-but-valid decode is still correct FOR ITS OWN KEY. Options recorded are the
          // CAPTURED decodeOptions (this buffer's true provenance), never the current store state.
          imageCacheService.setBase(
            filePath,
            rawData.data,
            rawData.width,
            rawData.height,
            { isRaw: true, autoAdjustmentResult, decodeOptions, ...rawData.metadata }
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
        // Defer the original snapshot for instant before/after comparison — no copy yet.
        this.deferOriginalSnapshot(result);
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
   * WRITE-BEFORE-GUARD (deliberate): the full decode costs ~4.3s and its pixels are VALID for
   * their own (path, captured-options) base-cache key regardless of whether this open still owns
   * the screen. So we write the base cache BEFORE the state-swap guards — a superseded open then
   * still PAYS FORWARD to the next reopen of that path instead of discarding a fully-paid decode.
   * The base cache is path-keyed and options-coherent, so caching a superseded-but-valid result
   * under its own key is safe. The state-swap guards then bail WITHOUT touching current state:
   *  - generation: a newer loadImage() started → don't swap (that open owns the screen + affordance).
   *  - identity: the current image is no longer this path → don't swap.
   *  - decode-options: the user changed demosaic/highlight via the RAW Decode panel (reDecode)
   *    while we were decoding → don't swap, so this stale-options full decode never replaces the
   *    reDecode's fresh working image.
   *
   * The ONE case that also skips the WRITE is a STALE-OPTIONS decode of THIS SAME path (the store
   * options already differ from this decode's captured options while this path is still the current
   * image — regardless of generation, so an out-of-order landing after a same-path reopen can't
   * clobber either): the path may already hold fresher-options pixels (from reDecode or a reopen
   * that cache-hit them), and getBase is options-blind on the KEY, so overwriting them with our
   * stale entry would downgrade the cache. The options recorded on the cache write are the CAPTURED
   * ones (the decodeOptions param), never the current store state — they are the buffer's true
   * decode provenance.
   *
   * A reDecode merely IN FLIGHT (options not yet changed) does NOT skip the write: the captured
   * options still equal the store options, so the entry is coherent for the read side. reDecode's
   * own setBase overwrites it on success; on reDecode FAILURE it survives as an INSTANT L1 hit on
   * reopen (upgrading failure recovery from an L2 disk read to L1). Only the visual swap is
   * suppressed for that case (see reDecodeWillOwnPath below) — the cache write is orthogonal.
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

      // Validate the decoded pixels BEFORE anything else — never write garbage to the base cache.
      const dimensionValidation = ValidationService.validateDimensions(rawData.width, rawData.height);
      if (!dimensionValidation.valid) {
        logger.warn(`Progressive full decode produced invalid dimensions: ${dimensionValidation.error}`);
        return;
      }

      // Supersession flags (see this method's doc comment). Computed once, up front, so the
      // write-before-guard decision and the state-swap bail below read a consistent snapshot.
      const generationSuperseded = generation !== this.loadGeneration;
      const stillCurrent = this.currentImage;
      const identityChanged = !stillCurrent || stillCurrent.filePath !== filePath;
      const storeOpts = useAppStore.getState().rawDecodeOptions;
      const optionsChanged =
        storeOpts.demosaic !== decodeOptions.demosaic ||
        storeOpts.highlightMode !== decodeOptions.highlightMode ||
        !storeOpts.cameraMatch !== !decodeOptions.cameraMatch;

      // A re-decode (RawDecodePanel → RawImageService.reDecode) for THIS path may be in flight.
      // reDecode updates the store's rawDecodeOptions only AFTER its own decode resolves, so when
      // the ORIGINAL background decode lands FIRST (the common order — it started earlier),
      // `optionsChanged` still reads false here even though a fresher re-decode is about to own
      // this path's base + screen. Without folding this in, we'd swap the OLD-options result in and
      // pay a full-res reprocess, only for reDecode to immediately swap the NEW-options result over
      // it — the wasteful OLD→NEW double swap. Treat an in-flight re-decode of the current path as
      // "reDecode wins": neither write L1 (reDecode writes the authoritative base) nor swap
      // (reDecode swaps). `!identityChanged` scopes it to a re-decode of THIS path — reDecode only
      // ever operates on the current image, and if identity changed we already bail below.
      const reDecodeInFlight = useAppStore.getState().reDecoding;
      const reDecodeWillOwnPath = reDecodeInFlight && !identityChanged;

      // WRITE-BEFORE-GUARD (deliberate — see doc comment): cache this fully-paid decode under its
      // own (path, captured-options) key so a superseded open still pays forward to the next
      // reopen. The base cache holds the FULL 16-bit decode only (the preview is never cached).
      // Skip the write ONLY when this decode's options are STALE for this SAME still-current path
      // (optionsChanged): the store already moved to different options, getBase is options-blind on
      // read, and the path may already hold fresher-options pixels (from reDecode or a reopen that
      // cache-hit them) — overwriting them with our stale-options entry would downgrade the cache.
      //
      // CASE A (reDecode in flight, options NOT yet changed — reDecodeInFlight && !optionsChanged):
      // we DO write now. The captured options still equal the current store options, so the read
      // side (baseCacheOptionsMismatch) will serve this entry coherently. If reDecode SUCCEEDS its
      // own setBase overwrites this entry (a harmless extra write). If reDecode FAILS the store
      // stays on these options, so this entry becomes a valid INSTANT L1 hit on reopen — upgrading
      // failure recovery from an L2 disk read (~1s) to L1 (instant). Only the VISUAL swap is still
      // suppressed for Case A (reDecodeWillOwnPath, below) — reDecode owns the screen; the cache
      // write is orthogonal and safe. (P6 made the L1 READ options-aware, which is what makes
      // writing the captured-options entry here safe — a mismatch is treated as a miss, never
      // served as wrong-options pixels.)
      //
      // Deliberately NOT conditioned on generation: a stale decode landing out-of-order after a
      // same-path reopen must not clobber either. Options recorded are the CAPTURED decodeOptions
      // param (this buffer's true provenance), never the current store state.
      const wouldClobberFresherReDecode = !identityChanged && optionsChanged;
      if (!wouldClobberFresherReDecode) {
        imageCacheService.setBase(
          filePath,
          rawData.data,
          rawData.width,
          rawData.height,
          { isRaw: true, autoAdjustmentResult: undefined, decodeOptions, ...rawData.metadata },
        );
      }

      // State-swap guards: a superseded open must NOT touch the current image / UI (a newer open
      // owns the screen + the "Developing…" affordance). The base cache is already written above.
      if (generationSuperseded) {
        logger.info(`Progressive full decode of ${filePath} superseded by a newer open — base cached, not swapped`);
        return;
      }
      if (identityChanged) {
        logger.info(`Progressive full decode of ${filePath} discarded: current image changed — base cached, not swapped`);
        return;
      }
      if (optionsChanged || reDecodeWillOwnPath) {
        logger.info(`Progressive full decode of ${filePath} discarded: a re-decode owns this path (options changed=${optionsChanged}, reDecode in flight=${reDecodeWillOwnPath}) — base not swapped`);
        return;
      }

      // Swap the base to the full 16-bit decode.
      this.processingPipeline?.clearCache(); // module results cached against preview dims are stale
      // Defer (don't copy) the original snapshot for the full-res base — this swap is the
      // progressive open's "real" load moment (graded preview -> neutral full decode), so it
      // gets the SAME laziness as a fresh loadImage(): most opens never use Before/After, so
      // don't pay the ~90-230ms/~310MB copy here either. Called BEFORE updateCurrentImageData,
      // with the SAME rawData.data reference that call passes, so updateCurrentImageData's
      // copy-on-write check (data !== pendingOriginalSource.data) is a no-op — zero copies at
      // swap time. (This used to be an eager `setOriginalImage(new Float32Array(rawData.data))`
      // unconditionally on every progressive RAW open — see this method's doc comment.)
      this.deferOriginalSnapshot(rawData);
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

  /**
   * L1 base-cache read-side coherence guard: a cached base is served ONLY when its recorded decode
   * options still match the options the caller is about to decode with. Canvas restores the
   * per-image saved decodeOptions into the store BEFORE loadImage, so a mismatch is normally
   * impossible — this guards the race/corruption case (e.g. a stale entry whose options no longer
   * match the store) so loadImage never serves wrong-options pixels: on a mismatch we treat the hit
   * as a MISS and fall through to a fresh decode (which overwrites the entry with correctly-
   * provenanced pixels). Only RAW bases carry decode options; regular images (and any pre-
   * provenance entry with no recorded decodeOptions) have nothing to compare and are served as-is.
   */
  private baseCacheOptionsMismatch(entry: CacheEntry): boolean {
    const recorded = entry.metadata?.decodeOptions as RawDecodeOptions | undefined;
    if (!recorded) return false;
    const current = useAppStore.getState().rawDecodeOptions;
    // cameraMatch compares by truthiness: a pre-feature entry recorded no field
    // (undefined) and its pixels are unmatched, so it must only serve cameraMatch-off.
    return (
      recorded.demosaic !== current.demosaic ||
      recorded.highlightMode !== current.highlightMode ||
      !recorded.cameraMatch !== !current.cameraMatch
    );
  }

  getCurrentImage(): ImageData | null {
    return this.currentImage;
  }

  /**
   * Read-only view of the monotonic load token bumped by every loadImage() — the same
   * supersession guard the async open/progressive-decode paths use internally. Exposed so
   * long-running bakes (EnhanceService) can capture {filePath, generation} before their first
   * await and detect ANY image switch before committing — including a re-open of the SAME file,
   * which a filePath comparison alone would miss. Reuses the existing token's semantics rather
   * than inventing a parallel counter (2026-07-20 W2 F1).
   */
  getLoadGeneration(): number {
    return this.loadGeneration;
  }

  /**
   * Returns the pristine original image data as it was at load time (or as explicitly
   * overwritten by setOriginalImage — see that method's doc comment). Used for instant
   * before/after comparison without re-reading from disk.
   *
   * LAZY / COPY-ON-WRITE DESIGN (Task L4): every image open used to eagerly deep-copy the
   * full-res buffer here (~90-230ms + ~310MB for a 20MP image), even though most opens never
   * open Before/After — the copy paid for itself on a tiny fraction of opens. Now the open
   * flow only records a REFERENCE to the as-decoded buffer (deferOriginalSnapshot, no
   * allocation). The actual deep copy happens HERE, lazily, the first time a caller actually
   * asks for the original — materializeOriginalSnapshot does the one-time allocation and the
   * result is cached in `originalImageData` so repeat calls (e.g. OriginalPane's effect
   * re-running on unrelated viewport changes) are free.
   *
   * Correctness across in-place-looking mutations (rotate/flip/resize, upscale, RAW re-decode):
   * "original" must mean the pre-edit base as decoded, not whatever the CURRENT working buffer
   * holds — so a naive "copy from getCurrentImage() on demand" would be wrong once the working
   * image has been replaced by one of those operations. Audit of every updateCurrentImageData
   * call site (App.tsx rotate/flip/resize, EnhanceService upscale + revert, RawImageService
   * re-decode, this file's progressive full-decode swap) shows each one passes a FRESHLY
   * allocated output array — none of them mutate the previous buffer in place — so the
   * reference held in `pendingOriginalSource` stays valid (untouched) across any number of such
   * calls until it's materialized. updateCurrentImageData ALSO defensively materializes the
   * snapshot from the pre-mutation pixels before swapping (see its comment) as a copy-on-write
   * safety net, so correctness does not silently depend on every future mutator upholding that
   * invariant.
   */
  getOriginalImage(): { data: Float32Array; width: number; height: number } | null {
    if (this.originalImageData) return this.originalImageData;
    if (this.pendingOriginalSource) {
      this.originalImageData = this.materializeOriginalSnapshot(this.pendingOriginalSource);
      this.pendingOriginalSource = null;
    }
    return this.originalImageData;
  }

  /**
   * Dimensions of the original (pre-edit) image WITHOUT materializing the deferred
   * 310MB snapshot copy. Consumers that only need width/height (e.g. the Enhance
   * panel's upscale feasibility, which renders per frame) must use this instead of
   * getOriginalImage() — calling the full getter from a render triggers the deep
   * copy synchronously and defeats the lazy-snapshot optimization.
   */
  getOriginalImageDimensions(): { width: number; height: number } | null {
    const src = this.originalImageData ?? this.pendingOriginalSource;
    return src ? { width: src.width, height: src.height } : null;
  }

  /**
   * Record a REFERENCE to the as-decoded pixels for later before/after comparison — no copy.
   * The actual deep copy is deferred until getOriginalImage() (or a mutating
   * updateCurrentImageData call) actually needs it. Called at load time for every open (and by
   * the progressive-open full-decode swap below), so the common open→browse-without-Before/After
   * path pays zero extra allocation/copy cost. Takes the bare {data,width,height} shape (not the
   * full ImageData) so callers that only have the raw decode result — not a whole ImageData —
   * can defer it too.
   */
  private deferOriginalSnapshot(source: { data: Float32Array; width: number; height: number }): void {
    this.originalImageData = null; // a fresh image invalidates any previously materialized snapshot
    this.pendingOriginalSource = { data: source.data, width: source.width, height: source.height };
    // Signal the Before/After pane that a NEW original is available for the current
    // image. Fresh opens don't bump baseImageVersion (only the in-place swap path
    // does), so without this the Before pane would keep rendering the PREVIOUS
    // image's original after an ordinary switch (plain/JPEG/cache open).
    useAppStore.getState().bumpOriginalSnapshotVersion();
  }

  /**
   * Deep-copy `source` into a fresh, independent snapshot (so later in-place-looking
   * replacements of the working buffer can never alias it). Factored out so both
   * getOriginalImage() and updateCurrentImageData() share the one allocation path — tests spy
   * on this method directly to assert a plain open triggers zero materializations.
   */
  private materializeOriginalSnapshot(
    source: { data: Float32Array; width: number; height: number }
  ): { data: Float32Array; width: number; height: number } {
    const snapshot = {
      data: new Float32Array(source.data),
      width: source.width,
      height: source.height,
    };
    logger.info(`Original image snapshot materialized: ${source.width}x${source.height} (${(source.data.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    return snapshot;
  }

  /**
   * Overwrite the original snapshot used by getOriginalImage() for Before/After comparison.
   * Called by EnhanceService after an upscale, and by RawImageService/this file after a RAW
   * re-decode, so the "Before" side reflects the clean new base rather than the pre-operation
   * pixels. This is an explicit, already-materialized snapshot — it supersedes (and clears) any
   * still-deferred `pendingOriginalSource`, so a later getOriginalImage() call never overwrites
   * it with the stale pre-operation pixels.
   */
  setOriginalImage(data: Float32Array, width: number, height: number): void {
    this.originalImageData = { data, width, height };
    this.pendingOriginalSource = null;
    useAppStore.getState().bumpOriginalSnapshotVersion(); // Before pane re-reads the new base
  }

  /**
   * Update the current image data with processed data.
   * Used when applying crop/transform changes permanently.
   */
  updateCurrentImageData(data: Float32Array, width: number, height: number): void {
    if (this.currentImage) {
      // Copy-on-write safety net: if nothing has materialized the before/after snapshot yet,
      // lock it in NOW from the pre-mutation pixels, before they're replaced below. Every known
      // mutator already passes a freshly-allocated output array rather than reusing the base
      // buffer (see getOriginalImage()'s doc comment for the audit), so in practice this rarely
      // has to actually copy here (rotate/flip/resize DO hit this the first time they run before
      // Before/After has ever been used) — but it guards the invariant explicitly rather than
      // trusting every future caller to uphold it. Callers that immediately follow this with
      // their own setOriginalImage() (upscale, re-decode) simply overwrite the result a moment
      // later; that redundant copy is bounded to those already-expensive operations, never the
      // plain-open hot path.
      //
      // The `pendingOriginalSource.data !== data` check skips the copy when the incoming buffer
      // IS the pending original itself — the progressive-open full-decode swap below calls
      // deferOriginalSnapshot(rawData) then updateCurrentImageData(rawData.data, ...) with the
      // SAME array; there is nothing to "preserve" from a swap onto itself, so this stays a
      // zero-copy reference update exactly like a plain open (see developFullDecode's comment).
      if (!this.originalImageData && this.pendingOriginalSource && this.pendingOriginalSource.data !== data) {
        this.originalImageData = this.materializeOriginalSnapshot(this.pendingOriginalSource);
        this.pendingOriginalSource = null;
      }
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
   * here. A caller that needs edited output must run the pipeline on these
   * pixels itself (see MultiExportService/BatchProcessingService).
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
      // time it was open. Neither present -> the user's saved decode defaults.
      const isCurrentImage = this.getCurrentImage()?.filePath === filePath;
      const decodeOptions = isCurrentImage
        ? useAppStore.getState().rawDecodeOptions
        // No saved per-image options → the user's last-chosen defaults (same
        // fallback the interactive open uses), so a batch export renders a
        // never-opened RAW the way opening it would.
        : (await editPersistenceService.getSavedRawDecodeOptions(filePath)) ?? (await loadRawDecodeDefaults());

      // interactive=false: an export decode is a one-shot the user never reopens interactively —
      // it must not write-through to (and churn) the disk base-cache LRU. Disk READS still apply.
      const rawData = await rawImageService.loadRawImage(filePath, decodeOptions, false);

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
    this.bakedDeblur = false;
    this.notifyImageSwitched(); // same per-image reset as a fresh load (drop EnhanceService's revert stack)
    // Release the original-snapshot references too (deferred or materialized) —
    // otherwise the previous image's ~310MB base stays reachable after a clear.
    this.originalImageData = null;
    this.pendingOriginalSource = null;
    logger.info('Image cleared');
  }

  /**
   * Register the single hook fired whenever the WORKING IMAGE IS SWITCHED — a fresh loadImage()
   * (any path: cache hit, progressive preview, full decode) or clearImage(). It is NOT fired on
   * in-place base replacements (updateCurrentImageData: rotate/flip/resize, the progressive
   * full-decode swap, the upscale bake), which keep the same logical image. EnhanceService
   * registers here to drop its per-image revert stack (see EnhanceService.onImageSwitched): those
   * restore points hold the PREVIOUS image's pre-upscale pixels + edit state, so surviving a switch
   * would let revert() restore another image's base as the current working image.
   *
   * Mirrors the setBakeBridge wiring — EnhanceService already imports imageService, so a single
   * setter (rather than a reverse import) avoids an import cycle and a new event bus. Single-consumer
   * by design, exactly like the `bakedUpscale` marker it is scoped alongside (both cleared at the
   * same loadImage/clearImage choke points).
   */
  setImageSwitchHook(hook: () => void): void {
    this.imageSwitchHook = hook;
  }

  private notifyImageSwitched(): void {
    try {
      this.imageSwitchHook?.();
    } catch (error) {
      logger.error('Error in image-switch hook:', error);
    }
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

  /** Mark the current working image as a baked AI motion-deblur result (same-dimension bake). */
  setBakedDeblur(): void {
    this.bakedDeblur = true;
  }

  /** Clear the baked motion-deblur marker (on revert to the pre-deblur base). */
  clearBakedDeblur(): void {
    this.bakedDeblur = false;
  }

  /** Check if the current working image is a baked motion-deblur result. */
  isBakedDeblurActive(): boolean {
    return this.bakedDeblur;
  }
}

export const imageService = ImageService.getInstance();