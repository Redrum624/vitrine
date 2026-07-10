import React, { useState, useCallback, useRef } from 'react';
import { ColorBalanceModule, ColorBalanceParams } from '../../modules/ColorBalanceModule';
import ColorWheel from '../Controls/ColorWheel';
import { SliderRow } from '../Controls/SliderRow';
import { SectionLabel } from '../Controls/SectionLabel';
import { Segmented } from '../Controls/Segmented';
import { logger } from '../../utils/Logger';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';
import { notificationService } from '../../services/NotificationService';
import { guardDeveloping } from '../../utils/developingGuard';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface ColorBalanceModuleComponentProps {
  module: ColorBalanceModule;
  onParamsChange: (params: ColorBalanceParams) => void;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

type TabType = 'traditional' | 'global';
type GlobalTabType = 'saturation' | 'luminance' | 'hue';
type ToneRange = 'shadows' | 'midtones' | 'highlights';

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

const MODE_OPTIONS = [
  { value: 'global' as TabType, label: 'Global' },
  { value: 'traditional' as TabType, label: 'Traditional' },
];

const GLOBAL_TAB_OPTIONS = [
  { value: 'saturation' as GlobalTabType, label: 'Saturation' },
  { value: 'luminance' as GlobalTabType, label: 'Luminance' },
  { value: 'hue' as GlobalTabType, label: 'Hue' },
];

const RANGE_OPTIONS = [
  { value: 'shadows' as ToneRange, label: 'Shadows' },
  { value: 'midtones' as ToneRange, label: 'Midtones' },
  { value: 'highlights' as ToneRange, label: 'Highlights' },
];

/** Full hue-rotation gradient for a mixer row's tinted track (ported verbatim
 * from the old colored-slider control's hue-mode gradient math). */
function hueTrackGradient(color: string): string {
  const hexValue = parseInt(color.replace('#', ''), 16);
  const r = ((hexValue >> 16) & 0xff) / 255;
  const g = ((hexValue >> 8) & 0xff) / 255;
  const b = (hexValue & 0xff) / 255;

  const cMax = Math.max(r, g, b);
  const cMin = Math.min(r, g, b);
  let baseHue = 0;

  if (cMax !== cMin) {
    const delta = cMax - cMin;
    if (cMax === r) baseHue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (cMax === g) baseHue = ((b - r) / delta + 2) / 6;
    else baseHue = ((r - g) / delta + 4) / 6;
  }
  baseHue *= 360;

  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const shift = -180 + (i / 8) * 360;
    const h = (baseHue + shift + 360) % 360;
    stops.push(`hsl(${h}, 80%, 50%) ${(i / 8 * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Mixer row track tint, per §4 ("colored dot + tinted track"). */
function mixerTrackGradient(tab: GlobalTabType, color: string): string {
  if (tab === 'luminance') return `linear-gradient(to right, #000000, ${color}, #ffffff)`;
  if (tab === 'hue') return hueTrackGradient(color);
  return `linear-gradient(to right, #6b7280, ${color}, #6b7280)`;
}

/** One MIXER row: colored dot + name, SliderRow-style tinted track, plain trailing value.
 * Not promoted to the shared Controls/ library — this dot-before-label + inline-value
 * layout is specific to the Color Balance mixer (see 4a-module-color-balance.png). */
function MixerRow({
  name, color, tab, value, min, max, onChange,
}: {
  name: string; color: string; tab: GlobalTabType; value: number; min: number; max: number;
  onChange: (value: number) => void;
}) {
  const rowId = React.useId();
  const labelId = `${rowId}-label`;
  const edited = value !== 0;
  const formatted = value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;

  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span id={labelId} style={{ width: 56, fontSize: 11.5, color: 'var(--glass-text-secondary)', flexShrink: 0 }}>
        {name}
      </span>
      <div style={{ position: 'relative', flex: 1, height: 5 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, borderRadius: 3,
            background: mixerTrackGradient(tab, color),
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,.6)',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden="true"
          style={{ position: 'absolute', top: -3, left: '50%', marginLeft: -0.5, width: 1, height: 11, background: 'rgba(255,255,255,.25)', pointerEvents: 'none' }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-labelledby={labelId}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(0)}
          title="Double-click to reset to 0"
          className={`glass-slider-thumb${edited ? ' is-edited' : ''}`}
          style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, background: 'transparent' }}
        />
      </div>
      <span
        style={{
          width: 30, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 10.5,
          color: edited ? 'var(--accent)' : 'var(--glass-text-secondary)', flexShrink: 0,
        }}
      >
        {formatted}
      </span>
    </div>
  );
}

export const ColorBalanceModuleComponent: React.FC<ColorBalanceModuleComponentProps> = ({
  module,
  onParamsChange,
  onRegisterActions
}) => {
  const [params, setParams] = useState<ColorBalanceParams>(module.getParams());
  const paramsRef = useRef<ColorBalanceParams>(params);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [activeTab, setActiveTab] = useState<TabType>('global');
  const [globalTab, setGlobalTab] = useState<GlobalTabType>('saturation');
  const [activeRange, setActiveRange] = useState<ToneRange>('midtones');

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Throttled update: immediate UI, deferred processing
  const updateParams = useCallback((newParams: Partial<ColorBalanceParams>) => {
    const updatedParams = { ...paramsRef.current, ...newParams };
    paramsRef.current = updatedParams;
    setParams(updatedParams);

    const key = Object.keys(newParams)[0] || 'cb';
    if (updateTimeoutRef.current[key]) clearTimeout(updateTimeoutRef.current[key]);
    updateTimeoutRef.current[key] = setTimeout(() => {
      module.setParams(updatedParams);
      onParamsChange(updatedParams);
      delete updateTimeoutRef.current[key];
    }, 16);
  }, [module, onParamsChange]);

  const resetParams = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    onParamsChange(resetParams);
    logger.info('Color balance reset to defaults');
  }, [module, onParamsChange]);

  // Image-aware auto colour balance — lifted verbatim from the old inner-header
  // ⚡ button so the card header's Auto keeps identical semantics (Task 2).
  const handleAuto = useCallback(() => {
    // Reads currentImage pixels directly — during the progressive-open developing window
    // that's the graded preview, not the neutral full-res base (L3 review round 2).
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Auto Color Balance')) return;
    const img = imageService.getCurrentImage();
    if (!img) { logger.warn('No image for auto color balance'); return; }
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    const computed = autoAdjustService.autoColorBalance(stats);
    module.setParams(computed as Partial<ColorBalanceParams>);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange(newParams);
    logger.info('Auto color balance applied (image-aware)');
  }, [module, onParamsChange]);

  useRegisterModuleCardActions(onRegisterActions, { auto: handleAuto, reset: resetParams });

  const updateTraditionalParam = (range: ToneRange, param: 'cyan_red' | 'magenta_green' | 'yellow_blue', value: number) => {
    updateParams({
      [range]: {
        ...params[range],
        [param]: value
      }
    });
  };

  const handleGlobalSliderChange = (colorId: string, tab: GlobalTabType, value: number) => {
    const paramKey = `${colorId}_${tab}` as keyof ColorBalanceParams;
    updateParams({ [paramKey]: value });
  };

  const renderTraditionalControls = () => {
    const rangeParams = params[activeRange];

    return (
      <div className="flex flex-col" style={{ gap: 14 }}>
        <div className="flex flex-col" style={{ gap: 10 }}>
          <SectionLabel>Range</SectionLabel>
          <Segmented options={RANGE_OPTIONS} value={activeRange} onChange={setActiveRange} className="w-full" />
        </div>

        <div className="flex flex-col" style={{ gap: 10 }}>
          <SectionLabel>Wheel</SectionLabel>
          <div className="flex flex-col items-center" style={{ gap: 12 }}>
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
            <SliderRow
              label="Yellow ↔ Blue"
              value={rangeParams.yellow_blue}
              defaultValue={0}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => updateTraditionalParam(activeRange, 'yellow_blue', v)}
              formatValue={(v) => v.toFixed(2)}
              trackBackground="linear-gradient(to right, #eab308, #6b7280, #3b82f6)"
              className="w-full"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderGlobalControls = () => {
    return (
      <div className="flex flex-col" style={{ gap: 14 }}>
        <Segmented options={GLOBAL_TAB_OPTIONS} value={globalTab} onChange={setGlobalTab} className="w-full" />

        <div className="flex flex-col" style={{ gap: 10 }}>
          <SectionLabel>Mixer</SectionLabel>
          <div className="flex flex-col" style={{ gap: 11 }}>
            {COLOR_RANGES.map((color) => {
              const paramKey = `${color.id}_${globalTab}` as keyof ColorBalanceParams;
              const value = (params[paramKey] as number) || 0;
              const range = globalTab === 'hue' ? 180 : 100;
              return (
                <MixerRow
                  key={color.id}
                  name={color.name}
                  color={color.color}
                  tab={globalTab}
                  value={value}
                  min={-range}
                  max={range}
                  onChange={(v) => handleGlobalSliderChange(color.id, globalTab, v)}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Segmented options={MODE_OPTIONS} value={activeTab} onChange={setActiveTab} className="w-full" />

      {activeTab === 'global' && renderGlobalControls()}
      {activeTab === 'traditional' && renderTraditionalControls()}
    </div>
  );
};
