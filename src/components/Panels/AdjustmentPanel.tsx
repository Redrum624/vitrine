import { useState, useCallback, useEffect, useRef } from 'react';
import { BasicAdjustmentsModule } from '../../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../../modules/ShadowsHighlightsPipelineModule';
import { CropPipelineModule } from '../../modules/CropPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import { LensCorrectionsPipelineModule } from '../../modules/LensCorrectionsPipelineModule';
import { NoiseReductionModule } from '../../modules/NoiseReductionModule';
import { EnhanceModule } from '../../modules/EnhanceModule';
import { BasicAdjustmentsModuleComponent } from '../Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../Modules/WhiteBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../Modules/ColorBalanceModuleComponent';
import { ShadowsHighlightsModuleComponent } from '../Modules/ShadowsHighlightsModuleComponent';
import { CropModuleComponent } from '../Modules/CropModuleComponent';
import { LocalAdjustmentsModuleComponent } from '../Modules/LocalAdjustmentsModuleComponent';
import { LensCorrectionsModuleComponent } from '../Modules/LensCorrectionsModuleComponent';
import { HistoryPanel } from './HistoryPanel';
import { RawDecodePanel } from './RawDecodePanel';
import EnhanceModuleComponent from '../Modules/EnhanceModuleComponent';
import { ModuleCardHeader } from '../Controls/ModuleCardHeader';
import type { ModuleCardActions } from '../Controls/moduleCardActions';
import { Sun, Droplet, Palette, Activity, Crop, Sparkles, Focus, History as HistoryIcon, Sliders, Contrast } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ImageFileInfo } from '../../services/FileSystemService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { imageService } from '../../services/ImageService';
import { notificationService } from '../../services/NotificationService';
import { guardDeveloping } from '../../utils/developingGuard';
import { boxDownsampleRGBA } from '../../utils/imageDownsample';
import { enhanceKernelScale } from '../../utils/enhanceOps';
import { progressivePreviewService } from '../../services/ProgressivePreviewService';
import { adaptiveDebounceService } from '../../services/AdaptiveDebounceService';
import { useAppStore } from '../../stores/appStore';
import { gpuPreviewPipeline } from '../../shaders/GpuPreviewPipeline';
import { buildPassList } from '../../shaders/passDescriptors';
import { logger } from '../../utils/Logger';
import { webWorkerImageProcessor } from '../../services/WebWorkerImageProcessor';
import type { WorkerModuleConfig } from '../../services/WebWorkerImageProcessor';
import { choosePreviewPath } from '../../services/previewRouting';

interface AdjustmentPanelProps {
  selectedModule?: string | null;
  // Required so tsc guarantees App threads its live selection down to the
  // RAW Decode panel (which self-gates to RAW files). null = no image open.
  currentImage: ImageFileInfo | null;
}

