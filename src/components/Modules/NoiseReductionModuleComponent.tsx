import React, { useState, useCallback, useRef } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { NoiseReductionModule, NoiseReductionParams } from '../../modules/NoiseReductionModule';
import { DenoiseMethod } from '../../services/AdvancedDenoisingService';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';

interface NoiseReductionModuleComponentProps {
  module: NoiseReductionModule;
  onParamsChange?: (params: Partial<NoiseReductionParams>) => void;
}

// Extended type to include 'none'
type ExtendedDenoiseMethod = DenoiseMethod | 'none';

export function NoiseReductionModuleComponent({
  module,
  onParamsChange
}: NoiseReductionModuleComponentProps) {
  const [params, setParams] = useState<NoiseReductionParams>(module.getParams());
  const [selectedMethod, setSelectedMethod] = useState<ExtendedDenoiseMethod>(params.enabled ? params.method : 'none');
  const paramsRef = useRef<NoiseReductionParams>(params);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Immediate UI update for smooth slider movement
  const updateParamImmediate = useCallback((key: keyof NoiseReductionParams, value: number | boolean | DenoiseMethod) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);
  }, []);

  // Throttled module update for performance
  const updateParam = useCallback((key: keyof NoiseReductionParams, value: number | boolean | DenoiseMethod) => {
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
      logger.debug(`NoiseReduction ${key} updated:`, value);
      delete updateTimeoutRef.current[key];
    }, 16); // ~60fps for smooth updates
  }, [module, onParamsChange, updateParamImmediate]);

  // Real-time update for slider dragging
  const updateParamRealTime = useCallback((key: keyof NoiseReductionParams, value: number) => {
    // Update ref and UI immediately without blocking
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);

    // Trigger module update and processing
    module.setParams({ [key]: value });
    onParamsChange?.(newParams);
  }, [module, onParamsChange]);

  const resetParam = useCallback((key: keyof NoiseReductionParams, defaultValue: number) => {
    updateParam(key, defaultValue);
  }, [updateParam]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    setSelectedMethod(resetParams.enabled ? resetParams.method : 'none');
    onParamsChange?.(resetParams);
    logger.info('NoiseReduction: All parameters reset to defaults');
  }, [module, onParamsChange]);

  const handleMethodChange = useCallback((method: ExtendedDenoiseMethod) => {
    setSelectedMethod(method);

    if (method === 'none') {
      // Disable noise reduction
      updateParam('enabled', false);
      logger.info('NoiseReduction disabled');
    } else {
      // Enable and set the method
      updateParam('enabled', true);
      updateParam('method', method as DenoiseMethod);
      logger.info(`NoiseReduction enabled with method: ${method}`);
    }
  }, [updateParam]);

  const isDisabled = selectedMethod === 'none';

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
        {/* Method Selection */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Algorithm</label>
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" style={{color: selectedMethod !== 'none' ? 'var(--primary-400)' : 'var(--gray-600)'}} />
            </div>
          </div>
          <select
            value={selectedMethod}
            onChange={(e) => handleMethodChange(e.target.value as ExtendedDenoiseMethod)}
            className="w-full px-3 py-2 rounded text-sm border"
            style={{
              backgroundColor: 'var(--gray-800)',
              borderColor: 'var(--border)',
              color: 'var(--gray-100)'
            }}
          >
            <option value="none">None</option>
            <option value="auto">Auto - Intelligent Selection</option>
            <option value="bm3d">BM3D - Best Quality (Slow)</option>
            <option value="nlmeans">Non-Local Means - Texture Preservation</option>
            <option value="wavelet">Wavelet - Edge Preservation</option>
            <option value="hybrid">Hybrid - Balanced Approach</option>
          </select>
          <p className="text-xs" style={{color: 'var(--gray-400)'}}>
            {selectedMethod === 'none' && 'Noise reduction disabled'}
            {selectedMethod === 'auto' && 'Automatically selects best algorithm based on image analysis'}
            {selectedMethod === 'bm3d' && 'State-of-the-art quality, rivals DxO PRIME and Topaz DeNoise'}
            {selectedMethod === 'nlmeans' && 'Excellent for preserving fine textures and details'}
            {selectedMethod === 'wavelet' && 'Multi-scale denoising, preserves edges well'}
            {selectedMethod === 'hybrid' && 'Combines BM3D, NLMeans, and Wavelet for best results'}
          </p>
        </div>

        {/* Strength */}
        <div className="space-y-1.5" style={{opacity: isDisabled ? 0.5 : 1}}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Strength</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.strength}
                onChange={(value) => updateParam('strength', value)}
                min={0}
                max={100}
                step={1}
                precision={0}
                disabled={isDisabled}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
              <button
                onClick={() => resetParam('strength', 50)}
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                disabled={isDisabled}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={params.strength}
            onInput={(e) => !isDisabled && updateParamRealTime('strength', parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => !isDisabled && updateParam('strength', parseFloat(e.target.value))}
            onDoubleClick={() => !isDisabled && updateParam('strength', 50)}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #1f2937, #3b82f6, #8b5cf6)',
              cursor: isDisabled ? 'not-allowed' : 'pointer'
            }}
            disabled={isDisabled}
            title="Double-click to reset to 50"
          />
        </div>

        {/* Detail Preservation */}
        <div className="space-y-1.5" style={{opacity: isDisabled ? 0.5 : 1}}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Preserve Detail</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.preserveDetail}
                onChange={(value) => updateParam('preserveDetail', value)}
                min={0}
                max={100}
                step={1}
                precision={0}
                disabled={isDisabled}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
              <button
                onClick={() => resetParam('preserveDetail', 70)}
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                disabled={isDisabled}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={params.preserveDetail}
            onInput={(e) => !isDisabled && updateParamRealTime('preserveDetail', parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => !isDisabled && updateParam('preserveDetail', parseFloat(e.target.value))}
            onDoubleClick={() => !isDisabled && updateParam('preserveDetail', 70)}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #6b7280, #10b981)',
              cursor: isDisabled ? 'not-allowed' : 'pointer'
            }}
            disabled={isDisabled}
            title="Double-click to reset to 70"
          />
          <p className="text-xs" style={{color: 'var(--gray-400)'}}>
            Higher values preserve more detail but remove less noise
          </p>
        </div>

        {/* Luminance Noise Reduction */}
        <div className="space-y-1.5" style={{opacity: isDisabled ? 0.5 : 1}}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Luminance</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.lumaStrength}
                onChange={(value) => updateParam('lumaStrength', value)}
                min={0}
                max={100}
                step={1}
                precision={0}
                disabled={isDisabled}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
              <button
                onClick={() => resetParam('lumaStrength', 50)}
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                disabled={isDisabled}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={params.lumaStrength}
            onInput={(e) => !isDisabled && updateParamRealTime('lumaStrength', parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => !isDisabled && updateParam('lumaStrength', parseFloat(e.target.value))}
            onDoubleClick={() => !isDisabled && updateParam('lumaStrength', 50)}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #000000, #6b7280, #ffffff)',
              cursor: isDisabled ? 'not-allowed' : 'pointer'
            }}
            disabled={isDisabled}
            title="Double-click to reset to 50"
          />
        </div>

        {/* Chroma Noise Reduction */}
        <div className="space-y-1.5" style={{opacity: isDisabled ? 0.5 : 1}}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color (Chroma)</label>
            <div className="flex items-center gap-1.5">
              <DelayedInputControl
                value={params.chromaStrength}
                onChange={(value) => updateParam('chromaStrength', value)}
                min={0}
                max={100}
                step={1}
                precision={0}
                disabled={isDisabled}
              />
              <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
              <button
                onClick={() => resetParam('chromaStrength', 50)}
                className="p-1 rounded"
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--gray-500)',
                  transition: 'var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--gray-500)';
                }}
                disabled={isDisabled}
                title="Reset"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={params.chromaStrength}
            onInput={(e) => !isDisabled && updateParamRealTime('chromaStrength', parseFloat((e.target as HTMLInputElement).value))}
            onChange={(e) => !isDisabled && updateParam('chromaStrength', parseFloat(e.target.value))}
            onDoubleClick={() => !isDisabled && updateParam('chromaStrength', 50)}
            className="slider w-full"
            style={{
              background: 'linear-gradient(to right, #9ca3af, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6)',
              cursor: isDisabled ? 'not-allowed' : 'pointer'
            }}
            disabled={isDisabled}
            title="Double-click to reset to 50"
          />
          <p className="text-xs" style={{color: 'var(--gray-400)'}}>
            Reduces color noise (common in high-ISO images)
          </p>
        </div>
      </div>
    </div>
  );
}
