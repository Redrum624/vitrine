import { useState, useCallback, useRef } from 'react';
import { RotateCcw, Sparkles, Play, X } from 'lucide-react';
import { NoiseReductionModule, NoiseReductionParams } from '../../modules/NoiseReductionModule';
import { DenoiseMethod } from '../../services/AdvancedDenoisingService';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';

interface NoiseReductionModuleComponentProps {
  module: NoiseReductionModule;
  onParamsChange?: (params: Partial<NoiseReductionParams>) => void;
}

type NRKey = 'strength' | 'preserveDetail' | 'lumaStrength' | 'chromaStrength';

const SLIDERS: { key: NRKey; label: string; def: number; gradient: string; hint?: string }[] = [
  { key: 'strength', label: 'Strength', def: 50, gradient: 'linear-gradient(to right, #1f2937, #3b82f6, #8b5cf6)' },
  { key: 'preserveDetail', label: 'Preserve Detail', def: 70, gradient: 'linear-gradient(to right, #6b7280, #10b981)', hint: 'Higher values preserve more detail but remove less noise' },
  { key: 'lumaStrength', label: 'Luminance', def: 50, gradient: 'linear-gradient(to right, #000000, #6b7280, #ffffff)' },
  { key: 'chromaStrength', label: 'Color (Chroma)', def: 50, gradient: 'linear-gradient(to right, #9ca3af, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6)', hint: 'Reduces color noise (common in high-ISO images)' },
];

/**
 * Noise Reduction panel. A single algorithm (BM3D / GPU NLM engine) — no algorithm
 * dropdown. The sliders only stage the settings; noise reduction is expensive, so it
 * runs ONLY when the user presses "Apply" (never on slider change).
 */
export function NoiseReductionModuleComponent({ module, onParamsChange }: NoiseReductionModuleComponentProps) {
  const [params, setParams] = useState<NoiseReductionParams>(module.getParams());
  const paramsRef = useRef<NoiseReductionParams>(params);

  // Local-only update: keep the module + UI in sync, but DON'T reprocess.
  const setParamLocal = useCallback((key: NRKey, value: number) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);
    module.setParams({ [key]: value });
  }, [module]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const reset = module.getParams();
    paramsRef.current = reset;
    setParams(reset);
    onParamsChange?.(reset); // clearing NR should reprocess
    logger.info('NoiseReduction: reset to defaults');
  }, [module, onParamsChange]);

  // The ONLY action that triggers processing.
  const applyNoiseReduction = useCallback(() => {
    const applied = { ...paramsRef.current, enabled: true, method: 'bm3d' as DenoiseMethod };
    paramsRef.current = applied;
    setParams(applied);
    module.setParams({ enabled: true, method: 'bm3d' });
    onParamsChange?.(applied);
    logger.info('NoiseReduction applied (BM3D)');
  }, [module, onParamsChange]);

  const removeNoiseReduction = useCallback(() => {
    const off = { ...paramsRef.current, enabled: false };
    paramsRef.current = off;
    setParams(off);
    module.setParams({ enabled: false });
    onParamsChange?.(off);
    logger.info('NoiseReduction removed');
  }, [module, onParamsChange]);

  const isApplied = params.enabled;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-3 h-3" style={{ color: isApplied ? 'var(--primary-400)' : 'var(--gray-600)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--gray-500)', letterSpacing: '0.5px' }}>Noise Reduction</span>
        </div>
        <button
          onClick={resetAll}
          className="p-1.5 rounded border"
          style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-400)' }}
          title="Reset all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sliders — adjust freely; nothing runs until Apply is pressed */}
      <div className="space-y-3">
        {SLIDERS.map((s) => (
          <div key={s.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>{s.label}</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl value={params[s.key]} onChange={(v) => setParamLocal(s.key, v)} min={0} max={100} step={1} precision={0} />
                <span className="text-xs font-mono" style={{ color: 'var(--gray-500)', width: '20px' }}>%</span>
                <button onClick={() => setParamLocal(s.key, s.def)} className="p-1 rounded" style={{ backgroundColor: 'transparent', color: 'var(--gray-500)' }} title="Reset">
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params[s.key]}
              onInput={(e) => setParamLocal(s.key, parseFloat((e.target as HTMLInputElement).value))}
              onDoubleClick={() => setParamLocal(s.key, s.def)}
              className="slider w-full"
              style={{ background: s.gradient, cursor: 'pointer' }}
              title={`Double-click to reset to ${s.def}`}
            />
            {s.hint && <p className="text-xs" style={{ color: 'var(--gray-400)' }}>{s.hint}</p>}
          </div>
        ))}
      </div>

      {/* Apply / Remove — the only triggers for (re)processing */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={applyNoiseReduction}
          className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 rounded border text-xs font-medium"
          style={{ backgroundColor: 'var(--primary-600, #2563eb)', borderColor: 'var(--primary-500, #3b82f6)', color: '#fff' }}
          title="Run noise reduction with the current settings"
        >
          <Play className="w-3.5 h-3.5" /> {isApplied ? 'Re-apply Noise Reduction' : 'Apply Noise Reduction'}
        </button>
        {isApplied && (
          <button
            onClick={removeNoiseReduction}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded border text-xs"
            style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
            title="Remove noise reduction"
          >
            <X className="w-3.5 h-3.5" /> Remove
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--gray-500)' }}>
        Adjust the sliders, then press Apply. Noise reduction is GPU-accelerated; large RAW files may take a moment.
      </p>
    </div>
  );
}
