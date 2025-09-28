import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, RefreshCw, Expand, Minimize2 } from 'lucide-react';
import { BasicAdjustmentsModule } from '../../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../../modules/ShadowsHighlightsPipelineModule';
import { BasicAdjustmentsModuleComponent } from '../Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../Modules/WhiteBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../Modules/ColorBalanceModuleComponent';
import { ShadowsHighlightsModuleComponent } from '../Modules/ShadowsHighlightsModuleComponent';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { imageService } from '../../services/ImageService';
import { autoRawAdjustmentService } from '../../services/AutoRawAdjustmentService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface ModuleState {
  expanded: boolean;
  enabled: boolean;
}

export function AdjustmentPanel() {
  const { setProcessedImageData, currentImage, viewport } = useAppStore();
  const [moduleStates, setModuleStates] = useState<Record<string, ModuleState>>({
    // Core processing modules first (most commonly used)
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
  const [shouldForceProcessing] = useState(false);

  // Connect the processing pipeline to image service for auto-adjustments
  useEffect(() => {
    imageService.setProcessingPipeline(imageProcessingPipeline);
    logger.info('Processing pipeline connected to ImageService for auto-adjustments');
  }, []);

  // Get module instances from pipeline
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

    try {
      setIsProcessing(true);
      const startTime = performance.now();

      // Use less aggressive downscaling for higher quality preview (2x downscale, min 512px)
      const previewWidth = Math.max(512, Math.floor(currentImage.width / 2));
      const previewHeight = Math.max(512, Math.floor(currentImage.height / 2));

      logger.debug(`Processing preview: ${previewWidth}x${previewHeight} (downscaled from ${currentImage.width}x${currentImage.height})`);

      // Detect channel count from image data
      const expectedPixels = currentImage.width * currentImage.height;
      const actualChannels = currentImage.data.length / expectedPixels;
      const isRGB = Math.abs(actualChannels - 3) < 0.1; // Tolerance for floating point
      const sourceChannels = isRGB ? 3 : 4;

      logger.debug(`Image format detected: ${sourceChannels} channels (${isRGB ? 'RGB' : 'RGBA'})`);

      // Create downscaled image data for faster processing (always output RGBA)
      const scaleFactor = previewWidth / currentImage.width;
      const previewData = new Float32Array(previewWidth * previewHeight * 4);

      // Debug original image data
      const origMax = Math.max(...currentImage.data.slice(0, 1000));
      const origMin = Math.min(...currentImage.data.slice(0, 1000));
      const origSample = currentImage.data.slice(0, 8);
      console.log('AdjustmentPanel: Original data - min:', origMin, 'max:', origMax, 'sample:', Array.from(origSample), 'scaleFactor:', scaleFactor);

      // Optimized nearest neighbor downsampling with channel conversion
      for (let y = 0; y < previewHeight; y++) {
        for (let x = 0; x < previewWidth; x++) {
          const srcX = Math.floor(x / scaleFactor);
          const srcY = Math.floor(y / scaleFactor);
          const srcIdx = (srcY * currentImage.width + srcX) * sourceChannels;
          const dstIdx = (y * previewWidth + x) * 4;

          // Copy RGB channels
          previewData[dstIdx] = currentImage.data[srcIdx] || 0;     // R
          previewData[dstIdx + 1] = currentImage.data[srcIdx + 1] || 0; // G
          previewData[dstIdx + 2] = currentImage.data[srcIdx + 2] || 0; // B

          // Handle alpha channel
          if (sourceChannels === 4) {
            previewData[dstIdx + 3] = currentImage.data[srcIdx + 3] || 1.0; // A from source
          } else {
            previewData[dstIdx + 3] = 1.0; // Full opacity for RGB images
          }
        }
      }

      // Debug preview data after downsampling
      const previewMax = Math.max(...previewData.slice(0, 1000));
      const previewMin = Math.min(...previewData.slice(0, 1000));
      const previewSample = previewData.slice(0, 8);
      console.log('AdjustmentPanel: Preview data - min:', previewMin, 'max:', previewMax, 'sample:', Array.from(previewSample));

      // Check if this is a LibRaw-processed image (skip pipeline processing to preserve colors)
      const isLibRawProcessed = currentImage.data.length > 0 &&
        Math.max(...currentImage.data.slice(0, 1000)) <= 1.0 &&
        Math.min(...currentImage.data.slice(0, 1000)) > 0.0 &&
        // Additional check: LibRaw typically has good dynamic range distribution
        (previewMax - previewMin) > 0.5;

      let processedData: Float32Array;

      // Check if any modules are enabled (user made manual adjustments)
      const hasManualAdjustments = Object.values(moduleStates).some(state => state.enabled);

      if (isLibRawProcessed && !hasManualAdjustments && !shouldForceProcessing) {
        // LibRaw-processed image with no manual adjustments: skip pipeline to preserve accurate colors
        console.log('AdjustmentPanel: LibRaw-processed image detected with no manual adjustments, bypassing pipeline processing');
        processedData = previewData; // Use the image directly without pipeline processing
      } else {
        // Normal image, or LibRaw with manual adjustments, or forced processing: run through pipeline
        console.log('AdjustmentPanel: Running image through processing pipeline',
          isLibRawProcessed ? '(LibRaw with manual adjustments)' : '(normal processing)');
        processedData = await imageProcessingPipeline.processImage(previewData, {
          width: previewWidth,
          height: previewHeight,
          channels: 4 // RGBA
        }, false); // Disable web workers for preview
      }

      const processTime = performance.now() - startTime;
      setLastProcessingTime(processTime);
      logger.debug(`Real-time preview processing completed in ${processTime.toFixed(2)}ms`);

      // Store both original and processed data
      console.log('AdjustmentPanel: Setting processed data', previewWidth, 'x', previewHeight, 'channels:', sourceChannels, '->', 4);
      setProcessedImageData({
        data: processedData,
        width: previewWidth,
        height: previewHeight,
        isPreview: true
      });

    } catch (error) {
      logger.error('Real-time processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [setProcessedImageData, isProcessing, moduleStates, shouldForceProcessing]);

  // Trigger reprocessing when viewport changes (for zoom, pan, etc.)
  useEffect(() => {
    if (currentImage) {
      logger.debug('Viewport changed, triggering reprocessing');
      processCurrentImageRealTime();
    }
  }, [viewport, currentImage, processCurrentImageRealTime]);

  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  const handleModuleParamsChange = useCallback((moduleId: string, _params: Record<string, unknown>) => {
    logger.debug(`Module ${moduleId} parameters changed`);

    // Real-time processing is always enabled

    logger.debug('Scheduling debounced update');

    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new timer with faster debounce for better responsiveness
    const newTimer = setTimeout(() => {
      processCurrentImageRealTime();
      setDebounceTimer(null);
    }, 100); // Reduced to 100ms debounce for better responsiveness

    setDebounceTimer(newTimer);
  }, [processCurrentImageRealTime, debounceTimer]);

  const handleAutoWhiteBalance = useCallback(() => {
    const currentImage = imageService.getCurrentImage();
    if (!currentImage || !whiteBalanceModule) return;

    try {
      whiteBalanceModule.autoDetectWhiteBalance(currentImage.data, {
        width: currentImage.width,
        height: currentImage.height,
        channels: 4
      });

      // Trigger real-time update after auto detection
      processCurrentImageRealTime();

      logger.info('Auto white balance applied');
    } catch (error) {
      logger.error('Auto white balance failed:', error);
    }
  }, [whiteBalanceModule, processCurrentImageRealTime]);

  const resetAllModules = useCallback(() => {
    imageProcessingPipeline.resetAllModules();
    processCurrentImageRealTime();
    logger.info('All modules reset to defaults');
  }, [processCurrentImageRealTime]);

  // Check if all modules are expanded
  const areAllModulesExpanded = useCallback(() => {
    const visibleModules = ['basicadj', 'whitebalance', 'shadowshighlights', 'tonecurve', 'colorbalance'];
    return visibleModules.every(moduleId => moduleStates[moduleId]?.expanded === true);
  }, [moduleStates]);

  const toggleAllModules = useCallback(() => {
    const allExpanded = areAllModulesExpanded();

    setModuleStates(prev => {
      const newStates = { ...prev };
      const visibleModules = ['basicadj', 'whitebalance', 'shadowshighlights', 'tonecurve', 'colorbalance'];

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

    // Cleanup listener on unmount
    return cleanup;
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
                2x downscaled preview ({lastProcessingTime.toFixed(1)}ms)
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