import React, { useState, useCallback } from 'react';
import { Zap, Palette, Eye, RotateCcw, Target, ChevronDown, ChevronRight, Aperture, Film } from 'lucide-react';
import { LensCorrectionsParams } from '../../modules/LensCorrectionsModule';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface LensCorrectionsModuleComponentProps {
  parameters: LensCorrectionsParams;
  onParametersChange: (params: Partial<LensCorrectionsParams>) => void;
  onAutoDetectVignetting?: () => void;
  onResetSection?: (section: 'vignetting' | 'distortion' | 'chromaticAberration' | 'blur' | 'filmGrain' | 'all') => void;
  className?: string;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

const VIGNETTING_PRESETS = [
  { name: 'Subtle', amount: 20, midpoint: 1.0, roundness: 0, feather: 60 },
  { name: 'Moderate', amount: 40, midpoint: 1.0, roundness: 0, feather: 50 },
  { name: 'Strong', amount: 60, midpoint: 0.8, roundness: -10, feather: 40 },
  { name: 'Wide Lens', amount: 80, midpoint: 0.6, roundness: -20, feather: 30 },
];

const DISTORTION_PRESETS = [
  { name: 'Barrel Weak', barrel: -15, scale: 1.05 },
  { name: 'Barrel Strong', barrel: -35, scale: 1.15 },
  { name: 'Pincushion Weak', barrel: 15, scale: 0.95 },
  { name: 'Pincushion Strong', barrel: 35, scale: 0.85 },
];

// ── Reusable bits ───────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, suffix = '', decimals = 0, desc }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string; decimals?: number; desc?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: 'var(--gray-400)' }}>{value.toFixed(decimals)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="slider w-full" />
      {desc && <div className="text-xs" style={{ color: 'var(--gray-500)' }}>{desc}</div>}
    </div>
  );
}

