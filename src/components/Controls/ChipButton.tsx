import { useState } from 'react';
import type { ReactNode } from 'react';

interface ChipButtonProps {
  children: ReactNode;
  active?: boolean;
  /** Dashed-border variant (e.g. the dock's Gallery chip); solid on hover/active. */
  dashed?: boolean;
  /** Corner radius override in px (default 6 — the standard chip radius). */
  radius?: number;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}

/**
 * Safelight chip: a compact toggle / preset button (white-balance presets,
 * mask tools, crop ratios). Idle chips sit in a dark field with a hairline
 * border; hover brightens the text; the active chip is a raised neutral tile
 * with a lighter border — the way native toggle buttons read. The accent is
 * deliberately NOT used here, so it keeps meaning "you changed this".
 */
export function ChipButton({
  children,
  active = false,
  dashed = false,
  radius = 6,
  onClick,
  disabled = false,
  className = '',
  title,
  type = 'button',
}: ChipButtonProps) {
  const [hovered, setHovered] = useState(false);
  const hot = hovered && !disabled;

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      data-active={active || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap ${className}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 26,
        padding: '0 10px',
        gap: 6,
        borderRadius: radius,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        borderWidth: 1,
        borderStyle: dashed && !active && !hot ? 'dashed' : 'solid',
        borderColor: active ? '#4b4b53' : hot ? '#3c3c43' : 'var(--vt-line)',
        background: active ? '#323237' : hot ? '#1c1c1f' : 'var(--vt-field)',
        color: active || hot ? 'var(--vt-text)' : 'var(--glass-text-label)',
        opacity: disabled ? 0.45 : 1,
        transition: 'background-color 90ms ease, border-color 120ms ease, color 90ms ease',
      }}
    >
      {children}
    </button>
  );
}

export default ChipButton;
