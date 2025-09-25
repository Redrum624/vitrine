import { useState, useCallback } from 'react';
import { RotateCcw, Info } from 'lucide-react';
import type { ExposureParams } from '../../types/darktable';
import { ExposureModule } from '../../modules/ExposureModule';

interface ExposureModuleComponentProps {
  module: ExposureModule;
  onParamsChange?: (params: Partial<ExposureParams>) => void;
  disabled?: boolean;
}

export function ExposureModuleComponent({
  module,
  onParamsChange,
  disabled = false
}: ExposureModuleComponentProps) {
  const [params, setParams] = useState<ExposureParams>(module.defaultParams);
  const constraints = module.getParamConstraints();
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const handleParamChange = useCallback((key: keyof ExposureParams, value: any) => {
    const newParams = { ...params, [key]: value };
    const validatedParams = module.validateParams(newParams);
    setParams(validatedParams);
    onParamsChange?.(validatedParams);
  }, [params, onParamsChange, module]);

  const handleReset = useCallback(() => {
    const resetParams = module.defaultParams;
    setParams(resetParams);
    onParamsChange?.(resetParams);
  }, [onParamsChange, module]);

  const handleModeChange = useCallback((mode: 'manual' | 'automatic') => {
    handleParamChange('mode', mode);
  }, [handleParamChange]);

  return (
    <div className="bg-dark-850 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-semibold text-dark-300">Exposure</h3>
          <button
            onMouseEnter={() => setShowTooltip('exposure-info')}
            onMouseLeave={() => setShowTooltip(null)}
            className="p-1 hover:bg-dark-700 rounded text-dark-300"
          >
            <Info className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={handleReset}
          disabled={disabled}
          className="p-1 hover:bg-dark-700 rounded transition-professional text-dark-300 disabled:opacity-50"
          title="Reset to defaults"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Tooltip */}
      {showTooltip === 'exposure-info' && (
        <div className="absolute bg-dark-800 border border-dark-600 rounded p-2 text-xs text-dark-300 max-w-xs z-10">
          Basic exposure and black level adjustments. Use exposure to brighten or darken the image,
          and black level to adjust shadow detail.
        </div>
      )}

      {/* Mode Selection */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-dark-300">Mode</label>
        <div className="flex space-x-2">
          <button
            onClick={() => handleModeChange('manual')}
            disabled={disabled}
            className={`px-3 py-1 text-xs rounded transition-professional ${
              params.mode === 'manual'
                ? 'bg-dark-600 text-dark-200'
                : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
            } disabled:opacity-50`}
          >
            Manual
          </button>
          <button
            onClick={() => handleModeChange('automatic')}
            disabled={disabled}
            className={`px-3 py-1 text-xs rounded transition-professional ${
              params.mode === 'automatic'
                ? 'bg-dark-600 text-dark-200'
                : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
            } disabled:opacity-50`}
          >
            Automatic
          </button>
        </div>
      </div>

      {/* Manual Mode Controls */}
      {params.mode === 'manual' && (
        <>
          {/* Exposure */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-dark-300">Exposure</label>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  value={params.exposure.toFixed(2)}
                  onChange={(e) => handleParamChange('exposure', parseFloat(e.target.value))}
                  disabled={disabled}
                  className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                  step={0.1}
                  min={constraints.exposure.min}
                  max={constraints.exposure.max}
                />
                <span className="text-xs text-dark-300">EV</span>
                <button
                  onClick={() => handleParamChange('exposure', constraints.exposure.default)}
                  disabled={disabled}
                  className="p-0.5 hover:bg-dark-700 rounded transition-professional disabled:opacity-50"
                  title="Reset exposure"
                >
                  <RotateCcw className="w-3 h-3 text-dark-300" />
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="range"
                min={constraints.exposure.min}
                max={constraints.exposure.max}
                value={params.exposure}
                onChange={(e) => handleParamChange('exposure', parseFloat(e.target.value))}
                disabled={disabled}
                className="slider w-full disabled:opacity-50"
                step={0.1}
              />
              {/* Center mark at 0 */}
              <div
                className="absolute top-1/2 w-px h-2 bg-dark-600 transform -translate-y-1/2"
                style={{
                  left: `${((0 - constraints.exposure.min) / (constraints.exposure.max - constraints.exposure.min)) * 100}%`
                }}
              />
            </div>
          </div>

          {/* Black Level */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-dark-300">Black Level</label>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  value={params.black.toFixed(3)}
                  onChange={(e) => handleParamChange('black', parseFloat(e.target.value))}
                  disabled={disabled}
                  className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                  step={0.01}
                  min={constraints.black.min}
                  max={constraints.black.max}
                />
                <button
                  onClick={() => handleParamChange('black', constraints.black.default)}
                  disabled={disabled}
                  className="p-0.5 hover:bg-dark-700 rounded transition-professional disabled:opacity-50"
                  title="Reset black level"
                >
                  <RotateCcw className="w-3 h-3 text-dark-300" />
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="range"
                min={constraints.black.min}
                max={constraints.black.max}
                value={params.black}
                onChange={(e) => handleParamChange('black', parseFloat(e.target.value))}
                disabled={disabled}
                className="slider w-full disabled:opacity-50"
                step={0.01}
              />
              {/* Center mark at 0 */}
              <div
                className="absolute top-1/2 w-px h-2 bg-dark-600 transform -translate-y-1/2"
                style={{
                  left: `${((0 - constraints.black.min) / (constraints.black.max - constraints.black.min)) * 100}%`
                }}
              />
            </div>
          </div>

          {/* Exposure Bias Compensation */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="compensate-bias"
              checked={params.compensate_exposure_bias}
              onChange={(e) => handleParamChange('compensate_exposure_bias', e.target.checked)}
              disabled={disabled}
              className="rounded text-dark-300 bg-dark-800 border-dark-700 disabled:opacity-50"
            />
            <label htmlFor="compensate-bias" className="text-xs text-dark-300">
              Compensate exposure bias
            </label>
          </div>
        </>
      )}

      {/* Automatic Mode Controls */}
      {params.mode === 'automatic' && (
        <>
          {/* Deflicker Percentile */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-dark-300">Percentile</label>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  value={params.deflicker_percentile.toFixed(1)}
                  onChange={(e) => handleParamChange('deflicker_percentile', parseFloat(e.target.value))}
                  disabled={disabled}
                  className="w-12 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                  step={1}
                  min={constraints.deflicker_percentile.min}
                  max={constraints.deflicker_percentile.max}
                />
                <span className="text-xs text-dark-300">%</span>
              </div>
            </div>
            <input
              type="range"
              min={constraints.deflicker_percentile.min}
              max={constraints.deflicker_percentile.max}
              value={params.deflicker_percentile}
              onChange={(e) => handleParamChange('deflicker_percentile', parseFloat(e.target.value))}
              disabled={disabled}
              className="slider w-full disabled:opacity-50"
              step={1}
            />
          </div>

          {/* Target Level */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-dark-300">Target Level</label>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  value={params.deflicker_target_level.toFixed(1)}
                  onChange={(e) => handleParamChange('deflicker_target_level', parseFloat(e.target.value))}
                  disabled={disabled}
                  className="w-16 px-1 py-0.5 text-xs bg-dark-800 border border-dark-700 rounded text-dark-300 text-right disabled:opacity-50"
                  step={0.1}
                  min={constraints.deflicker_target_level.min}
                  max={constraints.deflicker_target_level.max}
                />
                <span className="text-xs text-dark-300">EV</span>
              </div>
            </div>
            <input
              type="range"
              min={constraints.deflicker_target_level.min}
              max={constraints.deflicker_target_level.max}
              value={params.deflicker_target_level}
              onChange={(e) => handleParamChange('deflicker_target_level', parseFloat(e.target.value))}
              disabled={disabled}
              className="slider w-full disabled:opacity-50"
              step={0.1}
            />
          </div>
        </>
      )}
    </div>
  );
}