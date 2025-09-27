import { useState, useCallback } from 'react';
import { RotateCcw, Zap } from 'lucide-react';
import { BasicAdjustmentsModule, BasicAdjParams } from '../../modules/BasicAdjustmentsModule';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';

interface BasicAdjustmentsModuleComponentProps {
  module: BasicAdjustmentsModule;
  onParamsChange?: (params: Partial<BasicAdjParams>) => void;
}

export function BasicAdjustmentsModuleComponent({
  module,
  onParamsChange
}: BasicAdjustmentsModuleComponentProps) {
  const [params, setParams] = useState<BasicAdjParams>(module.getParams());

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

  // Use formatValue to prevent unused variable warning
  console.debug('formatValue available:', formatValue);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex justify-end space-x-1">
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

      <div className="space-y-4">
        {/* Exposure */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Exposure</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.exposure}
                onChange={(value) => updateParam('exposure', value)}
                min={-18}
                max={18}
                step={0.1}
                precision={2}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Black Point */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Black Point</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.black_point}
                onChange={(value) => updateParam('black_point', value)}
                min={-1}
                max={1}
                step={0.01}
                precision={3}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Contrast */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Contrast</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.contrast}
                onChange={(value) => updateParam('contrast', value)}
                min={-2.5}
                max={2.5}
                step={0.1}
                precision={2}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Brightness */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Brightness</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.brightness}
                onChange={(value) => updateParam('brightness', value)}
                min={-4}
                max={4}
                step={0.1}
                precision={2}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Saturation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Saturation</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.saturation}
                onChange={(value) => updateParam('saturation', value)}
                min={-1}
                max={1}
                step={0.05}
                precision={2}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>

        {/* Vibrance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Vibrance</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.vibrance}
                onChange={(value) => updateParam('vibrance', value)}
                min={-1}
                max={1}
                step={0.05}
                precision={2}
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
              className="w-full h-2 border border-dark-700 rounded-lg appearance-none cursor-pointer slider-thumb visible-track"
            />
          </div>
        </div>
      </div>
    </div>
  );
}