export function AdjustmentPanel({ selectedModule, currentImage }: AdjustmentPanelProps) {
  const { setProcessedImageData, processingVersion, externalParamsVersion, setProcessingStats } = useAppStore();
  const [resetCounter, setResetCounter] = useState(0);
  // The Auto/Reset handlers the CURRENTLY-mounted module registers with the card
  // header (Task 2). Only one module mounts at a time, so a single slot suffices;
  // React runs cleanups before setups, so a module switch ends on the new module.
  const [moduleActions, setModuleActions] = useState<ModuleCardActions | null>(null);
  // Remount the module panels (so each re-reads module.getParams() into its
  // sliders) on a manual Reset OR when params are set in bulk from outside the
  // panels (Paste Style / Auto All / presets). External bulk-setters bump
  // externalParamsVersion; normal slider drags do not, so editing isn't disrupted.
  const paramSync = `${resetCounter}-${externalParamsVersion}`;
  // Only the setter is bound: nothing renders from this state, and depending on its VALUE
  // anywhere (e.g. a useCallback dep) recreates the processing callback every run — the
  // exact identity churn behind the endless-reprocess-loop bug. Use isProcessingRef to read.
  const [, setIsProcessing] = useState(false);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessingTimeRef = useRef<number>(0);
  // Monotonic id per processing run. The 800ms spinner timer and the finally clear are
  // guarded on it so a stale/overlapping run can never leave the canvas spinner (and its
  // backdrop-blur overlay) stuck on — which read as a permanently "blurry/soft" image.
  const processingGenRef = useRef<number>(0);
  // Monotonic counter per preview run. If a newer run starts while an older async run is
  // still in-flight, the older one discards its result rather than overwriting the newer frame.
  const previewSeqRef = useRef<number>(0);
  // Synchronous in-flight guard (React state is stale inside the async closure). Without
  // it a slow run (noise reduction) + a second edit ran two pipeline passes concurrently
  // through the shared WebGL processor, corrupting the output (blurry). A skipped run sets
  // `pending` so it re-runs once the current one finishes (no lost edits).
  const isProcessingRef = useRef<boolean>(false);
  const pendingReprocessRef = useRef<boolean>(false);
  // NOTE: Removed lastProcessedImagePathRef - was blocking param change reprocessing

  // ── GPU resident-texture preview: source-reupload gating ──────────────────────
  // The whole point of the resident pipeline is to upload the source ONCE and then
  // re-run only the cheap GPU passes per slider tick. We re-upload setSource() ONLY
  // when the source identity changes (new image, or preview dims changed). Re-uploading
  // every tick would defeat that win. Crop is handled by the CPU path (crop active ⇒
  // it lands in cpuBridges ⇒ GPU mode is skipped), so the source here is always the
  // raw decoded image downsampled to the preview — no crop baked in.
  const lastGpuSourceKeyRef = useRef<string | null>(null);
  // ── Preview-source memo (downsample gating) ───────────────────────────────────
  // The area-averaged box downsample is O(source pixels) — ~50-150ms on a 24-45MP
  // image — and the source only changes on image switch, preview-dim change, or an
  // in-place base swap. Mirroring the GPU sourceKey pattern above, cache the last
  // downsampled preview by (filePath, previewW×H, baseImageVersion) so slider drags
  // (each processCurrentImageRealTime call) reuse it instead of rescanning the full
  // source every 50ms. Consumers never mutate it: the GPU path uploads it, the worker
  // path structured-clones it (postMessage, no transfer list) and the main-thread
  // pipeline copies its input (processOnMainThread does `new Float32Array(input)`).
  const previewSourceCacheRef = useRef<{ key: string; data: Float32Array } | null>(null);
  // Trailing throttle for the GPU→CPU histogram readback (keeps the histogram live in
  // gpu mode without blocking the present path). Cleared on unmount.
  const gpuReadbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Connect the processing pipeline to image service for auto-adjustments
  useEffect(() => {
    imageService.setProcessingPipeline(imageProcessingPipeline);
    logger.info('Processing pipeline connected to ImageService for auto-adjustments');
  }, []);

  // Get module instances from pipeline
  const cropModule = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  const lensCorrectionsModule = imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections');
  const whiteBalanceModule = imageProcessingPipeline.getModule<WhiteBalanceModule>('temperature');
  const basicAdjModule = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj');
  const toneCurveModule = imageProcessingPipeline.getModule<ToneCurvePipelineModule>('tonecurve');
  const colorBalanceModule = imageProcessingPipeline.getModule<ColorBalancePipelineModule>('colorbalance');
  const shadowsHighlightsModule = imageProcessingPipeline.getModule<ShadowsHighlightsPipelineModule>('shadowshighlights');
  const localAdjustmentsModule = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
  const noiseReductionModule = imageProcessingPipeline.getModule<NoiseReductionModule>('noise-reduction');
  const enhanceModuleInstance = imageProcessingPipeline.getModule<EnhanceModule>('enhance');

  const processCurrentImageRealTime = useCallback(async (opts?: { queueIfBusy?: boolean }) => {
    const currentImage = imageService.getCurrentImage();
    console.log('AdjustmentPanel: processCurrentImageRealTime called, currentImage:', currentImage ? `${currentImage.width}x${currentImage.height}` : 'null');

    if (!currentImage) return;

    // NOTE: Removed early return check for "same image already processed" because
    // it was blocking parameter change reprocessing. The check was meant for cached
    // navigation optimization but incorrectly blocked rotation/crop adjustments.
    // The debouncing and isProcessing checks provide sufficient protection.

    // Skip if a pipeline pass is already in flight (synchronous ref — React state is
    // stale here). Mark it pending so the latest state is reprocessed when this finishes —
    // but ONLY for a real new trigger (param change / processingVersion bump / image load).
    // Non-trigger callers (the mount effect) pass queueIfBusy:false; queuing those made the
    // finally-block triggerReprocessing() feed the next pass forever.
    if (isProcessingRef.current) {
      if (opts?.queueIfBusy !== false) {
        pendingReprocessRef.current = true;
        logger.debug('Skipping processing - already in progress (queued)');
      } else {
        logger.debug('Skipping processing - already in progress (not queued)');
      }
      return;
    }

    // Only prevent rapid-fire calls within a short time window (not based on parameter changes)
    const now = performance.now();
    const lastProcessingTime = lastProcessingTimeRef.current;

    if (lastProcessingTime && (now - lastProcessingTime) < 50) {
      logger.debug('Skipping processing - too soon since last processing (50ms throttle)');
      return;
    }

    // Track this processing attempt
    lastProcessingTimeRef.current = now;
    isProcessingRef.current = true;

    // Clear any pending timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }

    // Show the canvas spinner only if processing is slow (noise reduction, large
    // images, etc.) so fast slider drags don't flicker it on/off. Guard on a per-run
    // id so only the LATEST run can toggle it (no orphaned/stuck spinner).
    const gen = ++processingGenRef.current;
    const slowSpinnerTimer = setTimeout(() => {
      if (processingGenRef.current === gen) useAppStore.getState().setIsProcessing(true);
    }, 800);
    try {
      const seq = ++previewSeqRef.current;
      setIsProcessing(true);
      const startTime = performance.now();

      // Detect channel count from image data
      const expectedPixels = currentImage.width * currentImage.height;
      const actualChannels = currentImage.data.length / expectedPixels;
      const isRGB = Math.abs(actualChannels - 3) < 0.1;
      const sourceChannels = isRGB ? 3 : 4;

      logger.debug(`Image format detected: ${sourceChannels} channels (${isRGB ? 'RGB' : 'RGBA'})`);

      // Cancel any previous progressive preview requests
      progressivePreviewService.cancelActiveRequests();

      // Preview is capped at MAX_PREVIEW_SIZE and shrunk with an area-averaged box
      // downsample (boxDownsampleRGBA) — the previous nearest-neighbour "every Nth pixel"
      // sampler aliased high-frequency content into moiré and made the preview diverge from
      // the full-resolution render.
      //
      // The cap is DYNAMIC (v1.29 quality ratchet): base 1024, raised by Canvas
      // when zoom exceeds the image's previous farthest zoom or a crop apply
      // raises effective magnification (utils/previewQuality.ts). Read
      // imperatively — NOT a hook/dep — so this callback's identity stays
      // stable (see the identity-churn warnings above); a cap change reaches
      // this code through triggerReprocessing.
      const MAX_PREVIEW_SIZE = useAppStore.getState().previewQualityCap ?? 1024;
      const aspectRatio = currentImage.width / currentImage.height;

      let previewWidth, previewHeight;
      if (currentImage.width > currentImage.height) {
        previewWidth = Math.min(MAX_PREVIEW_SIZE, currentImage.width);
        previewHeight = Math.round(previewWidth / aspectRatio);
      } else {
        previewHeight = Math.min(MAX_PREVIEW_SIZE, currentImage.height);
        previewWidth = Math.round(previewHeight * aspectRatio);
      }

      console.log(`AdjustmentPanel: Creating preview ${previewWidth}x${previewHeight} from ${currentImage.width}x${currentImage.height}`);

      // For now, use original image data directly if it's not too large
      let previewData: Float32Array;

      if (currentImage.width <= MAX_PREVIEW_SIZE && currentImage.height <= MAX_PREVIEW_SIZE) {
        // Use original data directly if it's small enough
        console.log('AdjustmentPanel: Using original image data directly (small image)');
        previewData = currentImage.data.slice(); // Copy to avoid modifying original
        previewWidth = currentImage.width;
        previewHeight = currentImage.height;

        // Ensure RGBA format
        if (sourceChannels === 3) {
          const rgbaData = new Float32Array(currentImage.width * currentImage.height * 4);
          for (let i = 0; i < currentImage.width * currentImage.height; i++) {
            rgbaData[i * 4] = previewData[i * 3];
            rgbaData[i * 4 + 1] = previewData[i * 3 + 1];
            rgbaData[i * 4 + 2] = previewData[i * 3 + 2];
            rgbaData[i * 4 + 3] = 1.0;
          }
          previewData = rgbaData;
        }
      } else {
        // CRITICAL FIX: Recalculate preview dimensions to EXACTLY match source aspect ratio
        // This prevents stretching artifacts
        const actualPreviewWidth = previewWidth;
        const actualPreviewHeight = Math.round(previewWidth / aspectRatio);

        // Update preview dimensions to exact aspect ratio match
        previewWidth = actualPreviewWidth;
        previewHeight = actualPreviewHeight;

        console.log(`AdjustmentPanel: Downsampling ${currentImage.width}x${currentImage.height} to EXACT aspect ratio ${previewWidth}x${previewHeight}`);

        // Area-averaged box downsample: each preview pixel is the mean of every source
        // pixel in its footprint (anti-aliased), instead of dropping to a single source
        // pixel per cell. Averages in the source's own value space and outputs RGBA.
        //
        // Memoized per source (see previewSourceCacheRef): the scan is O(source pixels),
        // so it runs ONCE per (image path, preview dims, base pixels) instead of on every
        // slider drag. baseImageVersion folds in the in-place base swaps (a progressive
        // open's background full-decode swap, a RAW re-decode, a rotate/flip bake).
        const baseImageVersion = useAppStore.getState().baseImageVersion;
        const previewSourceKey = `${currentImage.filePath ?? ''}_${previewWidth}x${previewHeight}_${baseImageVersion}`;
        const cachedPreview = previewSourceCacheRef.current;
        if (cachedPreview && cachedPreview.key === previewSourceKey) {
          previewData = cachedPreview.data;
        } else {
          previewData = boxDownsampleRGBA(
            currentImage.data,
            currentImage.width,
            currentImage.height,
            previewWidth,
            previewHeight,
            sourceChannels,
          );
          previewSourceCacheRef.current = { key: previewSourceKey, data: previewData };
        }
      }

      // Debug the preview data
      const samplePreview = previewData.slice(0, 100);
      const previewNonZero = samplePreview.filter(val => val > 0).length;
      console.log(`AdjustmentPanel: Preview data created - nonZero: ${previewNonZero}/100, range: ${Math.min(...samplePreview)} - ${Math.max(...samplePreview)}, sample:`, samplePreview.slice(0, 8));

      // Always run through processing pipeline to ensure module effects are applied
      // The pipeline has its own optimizations to skip unchanged modules
      console.log('AdjustmentPanel: Processing preview', previewWidth, 'x', previewHeight);

      // v1.36.0 C5 (WYSIWYG kernels): this preview's long edge vs the image's NATIVE long edge,
      // derived ONCE per pass here (the pass-build seam) and threaded to every CPU route below
      // (main-thread context + worker imageData). Sub-native previews (<1) scale the enhance
      // sharpen kernels down so the preview matches what the native-res export produces; at 1:1
      // the quality ratchet drives previewWidth/Height to native → scale 1 → preview == export.
      // Crop runs inside the pass on BOTH the preview and the export, shrinking both long edges
      // by the same fraction, so the pre-crop ratio computed here is the correct pass scale.
      const kernelScale = enhanceKernelScale(
        Math.max(previewWidth, previewHeight),
        Math.max(currentImage.width, currentImage.height),
      );

      // CRITICAL: Create context object to track dimension changes from rotation/crop
      const processingContext = {
        width: previewWidth,
        height: previewHeight,
        channels: 4,
        kernelScale
      };

      // ── GPU resident-texture fast path ──────────────────────────────────────────
      // Build the GPU pass list from the SAME ordered modules the CPU pipeline uses
      // (via getOrderedModules() — no private-field access). The plan routes a frame to
      // the GPU only when every *active* module is GPU-capable, where "active" means
      // enabled AND non-identity (the exact gate the CPU processImage loop uses).
      //
      // buildPassList() maps CPU-only module ids (crop, exposure, enhance,
      // shadowshighlights, localadjustments, noise-reduction) to cpuBridges purely by id
      // — it has no notion of identity, so with all 11 modules registered it would ALWAYS
      // report a non-empty cpuBridges and the GPU path would never fire. We therefore
      // keep only the cpuBridges that are genuinely ACTIVE (imageProcessingPipeline
      // .isModuleActive). An inactive (default/identity) crop or enhance does not block
      // GPU; an actually-cropped image or an applied enhance / a live local-adjustment
      // mask does → CPU fallback for that frame.
      const orderedModules = imageProcessingPipeline.getOrderedModules();
      // Provide the render dims + a mask-rebuild callback so the local-adjustments pass
      // (Task 10) can bake/upload masks at the preview resolution. rebuildMask reuses the
      // module's OWN setLayerGeometry (no geometry→mask reimplementation) and returns the
      // freshly-baked mask for the layer, or null when the layer has no geometry.
      const { passes, cpuBridges } = buildPassList(orderedModules, {
        width: previewWidth,
        height: previewHeight,
        rebuildMask: (layerId, w, h) => {
          const laMod = imageProcessingPipeline.getModule('localadjustments') as LocalAdjustmentsPipelineModule | undefined;
          return laMod?.rebuildMask(layerId, w, h) ?? null;
        },
      });
      const activeCpuBridges = cpuBridges.filter((id) => imageProcessingPipeline.isModuleActive(id));

      const previewPath = choosePreviewPath({
        workersHealthy: webWorkerImageProcessor.isHealthy(),
        gpuAvailable: gpuPreviewPipeline.isAvailable(),
        activeCpuBridgeCount: activeCpuBridges.length,
        passCount: passes.length,
        width: previewWidth,
        height: previewHeight,
      });

      if (previewPath === 'gpu') {
        // Source identity: image path + preview dims. Crop never contributes here
        // (active crop ⇒ activeCpuBridges non-empty ⇒ this branch is skipped), so the
        // source is the raw downsampled image and only changes on image switch / dim change,
        // OR when the base pixels are replaced in place at the same path+dims (a RAW
        // re-decode / flip) — baseImageVersion folds that in so we re-upload the new pixels.
        const baseImageVersion = useAppStore.getState().baseImageVersion;
        const sourceKey = `${currentImage.filePath ?? ''}_${previewWidth}x${previewHeight}_${baseImageVersion}`;
        if (lastGpuSourceKeyRef.current !== sourceKey) {
          gpuPreviewPipeline.setSource(previewData, previewWidth, previewHeight);
          lastGpuSourceKeyRef.current = sourceKey;
        }

        // dehaze is a source-pixel statistic; read the current param from basicAdjModule
        // (resolved above via imageProcessingPipeline.getModule('basicadj')) so the GPU
        // pipeline can compute the real haze floor (default 0 ⇒ inactive, no cost).
        const basicAdjDehaze = (() => {
          const p = basicAdjModule?.getParams?.() as { dehaze?: number } | undefined;
          return typeof p?.dehaze === 'number' ? p.dehaze : 0;
        })();
        gpuPreviewPipeline.setDehazeParam(basicAdjDehaze);

        gpuPreviewPipeline.render(passes);
        useAppStore.getState().setRenderMode('gpu');
        useAppStore.getState().bumpGpuResult();

        // Histogram stays live in gpu mode via a trailing, throttled GPU→CPU readback
        // (~150ms). This does NOT gate the present path (which reads the resident texture
        // directly) — it only refreshes processedImageData for the histogram consumers.
        if (gpuReadbackTimerRef.current) clearTimeout(gpuReadbackTimerRef.current);
        gpuReadbackTimerRef.current = setTimeout(() => {
          try {
            const rb = gpuPreviewPipeline.readback();
            useAppStore.getState().setProcessedImageData({
              data: rb,
              width: previewWidth,
              height: previewHeight,
              isPreview: true,
            });
          } catch (e) {
            logger.warn('GPU histogram readback failed:', e instanceof Error ? e.message : String(e));
          }
        }, 150);

        const processTime = performance.now() - startTime;
        const pipelineStats = imageProcessingPipeline.getStats();
        setProcessingStats({
          timeMs: processTime,
          active: pipelineStats.enabledModules,
          total: pipelineStats.moduleCount,
        });
        logger.debug(`GPU preview render completed in ${processTime.toFixed(2)}ms (${passes.length} passes), size: ${previewWidth}x${previewHeight}`);
        return; // GL canvas presents from the resident result — skip the CPU blit path.
      }

      // ── CPU fallback path (proven 2D-canvas blit) ───────────────────────────────
      useAppStore.getState().setRenderMode('cpu');

      // Route large previews (≥1MP) through the worker pool so pixel math runs
      // off the renderer main thread. The worker returns the TRUE output dims so
      // an active CropModule (which mutates context.width/height in-place) is
      // handled correctly across the structured-clone boundary.
      //
      // Decision: gpu | worker | main
      //   gpu    → handled above (GPU path, already returned)
      //   worker → ≥1MP AND worker pool available (lazy-init on first use)
      //   main   → tiny preview below 1MP threshold, OR worker unavailable
      //
      // On any worker error we fall back to main-thread processing so the app
      // never breaks if worker URL resolution fails in Electron.
      let processedData: Float32Array;
      let outputWidth = previewWidth;
      let outputHeight = previewHeight;

      if (previewPath === 'worker') {
        // Build WorkerModuleConfig from the LIVE pipeline state (same source the GPU
        // pass-list uses). `getParams()` returns a plain JSON-serialisable object so
        // it survives the structured-clone boundary without any manual conversion.
        const workerConfig: WorkerModuleConfig[] = orderedModules.map((m) => ({
          moduleId: m.getId(),
          enabled: m.isEnabled !== false,
          params: m.getParams() as Record<string, unknown>,
        }));

        try {
          const workerResult = await webWorkerImageProcessor.processImage(
            // kernelScale: same pass-level C5 scale as the main-thread context above (the worker
            // path forwards it to every tile verbatim — never re-derived from tile dims).
            { width: previewWidth, height: previewHeight, data: previewData, channels: 4, kernelScale },
            workerConfig,
          );

          if (workerResult.success) {
            processedData = workerResult.data;
            // Use the dims the WORKER returned — these are the post-crop output dims
            // (the worker's local ProcessingContext was mutated by CropModule).
            outputWidth  = workerResult.width  ?? previewWidth;
            outputHeight = workerResult.height ?? previewHeight;
            logger.debug(`CPU-worker preview completed in ${workerResult.processingTime.toFixed(2)}ms, out: ${outputWidth}x${outputHeight}`);
          } else {
            throw new Error(workerResult.error ?? 'Worker returned failure');
          }
        } catch (workerErr) {
          // Worker failed (URL resolution, crash, timeout) → graceful main-thread fallback.
          logger.warn('Worker processing failed, falling back to main thread:', workerErr instanceof Error ? workerErr.message : String(workerErr));
          processedData = await imageProcessingPipeline.processImage(previewData, processingContext, { useWebWorkers: false });
          outputWidth  = processingContext.width;
          outputHeight = processingContext.height;
        }
      } else {
        // Tiny preview — keep it on the main thread (worker overhead not worth it).
        processedData = await imageProcessingPipeline.processImage(previewData, processingContext, { useWebWorkers: false });
        // CRITICAL: CropModule mutates processingContext.width/height in place.
        outputWidth  = processingContext.width;
        outputHeight = processingContext.height;
      }

      // Discard stale results if a newer preview has already started.
      if (previewSeqRef.current !== seq) return;

      // Update UI once with final result — use the TRUE output dims.
      setProcessedImageData({
        data: processedData,
        width: outputWidth,
        height: outputHeight,
        isPreview: true,
      });

      const processTime = performance.now() - startTime;
      // Surface the real pipeline timing + active-module count in the StatusBar.
      const pipelineStats = imageProcessingPipeline.getStats();
      setProcessingStats({
        timeMs: processTime,
        active: pipelineStats.enabledModules,
        total: pipelineStats.moduleCount,
      });

      logger.debug(`Preview processing completed in ${processTime.toFixed(2)}ms, size: ${previewWidth}x${previewHeight}`);

    } catch (error) {
      logger.error('Real-time processing failed:', error);
      // Reset the timing so the StatusBar doesn't keep showing a stale duration
      // from the last successful render (its display is guarded on timeMs > 0);
      // keep the still-accurate module counts.
      const failedStats = imageProcessingPipeline.getStats();
      setProcessingStats({ timeMs: 0, active: failedStats.enabledModules, total: failedStats.moduleCount });
    } finally {
      clearTimeout(slowSpinnerTimer);
      // Only the latest run clears the store spinner, so an older run completing can't
      // wipe a newer run's spinner (and the newest run's finally always clears it).
      if (processingGenRef.current === gen) useAppStore.getState().setIsProcessing(false);
      setIsProcessing(false);
      isProcessingRef.current = false;
      // An edit arrived while we were busy — reprocess the latest state now.
      if (pendingReprocessRef.current) {
        pendingReprocessRef.current = false;
        useAppStore.getState().triggerReprocessing();
      }
    }
    // NOTE: deps deliberately exclude the isProcessing STATE — the body never reads it
    // (it uses isProcessingRef + setIsProcessing). Including it minted a new callback
    // identity on every run's true→false toggle, re-firing the [callback] effects below
    // in an endless reprocess loop (82 identical passes in the renderer log).
  }, [setProcessedImageData, setProcessingStats]);

  // Note: Removed viewport-triggered reprocessing as viewport changes (zoom, pan)
  // should not trigger image reprocessing - only display changes

  const handleModuleParamsChange = useCallback((moduleId: string, params: Record<string, unknown>, changeType: 'slider' | 'input' | 'button' | 'auto' = 'slider') => {
    logger.debug(`Module ${moduleId} parameters changed:`, params);

    // Crop panel edits (rotation slider, 90° buttons, flips, ratios) go
    // through the INNER CropModule — mirror the enable onto the ADAPTER, whose
    // flag resetAllModules() clears on every image open. Without this the whole
    // panel was a visual no-op on a fresh photo until an app restart (same gate
    // as the v1.29.0 interactive-drag fix; process() requires BOTH flags).
    if (moduleId === 'crop') {
      imageProcessingPipeline.getModule<CropPipelineModule>('crop')?.setEnabled(true);
    }

    // Invalidate cache for this module to ensure changes are processed
    imageProcessingPipeline.invalidateModuleCache(moduleId);

    // Use adaptive debouncing for better responsiveness
    adaptiveDebounceService.debounce(
      `module-${moduleId}`,
      () => {
        console.log('Debounced processing triggered for module:', moduleId);
        processCurrentImageRealTime();
      },
      {
        moduleId,
        parameterName: Object.keys(params)[0] || 'unknown',
        changeType
      },
      {
        priority: 'normal',
        adaptiveDelay: true,
        maxWait: 300 // Faster response for better UX
      }
    );
  }, [processCurrentImageRealTime]);

  const handleAutoWhiteBalance = useCallback(() => {
    // Reads currentImage pixels directly — during the progressive-open developing window
    // that's the graded preview, not the neutral full-res base (L3 review round 2).
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Auto White Balance')) return;
    const currentImage = imageService.getCurrentImage();
    if (!currentImage || !whiteBalanceModule) return;

    try {
      // Gray-candidate estimation + damped correction: estimate the illuminant from
      // near-neutral samples (median cast) and apply a partial temperature/tint
      // correction that cleans the cast without sterilising warm scenes. Channel
      // count is detected from the buffer (RGB or RGBA).
      const { data, width, height } = currentImage;
      const channels = Math.max(3, Math.round(data.length / (width * height)));
      whiteBalanceModule.autoDetectWhiteBalance(data, { width, height, channels });

      // Clear the WB (and downstream) pipeline cache so the new gains take effect,
      // and refresh the panel sliders to the detected temperature/tint.
      imageProcessingPipeline.invalidateModuleCache('temperature');
      useAppStore.getState().notifyExternalParamsChange();

      // Trigger immediate update after auto detection
      adaptiveDebounceService.debounce(
        'auto-white-balance',
        processCurrentImageRealTime,
        {
          moduleId: 'whitebalance',
          parameterName: 'auto',
          changeType: 'auto'
        },
        {
          priority: 'high', // High priority for auto operations
          immediate: false,
          adaptiveDelay: true
        }
      );

      logger.info('Auto white balance applied');
    } catch (error) {
      logger.error('Auto white balance failed:', error);
    }
  }, [whiteBalanceModule, processCurrentImageRealTime]);

  // Latest processing callback behind a stable ref: the mount/image effect below must
  // re-fire on IMAGE identity (mount + image-load listener events), never on callback
  // identity churn — a [processCurrentImageRealTime] dep re-ran the already-processed
  // image on every callback identity change.
  const processCallbackRef = useRef(processCurrentImageRealTime);
  processCallbackRef.current = processCurrentImageRealTime;

  // Monitor image changes for real-time updates
  useEffect(() => {
    // Add listener for new image loads
    const cleanup = imageService.addImageLoadListener(() => {
      logger.debug('New image loaded, triggering real-time processing');
      // Force module components to remount so they re-read the (reset) module params
      // instead of keeping stale styled values in their local useState
      setResetCounter(prev => prev + 1);
      processCallbackRef.current();
    });

    // Process current image if one is already loaded. Not a new trigger — if a pass is
    // already in flight for this image, don't queue a redundant follow-up.
    const currentImage = imageService.getCurrentImage();
    if (currentImage) {
      logger.debug('Image detected, ready for real-time processing');
      processCallbackRef.current({ queueIfBusy: false });
    }

    // Cleanup listener and debounce service on unmount
    return () => {
      cleanup();
      adaptiveDebounceService.cancelAll();
      progressivePreviewService.cancelActiveRequests();
      if (gpuReadbackTimerRef.current) {
        clearTimeout(gpuReadbackTimerRef.current);
        gpuReadbackTimerRef.current = null;
      }
    };
  }, []);

  // Watch for external processing triggers (e.g., from Canvas crop handles)
  useEffect(() => {
    if (processingVersion > 0) {
      logger.debug(`Processing triggered via store (version: ${processingVersion})`);
      // Use debouncing for consistent behavior with other parameter changes
      adaptiveDebounceService.debounce(
        'external-trigger',
        processCurrentImageRealTime,
        {
          moduleId: 'crop',
          parameterName: 'external',
          changeType: 'slider'
        },
        {
          priority: 'normal',
          adaptiveDelay: true,
          maxWait: 150 // Faster response for drag operations
        }
      );
    }
  }, [processingVersion, processCurrentImageRealTime]);

  // Helper function to determine module title from selectedModule ID
  const getModuleTitle = () => {
    const titles: Record<string, string> = {
      crop: 'Crop & Transform',
      basicadj: 'Basic Adjustments',
      whitebalance: 'White Balance',
      tonecurve: 'Tone Curve',
      enhance: 'Enhance',
      shadowshighlights: 'Shadows & Highlights',
      colorbalance: 'Color Balance',
      localadjustments: 'Local Adjustments',
      lenscorrections: 'Lens Corrections',
      history: 'History'
    };
    return titles[selectedModule || ''] || 'Develop';
  };

  // Card-header icon chip glyph, reusing each module's IconSidebar lucide icon.
  const getModuleIcon = (): ReactNode => {
    const icons: Record<string, ReactNode> = {
      crop: <Crop size={15} />,
      basicadj: <Sun size={15} />,
      whitebalance: <Droplet size={15} />,
      tonecurve: <Activity size={15} />,
      enhance: <Sparkles size={15} />,
      // basicadj already uses Sun (also the IconSidebar rail glyph for it) — shadowshighlights
      // needs its own identity, not on the rail, so no rail collision to worry about (round-6
      // P8 polish). Contrast is lucide's half-filled-circle glyph, a natural fit for tone
      // recovery between highlights and shadows.
      shadowshighlights: <Contrast size={15} />,
      colorbalance: <Palette size={15} />,
      localadjustments: <Sliders size={15} />,
      lenscorrections: <Focus size={15} />,
      history: <HistoryIcon size={15} />,
    };
    return icons[selectedModule || ''] ?? <Sliders size={15} />;
  };

  // Cheap state subtitle. WB/Crop are derived live; BasicAdj counts non-zero
  // params; the rest fall back to a static description (per the Task-2 brief).
  const getModuleSubtitle = (): string | undefined => {
    const countActive = (p: Record<string, unknown> | undefined): number =>
      p ? Object.values(p).filter((v) => typeof v === 'number' && v !== 0).length : 0;
    try {
      switch (selectedModule) {
        case 'whitebalance': {
          const p = whiteBalanceModule?.getParams() as { preset?: string; temperature?: number } | undefined;
          if (!p) return 'Temperature & tint';
          const raw = p.preset && p.preset !== 'custom' ? p.preset : 'Custom';
          const label = raw.charAt(0).toUpperCase() + raw.slice(1);
          return typeof p.temperature === 'number' ? `${label} · ${Math.round(p.temperature)} K` : label;
        }
        case 'crop': {
          const p = cropModule?.getParams() as { aspectRatio?: string; angle?: number } | undefined;
          if (!p) return 'Ratio & geometry';
          const ratio = p.aspectRatio && p.aspectRatio !== 'free' ? p.aspectRatio : 'Free';
          const angle = typeof p.angle === 'number' ? p.angle : 0;
          return angle ? `Ratio ${ratio} · ${angle > 0 ? '+' : ''}${angle.toFixed(1)}°` : `Ratio ${ratio}`;
        }
        case 'basicadj': {
          const n = countActive(basicAdjModule?.getParams() as Record<string, unknown> | undefined);
          return n > 0 ? `Develop · ${n} edit${n === 1 ? '' : 's'} active` : 'No adjustments';
        }
        case 'colorbalance': return 'Color grading';
        case 'tonecurve': return 'Curve editor';
        case 'enhance': return 'Detail & scale';
        case 'shadowshighlights': return 'Tone recovery';
        case 'localadjustments': return 'Masked adjustments';
        case 'lenscorrections': return 'Vignette · distortion · grain';
        case 'history': return 'Edit timeline';
        default: return 'Develop';
      }
    } catch {
      return undefined;
    }
  };

  return (
    <div className="flex flex-col h-full" style={{width: '100%', background: 'transparent'}}>
      {/* Width-agnostic: the floating right column (App.tsx, Task 5) sets the 392px
          slot width; the module card scrolls inside this body, never clipped. */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '0' }}>

        {/* RAW Decode — pinned above the module card; self-gates to RAW images only,
            so it's a no-op render for non-RAW files. */}
        <RawDecodePanel currentImage={currentImage} />

        {/* Unified module card (Glass · Sectioned §4): header chrome + body.
            Entrance stagger (§5): the module card rises +70ms after the histogram
            card (0ms). This div lives OUTSIDE the per-module remount key
            (`${id}-${paramSync}`, on the inner module components only), so the rise
            plays once per panel mount — switching modules or bumping
            externalParamsVersion re-keys the body, not this card, so it never replays. */}
        <div className="glass-card dc-rise" style={{ overflow: 'hidden', animationDelay: '70ms' }}>
          <ModuleCardHeader
            icon={getModuleIcon()}
            title={getModuleTitle()}
            subtitle={getModuleSubtitle()}
            onAuto={moduleActions?.auto}
            onReset={moduleActions?.reset}
          />

          {/* Module bodies. Each wrapper below pads sides/top (px-5 pt-4); the
              18px bottom padding (design spec card body: 14 16 18) lives HERE,
              once, so the last control never sits flush against the card edge —
              applied on the shared container instead of 10 individual wrappers. */}
          <div className="pb-[18px]">

        {/* Crop Module */}
        {cropModule && selectedModule === 'crop' && (() => {
          const img = imageService.getCurrentImage();
          return (
            <div className="px-5 pt-4">
              <CropModuleComponent
                key={`crop-${paramSync}`}
                module={cropModule.getCropModule()}
                onParamsChange={(params) => handleModuleParamsChange('crop', params)}
                imageData={img?.data}
                imageWidth={img?.width || 0}
                imageHeight={img?.height || 0}
                onRegisterActions={setModuleActions}
              />
            </div>
          );
        })()}

        {/* Basic Adjustments Module */}
        {basicAdjModule && selectedModule === 'basicadj' && (
          <div className="px-5 pt-4">
            <BasicAdjustmentsModuleComponent
              key={`basicadj-${paramSync}`}
              module={basicAdjModule}
              onParamsChange={(params) => handleModuleParamsChange('basicadj', params)}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* White Balance Module */}
        {whiteBalanceModule && selectedModule === 'whitebalance' && (
          <div className="px-5 pt-4">
            <WhiteBalanceModuleComponent
              key={`whitebalance-${paramSync}`}
              module={whiteBalanceModule}
              onParamsChange={(params) => handleModuleParamsChange('temperature', params)}
              onAutoDetect={handleAutoWhiteBalance}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* Tone Curve Module */}
        {toneCurveModule && selectedModule === 'tonecurve' && (
          <div className="px-5 pt-4">
            <ToneCurveModuleComponent
              key={`tonecurve-${paramSync}`}
              module={toneCurveModule.getToneCurveModule()}
              onParamsChange={(params) => handleModuleParamsChange('tonecurve', params)}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* Enhance Module */}
        {enhanceModuleInstance && noiseReductionModule && selectedModule === 'enhance' && (
          <div className="px-5 pt-4">
            <EnhanceModuleComponent
              key={`enhance-${paramSync}`}
              module={enhanceModuleInstance}
              noiseReductionModule={noiseReductionModule}
              onParamsChange={(params) => handleModuleParamsChange('enhance', params)}
              onNoiseReductionChange={(p) => handleModuleParamsChange('noise-reduction', p)}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* Shadows & Highlights Module */}
        {shadowsHighlightsModule && selectedModule === 'shadowshighlights' && (
          <div className="px-5 pt-4">
            <ShadowsHighlightsModuleComponent
              key={`shadowshighlights-${paramSync}`}
              module={shadowsHighlightsModule.getShadowsHighlightsModule()}
              onParamsChange={(params) => handleModuleParamsChange('shadowshighlights', params)}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* Color Balance Module */}
        {colorBalanceModule && selectedModule === 'colorbalance' && (
          <div className="px-5 pt-4">
            <ColorBalanceModuleComponent
              key={`colorbalance-${paramSync}`}
              module={colorBalanceModule.getColorBalanceModule()}
              onParamsChange={(params) => handleModuleParamsChange('colorbalance', params)}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {/* LocalAdjustments Module */}
        {localAdjustmentsModule && selectedModule === 'localadjustments' && (() => {
          const img = imageService.getCurrentImage();
          if (!img) return null;

          const la = localAdjustmentsModule.getParameters();
          const active = la.layers.find(l => l.id === la.activeLayerId);
          // Adjustments/geometry edits only need a reprocess; create/select also
          // remount the panel (refresh) so it re-reads the active layer's values.
          const reprocess = () => useAppStore.getState().triggerReprocessing();
          const refresh = () => useAppStore.getState().notifyExternalParamsChange();

          return (
            <div className="px-5 pt-4">
              <LocalAdjustmentsModuleComponent
                key={`localadjustments-${paramSync}`}
                parameters={active ? active.parameters : la.defaultParams}
                brushParams={la.brushParams}
                layers={la.layers}
                activeLayerId={la.activeLayerId}
                geometry={active?.geometry}
                onParametersChange={(params) => {
                  if (la.activeLayerId) localAdjustmentsModule.updateLayerParameters(la.activeLayerId, params);
                  reprocess();
                }}
                onBrushParamsChange={(params) => {
                  localAdjustmentsModule.updateBrushParameters(params);
                }}
                onCreateLayer={(type, name) => {
                  localAdjustmentsModule.createLayer(type, name, img.width, img.height);
                  refresh();
                  reprocess();
                }}
                onRemoveLayer={(layerId) => {
                  localAdjustmentsModule.removeLayer(layerId);
                  refresh();
                  reprocess();
                }}
                onToggleLayer={(layerId, enabled) => {
                  localAdjustmentsModule.toggleLayer(layerId, enabled);
                  reprocess();
                }}
                onSetActiveLayer={(layerId) => {
                  localAdjustmentsModule.setActiveLayer(layerId);
                  refresh();
                }}
                onUpdateLayerOpacity={(layerId, opacity) => {
                  localAdjustmentsModule.updateLayerOpacity(layerId, opacity);
                  reprocess();
                }}
                onUpdateGeometry={(geom) => {
                  if (la.activeLayerId) localAdjustmentsModule.setLayerGeometry(la.activeLayerId, geom, img.width, img.height);
                  reprocess();
                }}
                onRegisterActions={setModuleActions}
              />
            </div>
          );
        })()}

        {/* Lens Corrections Module */}
        {lensCorrectionsModule && selectedModule === 'lenscorrections' && (
          <div className="px-5 pt-4">
            <LensCorrectionsModuleComponent
              key={`lenscorrections-${paramSync}`}
              parameters={lensCorrectionsModule.getParameters().lensCorrectionsParams}
              onParametersChange={(params) => {
                // Actually apply the change to the module (a shallow merge — the
                // component sends a complete sub-section object), then reprocess.
                // Without this, toggles/sliders were dropped and the checkboxes
                // snapped back to the unchanged module value.
                const cur = lensCorrectionsModule.getParameters().lensCorrectionsParams;
                lensCorrectionsModule.setParameters({ lensCorrectionsParams: { ...cur, ...params } });
                handleModuleParamsChange('lenscorrections', params);
              }}
              onAutoDetectVignetting={() => {
                const img = imageService.getCurrentImage();
                if (img?.data) {
                  lensCorrectionsModule.autoDetectVignetting(img.data, img.width, img.height);
                  handleModuleParamsChange('lenscorrections', lensCorrectionsModule.getParameters().lensCorrectionsParams);
                  // Remount the component so its local UI state re-reads the module
                  // (auto-detect changes vignetting.enabled/amount under the hood).
                  useAppStore.getState().notifyExternalParamsChange();
                }
              }}
              onResetSection={(section) => {
                if (section === 'vignetting') {
                  lensCorrectionsModule.resetVignetting();
                } else if (section === 'distortion') {
                  lensCorrectionsModule.resetDistortion();
                } else if (section === 'chromaticAberration') {
                  lensCorrectionsModule.resetChromaticAberration();
                } else if (section === 'blur') {
                  lensCorrectionsModule.resetBlur();
                } else if (section === 'filmGrain') {
                  lensCorrectionsModule.resetFilmGrain();
                } else if (section === 'all') {
                  lensCorrectionsModule.reset();
                }
                handleModuleParamsChange('lenscorrections', lensCorrectionsModule.getParameters().lensCorrectionsParams);
                useAppStore.getState().notifyExternalParamsChange();
              }}
              onRegisterActions={setModuleActions}
            />
          </div>
        )}

        {selectedModule === 'history' && (
          <div className="px-5 pt-4">
            <HistoryPanel onRegisterActions={setModuleActions} />
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}