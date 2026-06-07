import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Zap, Circle, Trash2 } from 'lucide-react';
import { BasicAdjustmentsModule, BasicAdjParams } from '../../modules/BasicAdjustmentsModule';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { useAppStore } from '../../stores/appStore';
import type { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import type { LocalAdjustmentLayer } from '../../modules/LocalAdjustmentsModule';

const NEUTRAL_BA: BasicAdjParams = {
  black_point: 0, exposure: 0, contrast: 0, brightness: 0,
  saturation: 0, vibrance: 0, dehaze: 0, highlights: 0, shadows: 0,
};

type SliderKey = 'exposure' | 'contrast' | 'highlights' | 'brightness' | 'black_point' | 'shadows' | 'dehaze' | 'saturation' | 'vibrance';

interface SliderCfg {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step?: number;       // DelayedInput + default range step
  rangeStep?: number;  // slider step override
  gradient: string;    // CSS gradient stops (without the linear-gradient wrapper)
  unit?: string;
}

// Slider order: Exposure, Contrast, Highlights, Brightness, Black Point, Shadows,
// Dehaze, Saturation, Vibrance. Highlights/Shadows replace the old standalone
// Shadows & Highlights module.
const BASIC_ADJ_SLIDERS: SliderCfg[] = [
  { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.01, gradient: '#000000, #6b7280, #ffffff', unit: 'EV' },
  { key: 'contrast', label: 'Contrast', min: -2.5, max: 2.5, step: 0.01, gradient: '#6b7280, #000000' },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, gradient: '#6b7280, #ffffff' },
  { key: 'brightness', label: 'Brightness', min: -2, max: 2, step: 0.01, gradient: '#000000, #6b7280, #ffffff' },
  { key: 'black_point', label: 'Black Point', min: -1, max: 1, step: 0.01, gradient: '#ffffff, #000000' },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, gradient: '#000000, #6b7280' },
  { key: 'dehaze', label: 'Dehaze', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#94a3b8, #64748b, #334155, #0ea5e9' },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#6b7280, #3b82f6, #10b981, #eab308, #f97316, #ef4444' },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#64748b, #a855f7, #ec4899, #f43f5e, #f97316' },
];

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

  // ── Local Adjustments: mask tools + per-mask "second Basic Adjustments" ─────
  const [masks, setMasks] = useState<LocalAdjustmentLayer[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [maskBA, setMaskBA] = useState<BasicAdjParams>(NEUTRAL_BA);
  const [maskFeather, setMaskFeather] = useState(0.5);

  const getLA = useCallback(
    () => imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments') ?? null,
    []
  );
  const reprocess = () => useAppStore.getState().triggerReprocessing();

  const refreshMasks = useCallback(() => {
    const la = getLA();
    setMasks(la ? la.getParameters().layers.filter(l => l.type === 'radial_gradient' || l.type === 'linear_gradient') : []);
  }, [getLA]);

  useEffect(() => { refreshMasks(); }, [refreshMasks]);

  const selectMask = useCallback((id: string) => {
    const la = getLA(); if (!la) return;
    la.setActiveLayer(id);
    setSelectedMaskId(id);
    const layer = la.getParameters().layers.find(l => l.id === id);
    setMaskBA({ ...NEUTRAL_BA, ...(layer?.basicAdj ?? {}) });
    setMaskFeather(layer?.geometry?.feather ?? 0.5);
    reprocess();
  }, [getLA]);

  const createMask = useCallback((type: 'radial_gradient' | 'linear_gradient') => {
    const la = getLA(); const img = imageService.getCurrentImage();
    if (!la || !img) { logger.warn('Local Adjustments: no image/module'); return; }
    const base = type === 'radial_gradient' ? 'Circle' : 'Gradient';
    const n = la.getParameters().layers.filter(l => l.name.startsWith(base)).length;
    const id = la.createLayer(type, n > 0 ? `${base} ${n + 1}` : base, img.width, img.height);
    la.updateLayerBasicAdj(id, {}); // mark it as a Basic-Adjustments mask
    refreshMasks();
    selectMask(id);
  }, [getLA, refreshMasks, selectMask]);

  const deleteMask = useCallback((id: string) => {
    const la = getLA(); if (!la) return;
    la.removeLayer(id);
    if (selectedMaskId === id) setSelectedMaskId(null);
    refreshMasks();
    reprocess();
  }, [getLA, refreshMasks, selectedMaskId]);

  const updateMaskBA = useCallback((key: keyof BasicAdjParams, value: number) => {
    if (!selectedMaskId) return;
    setMaskBA(prev => ({ ...prev, [key]: value }));
    getLA()?.updateLayerBasicAdj(selectedMaskId, { [key]: value });
    reprocess();
  }, [getLA, selectedMaskId]);

  const updateMaskFeather = useCallback((value: number) => {
    const la = getLA(); const img = imageService.getCurrentImage();
    if (!la || !img || !selectedMaskId) return;
    setMaskFeather(value);
    const layer = la.getParameters().layers.find(l => l.id === selectedMaskId);
    if (layer?.geometry) la.setLayerGeometry(selectedMaskId, { ...layer.geometry, feather: value }, img.width, img.height);
    reprocess();
  }, [getLA, selectedMaskId]);

  const selectedMask = masks.find(m => m.id === selectedMaskId) ?? null;

  // Press Delete/Backspace to delete the selected mask (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedMaskId) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      deleteMask(selectedMaskId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMaskId, deleteMask]);

  const renderMaskSlider = (cfg: SliderCfg, value: number, onChange: (v: number) => void) => {
    const rangeStep = cfg.rangeStep ?? cfg.step ?? 0.01;
    return (
      <div key={cfg.key} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>{cfg.label}</label>
          <div className="flex items-center gap-1.5">
            <DelayedInputControl value={value} onChange={onChange} min={cfg.min} max={cfg.max} step={cfg.step ?? 0.01} precision={2} />
            {cfg.unit && <span className="text-xs font-mono" style={{ color: 'var(--gray-500)', width: '20px' }}>{cfg.unit}</span>}
            <button onClick={() => onChange(0)} className="p-1 rounded" style={{ backgroundColor: 'transparent', color: 'var(--gray-500)' }} title="Reset"><RotateCcw className="w-3 h-3" /></button>
          </div>
        </div>
        <input
          type="range" min={cfg.min} max={cfg.max} step={rangeStep} value={value}
          onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(0)}
          className="slider w-full"
          style={{ background: `linear-gradient(to right, ${cfg.gradient})` }}
          title="Double-click to reset"
        />
      </div>
    );
  };

  const formatValue = (value: number, precision: number = 2): string => {
    return value.toFixed(precision);
  };

  // Use formatValue to prevent unused variable warning
  console.debug('formatValue available:', formatValue);

  const renderSlider = (cfg: SliderCfg) => {
    const value = params[cfg.key] as number;
    const rangeStep = cfg.rangeStep ?? cfg.step ?? 0.01;
    return (
      <div key={cfg.key} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>{cfg.label}</label>
          <div className="flex items-center gap-1.5">
            <DelayedInputControl
              value={value}
              onChange={(v) => updateParam(cfg.key, v)}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step ?? 0.01}
              precision={2}
            />
            {cfg.unit && <span className="text-xs font-mono" style={{ color: 'var(--gray-500)', width: '20px' }}>{cfg.unit}</span>}
            <button
              onClick={() => resetParam(cfg.key, 0.0)}
              className="p-1 rounded"
              style={{ backgroundColor: 'transparent', color: 'var(--gray-500)', transition: 'var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--gray-800)'; e.currentTarget.style.color = 'var(--white)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--gray-500)'; }}
              title={`Reset ${cfg.label.toLowerCase()}`}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
        <input
          type="range"
          min={cfg.min}
          max={cfg.max}
          step={rangeStep}
          value={value}
          onInput={(e) => updateParamRealTime(cfg.key, parseFloat((e.target as HTMLInputElement).value))}
          onChange={(e) => updateParam(cfg.key, parseFloat(e.target.value))}
          onDoubleClick={() => updateParam(cfg.key, 0.0)}
          className="slider w-full"
          style={{ background: `linear-gradient(to right, ${cfg.gradient})` }}
          title="Double-click to reset"
        />
      </div>
    );
  };

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
            onClick={() => {
              const img = imageService.getCurrentImage();
              if (!img) { logger.warn('No image for auto adjust'); return; }
              const stats = autoAdjustService.analyse(img.data, img.width, img.height);
              const computed = autoAdjustService.autoBasicAdj(stats);
              module.setParams(computed);
              const newParams = module.getParams() as BasicAdjParams;
              setParams(newParams);
              onParamsChange?.(newParams);
              logger.info('Auto adjustments applied (image-aware)');
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

      {/* Local Adjustments mask tools */}
      <div className="space-y-2 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--gray-500)', letterSpacing: '0.5px' }}>Local Adjustments</label>
        <div className="flex gap-1.5">
          <button onClick={() => createMask('radial_gradient')} className="flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 rounded border text-xs"
            style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-300)' }} title="Add a circle / oval mask">
            <Circle className="w-3.5 h-3.5" /> Circle
          </button>
          <button onClick={() => createMask('linear_gradient')} className="flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 rounded border text-xs"
            style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-300)' }} title="Add a linear gradient mask">
            <span style={{ fontSize: '13px', lineHeight: 1 }}>▤</span> Gradient
          </button>
        </div>
        {masks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {masks.map(mk => (
              <button key={mk.id} onClick={() => selectMask(mk.id)} className="px-2 py-1 rounded border text-xs"
                style={{ backgroundColor: mk.id === selectedMaskId ? 'var(--gray-700)' : 'transparent', borderColor: mk.id === selectedMaskId ? 'var(--primary-500)' : 'var(--border)', color: 'var(--gray-200)' }}>
                {mk.type === 'radial_gradient' ? '◯' : '▤'} {mk.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Per-mask Local Adjustments sliders — directly under the mask buttons, only
          when a mask is selected; in a lighter-grey card to distinguish it from the
          global Basic Adjustments below. */}
      {selectedMask && (
        <div className="space-y-3 rounded-lg" style={{ backgroundColor: 'var(--gray-700)', border: '1px solid var(--border)', padding: '10px' }}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--primary-400)' }}>
              {selectedMask.type === 'radial_gradient' ? '◯' : '▤'} {selectedMask.name}
            </label>
            <button onClick={() => deleteMask(selectedMask.id)} className="p-1 rounded" style={{ color: 'var(--red-400)' }} title="Delete mask (Del)">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-xs" style={{ color: 'var(--gray-300)' }}>Drag on the image to place / move / resize / rotate this mask. Press Del to delete.</div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--gray-200)' }}>Feather</span>
              <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{maskFeather.toFixed(2)}</span>
            </div>
            <input type="range" min={0.01} max={1} step={0.01} value={maskFeather} className="slider w-full"
              onInput={(e) => updateMaskFeather(parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => updateMaskFeather(parseFloat(e.target.value))} />
          </div>
          <div className="space-y-3">
            {BASIC_ADJ_SLIDERS.map(cfg => renderMaskSlider(cfg, maskBA[cfg.key] as number, (v) => updateMaskBA(cfg.key, v)))}
          </div>
        </div>
      )}

      {/* Global Basic Adjustments */}
      <div className="space-y-3">
        {BASIC_ADJ_SLIDERS.map(renderSlider)}
      </div>
    </div>
  );
}