import { useState, useCallback } from 'react';
import { RotateCcw, Info, Zap } from 'lucide-react';
import { WhiteBalanceModule, WhiteBalanceParams, WHITE_BALANCE_PRESETS } from '../../modules/WhiteBalanceModule';
import { logger } from '../../utils/Logger';

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
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const updateParam = useCallback((key: keyof WhiteBalanceParams, value: any) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
    logger.debug(`WhiteBalance ${key} updated:`, value);
  }, [params, module, onParamsChange]);

  const resetParam = useCallback((key: keyof WhiteBalanceParams, defaultValue: any) => {
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
    <div className="space-y-4 p-4 bg-dark-850 rounded-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-semibold text-dark-300">White Balance</h3>
          <button
            className="p-1 hover:bg-dark-700 rounded text-dark-300"
            onMouseEnter={() => setShowTooltip('wb-info')}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
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

      {/* Tooltip */}
      {showTooltip === 'wb-info' && (
        <div className="absolute bg-dark-800 border border-dark-600 rounded p-2 text-xs text-dark-300 max-w-xs z-10">
          Adjust color temperature and tint to correct white balance.
          Use presets for common lighting conditions or auto-detect from image.
        </div>
      )}

      <div className="space-y-4">
        {/* Preset Selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-dark-300">Preset</label>
          <div className="grid grid-cols-2 gap-1">
            {Object.keys(WHITE_BALANCE_PRESETS).map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetChange(preset)}
                className={`px-2 py-1 text-xs rounded transition-professional ${
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
              <input
                type="number"
                value={Math.round(params.temperature)}
                onChange={(e) => updateParam('temperature', Math.max(2000, Math.min(50000, parseInt(e.target.value) || 6500)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="100"
                min="2000"
                max="50000"
              />
              <span className="text-xs text-dark-300">K</span>
              <button
                onClick={() => resetParam('temperature', 6500)}
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
              max="50000"
              step="100"
              value={params.temperature}
              onChange={(e) => updateParam('temperature', parseInt(e.target.value))}
              className="w-full h-2 bg-gradient-to-r from-orange-400 via-white to-blue-400 rounded-lg appearance-none cursor-pointer slider-thumb"
            />
          </div>
          <div className="flex justify-between text-xs text-dark-400">
            <span>Warm (2000K)</span>
            <span>Cool (50000K)</span>
          </div>
        </div>

        {/* Tint */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-dark-300">Tint</label>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={params.tint.toFixed(1)}
                onChange={(e) => updateParam('tint', Math.max(-100, Math.min(100, parseFloat(e.target.value) || 0)))}
                className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                step="1"
                min="-100"
                max="100"
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