import React, { useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { ColorBalanceModule, ColorBalanceParams } from '../../modules/ColorBalanceModule';
import ColorWheel from '../Controls/ColorWheel';
import ColoredSliderControl from '../Controls/ColoredSliderControl';
import { logger } from '../../utils/Logger';

interface ColorBalanceModuleComponentProps {
  module: ColorBalanceModule;
  onParamsChange: (params: ColorBalanceParams) => void;
}

type TabType = 'traditional' | 'global';
type GlobalTabType = 'saturation' | 'luminance' | 'hue';

const COLOR_RANGES = [
  { id: 'red', name: 'Red', color: '#ef4444' },
  { id: 'orange', name: 'Orange', color: '#f97316' },
  { id: 'yellow', name: 'Yellow', color: '#eab308' },
  { id: 'green', name: 'Green', color: '#22c55e' },
  { id: 'cyan', name: 'Cyan', color: '#06b6d4' },
  { id: 'blue', name: 'Blue', color: '#3b82f6' },
  { id: 'purple', name: 'Purple', color: '#8b5cf6' },
  { id: 'magenta', name: 'Magenta', color: '#d946ef' }
] as const;

export const ColorBalanceModuleComponent: React.FC<ColorBalanceModuleComponentProps> = ({
  module,
  onParamsChange
}) => {
  const [params, setParams] = useState<ColorBalanceParams>(module.getParams());
  const paramsRef = React.useRef<ColorBalanceParams>(params);
  const [activeTab, setActiveTab] = useState<TabType>('traditional');
  const [globalTab, setGlobalTab] = useState<GlobalTabType>('saturation');

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const updateParams = useCallback((newParams: Partial<ColorBalanceParams>) => {
    const updatedParams = { ...paramsRef.current, ...newParams };
    paramsRef.current = updatedParams;
    setParams(updatedParams);
    module.setParams(updatedParams);
    onParamsChange(updatedParams);
    logger.debug('Color balance updated:', newParams);
  }, [module, onParamsChange]);

  const resetParams = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    onParamsChange(resetParams);
    logger.info('Color balance reset to defaults');
  }, [module, onParamsChange]);

  const updateTraditionalParam = (range: 'shadows' | 'midtones' | 'highlights', param: 'cyan_red' | 'magenta_green' | 'yellow_blue', value: number) => {
    updateParams({
      [range]: {
        ...params[range],
        [param]: value
      }
    });
  };

  const getGlobalSliderProps = (colorId: string, tab: GlobalTabType) => {
    const paramKey = `${colorId}_${tab}` as keyof ColorBalanceParams;
    const value = (params[paramKey] as number) || 0;

    switch (tab) {
      case 'saturation':
        return {
          min: -100,
          max: 100,
          step: 1,
          value,
          precision: 0,
          unit: '%'
        };
      case 'luminance':
        return {
          min: -100,
          max: 100,
          step: 1,
          value,
          precision: 0,
          unit: '%'
        };
      case 'hue':
        return {
          min: -180,
          max: 180,
          step: 1,
          value,
          precision: 0,
          unit: '°'
        };
    }
  };

  const handleGlobalSliderChange = (colorId: string, tab: GlobalTabType, value: number) => {
    const paramKey = `${colorId}_${tab}` as keyof ColorBalanceParams;
    updateParams({ [paramKey]: value });
  };

  const [activeRange, setActiveRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');

  const renderTraditionalControls = () => {
    // We'll work with the currently selected range (defaulting to midtones)
    const rangeParams = params[activeRange];

    return (
      <div className="space-y-4">
        {/* Range Selection */}
        <div className="flex rounded-md bg-gray-700 p-1">
          {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setActiveRange(range)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors capitalize ${
                activeRange === range
                  ? 'bg-gray-600 text-white shadow-sm'
                  : 'bg-transparent hover:text-gray-600'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Large Color Wheel */}
        <div className="flex flex-col items-center space-y-4">
          <ColorWheel
            cyanRed={rangeParams.cyan_red}
            magentaGreen={rangeParams.magenta_green}
            yellowBlue={rangeParams.yellow_blue}
            onChange={(values) => {
              updateParams({
                [activeRange]: {
                  ...rangeParams,
                  cyan_red: values.cyanRed,
                  magenta_green: values.magentaGreen,
                  yellow_blue: values.yellowBlue
                }
              });
            }}
            size={200}
          />

          {/* Yellow-Blue Slider */}
          <div className="w-full py-4 max-w-xs">
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-dark-300">Yellow ↔ Blue</label>
                <span className="text-xs text-dark-400">{rangeParams.yellow_blue.toFixed(2)}</span>
              </div>
              <div className="relative">
                <div
                  className="w-full h-2 rounded-lg relative overflow-hidden border border-dark-700"
                  style={{
                    background: 'linear-gradient(to right, #eab308, #6b7280, #3b82f6)'
                  }}
                >
                  {/* Center line indicator */}
                  <div className="absolute top-0 h-full w-0.5 bg-white opacity-50" style={{ left: '50%' }} />
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={rangeParams.yellow_blue}
                  onChange={(e) => updateTraditionalParam(activeRange, 'yellow_blue', parseFloat(e.target.value))}
                  onDoubleClick={() => updateTraditionalParam(activeRange, 'yellow_blue', 0)}
                  className="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer slider-thumb"
                  style={{ background: 'transparent' }}
                  title="Double-click to reset to 0"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGlobalControls = () => {
    return (
      <div className="space-y-4">
        {/* Global Color Control Tabs */}
        <div className="flex rounded-md bg-gray-700 p-1">
          {(['saturation', 'luminance', 'hue'] as GlobalTabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setGlobalTab(tab)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                globalTab === tab
                ? 'bg-gray-600 text-white shadow-sm'
                : 'bg-transparent hover:text-gray-600'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Color Controls */}
        <div className="space-y-1">
          {COLOR_RANGES.map((color) => {
            const sliderProps = getGlobalSliderProps(color.id, globalTab);

            return (
              <div key={color.id} className="flex items-center space-x-3 py-2">
                <div className="flex items-center space-x-2 w-20">
                  <div
                    className="w-3 h-3 rounded-full border border-gray-600"
                    style={{ backgroundColor: color.color }}
                  />
                  <span className="text-xs text-gray-300 font-medium">{color.name}</span>
                </div>

                <div className="flex-1">
                  <ColoredSliderControl
                    label=""
                    value={sliderProps.value}
                    min={sliderProps.min}
                    max={sliderProps.max}
                    step={sliderProps.step}
                    onChange={(value) => handleGlobalSliderChange(color.id, globalTab, value)}
                    precision={sliderProps.precision}
                    unit={sliderProps.unit}
                    color={color.color}
                    className="mb-0"
                    sliderType={globalTab}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Tab Description */}
        <div className="text-xs text-gray-500 px-2">
          {globalTab === 'saturation' && 'Adjust the intensity of each color range'}
          {globalTab === 'luminance' && 'Adjust the brightness of each color range'}
          {globalTab === 'hue' && 'Shift the hue of each color range'}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-end">
        <button
          onClick={resetParams}
          className="p-1 text-gray-400 hover:text-gray-300 transition-colors"
          title="Reset color balance"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Main Tabs */}
      <div className="flex rounded-md bg-gray-700 p-1">
        <button
          onClick={() => setActiveTab('traditional')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
            activeTab === 'traditional'
              ? 'bg-gray-600 text-white shadow-sm'
              : 'bg-transparent hover:text-gray-600'
          }`}
        >
          Traditional
        </button>
        <button
          onClick={() => setActiveTab('global')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
            activeTab === 'global'
              ? 'bg-gray-600 text-white shadow-sm'
              : 'bg-transparent hover:text-gray-600'
          }`}
        >
          Global Colors
        </button>
      </div>

      {/* Content */}
      {activeTab === 'traditional' && renderTraditionalControls()}
      {activeTab === 'global' && renderGlobalControls()}

    </div>
  );
};