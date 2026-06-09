import { useState, useCallback, useRef } from 'react';
import { RotateCcw, Triangle } from 'lucide-react';
import { SharpenModule, SharpenParams } from '../../modules/SharpenModule';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';

interface SharpenModuleComponentProps {
  module: SharpenModule;
  onParamsChange?: (params: Partial<SharpenParams>) => void;
}

type SharpenKey = 'amount' | 'radius' | 'detail';

const SLIDERS: {
  key: SharpenKey; label: string; min: number; max: number; step: number;
  def: number; precision: number; suffix: string; gradient: string; hint?: string;
}[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 150, step: 1, def: 0, precision: 0, suffix: '%',
    gradient: 'linear-gradient(to right, #1f2937, #3b82f6, #8b5cf6)',
    hint: 'Overall sharpening strength' },
  { key: 'radius', label: 'Radius', min: 0.5, max: 3, step: 0.1, def: 1.0, precision: 1, suffix: 'px',
    gradient: 'linear-gradient(to right, #374151, #9ca3af)',
    hint: 'Size of the edge halo. Keep low (≈1px) for fine detail' },
  { key: 'detail', label: 'Detail', min: 0, max: 100, step: 1, def: 25, precision: 0, suffix: '',
    gradient: 'linear-gradient(to right, #6b7280, #10b981)',
    hint: 'Higher protects smooth areas / noise — only stronger edges get sharpened' },
];

/**
 * Sharpen panel — a non-destructive unsharp-mask develop module. Unlike Noise
 * Reduction, sharpening is cheap at preview resolution, so the sliders update the
 * image live (no Apply button). Amount 0 = off.
 */
export function SharpenModuleComponent({ module, onParamsChange }: SharpenModuleComponentProps) {
  const [params, setParams] = useState<SharpenParams>(module.getParams());
  const paramsRef = useRef<SharpenParams>(params);

  const setParam = useCallback((key: SharpenKey, value: number) => {
    // Touching any slider activates the module; Amount drives the actual strength.
    const next = { ...paramsRef.current, [key]: value, enabled: true };
    paramsRef.current = next;
    setParams(next);
    module.setParams({ [key]: value, enabled: true });
    onParamsChange?.({ [key]: value, enabled: true }); // live reprocess (debounced upstream)
  }, [module, onParamsChange]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const reset = module.getParams();
    paramsRef.current = reset;
    setParams(reset);
    onParamsChange?.(reset);
    logger.info('Sharpen: reset to defaults');
  }, [module, onParamsChange]);

  const isActive = params.enabled && params.amount > 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Triangle className="w-3 h-3" style={{ color: isActive ? 'var(--primary-400)' : 'var(--gray-600)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--gray-500)', letterSpacing: '0.5px' }}>Sharpen</span>
        </div>
        <button
          onClick={resetAll}
          className="p-1.5 rounded border"
          style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-400)' }}
          title="Reset"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live sliders */}
      <div className="space-y-3">
        {SLIDERS.map((s) => (
          <div key={s.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>{s.label}</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl value={params[s.key]} onChange={(v) => setParam(s.key, v)} min={s.min} max={s.max} step={s.step} precision={s.precision} />
                {s.suffix && <span className="text-xs font-mono" style={{ color: 'var(--gray-500)', width: '20px' }}>{s.suffix}</span>}
                <button onClick={() => setParam(s.key, s.def)} className="p-1 rounded" style={{ backgroundColor: 'transparent', color: 'var(--gray-500)' }} title={`Reset to ${s.def}`}>
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={params[s.key]}
              onInput={(e) => setParam(s.key, parseFloat((e.target as HTMLInputElement).value))}
              onDoubleClick={() => setParam(s.key, s.def)}
              className="slider w-full"
              style={{ background: s.gradient, cursor: 'pointer' }}
              title={`Double-click to reset to ${s.def}`}
            />
            {s.hint && <p className="text-xs" style={{ color: 'var(--gray-400)' }}>{s.hint}</p>}
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: 'var(--gray-500)' }}>
        Sharpening is applied to the full image (preview and export match). Set Amount to 0 to turn it off.
      </p>
    </div>
  );
}
