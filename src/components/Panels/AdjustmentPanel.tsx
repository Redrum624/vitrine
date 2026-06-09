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
import { SharpenModule } from '../../modules/SharpenModule';
import { BasicAdjustmentsModuleComponent } from '../Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../Modules/WhiteBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../Modules/ColorBalanceModuleComponent';
import { ShadowsHighlightsModuleComponent } from '../Modules/ShadowsHighlightsModuleComponent';
import { CropModuleComponent } from '../Modules/CropModuleComponent';
import { LocalAdjustmentsModuleComponent } from '../Modules/LocalAdjustmentsModuleComponent';
import { LensCorrectionsModuleComponent } from '../Modules/LensCorrectionsModuleComponent';
import { HistoryPanel } from './HistoryPanel';
import { NoiseReductionModuleComponent } from '../Modules/NoiseReductionModuleComponent';
import { SharpenModuleComponent } from '../Modules/SharpenModuleComponent';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { imageService } from '../../services/ImageService';
import { progressivePreviewService } from '../../services/ProgressivePreviewService';
import { adaptiveDebounceService } from '../../services/AdaptiveDebounceService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface AdjustmentPanelProps {
  selectedModule?: string | null;
}

export function AdjustmentPanel({ selectedModule }: AdjustmentPanelProps) {
  const { setProcessedImageData, processingVersion, externalParamsVersion, setProcessingStats } = useAppStore();
  const [resetCounter, setResetCounter] = useState(0);
  // Remount the module panels (so each re-reads module.getParams() into its
  // sliders) on a manual Reset OR when params are set in bulk from outside the
  // panels (Paste Style / Auto All / presets). External bulk-setters bump
  // externalParamsVersion; normal slider drags do not, so editing isn't disrupted.
  const paramSync = `${resetCounter}-${externalParamsVersion}`;
  const [isProcessing, setIsProcessing] = useState(false);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessingTimeRef = useRef<number>(0);
  // Monotonic id per processing run. The 800ms spinner timer and the finally clear are
  // guarded on it so a stale/overlapping run can never leave the canvas spinner (and its
  // backdrop-blur overlay) stuck on — which read as a permanently "blurry/soft" image.
  const processingGenRef = useRef<number>(0);
  // Synchronous in-flight guard (React state is stale inside the async closure). Without
  // it a slow run (noise reduction) + a second edit ran two pipeline passes concurrently
  // through the shared WebGL processor, corrupting the output (blurry). A skipped run sets
  // `pending` so it re-runs once the current one finishes (no lost edits).
  const isProcessingRef = useRef<boolean>(false);
  const pendingReprocessRef = useRef<boolean>(false);
  // NOTE: Removed lastProcessedImagePathRef - was blocking param change reprocessing

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
  const sharpenModule = imageProcessingPipeline.getModule<SharpenModule>('sharpen');

  const processCurrentImageRealTime = useCallback(async () => {
    const currentImage = imageService.getCurrentImage();
    console.log('AdjustmentPanel: processCurrentImageRealTime called, currentImage:', currentImage ? `${currentImage.width}x${currentImage.height}` : 'null');

    if (!currentImage) return;

    // NOTE: Removed early return check for "same image already processed" because
    // it was blocking parameter change reprocessing. The check was meant for cached
    // navigation optimization but incorrectly blocked rotation/crop adjustments.
    // The debouncing and isProcessing checks provide sufficient protection.

    // Skip if a pipeline pass is already in flight (synchronous ref — React state is
    // stale here). Mark it pending so the latest state is reprocessed when this finishes.
    if (isProcessingRef.current) {
      pendingReprocessRef.current = true;
      logger.debug('Skipping processing - already in progress (queued)');
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

      // Temporarily use smaller downsampling to avoid issues
      // TODO: Fix downsampling algorithm properly later
      const MAX_PREVIEW_SIZE = 1024; // Smaller size for now to test fix
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

        // Simple downsampling - use every Nth pixel
        const scaleX = currentImage.width / previewWidth;
        const scaleY = currentImage.height / previewHeight;

        console.log(`AdjustmentPanel: Scale factors: ${scaleX.toFixed(2)}x horizontally, ${scaleY.toFixed(2)}x vertically`);

        previewData = new Float32Array(previewWidth * previewHeight * 4);

        for (let y = 0; y < previewHeight; y++) {
          for (let x = 0; x < previewWidth; x++) {
            // Use exact mapping to avoid aspect ratio distortion
            const srcX = Math.min(Math.floor(x * scaleX), currentImage.width - 1);
            const srcY = Math.min(Math.floor(y * scaleY), currentImage.height - 1);
            const srcIdx = (srcY * currentImage.width + srcX) * sourceChannels;
            const dstIdx = (y * previewWidth + x) * 4;

            previewData[dstIdx] = currentImage.data[srcIdx] || 0;
            previewData[dstIdx + 1] = currentImage.data[srcIdx + 1] || 0;
            previewData[dstIdx + 2] = currentImage.data[srcIdx + 2] || 0;
            previewData[dstIdx + 3] = sourceChannels === 4 ? (currentImage.data[srcIdx + 3] || 1.0) : 1.0;
          }
        }
      }

      // Debug the preview data
      const samplePreview = previewData.slice(0, 100);
      const previewNonZero = samplePreview.filter(val => val > 0).length;
      console.log(`AdjustmentPanel: Preview data created - nonZero: ${previewNonZero}/100, range: ${Math.min(...samplePreview)} - ${Math.max(...samplePreview)}, sample:`, samplePreview.slice(0, 8));

      // Always run through processing pipeline to ensure module effects are applied
      // The pipeline has its own optimizations to skip unchanged modules
      console.log('AdjustmentPanel: Processing preview', previewWidth, 'x', previewHeight);

      // CRITICAL: Create context object to track dimension changes from rotation/crop
      const processingContext = {
        width: previewWidth,
        height: previewHeight,
        channels: 4
      };

      const processedData = await imageProcessingPipeline.processImage(previewData, processingContext, false); // Disable web workers for preview

      // CRITICAL: Use the context dimensions which may have been updated by CropModule rotation
      // When expandCanvas is true during rotation, the output dimensions change
      const outputWidth = processingContext.width;
      const outputHeight = processingContext.height;

      console.log(`AdjustmentPanel: Processed dimensions: ${outputWidth}x${outputHeight} (input was ${previewWidth}x${previewHeight})`);

      // Validate that the data length matches the output dimensions
      const expectedLength = outputWidth * outputHeight * 4;
      if (processedData.length !== expectedLength) {
        console.warn(`AdjustmentPanel: Data length mismatch! Expected ${expectedLength}, got ${processedData.length}`);
        // Try to infer correct dimensions from data length
        const actualPixels = processedData.length / 4;
        const inferredHeight = Math.round(Math.sqrt(actualPixels / (outputWidth / outputHeight)));
        const inferredWidth = Math.round(inferredHeight * (outputWidth / outputHeight));
        console.log(`AdjustmentPanel: Inferring dimensions as ${inferredWidth}x${inferredHeight}`);
      }

      // Critical debugging: Track data before passing to Canvas
      const stats = { min: Infinity, max: -Infinity, nonZero: 0 };
      for (let i = 0; i < processedData.length; i += 4) {
        const r = processedData[i], g = processedData[i + 1], b = processedData[i + 2];
        stats.min = Math.min(stats.min, r, g, b);
        stats.max = Math.max(stats.max, r, g, b);
        if (r > 0.001 || g > 0.001 || b > 0.001) stats.nonZero++;
      }
      logger.info(`AdjustmentPanel: FINAL DATA before Canvas - range=${stats.min.toFixed(4)}-${stats.max.toFixed(4)}, nonZero=${stats.nonZero}/${processedData.length/4}`);

      // Update UI once with final result - use OUTPUT dimensions from context
      setProcessedImageData({
        data: processedData,
        width: outputWidth,
        height: outputHeight,
        isPreview: true
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
  }, [setProcessedImageData, setProcessingStats, isProcessing]);

  // Note: Removed viewport-triggered reprocessing as viewport changes (zoom, pan)
  // should not trigger image reprocessing - only display changes

  const handleModuleParamsChange = useCallback((moduleId: string, params: Record<string, unknown>, changeType: 'slider' | 'input' | 'button' | 'auto' = 'slider') => {
    logger.debug(`Module ${moduleId} parameters changed:`, params);

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
    const currentImage = imageService.getCurrentImage();
    if (!currentImage || !whiteBalanceModule) return;

    try {
      // Median gray-world: scan the image for its overall median colour cast and
      // neutralise it (both temperature/warmth AND tint). Channel count is detected
      // from the buffer (RGB or RGBA).
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

  const resetAllModules = useCallback(() => {
    // Call resetParams() on each module individually, just like individual reset buttons do
    // This ensures the exact same behavior as clicking each reset button

    // Reset new modules first (Crop & Transform unified, Lens Corrections, Local Adjustments)
    if (cropModule) {
      cropModule.reset();
      const cropParams = cropModule.getParams();
      handleModuleParamsChange('crop', cropParams, 'button');
    }

    if (lensCorrectionsModule) {
      lensCorrectionsModule.reset();
      const lensParams = lensCorrectionsModule.getParameters();
      handleModuleParamsChange('lenscorrections', lensParams.lensCorrectionsParams, 'button');
    }

    if (localAdjustmentsModule) {
      localAdjustmentsModule.reset();
      const localParams = localAdjustmentsModule.getParameters();
      handleModuleParamsChange('localadjustments', localParams.defaultParams, 'button');
    }

    // Reset core modules
    if (basicAdjModule) {
      basicAdjModule.resetParams();
      const basicAdjParams = basicAdjModule.getParams();
      handleModuleParamsChange('basicadj', basicAdjParams, 'button');
    }

    if (whiteBalanceModule) {
      whiteBalanceModule.resetParams();
      const whiteBalanceParams = whiteBalanceModule.getParams();
      handleModuleParamsChange('temperature', whiteBalanceParams, 'button');
    }

    // ToneCurve, ColorBalance, and ShadowsHighlights are pipeline modules
    // They need to be reset through the pipeline's resetAllModules method
    // since they don't have individual resetParams methods
    imageProcessingPipeline.resetAllModules();

    // Increment reset counter to force all module components to refresh
    setResetCounter(prev => prev + 1);

    // Clear debounce history since we're resetting everything
    adaptiveDebounceService.clearHistory();

    // Immediate processing for reset operations
    adaptiveDebounceService.debounce(
      'reset-all-modules',
      processCurrentImageRealTime,
      {
        moduleId: 'all',
        parameterName: 'reset',
        changeType: 'button'
      },
      {
        priority: 'high',
        immediate: false,
        adaptiveDelay: false
      }
    );

    logger.info('All modules reset to defaults');
  }, [processCurrentImageRealTime, basicAdjModule, whiteBalanceModule, handleModuleParamsChange, cropModule, lensCorrectionsModule, localAdjustmentsModule]);

  // Monitor image changes for real-time updates
  useEffect(() => {
    // Add listener for new image loads
    const cleanup = imageService.addImageLoadListener(() => {
      logger.debug('New image loaded, triggering real-time processing');
      // Force module components to remount so they re-read the (reset) module params
      // instead of keeping stale styled values in their local useState
      setResetCounter(prev => prev + 1);
      processCurrentImageRealTime();
    });

    // Process current image if one is already loaded
    const currentImage = imageService.getCurrentImage();
    if (currentImage) {
      logger.debug('Image detected, ready for real-time processing');
      processCurrentImageRealTime();
    }

    // Cleanup listener and debounce service on unmount
    return () => {
      cleanup();
      adaptiveDebounceService.cancelAll();
      progressivePreviewService.cancelActiveRequests();
    };
  }, [processCurrentImageRealTime]);

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
      noisereduction: 'Noise Reduction',
      sharpen: 'Sharpen',
      shadowshighlights: 'Shadows & Highlights',
      colorbalance: 'Color Balance',
      localadjustments: 'Local Adjustments',
      lenscorrections: 'Lens Corrections',
      history: 'History'
    };
    return titles[selectedModule || ''] || 'Develop';
  };

  return (
    <div className="flex flex-col h-full" style={{width: '360px', backgroundColor: 'var(--gray-900)'}}>
      {/* Header - Redesigned */}
      <div className="border-b flex items-center justify-between" style={{padding: '14px 20px', borderBottomColor: 'var(--border)', backgroundColor: 'var(--black)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-sm" style={{backgroundColor: 'var(--white)'}} />
          <h2 className="text-white font-semibold uppercase tracking-wider" style={{fontSize: '11px', fontWeight: 600, letterSpacing: '1.5px'}}>
            {getModuleTitle()}
          </h2>
        </div>
        <button
          onClick={resetAllModules}
          className="border-0 cursor-pointer px-3 py-1.5 rounded text-xs font-medium"
          style={{
            backgroundColor: 'var(--gray-850)',
            color: 'var(--gray-300)',
            transition: 'var(--transition-fast)',
            border: '1px solid var(--border)',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--white)';
            e.currentTarget.style.backgroundColor = 'var(--gray-800)';
            e.currentTarget.style.borderColor = 'var(--border-light)';
            e.currentTarget.style.cursor = 'pointer';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--gray-300)';
            e.currentTarget.style.backgroundColor = 'var(--gray-850)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.cursor = 'pointer';
          }}
          title="Reset all adjustments to defaults"
        >
          Reset All
        </button>
      </div>

      {/* Darktable Modules */}
      <div className="flex-1 overflow-y-auto">

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
            />
          </div>
        )}

        {/* Noise Reduction Module */}
        {noiseReductionModule && selectedModule === 'noisereduction' && (
          <div className="px-5 pt-4">
            <NoiseReductionModuleComponent
              key={`noisereduction-${paramSync}`}
              module={noiseReductionModule}
              onParamsChange={(params) => handleModuleParamsChange('noisereduction', params)}
            />
          </div>
        )}

        {/* Sharpen Module */}
        {sharpenModule && selectedModule === 'sharpen' && (
          <div className="px-5 pt-4">
            <SharpenModuleComponent
              key={`sharpen-${paramSync}`}
              module={sharpenModule}
              onParamsChange={(params) => handleModuleParamsChange('sharpen', params)}
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
            />
          </div>
        )}

        {selectedModule === 'history' && (
          <div className="px-5 pt-4">
            <HistoryPanel />
          </div>
        )}

        {/* Processing Stats */}
        <div className="p-3 text-xs" style={{backgroundColor: 'var(--gray-850)', color: 'var(--gray-400)'}}>
          <div className="space-y-1">
            <div>Pipeline: {imageProcessingPipeline.getStats().enabledModules} modules active</div>
            <div>Real-time: 100ms debounce, 4x downscaled preview (main thread)</div>
          </div>
        </div>
      </div>
    </div>
  );
}