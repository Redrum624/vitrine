import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Smaller 22px segments for dense panels (default 24px). */
  size?: 'sm' | 'md';
}

/**
 * Safelight segmented control: equal-width segments in a recessed field, with
 * ONE raised indicator that slides to the selected segment on the spring
 * curve (340ms) instead of the selection jumping. Generic over any
 * string-literal union (mode tiles, channel tabs, Develop|Gallery, ...).
 *
 * Keyboard: implements the ARIA Authoring Practices "tabs" pattern with
 * *automatic activation* — roving tabindex (only the active segment is a Tab
 * stop; Tab enters/leaves the control on it) plus ArrowLeft/ArrowRight (wrap
 * at the ends) and Home/End, all of which move focus AND fire onChange in the
 * same step. This matches how a mouse click already selects on interaction
 * (no separate "confirm" step), so keyboard users get the same one-action
 * selection instead of the manual-activation variant (move focus, then
 * Enter/Space to commit).
 */
export function Segmented<T extends string>({ options, value, onChange, className = '', size = 'md' }: SegmentedProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = options.findIndex((o) => o.value === value);
  const count = Math.max(1, options.length);

  const focusAndActivate = (index: number) => {
    const option = options[index];
    if (!option) return;
    // With a single option, Home/End/ArrowLeft/ArrowRight all wrap back to the SAME
    // (already-active) index — skip the redundant onChange so a single-item control
    // doesn't fire a spurious no-op change on every arrow keypress.
    if (index !== activeIndex) onChange(option.value);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAndActivate((index + 1) % options.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAndActivate((index - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndActivate(options.length - 1);
        break;
      default:
        break;
    }
  };

  const height = size === 'sm' ? 22 : 24;

  return (
    <div
      role="tablist"
      className={`inline-grid ${className}`}
      style={{
        position: 'relative',
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(0, 1fr)',
        background: 'var(--vt-field)',
        boxShadow: 'inset 0 0 0 1px var(--vt-line-soft)',
        borderRadius: 7,
        padding: 2,
      }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden="true"
          data-segmented-indicator="true"
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: 2,
            width: `calc((100% - 4px) / ${count})`,
            borderRadius: 5,
            background: '#333338',
            boxShadow: '0 1px 2px rgba(0,0,0,.35), inset 0 0 0 .5px rgba(255,255,255,.07)',
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 340ms var(--ease-spring)',
            pointerEvents: 'none',
          }}
        />
      )}
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="segmented-tab"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            style={{
              position: 'relative',
              zIndex: 1,
              height,
              padding: size === 'sm' ? '0 9px' : '0 12px',
              borderRadius: 5,
              fontSize: size === 'sm' ? 11.5 : 12,
              fontWeight: active ? 600 : 500,
              border: 0,
              background: 'transparent',
              color: active ? 'var(--vt-text)' : 'var(--glass-text-muted)',
              whiteSpace: 'nowrap',
              transition: 'color 160ms ease',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
