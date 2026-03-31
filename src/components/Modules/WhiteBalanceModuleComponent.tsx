import { useState, useCallback, useRef, useEffect } from 'react';
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

  return (
    <div className="space-y-3">
      {/* Header - Redesigned */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAutoDetect}
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
            title="Auto detect"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetAll}
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
            title="Reset all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Presets */}
        <div className="space-y-2">
          <label className="text-xs font-medium" style={{color: 'var(--gray-400)'}}>Preset</label>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.keys(WHITE_BALANCE_PRESETS).map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetChange(preset)}
                className="px-3 py-1.5 text-xs rounded border font-medium"
                style={{
                  backgroundColor: params.preset === preset ? 'var(--gray-700)' : 'var(--gray-850)',
                  borderColor: params.preset === preset ? 'var(--border-light)' : 'var(--border)',
                  color: params.preset === preset ? 'var(--white)' : 'var(--gray-300)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (params.preset !== preset) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.borderColor = 'var(--border-light)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (params.preset !== preset) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-850)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }
                }}
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Auto Indicator */}
        {params.auto && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded border" style={{backgroundColor: 'var(--gray-850)', borderColor: 'var(--border)'}}>
            <Zap className="w-3 h-3" style={{color: 'var(--gray-400)'}} />
            <span className="text-xs" style={{color: 'var(--gray-300)'}}>Auto-detected white balance</span>
          </div>
        )}

        {/* Temperature */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Temperature</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.temperature}
                onChange={(value) => updateParam('temperature', value)}
                min={2000}
                max={12000}
                step={100}
                precision={0}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '12px'}}>K</span>
              <button
                onClick={() => resetParam('temperature', 6500)}
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                  e.currentTarget.style.color = 'var(--white)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="2000"
            max="12000"
            step="100"
            value={Math.min(12000, params.temperature)}
            onChange={(e) => updateParam('temperature', parseInt(e.target.value))}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #60a5fa, #e5e7eb, #fb923c)',
            }}
            title="Double-click to reset"
          />
          <div className="flex justify-between text-xs" style={{color: 'var(--gray-500)'}}>
            <span>Cool</span>
            <span>Neutral</span>
            <span>Warm</span>
          </div>
        </div>

        {/* Tint */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Tint</label>
            <div className="flex items-center gap-1.5">
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
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                  e.currentTarget.style.color = 'var(--white)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={params.tint}
            onChange={(e) => updateParam('tint', parseFloat(e.target.value))}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #f472b6, #9ca3af, #4ade80)',
            }}
            title="Double-click to reset"
          />
          <div className="flex justify-between text-xs" style={{color: 'var(--gray-500)'}}>
            <span>Magenta</span>
            <span>Green</span>
          </div>
        </div>

        {/* Current Values */}
        <div className="flex justify-between text-xs pt-2" style={{borderTop: '1px solid var(--border)', color: 'var(--gray-400)'}}>
          <div>
            <span style={{color: 'var(--gray-500)'}}>Temp: </span>
            <span className="font-mono" style={{color: 'var(--gray-200)'}}>{Math.round(params.temperature)}K</span>
          </div>
          <div>
            <span style={{color: 'var(--gray-500)'}}>Tint: </span>
            <span className="font-mono" style={{color: 'var(--gray-200)'}}>{params.tint >= 0 ? '+' : ''}{params.tint.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
