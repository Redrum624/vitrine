import type { ReactNode } from 'react';

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
 * Develop|Gallery toggle, ...). See design_handoff_glass_ui/README.md
 * ("Chips/tiles" → Segmented controls).
 */
export function Segmented<T extends string>({ options, value, onChange, className = '' }: SegmentedProps<T>) {
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
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              border: '1px solid',
              borderColor: active ? 'var(--accent-ring)' : 'transparent',
              background: active ? 'var(--accent-soft)' : 'transparent',
              color: active ? 'var(--accent)' : '#a8a8b0',
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
