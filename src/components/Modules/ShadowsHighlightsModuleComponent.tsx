import React, { useState, useCallback } from 'react';
import { Sun, Moon, Sliders, RotateCcw, Zap, Settings, Eye, EyeOff } from 'lucide-react';
import { ShadowsHighlightsModule, ShadowsHighlightsParams } from '../../modules/ShadowsHighlightsModule';
import { logger } from '../../utils/Logger';

interface ShadowsHighlightsModuleComponentProps {
  module: ShadowsHighlightsModule;
  onParamsChange?: (params: Partial<ShadowsHighlightsParams>) => void;
}

type PresetType = 'subtle' | 'moderate' | 'strong' | 'highlights-only' | 'shadows-only';

export const ShadowsHighlightsModuleComponent: React.FC<ShadowsHighlightsModuleComponentProps> = ({
  module,
  onParamsChange
}) => {
  const [params, setParams] = useState<ShadowsHighlightsParams>(module.getParams());
  const [activeSection, setActiveSection] = useState<'shadows' | 'highlights' | 'advanced'>('shadows');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleParamChange = useCallback((paramName: keyof ShadowsHighlightsParams, value: number) => {
    const newParams = { ...params, [paramName]: value };
    setParams(newParams);
    module.setParams({ [paramName]: value });
    onParamsChange?.(newParams);

    logger.debug(`ShadowsHighlights ${paramName} changed to:`, value);
  }, [params, module, onParamsChange]);

  const handlePresetApply = useCallback((preset: PresetType) => {
    module.applyPreset(preset);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info(`Applied ShadowsHighlights preset: ${preset}`);
  }, [module, onParamsChange]);

  const handleReset = useCallback(() => {
    module.resetParams();
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info('ShadowsHighlights parameters reset to defaults');
  }, [module, onParamsChange]);

  const SliderControl: React.FC<{
    label: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    suffix?: string;
    precision?: number;
    gradient?: string;
    defaultValue?: number;
  }> = ({ label, value, onChange, min, max, step = 0.1, suffix = '', precision = 1, gradient, defaultValue = 0 }) => (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium text-dark-300">{label}</label>
        <span className="text-xs text-dark-400">
          {value.toFixed(precision)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
        style={gradient ? {
          background: gradient,
          border: '1px solid #374151'
        } : {
          border: '1px solid #374151'
        }}
        title={`Double-click to reset to ${defaultValue}${suffix}`}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Preset Buttons */}
      <div className="space-y-2">
        {/* Action Row */}
        <div className="flex justify-end space-x-1">
          <button
            onClick={() => {
              const autoParams = module.autoAdjust();
              setParams(autoParams);
              onParamsChange?.(autoParams);
              logger.info('Auto shadows/highlights applied');
            }}
            className="p-1 text-xs bg-dark-700 hover:bg-dark-600 text-dark-300 rounded transition-professional flex items-center justify-center"
            title="Auto shadows/highlights adjustment"
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-1 text-xs bg-dark-700 hover:bg-dark-600 text-dark-300 rounded transition-professional flex items-center justify-center"
            title="Reset to defaults"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Preset Row */}
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => handlePresetApply('subtle')}
            className="px-2 py-1 text-xs border border-dark-700 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded transition-professional"
            title="Subtle shadow/highlight recovery"
          >
            Subtle
          </button>
          <button
            onClick={() => handlePresetApply('moderate')}
            className="px-2 py-1 text-xs border border-dark-700 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded transition-professional"
            title="Moderate shadow/highlight recovery"
          >
            Moderate
          </button>
          <button
            onClick={() => handlePresetApply('strong')}
            className="px-2 py-1 text-xs border border-dark-700 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded transition-professional"
            title="Strong shadow/highlight recovery"
          >
            Strong
          </button>
        </div>

      </div>

      {/* Section Tabs */}
      <div className="flex bg-dark-800 rounded-lg p-1">
        <button
          onClick={() => setActiveSection('shadows')}
          className={`flex-1 flex items-center justify-center border border-dark-700 space-x-1 px-2 py-1 text-xs rounded transition-professional ${
            activeSection === 'shadows'
              ? 'bg-dark-600 text-white'
              : 'text-dark-400 hover:text-dark-300'
          }`}
        >
          <Moon className="w-3 h-3" />
          <span>Shadows</span>
        </button>
        <button
          onClick={() => setActiveSection('highlights')}
          className={`flex-1 flex items-center justify-center border border-dark-700 space-x-1 px-2 py-1 text-xs rounded transition-professional ${
            activeSection === 'highlights'
              ? 'bg-dark-600 text-white'
              : 'text-dark-400 hover:text-dark-300'
          }`}
        >
          <Sun className="w-3 h-3" />
          <span>Highlights</span>
        </button>
        <button
          onClick={() => setActiveSection('advanced')}
          className={`flex-1 flex items-center justify-center border border-dark-700 space-x-1 px-2 py-1 text-xs rounded transition-professional ${
            activeSection === 'advanced'
              ? 'bg-dark-600 text-white'
              : 'text-dark-400 hover:text-dark-300'
          }`}
        >
          <Settings className="w-3 h-3" />
          <span>Advanced</span>
        </button>
      </div>

      {/* Shadow Controls */}
      {activeSection === 'shadows' && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2 mb-2">
            <Moon className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-dark-300">Shadow Recovery</span>
          </div>

          <SliderControl
            label="Amount"
            value={params.shadows}
            onChange={(value) => handleParamChange('shadows', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #000000, #4b5563, #9ca3af)"
          />

          <SliderControl
            label="Radius"
            value={params.shadowsRadius}
            onChange={(value) => handleParamChange('shadowsRadius', value)}
            min={0.1}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #1f2937, #374151, #6b7280)"
          />

          <SliderControl
            label="Color Transfer"
            value={params.shadowsColorTransfer}
            onChange={(value) => handleParamChange('shadowsColorTransfer', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #374151, #3b82f6, #1d4ed8)"
          />

          <SliderControl
            label="Color Correction"
            value={params.shadowsColorCorrection}
            onChange={(value) => handleParamChange('shadowsColorCorrection', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #374151, #8b5cf6, #7c3aed)"
          />
        </div>
      )}

      {/* Highlight Controls */}
      {activeSection === 'highlights' && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2 mb-2">
            <Sun className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-dark-300">Highlight Recovery</span>
          </div>

          <SliderControl
            label="Amount"
            value={params.highlights}
            onChange={(value) => handleParamChange('highlights', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #9ca3af, #f3f4f6, #ffffff)"
          />

          <SliderControl
            label="Radius"
            value={params.highlightsRadius}
            onChange={(value) => handleParamChange('highlightsRadius', value)}
            min={0.1}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #d1d5db, #f3f4f6, #ffffff)"
          />

          <SliderControl
            label="Color Transfer"
            value={params.highlightsColorTransfer}
            onChange={(value) => handleParamChange('highlightsColorTransfer', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #d1d5db, #fbbf24, #f59e0b)"
          />

          <SliderControl
            label="Color Correction"
            value={params.highlightsColorCorrection}
            onChange={(value) => handleParamChange('highlightsColorCorrection', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #d1d5db, #f97316, #ea580c)"
          />
        </div>
      )}

      {/* Advanced Controls */}
      {activeSection === 'advanced' && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2 mb-2">
            <Settings className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-dark-300">Advanced Settings</span>
          </div>

          {/* White/Black Points */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-dark-400">Tone Range</span>
            <SliderControl
              label="White Point"
              value={params.whitePoint}
              onChange={(value) => handleParamChange('whitePoint', value)}
              min={-4}
              max={4}
              step={0.01}
              suffix=" EV"
              precision={2}
              gradient="linear-gradient(to right, #6b7280, #d1d5db, #ffffff)"
            />
            <SliderControl
              label="Black Point"
              value={params.blackPoint}
              onChange={(value) => handleParamChange('blackPoint', value)}
              min={-4}
              max={4}
              step={0.01}
              suffix=" EV"
              precision={2}
              gradient="linear-gradient(to right, #000000, #374151, #6b7280)"
            />
          </div>

          {/* Compression */}
          <SliderControl
            label="Compression"
            value={params.compress}
            onChange={(value) => handleParamChange('compress', value)}
            min={0}
            max={100}
            step={0.01}
            suffix="%"
            precision={2}
            gradient="linear-gradient(to right, #374151, #dc2626, #991b1b)"
          />

          {/* Processing Controls */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-dark-400">Processing</span>
            <SliderControl
              label="Strength"
              value={params.strength}
              onChange={(value) => handleParamChange('strength', value)}
              min={0}
              max={2}
              step={0.01}
              suffix="x"
              precision={2}
              gradient="linear-gradient(to right, #374151, #10b981, #059669)"
            />
            <SliderControl
              label="Iterations"
              value={params.iterations}
              onChange={(value) => handleParamChange('iterations', value)}
              min={1}
              max={5}
              step={1}
              suffix=""
              precision={0}
              gradient="linear-gradient(to right, #6b7280, #3b82f6, #1d4ed8)"
            />
          </div>

          {/* Masking Controls */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center space-x-2 text-xs text-dark-400 hover:text-dark-300 transition-professional"
          >
            {showAdvanced ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{showAdvanced ? 'Hide' : 'Show'} Masking</span>
          </button>

          {showAdvanced && (
            <div className="space-y-2 border-l-2 border-dark-700 pl-3">
              <SliderControl
                label="Mask Blur"
                value={params.maskBlur}
                onChange={(value) => handleParamChange('maskBlur', value)}
                min={0}
                max={10}
                step={0.01}
                suffix="px"
                precision={2}
                gradient="linear-gradient(to right, #374151, #6366f1, #4f46e5)"
              />
              <SliderControl
                label="Mask Falloff"
                value={params.maskFalloff}
                onChange={(value) => handleParamChange('maskFalloff', value)}
                min={0.1}
                max={5}
                step={0.01}
                suffix=""
                precision={2}
                gradient="linear-gradient(to right, #6b7280, #8b5cf6, #7c3aed)"
              />

              {/* Toggle Switches */}
              <div className="space-y-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={params.preserveColor}
                    onChange={(e) => handleParamChange('preserveColor', e.target.checked ? 1 : 0)}
                    className="rounded border-dark-600 bg-dark-700 text-blue-500 focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="text-xs text-dark-300">Preserve Color</span>
                </label>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={params.bilateralFilter}
                    onChange={(e) => handleParamChange('bilateralFilter', e.target.checked ? 1 : 0)}
                    className="rounded border-dark-600 bg-dark-700 text-blue-500 focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="text-xs text-dark-300">Bilateral Filter</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Indicator */}
      <div className="pt-2 border-t border-dark-800">
        <div className="flex items-center justify-between text-xs text-dark-500">
          <div className="flex items-center space-x-1">
            <Sliders className="w-3 h-3" />
            <span>Shadows/Highlights</span>
          </div>
          <div className="flex items-center space-x-2">
            {(params.shadows > 0 || params.highlights > 0) && (
              <div className="flex items-center space-x-1 text-green-400">
                <Zap className="w-3 h-3" />
                <span>Active</span>
              </div>
            )}
            <span>
              S:{params.shadows.toFixed(0)}% H:{params.highlights.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShadowsHighlightsModuleComponent;