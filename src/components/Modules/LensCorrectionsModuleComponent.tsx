import React, { useState, useCallback } from 'react';
import { Target, RotateCcw } from 'lucide-react';
import { LensCorrectionsParams } from '../../modules/LensCorrectionsModule';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { SliderRow } from '../Controls/SliderRow';

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

/** 22px icon-only action button (Auto-detect / Reset-this-section). Static tokens,
 * no hover-state JS — same idle look as ChipButton's idle state. */
function IconChip({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        border: '1px solid rgba(255,255,255,.1)',
        background: 'rgba(255,255,255,.04)',
        color: 'var(--glass-text-secondary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** Section header: SectionLabel (stretched via flex-1 so its hairline still
 * spans) + enable checkbox + optional Auto/Reset icon chips. */
function SectionHeader({ title, enabled, onToggleEnabled, onAuto, onReset }: {
  title: string; enabled: boolean; onToggleEnabled: (v: boolean) => void; onAuto?: () => void; onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 8 }}>
      <SectionLabel className="flex-1">{title}</SectionLabel>
      <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
        {onAuto && (
          <IconChip title="Auto-detect" onClick={onAuto}>
            <Target size={12} />
          </IconChip>
        )}
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          title={`Enable ${title}`}
          aria-label={`Enable ${title}`}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
        />
        {onReset && (
          <IconChip title="Reset this section" onClick={onReset}>
            <RotateCcw size={12} />
          </IconChip>
        )}
      </div>
    </div>
  );
}

function Presets({ items, onApply }: { items: { name: string }[]; onApply: (i: number) => void }) {
  return (
    <div className="grid grid-cols-2" style={{ gap: 6 }}>
      {items.map((p, i) => (
        <ChipButton key={p.name} onClick={() => onApply(i)}>{p.name}</ChipButton>
      ))}
    </div>
  );
}

/** 10px muted caption under a slider (mirrors the pre-port `desc` prop). */
function Caption({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: 'var(--glass-text-muted)' }}>{children}</div>;
}

