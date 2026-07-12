import { useState, useCallback, useRef, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { WhiteBalanceModule, WhiteBalanceParams, WHITE_BALANCE_PRESETS } from '../../modules/WhiteBalanceModule';
import { logger } from '../../utils/Logger';
import { SliderRow } from '../Controls/SliderRow';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface WhiteBalanceModuleComponentProps {
  module: WhiteBalanceModule;
  onParamsChange?: (params: Partial<WhiteBalanceParams>) => void;
  onAutoDetect?: () => void;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

export function WhiteBalanceModuleComponent({
  module,
  onParamsChange,
  onAutoDetect,
  onRegisterActions
}: WhiteBalanceModuleComponentProps) {
  const [params, setParams] = useState<WhiteBalanceParams>(module.getParams());
  const paramsRef = useRef<WhiteBalanceParams>(params);

  // Keep ref in sync
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const updateParam = useCallback((key: keyof WhiteBalanceParams, value: number | string) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
    logger.debug(`WhiteBalance ${key} updated:`, value);
  }, [module, onParamsChange]);

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

  useRegisterModuleCardActions(onRegisterActions, { auto: handleAutoDetect, reset: resetAll });

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Preset */}
      <div className="flex flex-col" style={{ gap: 10 }}>
        <SectionLabel>Preset</SectionLabel>
        <div className="grid grid-cols-3" style={{ gap: 6 }}>
          {Object.keys(WHITE_BALANCE_PRESETS).map((preset) => (
            <ChipButton
              key={preset}
              active={params.preset === preset}
              onClick={() => handlePresetChange(preset)}
            >
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </ChipButton>
          ))}
        </div>

        {/* Auto Indicator */}
        {params.auto && (
          <div
            className="flex items-center"
            style={{ gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--glass-border)' }}
          >
            <Zap className="w-3 h-3" style={{ color: 'var(--glass-text-muted)' }} />
            <span style={{ fontSize: 11, color: 'var(--glass-text-secondary)' }}>Auto-detected white balance</span>
          </div>
        )}
      </div>

      {/* Cast */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionLabel>Cast</SectionLabel>
        <SliderRow
          label="Temperature"
          value={params.temperature}
          defaultValue={6500}
          min={2000}
          max={12000}
          step={100}
          onChange={(v) => updateParam('temperature', v)}
          formatValue={(v) => `${Math.round(v)} K`}
          trackBackground="linear-gradient(to right, #60a5fa, #e5e7eb, #fb923c)"
          legend={{ left: 'Cool', center: 'Neutral', right: 'Warm' }}
        />
        <SliderRow
          label="Tint"
          value={params.tint}
          defaultValue={0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => updateParam('tint', v)}
          formatValue={(v) => v.toFixed(1)}
          trackBackground="linear-gradient(to right, #f472b6, #9ca3af, #4ade80)"
          legend={{ left: 'Magenta', right: 'Green' }}
        />
      </div>
    </div>
  );
}
