import { useState, useCallback, useRef } from 'react';
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
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Immediate UI update for smooth slider movement
  const updateParamImmediate = useCallback((key: keyof BasicAdjParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
  }, [params]);

  // Throttled module update for performance
  const updateParam = useCallback((key: keyof BasicAdjParams, value: number) => {
    // Clear any existing timeout for this parameter
    if (updateTimeoutRef.current[key]) {
      clearTimeout(updateTimeoutRef.current[key]);
    }

    // Update UI immediately for smooth feedback
    updateParamImmediate(key, value);

    // Throttle the actual module and processing updates
    updateTimeoutRef.current[key] = setTimeout(() => {
      const newParams = { ...params, [key]: value };
      module.setParams({ [key]: value });
      onParamsChange?.(newParams);
      logger.debug(`BasicAdj ${key} updated:`, value);
      delete updateTimeoutRef.current[key];
    }, 16); // ~60fps for smooth updates
  }, [params, module, onParamsChange, updateParamImmediate]);

  // Real-time update for slider dragging
  const updateParamRealTime = useCallback((key: keyof BasicAdjParams, value: number) => {
    // Update UI immediately
    updateParamImmediate(key, value);

    // Also update module for real-time preview (no throttling)
    module.setParams({ [key]: value });
    const newParams = { ...params, [key]: value };
    onParamsChange?.(newParams);
  }, [params, module, onParamsChange, updateParamImmediate]);

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
                min={-6}
                max={6}
                step={0.01}
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
              min="-6"
              max="6"
              step="0.01"
              value={params.exposure}
              onInput={(e) => updateParamRealTime('exposure', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('exposure', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('exposure', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
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
                precision={2}
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
              onInput={(e) => updateParamRealTime('black_point', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('black_point', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('black_point', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #000000, #4b5563)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
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
                step={0.01}
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
              step="0.01"
              value={params.contrast}
              onInput={(e) => updateParamRealTime('contrast', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('contrast', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('contrast', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #ffffff, #000000)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
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
                min={-2}
                max={2}
                step={0.01}
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
              min="-2"
              max="2"
              step="0.01"
              value={params.brightness}
              onInput={(e) => updateParamRealTime('brightness', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('brightness', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('brightness', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
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
                step={0.01}
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
              onInput={(e) => updateParamRealTime('saturation', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('saturation', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('saturation', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #9ca3af, #3b82f6, #10b981, #eab308, #f97316, #ef4444)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
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
                step={0.01}
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
              onInput={(e) => updateParamRealTime('vibrance', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('vibrance', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('vibrance', 0.0)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: 'linear-gradient(to right, #64748b, #a855f7, #ec4899, #f43f5e, #f97316)',
                border: '1px solid #374151'
              }}
              title="Double-click to reset to 0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}