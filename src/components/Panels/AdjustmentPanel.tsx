import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { ExposureModule } from '../../modules/ExposureModule';
import { BasicAdjustmentsModule } from '../../modules/BasicAdjustmentsModule';
import { WhiteBalanceModule } from '../../modules/WhiteBalanceModule';
import { ToneCurvePipelineModule } from '../../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../../modules/ColorBalancePipelineModule';
import { ShadowsHighlightsPipelineModule } from '../../modules/ShadowsHighlightsPipelineModule';
import { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import { LensCorrectionsPipelineModule } from '../../modules/LensCorrectionsPipelineModule';
import { ExposureModuleComponent } from '../Modules/ExposureModuleComponent';
import { BasicAdjustmentsModuleComponent } from '../Modules/BasicAdjustmentsModuleComponent';
import { WhiteBalanceModuleComponent } from '../Modules/WhiteBalanceModuleComponent';
import { ToneCurveModuleComponent } from '../Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../Modules/ColorBalanceModuleComponent';
import { ShadowsHighlightsModuleComponent } from '../Modules/ShadowsHighlightsModuleComponent';
import { LocalAdjustmentsModuleComponent } from '../Modules/LocalAdjustmentsModuleComponent';
import { LensCorrectionsModuleComponent } from '../Modules/LensCorrectionsModuleComponent';
import { AdvancedRawModule } from '../Modules/AdvancedRawModule';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { imageService } from '../../services/ImageService';
import { useAppStore } from '../../stores/appStore';
import { logger } from '../../utils/Logger';

interface ModuleState {
  expanded: boolean;
  enabled: boolean;
}

export function AdjustmentPanel() {
  const { setProcessedImageData } = useAppStore();
  const [moduleStates, setModuleStates] = useState<Record<string, ModuleState>>({
    advancedraw: { expanded: false, enabled: false },
    exposure: { expanded: true, enabled: true },
    whitebalance: { expanded: false, enabled: true },
    basicadj: { expanded: false, enabled: true },
    tonecurve: { expanded: false, enabled: true },
    colorbalance: { expanded: false, enabled: true },
    shadowshighlights: { expanded: false, enabled: true },
    localadjustments: { expanded: false, enabled: false },
    lenscorrections: { expanded: false, enabled: false }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessingTime, setLastProcessingTime] = useState(0);

  // Get module instances from pipeline
  const exposureModule = imageProcessingPipeline.getModule<ExposureModule>('exposure');
  const whiteBalanceModule = imageProcessingPipeline.getModule<WhiteBalanceModule>('temperature');
  const basicAdjModule = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj');
  const toneCurveModule = imageProcessingPipeline.getModule<ToneCurvePipelineModule>('tonecurve');
  const colorBalanceModule = imageProcessingPipeline.getModule<ColorBalancePipelineModule>('colorbalance');
  const shadowsHighlightsModule = imageProcessingPipeline.getModule<ShadowsHighlightsPipelineModule>('shadowshighlights');
  const localAdjustmentsModule = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
  const lensCorrectionsModule = imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections');

  const toggleModule = useCallback((moduleId: string) => {
    setModuleStates(prev => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        expanded: !prev[moduleId]?.expanded
      }
    }));
  }, []);

  const toggleModuleEnabled = useCallback((moduleId: string) => {
    setModuleStates(prev => {
      const newEnabled = !prev[moduleId]?.enabled;
      imageProcessingPipeline.setModuleEnabled(moduleId, newEnabled);
      logger.info(`Module ${moduleId} ${newEnabled ? 'enabled' : 'disabled'}`);

      // Trigger real-time update
      processCurrentImageRealTime();

      return {
        ...prev,
        [moduleId]: {
          ...prev[moduleId],
          enabled: newEnabled
        }
      };
    });
  }, []);

  const processCurrentImageRealTime = useCallback(async () => {
    const currentImage = imageService.getCurrentImage();
    if (!currentImage) return;

    try {
      setIsProcessing(true);
      const startTime = performance.now();

      // Process with current pipeline settings
      const processedData = await imageProcessingPipeline.processImage(currentImage.data, {
        width: currentImage.width,
        height: currentImage.height,
        channels: 4 // RGBA
      });

      const processTime = performance.now() - startTime;
      setLastProcessingTime(processTime);
      logger.debug(`Real-time processing completed in ${processTime.toFixed(2)}ms`);

      // Update store with processed image data for Canvas display
      setProcessedImageData(processedData);

    } catch (error) {
      logger.error('Real-time processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [setProcessedImageData]);

  const handleModuleParamsChange = useCallback((moduleId: string, _params: any) => {
    logger.debug(`Module ${moduleId} parameters changed, triggering real-time update`);

    // Debounce rapid changes for performance
    setTimeout(() => {
      processCurrentImageRealTime();
    }, 50); // 50ms debounce
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
    <div className="w-80 bg-dark-900 border-l border-dark-700 flex flex-col h-full rounded-r-lg">
      {/* Header */}
      <div className="p-3 border-b border-dark-700 rounded-tr-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-dark-300">Develop</h2>
          <div className="flex items-center space-x-1">
            <button
              onClick={resetAllModules}
              className="p-1 hover:bg-dark-700 rounded text-dark-300 transition-professional"
              title="Reset all modules"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Processing Pipeline Status */}
      <div className="px-3 py-2 bg-dark-850 border-b border-dark-800">
        <div className="flex items-center justify-between text-xs">
          <div className="text-dark-400">
            Real-time processing: {isProcessing ? (
              <span className="text-yellow-400 animate-pulse">Processing...</span>
            ) : (
              <span className="text-green-400">Ready</span>
            )}
          </div>
          {lastProcessingTime > 0 && !isProcessing && (
            <div className="text-dark-500">
              {lastProcessingTime.toFixed(1)}ms
            </div>
          )}
        </div>
      </div>

      {/* Darktable Modules */}
      <div className="flex-1 overflow-y-auto">

        {/* Lens Corrections Module */}
        {lensCorrectionsModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('lenscorrections')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Lens Corrections</span>
                {moduleStates.lenscorrections?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('lenscorrections')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.lenscorrections?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.lenscorrections?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.lenscorrections?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {moduleStates.lenscorrections?.expanded && (
              <div className="px-3 pb-3">
                <LensCorrectionsModuleComponent
                  parameters={lensCorrectionsModule.getParameters().lensCorrectionsParams}
                  onParametersChange={(params) => {
                    lensCorrectionsModule.setParameters({ lensCorrectionsParams: params });
                    handleModuleParamsChange('lenscorrections', params);
                  }}
                  onAutoDetectVignetting={() => {
                    const currentImage = imageService.getCurrentImage();
                    if (currentImage) {
                      lensCorrectionsModule.autoDetectVignetting(
                        currentImage.data,
                        currentImage.width,
                        currentImage.height
                      );
                      handleModuleParamsChange('lenscorrections', {});
                    }
                  }}
                  onResetSection={(section) => {
                    if (section === 'all') {
                      lensCorrectionsModule.reset();
                    } else if (section === 'vignetting') {
                      lensCorrectionsModule.resetVignetting();
                    } else if (section === 'distortion') {
                      lensCorrectionsModule.resetDistortion();
                    } else if (section === 'chromaticAberration') {
                      lensCorrectionsModule.resetChromaticAberration();
                    }
                    handleModuleParamsChange('lenscorrections', {});
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Advanced RAW Processing Module */}
        <div className="border-b border-dark-800">
          <div className="flex items-center">
            <button
              onClick={() => toggleModule('advancedraw')}
              className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
            >
              <span className="text-sm font-medium text-dark-300">Advanced RAW Processing</span>
              {moduleStates.advancedraw?.expanded ? (
                <ChevronDown className="w-4 h-4 text-dark-300" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dark-300" />
              )}
            </button>
          </div>

          {moduleStates.advancedraw?.expanded && (
            <div className="px-3 pb-3">
              <AdvancedRawModule
                isEnabled={moduleStates.advancedraw?.enabled || false}
                onToggle={(enabled) => {
                  setModuleStates(prev => ({
                    ...prev,
                    advancedraw: { ...prev.advancedraw, enabled }
                  }));
                  logger.info(`Advanced RAW processing ${enabled ? 'enabled' : 'disabled'}`);
                }}
              />
            </div>
          )}
        </div>

        {/* Exposure Module */}
        {exposureModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('exposure')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Exposure</span>
                {moduleStates.exposure?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('exposure')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.exposure?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.exposure?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.exposure?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {moduleStates.exposure?.expanded && (
              <div className="px-3 pb-3">
                <ExposureModuleComponent
                  module={exposureModule}
                  onParamsChange={(params) => handleModuleParamsChange('exposure', params)}
                />
              </div>
            )}
          </div>
        )}

        {/* White Balance Module */}
        {whiteBalanceModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('whitebalance')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">White Balance</span>
                {moduleStates.whitebalance?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('temperature')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.whitebalance?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.whitebalance?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.whitebalance?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

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

        {/* Basic Adjustments Module */}
        {basicAdjModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('basicadj')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Basic Adjustments</span>
                {moduleStates.basicadj?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('basicadj')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.basicadj?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.basicadj?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.basicadj?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

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

        {/* Tone Curve Module */}
        {toneCurveModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('tonecurve')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Tone Curve</span>
                {moduleStates.tonecurve?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('tonecurve')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.tonecurve?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.tonecurve?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.tonecurve?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

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
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('colorbalance')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Color Balance</span>
                {moduleStates.colorbalance?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('colorbalance')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.colorbalance?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.colorbalance?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.colorbalance?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

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

        {/* Shadows & Highlights Module */}
        {shadowsHighlightsModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('shadowshighlights')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Shadows & Highlights</span>
                {moduleStates.shadowshighlights?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('shadowshighlights')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.shadowshighlights?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.shadowshighlights?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.shadowshighlights?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

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

        {/* Local Adjustments Module */}
        {localAdjustmentsModule && (
          <div className="border-b border-dark-800">
            <div className="flex items-center">
              <button
                onClick={() => toggleModule('localadjustments')}
                className="flex-1 p-3 flex items-center justify-between hover:bg-dark-800 transition-professional text-left"
              >
                <span className="text-sm font-medium text-dark-300">Local Adjustments</span>
                {moduleStates.localadjustments?.expanded ? (
                  <ChevronDown className="w-4 h-4 text-dark-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dark-300" />
                )}
              </button>
              <button
                onClick={() => toggleModuleEnabled('localadjustments')}
                className={`px-2 py-1 mx-2 rounded text-xs transition-professional ${
                  moduleStates.localadjustments?.enabled
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-dark-400'
                }`}
                title={`${moduleStates.localadjustments?.enabled ? 'Disable' : 'Enable'} module`}
              >
                {moduleStates.localadjustments?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {moduleStates.localadjustments?.expanded && (
              <div className="px-3 pb-3">
                <LocalAdjustmentsModuleComponent
                  parameters={localAdjustmentsModule.getParameters().defaultParams}
                  brushParams={localAdjustmentsModule.getParameters().brushParams}
                  layers={localAdjustmentsModule.getParameters().layers}
                  activeLayerId={localAdjustmentsModule.getParameters().activeLayerId}
                  onParametersChange={(params) => {
                    if (localAdjustmentsModule.getParameters().activeLayerId) {
                      localAdjustmentsModule.updateLayerParameters(
                        localAdjustmentsModule.getParameters().activeLayerId,
                        params
                      );
                      handleModuleParamsChange('localadjustments', params);
                    }
                  }}
                  onBrushParamsChange={(params) => {
                    localAdjustmentsModule.updateBrushParameters(params);
                    handleModuleParamsChange('localadjustments', params);
                  }}
                  onCreateLayer={(type, name) => {
                    const currentImage = imageService.getCurrentImage();
                    if (currentImage) {
                      localAdjustmentsModule.createLayer(type, name, currentImage.width, currentImage.height);
                      handleModuleParamsChange('localadjustments', {});
                    }
                  }}
                  onRemoveLayer={(layerId) => {
                    localAdjustmentsModule.removeLayer(layerId);
                    handleModuleParamsChange('localadjustments', {});
                  }}
                  onToggleLayer={(layerId, enabled) => {
                    localAdjustmentsModule.toggleLayer(layerId, enabled);
                    handleModuleParamsChange('localadjustments', {});
                  }}
                  onSetActiveLayer={(layerId) => {
                    localAdjustmentsModule.setActiveLayer(layerId);
                  }}
                  onUpdateLayerOpacity={(layerId, opacity) => {
                    localAdjustmentsModule.updateLayerOpacity(layerId, opacity);
                    handleModuleParamsChange('localadjustments', {});
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Processing Stats */}
        <div className="p-3 bg-dark-850 text-xs text-dark-400">
          <div className="space-y-1">
            <div>Pipeline: {imageProcessingPipeline.getStats().enabledModules} modules active</div>
            <div>Real-time: 50ms debounce</div>
          </div>
        </div>
      </div>
    </div>
  );
}