function Presets({ items, onApply }: { items: { name: string }[]; onApply: (i: number) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Presets</label>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((p, i) => (
          <button key={p.name} onClick={() => onApply(i)} className="px-2 py-1 text-xs rounded"
            style={{ backgroundColor: 'var(--gray-700)', color: 'var(--white)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--gray-600)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--gray-700)'; }}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// A collapsible category section with an enable toggle (+ optional auto / reset).
function Section({ title, icon: Icon, enabled, onToggleEnabled, onReset, onAuto, children }: {
  title: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  enabled: boolean; onToggleEnabled: (v: boolean) => void; onReset?: () => void; onAuto?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(enabled);
  const iconBtn = { backgroundColor: 'transparent', color: 'var(--gray-400)' } as React.CSSProperties;
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" style={{ backgroundColor: 'var(--gray-800)' }} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--gray-500)' }} />}
        <Icon className="w-3.5 h-3.5" style={{ color: enabled ? 'var(--primary-400)' : 'var(--gray-500)' }} />
        <span className="text-xs font-medium flex-1 truncate" style={{ color: enabled ? 'var(--gray-100)' : 'var(--gray-400)' }}>{title}</span>
        <input type="checkbox" checked={enabled} onClick={(e) => e.stopPropagation()} onChange={(e) => onToggleEnabled(e.target.checked)} className="rounded" title="Enable" />
        {onAuto && (
          <button onClick={(e) => { e.stopPropagation(); onAuto(); }} className="p-1 rounded" style={iconBtn} title="Auto-detect">
            <Target className="w-3 h-3" />
          </button>
        )}
        {onReset && (
          <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="p-1 rounded" style={iconBtn} title="Reset this section">
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 py-3 space-y-3" style={{ opacity: enabled ? 1 : 0.55, pointerEvents: enabled ? 'auto' : 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Module ──────────────────────────────────────────────────────────────────
export const LensCorrectionsModuleComponent: React.FC<LensCorrectionsModuleComponentProps> = ({
  parameters, onParametersChange, onAutoDetectVignetting, onResetSection, className = '', onRegisterActions,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Local UI state mirror of the params. The component is keyed by paramSync, so it
  // remounts (re-initialising from the prop) after external changes (auto-detect /
  // reset). For in-component edits, we update this local state immediately AND
  // propagate the partial to the module — otherwise the checkbox/slider would snap
  // back to the (unchanged) module value because the parent doesn't re-render.
  const [params, setParams] = useState(parameters);
  const { vignetting, distortion, chromaticAberration: ca, blur, filmGrain } = params;

  const update = useCallback((partial: Partial<LensCorrectionsParams>) => {
    setParams(prev => ({ ...prev, ...partial }));
    onParametersChange(partial);
  }, [onParametersChange]);

  const setVignetting = useCallback((key: string, value: number | boolean) =>
    update({ vignetting: { ...params.vignetting, [key]: value } }), [params.vignetting, update]);
  const setDistortion = useCallback((key: string, value: number | boolean | object) =>
    update({ distortion: { ...params.distortion, [key]: value } }), [params.distortion, update]);
  const setCA = useCallback((key: string, value: number | boolean | object) =>
    update({ chromaticAberration: { ...params.chromaticAberration, [key]: value } }), [params.chromaticAberration, update]);
  const setBlur = useCallback((key: string, value: number | boolean) =>
    update({ blur: { ...params.blur, [key]: value } }), [params.blur, update]);
  const setFilmGrain = useCallback((key: string, value: number | boolean) =>
    update({ filmGrain: { ...params.filmGrain, [key]: value } }), [params.filmGrain, update]);

  const activeCount = [vignetting.enabled, distortion.enabled, ca.enabled, blur.enabled, filmGrain.enabled].filter(Boolean).length;

  // Card header (Task 2): Auto ⚡ = auto-detect vignetting, Reset ↺ = reset all
  // corrections — both reuse the module's existing callbacks unchanged.
  useRegisterModuleCardActions(onRegisterActions, {
    auto: onAutoDetectVignetting,
    reset: onResetSection ? () => onResetSection('all') : undefined,
  });

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Distortion */}
      <Section title="Distortion" icon={Zap} enabled={distortion.enabled}
        onToggleEnabled={(v) => setDistortion('enabled', v)} onReset={onResetSection && (() => onResetSection('distortion'))}>
        <Presets items={DISTORTION_PRESETS} onApply={(i) => update({ distortion: { ...params.distortion, enabled: true, ...DISTORTION_PRESETS[i], perspective: { horizontal: 0, vertical: 0 } } })} />
        <Slider label="Barrel / Pincushion" value={distortion.barrel} min={-100} max={100} step={1} onChange={(v) => setDistortion('barrel', v)} desc="Negative = barrel, positive = pincushion" />
        <Slider label="Scale" value={distortion.scale} min={0.5} max={2.0} step={0.01} decimals={2} onChange={(v) => setDistortion('scale', v)} />
        <div className="pt-2 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Perspective</label>
          <Slider label="Horizontal" value={distortion.perspective.horizontal} min={-45} max={45} step={0.1} decimals={1} suffix="°"
            onChange={(v) => setDistortion('perspective', { ...distortion.perspective, horizontal: v })} />
          <Slider label="Vertical" value={distortion.perspective.vertical} min={-45} max={45} step={0.1} decimals={1} suffix="°"
            onChange={(v) => setDistortion('perspective', { ...distortion.perspective, vertical: v })} />
        </div>
      </Section>

      {/* Vignetting */}
      <Section title="Vignetting" icon={Eye} enabled={vignetting.enabled}
        onToggleEnabled={(v) => setVignetting('enabled', v)} onReset={onResetSection && (() => onResetSection('vignetting'))} onAuto={onAutoDetectVignetting}>
        <Presets items={VIGNETTING_PRESETS} onApply={(i) => update({ vignetting: { ...params.vignetting, enabled: true, ...VIGNETTING_PRESETS[i] } })} />
        <Slider label="Amount" value={vignetting.amount} min={-100} max={100} step={1} onChange={(v) => setVignetting('amount', v)} />
        <Slider label="Midpoint" value={vignetting.midpoint} min={0.1} max={2.0} step={0.01} decimals={2} onChange={(v) => setVignetting('midpoint', v)} />
        <Slider label="Roundness" value={vignetting.roundness} min={-100} max={100} step={1} onChange={(v) => setVignetting('roundness', v)} />
        <Slider label="Feather" value={vignetting.feather} min={0} max={100} step={1} suffix="%" onChange={(v) => setVignetting('feather', v)} />
      </Section>

      {/* Chromatic Aberration */}
      <Section title="Chromatic Aberration" icon={Palette} enabled={ca.enabled}
        onToggleEnabled={(v) => setCA('enabled', v)} onReset={onResetSection && (() => onResetSection('chromaticAberration'))}>
        <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Lateral (defringe edges)</label>
        <Slider label="Red / Cyan" value={ca.redCyan} min={-100} max={100} step={1} onChange={(v) => setCA('redCyan', v)} />
        <Slider label="Blue / Magenta" value={ca.blueMagenta} min={-100} max={100} step={1} onChange={(v) => setCA('blueMagenta', v)} />
        <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          <label className="text-xs font-medium" style={{ color: 'var(--gray-300)' }}>Defringe</label>
          {([
            { key: 'purple', label: 'Purple', color: '#a855f7' },
            { key: 'green', label: 'Green', color: '#22c55e' },
          ] as const).map(({ key, label, color }) => {
            const f = ca[key];
            return (
              <div key={key} className="space-y-2 pl-2" style={{ borderLeft: `2px solid ${color}` }}>
                <span className="text-xs font-medium" style={{ color }}>{label}</span>
                <Slider label="Amount" value={f.amount} min={0} max={100} step={1} suffix="%" onChange={(v) => setCA(key, { ...f, amount: v })} />
                {showAdvanced && <>
                  <Slider label="Hue" value={f.hue} min={0} max={360} step={1} suffix="°" onChange={(v) => setCA(key, { ...f, hue: v })} />
                  <Slider label="Range" value={f.range} min={1} max={100} step={1} onChange={(v) => setCA(key, { ...f, range: v })} />
                </>}
              </div>
            );
          })}
          <button onClick={() => setShowAdvanced((s) => !s)} className="text-xs" style={{ color: 'var(--primary-400)' }}>
            {showAdvanced ? 'Hide' : 'Show'} advanced (hue / range)
          </button>
        </div>
      </Section>

      {/* Blur */}
      <Section title="Blur" icon={Aperture} enabled={blur.enabled}
        onToggleEnabled={(v) => setBlur('enabled', v)} onReset={onResetSection && (() => onResetSection('blur'))}>
        <Slider label="Radius" value={blur.radius} min={0} max={20} step={0.5} decimals={1} suffix="px"
          onChange={(v) => setBlur('radius', v)} desc="Non-destructive Gaussian blur applied to the whole image" />
      </Section>

      {/* Film Grain */}
      <Section title="Film Grain" icon={Film} enabled={filmGrain.enabled}
        onToggleEnabled={(v) => setFilmGrain('enabled', v)} onReset={onResetSection && (() => onResetSection('filmGrain'))}>
        <Slider label="Amount" value={filmGrain.amount} min={0} max={100} step={1} suffix="%"
          onChange={(v) => setFilmGrain('amount', v)} desc="Grain intensity (luminance-weighted, strongest in midtones)" />
        <Slider label="Grain Size" value={filmGrain.size} min={1} max={4} step={1}
          onChange={(v) => setFilmGrain('size', v)} desc="1 = fine, 4 = coarse" />
      </Section>

      {/* Summary */}
      <div className="pt-2 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--gray-400)' }}>
        <span>Active corrections</span>
        <span style={{ color: activeCount > 0 ? 'var(--primary-400)' : 'var(--gray-500)' }}>{activeCount}</span>
      </div>
    </div>
  );
};

export default LensCorrectionsModuleComponent;
