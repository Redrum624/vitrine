import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, RefreshCw, Expand, Minimize2 } from 'lucide-react';
import { BasicAdjustmentsModule } from '../../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../../modules/ShadowsHighlightsPipelineModule';
import { CropPipelineModule } from '../../modules/CropPipelineModule';
import { TransformPipelineModule } from '../../modules/TransformPipelineModule';
import { BasicAdjustmentsModuleComponent } from '../Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../Modules/WhiteBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../Modules/ColorBalanceModuleComponent';
import { ShadowsHighlightsModuleComponent } from '../Modules/ShadowsHighlightsModuleComponent';
import { CropModuleComponent } from '../Modules/CropModuleComponent';
import { TransformModuleComponent } from '../Modules/TransformModuleComponent';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { imageService } from '../../services/ImageService';
import { autoRawAdjustmentService } from '../../services/AutoRawAdjustmentService';
import { progressivePreviewService } from '../../services/ProgressivePreviewService';
import { adaptiveDebounceService } from '../../services/AdaptiveDebounceService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface ModuleState {
  expanded: boolean;
  enabled: boolean;
}

export function AdjustmentPanel() {
  const { setProcessedImageData, currentImage } = useAppStore();
  const [resetCounter, setResetCounter] = useState(0);
  const [moduleStates, setModuleStates] = useState<Record<string, ModuleState>>({
    // Geometric operations (first)
    crop: { expanded: false, enabled: false },
    transform: { expanded: false, enabled: false },
    // Core processing modules
    exposure: { expanded: true, enabled: true },
    basicadj: { expanded: false, enabled: true },
    whitebalance: { expanded: false, enabled: true },
    shadowshighlights: { expanded: false, enabled: true },
    tonecurve: { expanded: false, enabled: true },
    colorbalance: { expanded: false, enabled: true },
    // Advanced processing
    localadjustments: { expanded: false, enabled: false },
    lenscorrections: { expanded: false, enabled: false },
    noisereduction: { expanded: false, enabled: false },
    lenscorrection: { expanded: false, enabled: false },
    advancedraw: { expanded: false, enabled: false },
    luminositymasks: { expanded: false, enabled: false },
    // Output modules (bottom)
    print: { expanded: false, enabled: false },
    webgallery: { expanded: false, enabled: false },
    watermark: { expanded: false, enabled: false },
    copyright: { expanded: false, enabled: false },
    outputcollections: { expanded: false, enabled: false }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessingTime, setLastProcessingTime] = useState(0);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessingTimeRef = useRef<number>(0);

  // Connect the processing pipeline to image service for auto-adjustments
  useEffect(() => {
    imageService.setProcessingPipeline(imageProcessingPipeline);
    logger.info('Processing pipeline connected to ImageService for auto-adjustments');
  }, []);

  // Get module instances from pipeline
  const cropModule = imageProcessingPipeline.getModule<CropPipelineModule>('crop');
  const transformModule = imageProcessingPipeline.getModule<TransformPipelineModule>('transform');
  const whiteBalanceModule = imageProcessingPipeline.getModule<WhiteBalanceModule>('temperature');
  const basicAdjModule = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj');
  const toneCurveModule = imageProcessingPipeline.getModule<ToneCurvePipelineModule>('tonecurve');
  const colorBalanceModule = imageProcessingPipeline.getModule<ColorBalancePipelineModule>('colorbalance');
  const shadowsHighlightsModule = imageProcessingPipeline.getModule<ShadowsHighlightsPipelineModule>('shadowshighlights');

  const toggleModule = useCallback((moduleId: string) => {
    setModuleStates(prev => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        expanded: !prev[moduleId]?.expanded
      }
    }));
  }, []);

  const processCurrentImageRealTime = useCallback(async () => {
    const currentImage = imageService.getCurrentImage();
    console.log('AdjustmentPanel: processCurrentImageRealTime called, currentImage:', currentImage ? `${currentImage.width}x${currentImage.height}` : 'null');

    if (!currentImage) return;

    // Skip processing if already processing
    if (isProcessing) {
      logger.debug('Skipping processing - already in progress');
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

    // Clear any pending timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }

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

      // Check if any modules are enabled (user made manual adjustments)
      const hasManualAdjustments = Object.values(moduleStates).some(state => state.enabled);


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
      console.log('AdjustmentPanel: Processing preview', previewWidth, 'x', previewHeight, 'hasAdjustments:', hasManualAdjustments);
      const processedData = await imageProcessingPipeline.processImage(previewData, {
        width: previewWidth,
        height: previewHeight,
        channels: 4
      }, false); // Disable web workers for preview

      // Critical debugging: Track data before passing to Canvas
      const stats = { min: Infinity, max: -Infinity, nonZero: 0 };
      for (let i = 0; i < processedData.length; i += 4) {
        const r = processedData[i], g = processedData[i + 1], b = processedData[i + 2];
        stats.min = Math.min(stats.min, r, g, b);
        stats.max = Math.max(stats.max, r, g, b);
        if (r > 0.001 || g > 0.001 || b > 0.001) stats.nonZero++;
      }
      logger.info(`AdjustmentPanel: FINAL DATA before Canvas - range=${stats.min.toFixed(4)}-${stats.max.toFixed(4)}, nonZero=${stats.nonZero}/${processedData.length/4}`);

      // Update UI once with final result
      setProcessedImageData({
        data: processedData,
        width: previewWidth,
        height: previewHeight,
        isPreview: true
      });

      const processTime = performance.now() - startTime;
      setLastProcessingTime(processTime);

      logger.debug(`Preview processing completed in ${processTime.toFixed(2)}ms, size: ${previewWidth}x${previewHeight}`);

    } catch (error) {
      logger.error('Real-time processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [setProcessedImageData, isProcessing, moduleStates]);

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
      whiteBalanceModule.autoDetectWhiteBalance(currentImage.data, {
        width: currentImage.width,
        height: currentImage.height,
        channels: 4
      });

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
  }, [processCurrentImageRealTime, basicAdjModule, whiteBalanceModule, handleModuleParamsChange]);

  // Check if all modules are expanded
  const areAllModulesExpanded = useCallback(() => {
    const visibleModules = ['crop', 'transform', 'basicadj', 'whitebalance', 'shadowshighlights', 'tonecurve', 'colorbalance'];
    return visibleModules.every(moduleId => moduleStates[moduleId]?.expanded === true);
  }, [moduleStates]);

  const toggleAllModules = useCallback(() => {
    const allExpanded = areAllModulesExpanded();

    setModuleStates(prev => {
      const newStates = { ...prev };
      const visibleModules = ['crop', 'transform', 'basicadj', 'whitebalance', 'shadowshighlights', 'tonecurve', 'colorbalance'];

      visibleModules.forEach(key => {
        if (newStates[key]) {
          newStates[key] = { ...newStates[key], expanded: !allExpanded };
        }
      });
      return newStates;
    });

    logger.info(allExpanded ? 'All modules retracted' : 'All modules expanded');
  }, [areAllModulesExpanded]);

  // Monitor image changes for real-time updates
  useEffect(() => {
    // Add listener for new image loads
    const cleanup = imageService.addImageLoadListener(() => {
      logger.debug('New image loaded, triggering real-time processing');
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

  return (
    <div className="w-80 bg-dark-900 border-dark-700 flex flex-col h-full rounded-r-lg">
      {/* Header */}
      <div className="p-3 border-b border-dark-700 rounded-tr-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-dark-300">Develop</h2>
            {lastProcessingTime > 0 && !isProcessing && (
              <div className="text-xs text-center text-dark-500">
                High quality preview ({lastProcessingTime.toFixed(1)}ms)
              </div>
            )}
          </div>
          <div className="flex items-center space-x-1">
            {currentImage?.isRaw && (
              <button
                onClick={() => {
                  if (currentImage && imageService.getProcessingPipeline()) {
                    autoRawAdjustmentService.resetAutoAdjustments(imageService.getProcessingPipeline()!);
                    processCurrentImageRealTime();
                    logger.info('RAW auto-adjustments reset');
                  }
                }}
                className="p-1 hover:bg-dark-700 rounded text-dark-300 transition-professional"
                title="Reset RAW auto-adjustments"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={resetAllModules}
              className="p-1 hover:bg-dark-700 rounded text-dark-300 transition-professional"
              title="Reset all modules"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={toggleAllModules}
              className="p-1 hover:bg-dark-700 rounded text-dark-300 transition-professional"
              title={areAllModulesExpanded() ? "Retract all modules" : "Expand all modules"}
            >
              {areAllModulesExpanded() ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Expand className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Darktable Modules */}
      <div className="flex-1 overflow-y-auto">

        {/* Crop Module */}
        {cropModule && (() => {
          const img = imageService.getCurrentImage();
          if (!img) return null;
          return (
            <div className="border-b border-dark-800">
              <button
                onClick={() => toggleModule('crop')}
                className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Crop</span>
                {moduleStates.crop?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>

              {moduleStates.crop?.expanded && (
                <div className="px-3 pb-3">
                  <CropModuleComponent
                    key={`crop-${resetCounter}`}
                    module={cropModule.getCropModule()}
                    onParamsChange={(params) => handleModuleParamsChange('crop', params)}
                    imageWidth={img.width}
                    imageHeight={img.height}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Transform Module */}
        {transformModule && (() => {
          const img = imageService.getCurrentImage();
          if (!img) return null;
          return (
            <div className="border-b border-dark-800">
              <button
                onClick={() => toggleModule('transform')}
                className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Transform</span>
                {moduleStates.transform?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>

              {moduleStates.transform?.expanded && (
                <div className="px-3 pb-3">
                  <TransformModuleComponent
                    key={`transform-${resetCounter}`}
                    module={transformModule.getTransformModule()}
                    onParamsChange={(params) => handleModuleParamsChange('transform', params)}
                    onAutoStraighten={() => {
                      // Re-process after auto-straighten
                      processCurrentImageRealTime();
                    }}
                    imageData={img.data}
                    imageWidth={img.width}
                    imageHeight={img.height}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Basic Adjustments Module */}
        {basicAdjModule && (
          <div className="border-b border-dark-800">
            <button
              onClick={() => toggleModule('basicadj')}
              className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">Basic Adjustments</span>
              {moduleStates.basicadj?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>

            {moduleStates.basicadj?.expanded && (
              <div className="px-3 pb-3">
                <BasicAdjustmentsModuleComponent
                  key={`basicadj-${resetCounter}`}
                  module={basicAdjModule}
                  onParamsChange={(params) => handleModuleParamsChange('basicadj', params)}
                />
              </div>
            )}
          </div>
        )}

        {/* White Balance Module */}
        {whiteBalanceModule && (
          <div className="border-b border-dark-800">
            <button
              onClick={() => toggleModule('whitebalance')}
              className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">White Balance</span>
              {moduleStates.whitebalance?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>

            {moduleStates.whitebalance?.expanded && (
              <div className="px-3 pb-3">
                <WhiteBalanceModuleComponent
                  key={`whitebalance-${resetCounter}`}
                  module={whiteBalanceModule}
                  onParamsChange={(params) => handleModuleParamsChange('temperature', params)}
                  onAutoDetect={handleAutoWhiteBalance}
                />
              </div>
            )}
          </div>
        )}

        {/* Shadows & Highlights Module */}
        {shadowsHighlightsModule && (
          <div className="border-b border-dark-800">
            <button
              onClick={() => toggleModule('shadowshighlights')}
              className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">Shadows & Highlights</span>
              {moduleStates.shadowshighlights?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>

            {moduleStates.shadowshighlights?.expanded && (
              <div className="px-3 pb-3">
                <ShadowsHighlightsModuleComponent
                  key={`shadowshighlights-${resetCounter}`}
                  module={shadowsHighlightsModule.getShadowsHighlightsModule()}
                  onParamsChange={(params) => handleModuleParamsChange('shadowshighlights', params)}
                />
              </div>
            )}
          </div>
        )}

        {/* Tone Curve Module */}
        {toneCurveModule && (
          <div className="border-b border-dark-800">
            <button
              onClick={() => toggleModule('tonecurve')}
              className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">Tone Curve</span>
              {moduleStates.tonecurve?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>

            {moduleStates.tonecurve?.expanded && (
              <div className="px-3 pb-3">
                <ToneCurveModuleComponent
                  key={`tonecurve-${resetCounter}`}
                  module={toneCurveModule.getToneCurveModule()}
                  onParamsChange={(params) => handleModuleParamsChange('tonecurve', params)}
                />
              </div>
            )}
          </div>
        )}

        {/* Color Balance Module */}
        {colorBalanceModule && (
          <div className="border-b border-dark-800">
            <button
              onClick={() => toggleModule('colorbalance')}
              className="w-full p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">Color Balance</span>
              {moduleStates.colorbalance?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>

            {moduleStates.colorbalance?.expanded && (
              <div className="px-3 pb-3">
                <ColorBalanceModuleComponent
                  key={`colorbalance-${resetCounter}`}
                  module={colorBalanceModule.getColorBalanceModule()}
                  onParamsChange={(params) => handleModuleParamsChange('colorbalance', params)}
                />
              </div>
            )}
          </div>
        )}


        {/* Processing Stats */}
        <div className="p-3 bg-dark-850 text-xs text-dark-400">
          <div className="space-y-1">
            <div>Pipeline: {imageProcessingPipeline.getStats().enabledModules} modules active</div>
            <div>Real-time: 100ms debounce, 4x downscaled preview (main thread)</div>
          </div>
        </div>
      </div>
    </div>
  );
}