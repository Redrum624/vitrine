import { useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

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
  /**
   * Precision used ONLY by the click-to-edit numeric entry (typed value
   * snapping/rounding) — dragging the thumb always uses `step`. Lets a
   * consumer offer coarse drag increments (e.g. step 1) while still
   * accepting fine-grained typed values (e.g. typingStep 0.01). Defaults to
   * `step`, so consumers that don't pass it see no behavior change.
   */
  typingStep?: number;
  onChange: (value: number) => void;
  /** Formats the value text (e.g. "+0.35"); defaults to the raw number. */
  formatValue?: (value: number) => string;
  /** CSS `background` for the track, e.g. the Exposure/Temperature/Tint gradients. */
  trackBackground?: string;
  /** Optional 10px muted legend row under the track (e.g. Cool / Neutral / Warm). */
  legend?: SliderRowLegend;
  disabled?: boolean;
  className?: string;
  /**
   * Fired on pointer-down/touch-start on the thumb (and when a label scrub
   * starts), before any onChange. Lets a consumer track an "actively
   * dragging" state (e.g. Crop's rotation guide overlay) — optional, most
   * sliders don't need it.
   */
  onDragStart?: () => void;
  /**
   * Fired on pointer-up/leave/touch-end (and when a label scrub ends). Pairs
   * with `onDragStart` for consumers that need a side-effect at the END of a
   * drag (e.g. Crop's auto-crop-on-release).
   */
  onDragEnd?: () => void;
}

/** Pixels of horizontal label drag that cover the slider's full range. */
const SCRUB_SPAN_PX = 280;

/**
 * Safelight slider row: label and value on one line, a 3px track below.
 *
 * - **Edited state** — when `value !== defaultValue` an amber dot appears in
 *   the gutter beside the label, the label and value brighten, and a light
 *   fill runs along the track from the default to the current value, so you
 *   can scan a module for what you changed.
 * - **Detent** — a short tick marks the default when it sits inside the range.
 * - **Reset** — double-click the thumb or the label.
 * - **Scrub** — drag the label sideways to adjust (Shift for fine control),
 *   like the scrubby labels in desktop photo editors.
 * - **Type** — click the value to type an exact number (Enter / blur commits,
 *   Escape cancels).
 *
 * The native range input supplies the thumb (see .glass-slider-thumb in
 * src/index.css), so keyboard and screen-reader behaviour stay native.
 */
