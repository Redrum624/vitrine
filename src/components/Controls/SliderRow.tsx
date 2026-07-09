import { useId } from 'react';

export interface SliderRowLegend {
  left: string;
  center?: string;
  right: string;
}

interface SliderRowProps {
  label: string;
  value: number;
  /** The value the double-click reset / center detent line snap to. */
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Formats the value chip text (e.g. "+0.35"); defaults to the raw number. */
  formatValue?: (value: number) => string;
  /** CSS `background` for the track, e.g. the Exposure/Temperature/Tint gradients. */
  trackBackground?: string;
  /** Optional 10px muted legend row under the track (e.g. Cool / Neutral / Warm). */
  legend?: SliderRowLegend;
  disabled?: boolean;
  className?: string;
}

/**
 * Glass · Sectioned slider row: label + edited-state value chip, 5px inset
 * track (optionally gradient), center detent line at the default value, and a
 * 14px thumb that grows + accent-rings on hover/drag (see .glass-slider-thumb
 * in src/index.css). Double-click resets to `defaultValue` (existing app
 * behavior). See design_handoff_glass_ui/README.md ("Slider row") and
 * 4a Dev Handoff.dc.html §4.
 */
export function SliderRow({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  trackBackground,
  legend,
  disabled = false,
  className = '',
}: SliderRowProps) {
  const sliderId = useId();
  const labelId = `${sliderId}-label`;
  const edited = value !== defaultValue;
  const chipText = formatValue ? formatValue(value) : `${value}`;
  const hasDetent = min < defaultValue && defaultValue < max;
  const detentFraction = hasDetent ? ((defaultValue - min) / (max - min)) * 100 : null;

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: 6 }}>
      <div className="flex items-center justify-between">
        <label id={labelId} htmlFor={sliderId} style={{ fontSize: 12, fontWeight: 500, color: 'var(--glass-text-label)' }}>
          {label}
        </label>
        <span
          data-edited={edited || undefined}
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            lineHeight: '16px',
            padding: '2px 8px',
            borderRadius: 6,
            border: `1px solid ${edited ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)'}`,
            background: edited ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
            color: edited ? 'var(--accent)' : 'var(--glass-text-secondary)',
          }}
        >
          {chipText}
        </span>
      </div>

      <div style={{ position: 'relative', height: 5 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 3,
            background: trackBackground || 'rgba(255,255,255,.09)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,.6)',
            pointerEvents: 'none',
          }}
        />
        {hasDetent && (
          <div
            aria-hidden="true"
            data-detent="true"
            style={{
              position: 'absolute',
              top: -3,
              left: `${detentFraction}%`,
              marginLeft: -0.5,
              width: 1,
              height: 11,
              background: 'rgba(255,255,255,.25)',
              pointerEvents: 'none',
            }}
          />
        )}
        <input
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          title="Double-click to reset to default"
          className={`glass-slider-thumb${edited ? ' is-edited' : ''}`}
          style={{ position: 'absolute', inset: 0, width: '100%', margin: 0, background: 'transparent' }}
        />
      </div>

      {legend && (
        <div className="flex items-center justify-between" style={{ fontSize: 10, color: 'var(--glass-text-muted)' }}>
          <span>{legend.left}</span>
          {legend.center && <span>{legend.center}</span>}
          <span>{legend.right}</span>
        </div>
      )}
    </div>
  );
}

export default SliderRow;