/** Small sub-grouping label within a section (e.g. "Perspective", "Defringe"). */
function SubLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>{children}</span>;
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

  const sectionBodyStyle = (enabled: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', gap: 12,
    opacity: enabled ? 1 : 0.55, pointerEvents: enabled ? 'auto' : 'none',
  });

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: 18 }}>
      {/* Vignetting — first, per the reference shot (4a-module-lens-corrections.png) */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionHeader
          title="Vignetting"
          enabled={vignetting.enabled}
          onToggleEnabled={(v) => setVignetting('enabled', v)}
          onAuto={onAutoDetectVignetting}
          onReset={onResetSection && (() => onResetSection('vignetting'))}
        />
        <div style={sectionBodyStyle(vignetting.enabled)}>
          <Presets items={VIGNETTING_PRESETS} onApply={(i) => update({ vignetting: { ...params.vignetting, enabled: true, ...VIGNETTING_PRESETS[i] } })} />
          <SliderRow label="Amount" value={vignetting.amount} defaultValue={0} min={-100} max={100} step={1} onChange={(v) => setVignetting('amount', v)} />
          <SliderRow label="Midpoint" value={vignetting.midpoint} defaultValue={1.0} min={0.1} max={2.0} step={0.01} formatValue={(v) => v.toFixed(2)} onChange={(v) => setVignetting('midpoint', v)} />
          <SliderRow label="Roundness" value={vignetting.roundness} defaultValue={0} min={-100} max={100} step={1} onChange={(v) => setVignetting('roundness', v)} />
          <SliderRow label="Feather" value={vignetting.feather} defaultValue={50} min={0} max={100} step={1} formatValue={(v) => `${v}%`} onChange={(v) => setVignetting('feather', v)} />
        </div>
      </div>

      {/* Distortion */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionHeader
          title="Distortion"
          enabled={distortion.enabled}
          onToggleEnabled={(v) => setDistortion('enabled', v)}
          onReset={onResetSection && (() => onResetSection('distortion'))}
        />
        <div style={sectionBodyStyle(distortion.enabled)}>
          <Presets items={DISTORTION_PRESETS} onApply={(i) => update({ distortion: { ...params.distortion, enabled: true, ...DISTORTION_PRESETS[i], perspective: { horizontal: 0, vertical: 0 } } })} />
          <SliderRow label="Barrel / Pincushion" value={distortion.barrel} defaultValue={0} min={-100} max={100} step={1} onChange={(v) => setDistortion('barrel', v)} />
          <Caption>Negative = barrel, positive = pincushion</Caption>
          <SliderRow label="Scale" value={distortion.scale} defaultValue={1.0} min={0.5} max={2.0} step={0.01} formatValue={(v) => v.toFixed(2)} onChange={(v) => setDistortion('scale', v)} />
          <div className="flex flex-col" style={{ gap: 12, paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
            <SubLabel>Perspective</SubLabel>
            <SliderRow
              label="Horizontal" value={distortion.perspective.horizontal} defaultValue={0} min={-45} max={45} step={0.1}
              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
              onChange={(v) => setDistortion('perspective', { ...distortion.perspective, horizontal: v })}
            />
            <SliderRow
              label="Vertical" value={distortion.perspective.vertical} defaultValue={0} min={-45} max={45} step={0.1}
              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
              onChange={(v) => setDistortion('perspective', { ...distortion.perspective, vertical: v })}
            />
          </div>
        </div>
      </div>

      {/* Chromatic Aberration */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionHeader
          title="Chromatic Aberration"
          enabled={ca.enabled}
          onToggleEnabled={(v) => setCA('enabled', v)}
          onReset={onResetSection && (() => onResetSection('chromaticAberration'))}
        />
        <div style={sectionBodyStyle(ca.enabled)}>
          <SubLabel>Lateral (defringe edges)</SubLabel>
          <SliderRow label="Red / Cyan" value={ca.redCyan} defaultValue={0} min={-100} max={100} step={1} onChange={(v) => setCA('redCyan', v)} />
          <SliderRow label="Blue / Magenta" value={ca.blueMagenta} defaultValue={0} min={-100} max={100} step={1} onChange={(v) => setCA('blueMagenta', v)} />
          <div className="flex flex-col" style={{ gap: 10, paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
            <SubLabel>Defringe</SubLabel>
            {([
              { key: 'purple', label: 'Purple', color: '#a855f7' },
              { key: 'green', label: 'Green', color: '#22c55e' },
            ] as const).map(({ key, label, color }) => {
              const f = ca[key];
              return (
                <div key={key} className="flex flex-col" style={{ gap: 10, paddingLeft: 8, borderLeft: `2px solid ${color}` }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color }}>{label}</span>
                  <SliderRow label="Amount" value={f.amount} defaultValue={0} min={0} max={100} step={1} formatValue={(v) => `${v}%`} onChange={(v) => setCA(key, { ...f, amount: v })} />
                  {showAdvanced && <>
                    <SliderRow label="Hue" value={f.hue} defaultValue={key === 'purple' ? 300 : 60} min={0} max={360} step={1} formatValue={(v) => `${v}°`} onChange={(v) => setCA(key, { ...f, hue: v })} />
                    <SliderRow label="Range" value={f.range} defaultValue={10} min={1} max={100} step={1} onChange={(v) => setCA(key, { ...f, range: v })} />
                  </>}
                </div>
              );
            })}
            <ChipButton dashed onClick={() => setShowAdvanced((s) => !s)}>
              {showAdvanced ? 'Hide' : 'Show'} advanced (hue / range)
            </ChipButton>
          </div>
        </div>
      </div>

      {/* Blur */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionHeader
          title="Blur"
          enabled={blur.enabled}
          onToggleEnabled={(v) => setBlur('enabled', v)}
          onReset={onResetSection && (() => onResetSection('blur'))}
        />
        <div style={sectionBodyStyle(blur.enabled)}>
          <SliderRow label="Radius" value={blur.radius} defaultValue={0} min={0} max={20} step={0.5} formatValue={(v) => `${v.toFixed(1)} px`} onChange={(v) => setBlur('radius', v)} />
          <Caption>Non-destructive Gaussian blur applied to the whole image</Caption>
        </div>
      </div>

      {/* Film Grain */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionHeader
          title="Film Grain"
          enabled={filmGrain.enabled}
          onToggleEnabled={(v) => setFilmGrain('enabled', v)}
          onReset={onResetSection && (() => onResetSection('filmGrain'))}
        />
        <div style={sectionBodyStyle(filmGrain.enabled)}>
          <SliderRow label="Amount" value={filmGrain.amount} defaultValue={0} min={0} max={100} step={1} formatValue={(v) => `${v}%`} onChange={(v) => setFilmGrain('amount', v)} />
          <Caption>Grain intensity (luminance-weighted, strongest in midtones)</Caption>
          <SliderRow label="Grain Size" value={filmGrain.size} defaultValue={1} min={1} max={4} step={1} onChange={(v) => setFilmGrain('size', v)} />
          <Caption>1 = fine, 4 = coarse</Caption>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between" style={{ paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: 11 }}>
        <span style={{ color: 'var(--glass-text-muted)' }}>Active corrections</span>
        <span style={{ color: activeCount > 0 ? 'var(--accent)' : 'var(--glass-text-muted)' }}>{activeCount}</span>
      </div>
    </div>
  );
};

export default LensCorrectionsModuleComponent;