export function SliderRow({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  typingStep,
  onChange,
  formatValue,
  trackBackground,
  legend,
  disabled = false,
  className = '',
  onDragStart,
  onDragEnd,
}: SliderRowProps) {
  const sliderId = useId();
  const labelId = `${sliderId}-label`;
  const effectiveTypingStep = typingStep ?? step;
  const span = max - min || 1;
  const edited = value !== defaultValue;
  const valueText = formatValue ? formatValue(value) : `${value}`;
  const hasDetent = min < defaultValue && defaultValue < max;
  const detentFraction = ((defaultValue - min) / span) * 100;
  const valueFraction = ((Math.min(max, Math.max(min, value)) - min) / span) * 100;
  const fillFrom = Math.min(detentFraction, valueFraction);
  const fillWidth = Math.abs(valueFraction - detentFraction);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const beginEdit = () => {
    if (disabled) return;
    setDraft(String(value));
    setEditing(true);
  };

  const commitEdit = () => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      const snapped = effectiveTypingStep
        ? Math.round((clamped - min) / effectiveTypingStep) * effectiveTypingStep + min
        : clamped;
      const decimals = (effectiveTypingStep ? effectiveTypingStep.toString().split('.')[1] ?? '' : '').length;
      onChange(decimals > 0 ? parseFloat(snapped.toFixed(decimals)) : snapped);
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  const resetToDefault = () => {
    if (!disabled) onChange(defaultValue);
  };

  // Label scrub: pointer capture on the label; a drag past 3px adjusts the
  // value proportionally to SCRUB_SPAN_PX, snapped to `step`. A plain click
  // still focuses the slider (the label's default behaviour).
  const scrub = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const decimalsOf = (n: number) => (n.toString().split('.')[1] ?? '').length;

  const onLabelPointerDown = (e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is unavailable (e.g. synthetic events) — scrubbing still works while over the label.
    }
    scrub.current = { x: e.clientX, start: value, moved: false };
  };

  const onLabelPointerMove = (e: ReactPointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved) {
      if (Math.abs(dx) < 3) return;
      s.moved = true;
      onDragStart?.();
    }
    const raw = s.start + (dx / SCRUB_SPAN_PX) * span * (e.shiftKey ? 0.2 : 1);
    const clamped = Math.min(max, Math.max(min, raw));
    const snapped = Math.round((clamped - min) / step) * step + min;
    const decimals = decimalsOf(step);
    const next = decimals > 0 ? parseFloat(snapped.toFixed(decimals)) : snapped;
    if (next !== value) onChange(next);
  };

  const onLabelPointerUp = (e: ReactPointerEvent) => {
    const s = scrub.current;
    scrub.current = null;
    if (s?.moved) {
      e.preventDefault();
      onDragEnd?.();
    }
  };

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: 5, opacity: disabled ? 0.5 : 1 }}>
      <div className="flex items-center justify-between" style={{ position: 'relative', minHeight: 22 }}>
        <span
          aria-hidden="true"
          data-edited-dot="true"
          style={{
            position: 'absolute',
            left: -10,
            top: '50%',
            width: 5,
            height: 5,
            marginTop: -2.5,
            borderRadius: '50%',
            background: 'var(--accent)',
            transform: `scale(${edited ? 1 : 0})`,
            transition: 'transform 280ms var(--ease-spring)',
          }}
        />
        <label
          id={labelId}
          htmlFor={sliderId}
          title="Drag to adjust · double-click to reset"
          onPointerDown={onLabelPointerDown}
          onPointerMove={onLabelPointerMove}
          onPointerUp={onLabelPointerUp}
          onPointerCancel={onLabelPointerUp}
          onDoubleClick={resetToDefault}
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: edited ? 'var(--vt-text)' : 'var(--glass-text-label)',
            cursor: disabled ? 'default' : 'ew-resize',
            touchAction: 'none',
            whiteSpace: 'nowrap',
            overflow: 'visible',
            transition: 'color 120ms ease',
          }}
        >
          {label}
        </label>
        {editing ? (
          <input
            type="number"
            autoFocus
            aria-label={`${label} value`}
            value={draft}
            min={min}
            max={max}
            step={effectiveTypingStep}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '20px',
              height: 22,
              padding: '0 6px',
              width: 64,
              textAlign: 'right',
              borderRadius: 4,
              border: '1px solid var(--accent)',
              background: 'var(--vt-field)',
              color: 'var(--vt-text)',
              outline: 'none',
            }}
          />
        ) : (
          <button
            type="button"
            data-edited={edited || undefined}
            onClick={beginEdit}
            disabled={disabled}
            title="Click to type a value"
            className="vt-value-text"
            style={{
              fontFamily: 'inherit',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '20px',
              height: 22,
              minWidth: 44,
              padding: '0 6px',
              marginRight: -6,
              textAlign: 'right',
              borderRadius: 4,
              border: '1px solid transparent',
              background: 'transparent',
              color: edited ? 'var(--vt-text)' : 'var(--glass-text-muted)',
              transition: 'color 120ms ease, border-color 120ms ease',
            }}
          >
            {valueText}
          </button>
        )}
      </div>

      <div style={{ position: 'relative', height: 18 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 7.5,
            height: 3,
            borderRadius: 2,
            background: trackBackground || '#36363b',
            opacity: trackBackground ? 0.75 : 1,
            pointerEvents: 'none',
          }}
        />
        {!trackBackground && edited && (
          <div
            aria-hidden="true"
            data-edited-fill="true"
            style={{
              position: 'absolute',
              top: 7.5,
              height: 3,
              left: `${fillFrom}%`,
              width: `${fillWidth}%`,
              borderRadius: 2,
              background: '#d9d9de',
              pointerEvents: 'none',
            }}
          />
        )}
        {hasDetent && (
          <div
            aria-hidden="true"
            data-detent="true"
            style={{
              position: 'absolute',
              top: 4,
              left: `${detentFraction}%`,
              marginLeft: -0.5,
              width: 1,
              height: 10,
              background: '#5a5a61',
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
          onDoubleClick={resetToDefault}
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
          onMouseUp={onDragEnd}
          onMouseLeave={onDragEnd}
          onTouchEnd={onDragEnd}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText}
          title="Double-click to reset to default"
          className={`glass-slider-thumb${edited ? ' is-edited' : ''}`}
          style={{ position: 'absolute', left: -6, top: 0, width: 'calc(100% + 12px)', margin: 0 }}
        />
      </div>

      {legend && (
        <div className="flex items-center justify-between" style={{ fontSize: 10.5, color: 'var(--glass-text-muted)', marginTop: -2 }}>
          <span>{legend.left}</span>
          {legend.center && <span>{legend.center}</span>}
          <span>{legend.right}</span>
        </div>
      )}
    </div>
  );
}

export default SliderRow;
