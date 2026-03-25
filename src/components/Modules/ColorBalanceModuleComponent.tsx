import React, { useState, useCallback } from 'react';
import { RotateCcw, Zap } from 'lucide-react';
import { ColorBalanceModule, ColorBalanceParams } from '../../modules/ColorBalanceModule';
import ColorWheel from '../Controls/ColorWheel';
import ColoredSliderControl from '../Controls/ColoredSliderControl';
import { logger } from '../../utils/Logger';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';

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
  const [activeRange, setActiveRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');

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

  const renderTraditionalControls = () => {
    const rangeParams = params[activeRange];

    return (
      <div className="space-y-3">
        {/* Range Selection */}
        <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
          {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setActiveRange(range)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all capitalize ${
                activeRange === range
                  ? 'shadow-sm'
                  : 'bg-transparent'
              }`}
              style={{
                backgroundColor: activeRange === range ? 'var(--gray-600)' : 'transparent',
                color: activeRange === range ? 'var(--white)' : 'var(--gray-300)'
              }}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Large Color Wheel */}
        <div className="flex flex-col items-center space-y-3">
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
          <div className="w-full max-w-xs space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Yellow ↔ Blue</label>
              <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>{rangeParams.yellow_blue.toFixed(2)}</span>
            </div>
            <div className="relative">
              <div
                className="w-full h-2 rounded-lg relative overflow-hidden"
                style={{
                  background: 'linear-gradient(to right, #eab308, #6b7280, #3b82f6)',
                  border: '1px solid var(--border)'
                }}
              >
                {/* Center line indicator */}
                <div className="absolute top-0 h-full w-px" style={{left: '50%', backgroundColor: 'var(--white)', opacity: 0.5}} />
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={rangeParams.yellow_blue}
                onChange={(e) => updateTraditionalParam(activeRange, 'yellow_blue', parseFloat(e.target.value))}
                onDoubleClick={() => updateTraditionalParam(activeRange, 'yellow_blue', 0)}
                className="slider w-full absolute top-0"
                style={{ background: 'transparent' }}
                title="Double-click to reset to 0"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderGlobalControls = () => {
    return (
      <div className="space-y-3">
        {/* Global Color Control Tabs */}
        <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
          {(['saturation', 'luminance', 'hue'] as GlobalTabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setGlobalTab(tab)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all capitalize ${
                globalTab === tab
                  ? 'shadow-sm'
                  : 'bg-transparent'
              }`}
              style={{
                backgroundColor: globalTab === tab ? 'var(--gray-600)' : 'transparent',
                color: globalTab === tab ? 'var(--white)' : 'var(--gray-300)'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Color Controls */}
        <div className="space-y-1.5">
          {COLOR_RANGES.map((color) => {
            const sliderProps = getGlobalSliderProps(color.id, globalTab);

            return (
              <div key={color.id} className="flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 w-20">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: color.color,
                      border: '1px solid var(--border)'
                    }}
                  />
                  <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>{color.name}</span>
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
        <div className="text-xs px-2" style={{color: 'var(--gray-500)'}}>
          {globalTab === 'saturation' && 'Adjust the intensity of each color range'}
          {globalTab === 'luminance' && 'Adjust the brightness of each color range'}
          {globalTab === 'hue' && 'Shift the hue of each color range'}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              const img = imageService.getCurrentImage();
              if (!img) { logger.warn('No image for auto color balance'); return; }
              const stats = autoAdjustService.analyse(img.data, img.width, img.height);
              const computed = autoAdjustService.autoColorBalance(stats);
              module.setParams(computed as Partial<ColorBalanceParams>);
              const newParams = module.getParams();
              setParams(newParams);
              onParamsChange(newParams);
              logger.info('Auto color balance applied (image-aware)');
            }}
            className="p-1.5 rounded border"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Auto balance colors"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetParams}
            className="p-1.5 rounded border"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              transition: 'var(--transition-fast)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Reset color balance"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
        <button
          onClick={() => setActiveTab('traditional')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
            activeTab === 'traditional'
              ? 'shadow-sm'
              : 'bg-transparent'
          }`}
          style={{
            backgroundColor: activeTab === 'traditional' ? 'var(--gray-600)' : 'transparent',
            color: activeTab === 'traditional' ? 'var(--white)' : 'var(--gray-300)'
          }}
        >
          Traditional
        </button>
        <button
          onClick={() => setActiveTab('global')}
          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
            activeTab === 'global'
              ? 'shadow-sm'
              : 'bg-transparent'
          }`}
          style={{
            backgroundColor: activeTab === 'global' ? 'var(--gray-600)' : 'transparent',
            color: activeTab === 'global' ? 'var(--white)' : 'var(--gray-300)'
          }}
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
