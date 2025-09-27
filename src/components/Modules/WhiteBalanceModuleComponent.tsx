import { useState, useCallback } from 'react';
import { RotateCcw, Zap } from 'lucide-react';
import { WhiteBalanceModule, WhiteBalanceParams, WHITE_BALANCE_PRESETS } from '../../modules/WhiteBalanceModule';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';

interface WhiteBalanceModuleComponentProps {
  module: WhiteBalanceModule;
  onParamsChange?: (params: Partial<WhiteBalanceParams>) => void;
  onAutoDetect?: () => void;
}

export function WhiteBalanceModuleComponent({
  module,
  onParamsChange,
  onAutoDetect
}: WhiteBalanceModuleComponentProps) {
  const [params, setParams] = useState<WhiteBalanceParams>(module.getParams());
  const updateParam = useCallback((key: keyof WhiteBalanceParams, value: number | string) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
    logger.debug(`WhiteBalance ${key} updated:`, value);
  }, [params, module, onParamsChange]);

  const resetParam = useCallback((key: keyof WhiteBalanceParams, defaultValue: number | string) => {
    updateParam(key, defaultValue);
  }, [updateParam]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    onParamsChange?.(resetParams);
    logger.info('WhiteBalance: All parameters reset to defaults');
  }, [module, onParamsChange]);

  const handlePresetChange = useCallback((preset: string) => {
    module.setPreset(preset);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info(`WhiteBalance preset applied: ${preset}`);
  }, [module, onParamsChange]);

  const handleAutoDetect = useCallback(() => {
    onAutoDetect?.();
    // Update params after auto detection
    setTimeout(() => {
      const newParams = module.getParams();
      setParams(newParams);
      onParamsChange?.(newParams);
    }, 100);
  }, [module, onParamsChange, onAutoDetect]);

  const formatTemperature = (temp: number): string => {
    return `${Math.round(temp)}K`;
  };

  const formatTint = (tint: number): string => {
    return tint >= 0 ? `+${tint.toFixed(1)}` : tint.toFixed(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}

      <div className="space-y-2">
        {/* Preset Selection */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-dark-300">Preset</label>
          <div className="flex items-center space-x-1">
            <button
              onClick={handleAutoDetect}
              className="p-1 hover:bg-dark-700 rounded text-dark-300"
              title="Auto detect white balance"
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

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {Object.keys(WHITE_BALANCE_PRESETS).map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetChange(preset)}
                className={`px-2 py-1 text-xs rounded border border-dark-700 transition-professional ${
                  params.preset === preset
                    ? 'bg-dark-600 text-dark-200'
                    : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
                }`}
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Auto White Balance Indicator */}
        {params.auto && (
          <div className="flex items-center space-x-2 px-2 py-1 bg-dark-700 rounded text-xs text-dark-300">
            <Zap className="w-3 h-3" />
            <span>Auto-detected white balance</span>
          </div>
        )}

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Temperature</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.temperature}
                onChange={(value) => updateParam('temperature', value)}
                min={2000}
                max={12000}
                step={100}
                precision={0}
              />
              <span className="text-xs text-dark-300">K</span>
              <button
                onClick={() => resetParam('temperature', 5500)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset temperature"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="2000"
              max="12000"
              step="100"
              value={Math.min(12000, params.temperature)}
              onChange={(e) => updateParam('temperature', parseInt(e.target.value))}
              className="w-full h-2 bg-gradient-to-r from-blue-400 via-white to-orange-400 rounded-lg appearance-none cursor-pointer slider-thumb"
            />
          </div>
          <div className="flex justify-between text-xs text-dark-400">
            <span>Cool (2000K)</span>
            <span>Neutral (5500K)</span>
            <span>Warm (12000K)</span>
          </div>
        </div>

        {/* Tint */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Tint</label>
            <div className="flex items-center space-x-2">
              <DelayedInputControl
                value={params.tint}
                onChange={(value) => updateParam('tint', value)}
                min={-100}
                max={100}
                step={1}
                precision={1}
              />
              <button
                onClick={() => resetParam('tint', 0.0)}
                className="p-1 hover:bg-dark-700 rounded text-dark-300"
                title="Reset tint"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={params.tint}
              onChange={(e) => updateParam('tint', parseFloat(e.target.value))}
              className="w-full h-2 bg-gradient-to-r from-pink-400 via-gray-300 to-green-400 rounded-lg appearance-none cursor-pointer slider-thumb"
            />
          </div>
          <div className="flex justify-between text-xs text-dark-400">
            <span>Magenta (-100)</span>
            <span>Green (+100)</span>
          </div>
        </div>

        {/* Current Values Display */}
        <div className="flex justify-between text-xs text-dark-400 pt-2 border-t border-dark-700">
          <div>
            <span className="text-dark-300">Temperature: </span>
            <span className="font-mono">{formatTemperature(params.temperature)}</span>
          </div>
          <div>
            <span className="text-dark-300">Tint: </span>
            <span className="font-mono">{formatTint(params.tint)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}