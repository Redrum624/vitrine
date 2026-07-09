import { useState } from 'react';
import type { ReactNode } from 'react';

interface ChipButtonProps {
  children: ReactNode;
  active?: boolean;
  /** Dashed-border variant (e.g. the dock's Gallery chip); solid on hover/active. */
  dashed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}

/**
 * Glass · Sectioned chip / tile button: padding 7×10-12, radius 9, idle
 * rgba(255,255,255,.04) fill / .1 border, 11.5px text. Active (and hover, per
 * the spec's "chips → accent soft/ring/text" hover rule) = accent-soft fill +
 * accent-ring border + accent text, 150ms transition; press = scale(.97).
 * See design_handoff_glass_ui/README.md ("Chips/tiles", "Interactions & Behavior").
 */
export function ChipButton({
  children,
  active = false,
  dashed = false,
  onClick,
  disabled = false,
  className = '',
  title,
  type = 'button',
}: ChipButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const highlighted = active || (hovered && !disabled);

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      data-active={active || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap ${className}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: '7px 11px',
        borderRadius: 9,
        fontSize: 11.5,
        borderWidth: 1,
        borderStyle: dashed && !highlighted ? 'dashed' : 'solid',
        borderColor: highlighted ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)',
        background: highlighted ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
        color: highlighted ? 'var(--accent)' : 'var(--glass-text-label)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transform: pressed ? 'scale(.97)' : 'scale(1)',
        transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease',
      }}
    >
      {children}
    </button>
  );
}

export default ChipButton;
