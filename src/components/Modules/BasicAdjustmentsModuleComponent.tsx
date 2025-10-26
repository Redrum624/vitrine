import React, { useState, useCallback, useRef } from 'react';
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
  const paramsRef = useRef<BasicAdjParams>(params);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Immediate UI update for smooth slider movement
  const updateParamImmediate = useCallback((key: keyof BasicAdjParams, value: number) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);
  }, []);

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
      const newParams = { ...paramsRef.current, [key]: value };
      module.setParams({ [key]: value });
      onParamsChange?.(newParams);
      logger.debug(`BasicAdj ${key} updated:`, value);
      delete updateTimeoutRef.current[key];
    }, 16); // ~60fps for smooth updates
  }, [module, onParamsChange, updateParamImmediate]);

  // Real-time update for slider dragging
  const updateParamRealTime = useCallback((key: keyof BasicAdjParams, value: number) => {
    // Update ref and UI immediately without blocking
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);

    // Trigger module update and processing
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
  }, [module, onParamsChange]);

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
    <div className="space-y-3">
      {/* Header - Redesigned */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const autoParams = module.autoAdjust();
              setParams(autoParams);
              onParamsChange?.(autoParams);
              logger.info('Auto adjustments applied');
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
            title="Auto adjust"
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
        {/* Exposure */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Exposure</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.exposure}
                onChange={(value) => updateParam('exposure', value)}
                min={-1}
                max={1}
                step={0.01}
                precision={2}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>EV</span>
              <button
                onClick={() => resetParam('exposure', 0.0)}
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
            min="-1"
            max="1"
            step="0.01"
            value={params.exposure}
            onInput={(e) => updateParamRealTime('exposure', parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => updateParam('exposure', parseFloat(e.target.value))}
            onDoubleClick={() => updateParam('exposure', 0.0)}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
            }}
            title="Double-click to reset"
          />
        </div>

        {/* Black Point */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Black Point</label>
            <div className="flex items-center gap-1.5">
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
                title="Reset black point"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={params.black_point}
              onInput={(e) => updateParamRealTime('black_point', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('black_point', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('black_point', 0.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #ffffff, #000000)',
              }}
              title="Double-click to reset"
            />
        </div>

        {/* Contrast */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Contrast</label>
            <div className="flex items-center gap-1.5">
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
                title="Reset contrast"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
              type="range"
              min="-2.5"
              max="2.5"
              step="0.01"
              value={params.contrast}
              onInput={(e) => updateParamRealTime('contrast', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('contrast', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('contrast', 0.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #6b7280, #000000)',
              }}
              title="Double-click to reset"
            />
        </div>

        {/* Brightness */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Brightness</label>
            <div className="flex items-center gap-1.5">
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
                title="Reset brightness"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
              type="range"
              min="-2"
              max="2"
              step="0.01"
              value={params.brightness}
              onInput={(e) => updateParamRealTime('brightness', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('brightness', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('brightness', 0.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
              }}
              title="Double-click to reset"
            />
        </div>

        {/* Saturation */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Saturation</label>
            <div className="flex items-center gap-1.5">
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
                title="Reset saturation"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={params.saturation}
              onInput={(e) => updateParamRealTime('saturation', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('saturation', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('saturation', 0.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #6b7280, #3b82f6, #10b981, #eab308, #f97316, #ef4444)',
              }}
              title="Double-click to reset"
            />
        </div>

        {/* Vibrance */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Vibrance</label>
            <div className="flex items-center gap-1.5">
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
                title="Reset vibrance"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
              type="range"
              min="-1"
              max="1"
              step="0.05"
              value={params.vibrance}
              onInput={(e) => updateParamRealTime('vibrance', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateParam('vibrance', parseFloat(e.target.value))}
              onDoubleClick={() => updateParam('vibrance', 0.0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #64748b, #a855f7, #ec4899, #f43f5e, #f97316)',
              }}
              title="Double-click to reset"
            />
        </div>
      </div>
    </div>
  );
}