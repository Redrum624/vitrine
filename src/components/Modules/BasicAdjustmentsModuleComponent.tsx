import { useState, useCallback } from 'react';
import { RotateCcw, Info, Zap } from 'lucide-react';
import { BasicAdjustmentsModule, BasicAdjParams } from '../../modules/BasicAdjustmentsModule';
import { logger } from '../../utils/Logger';

interface BasicAdjustmentsModuleComponentProps {
  module: BasicAdjustmentsModule;
  onParamsChange?: (params: Partial<BasicAdjParams>) => void;
}

export function BasicAdjustmentsModuleComponent({
  module,
  onParamsChange
}: BasicAdjustmentsModuleComponentProps) {
  const [params, setParams] = useState<BasicAdjParams>(module.getParams());
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const updateParam = useCallback((key: keyof BasicAdjParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
    logger.debug(`BasicAdj ${key} updated:`, value);
  }, [params, module, onParamsChange]);

  const resetParam = useCallback((key: keyof BasicAdjParams, defaultValue: number) => {
    updateParam(key, defaultValue);
  }, [updateParam]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    onParamsChange?.(resetParams);
    logger.info('BasicAdj: All parameters reset to defaults');
  }, [module, onParamsChange]);

  const formatValue = (value: number, precision: number = 2): string => {
    return value.toFixed(precision);
  };

  return (
    <div className="space-y-4 p-4 bg-dark-850 rounded-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-semibold text-dark-300">Basic Adjustments</h3>
          <button
            className="p-1 hover:bg-dark-700 rounded text-dark-300"
            onMouseEnter={() => setShowTooltip('basicadj-info')}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => {
              // Auto adjust based on histogram analysis
              const autoParams = module.autoAdjust();
              setParams(autoParams);
              onParamsChange?.(autoParams);
              logger.info('Auto adjustments applied');
            }}
            className="p-1 hover:bg-dark-700 rounded text-dark-300"
            title="Auto adjust basic parameters"
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={resetAll}
            className="p-1 hover:bg-dark-700 rounded transition-professional text-dark-300 disabled:opacity-50"
            title="Reset all parameters"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tooltip */}
      {showTooltip === 'basicadj-info' && (
        <div className="absolute bg-dark-800 border border-dark-600 rounded p-2 text-xs text-dark-300 max-w-xs z-10">
          Basic adjustments for exposure, contrast, brightness, and color saturation.
          These are fundamental corrections applied early in the processing pipeline.
        </div>
      )}

      <div className="space-y-4">
        {/* Exposure */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Exposure</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.exposure, 2)}
                onChange={(e) => updateParam('exposure', Math.max(-18, Math.min(18, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.1"
                min="-18"
                max="18"
              />
              <span className="text-xs text-dark-300">EV</span>
              <button
                onClick={() => resetParam('exposure', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset exposure"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-18"
              max="18"
              step="0.1"
              value={params.exposure}
              onChange={(e) => updateParam('exposure', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Black Point */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Black Point</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.black_point, 3)}
                onChange={(e) => updateParam('black_point', Math.max(-1, Math.min(1, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.01"
                min="-1"
                max="1"
              />
              <button
                onClick={() => resetParam('black_point', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset black point"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={params.black_point}
              onChange={(e) => updateParam('black_point', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Contrast */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Contrast</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.contrast, 2)}
                onChange={(e) => updateParam('contrast', Math.max(-2.5, Math.min(2.5, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.1"
                min="-2.5"
                max="2.5"
              />
              <button
                onClick={() => resetParam('contrast', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset contrast"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-2.5"
              max="2.5"
              step="0.1"
              value={params.contrast}
              onChange={(e) => updateParam('contrast', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Brightness */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Brightness</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.brightness, 2)}
                onChange={(e) => updateParam('brightness', Math.max(-4, Math.min(4, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.1"
                min="-4"
                max="4"
              />
              <button
                onClick={() => resetParam('brightness', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset brightness"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-4"
              max="4"
              step="0.1"
              value={params.brightness}
              onChange={(e) => updateParam('brightness', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Saturation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Saturation</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.saturation, 2)}
                onChange={(e) => updateParam('saturation', Math.max(-1, Math.min(1, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.05"
                min="-1"
                max="1"
              />
              <button
                onClick={() => resetParam('saturation', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset saturation"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={params.saturation}
              onChange={(e) => updateParam('saturation', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Vibrance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Vibrance</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={formatValue(params.vibrance, 2)}
                onChange={(e) => updateParam('vibrance', Math.max(-1, Math.min(1, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="0.05"
                min="-1"
                max="1"
              />
              <button
                onClick={() => resetParam('vibrance', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset vibrance"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={params.vibrance}
              onChange={(e) => updateParam('vibrance', parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>
      </div>
    </div>
  );
}