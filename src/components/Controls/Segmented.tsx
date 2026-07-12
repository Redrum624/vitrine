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
}

/**
 * Glass · Sectioned segmented control: container rgba(0,0,0,.35) radius 9
 * padding 3; active segment = accent-soft fill / accent-ring border / accent
 * text. Generic over any string-literal union (mode tiles, channel tabs,
 * Develop|Gallery toggle, ...). See the Glass UI design spec
 * ("Chips/tiles" → Segmented controls).
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
export function Segmented<T extends string>({ options, value, onChange, className = '' }: SegmentedProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndActivate = (index: number) => {
    const option = options[index];
    if (!option) return;
    // With a single option, Home/End/ArrowLeft/ArrowRight all wrap back to the SAME
    // (already-active) index — skip the redundant onChange so a single-item control
    // doesn't fire a spurious no-op change on every arrow keypress.
    const activeIndex = options.findIndex((o) => o.value === value);
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

  return (
    <div
      role="tablist"
      className={`inline-flex ${className}`}
      style={{
        background: 'rgba(0,0,0,.35)',
        borderRadius: 9,
        padding: 3,
        gap: 2,
      }}
    >
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
              padding: '6px 12px',
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              border: '1px solid',
              borderColor: active ? 'var(--accent-ring)' : 'transparent',
              background: active ? 'var(--accent-soft)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--glass-text-secondary)',
              cursor: 'pointer',
              transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
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
