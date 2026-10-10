import type { CSSProperties, ReactNode } from 'react';

interface AccentButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  /** Stretches to the width of its container (e.g. BatchProcessingDialog's
   *  "Create and Start Batch Job"). Defaults to inline sizing. */
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * Safelight primary action: solid safelight amber, `--accent-ink` text,
 * 30px tall, 12.5px/600, radius 6 — no glow, no lift. One per surface: the
 * modal-footer primary (Export, Apply, Create and Start Batch Job, ...).
 * Hover (brightness) / press (scale .98) / disabled states live in
 * `.glass-modal-btn-primary` (src/index.css) so call sites don't each
 * restate bespoke JS hover state.
 */
export function AccentButton({
  children,
  onClick,
  disabled = false,
  type = 'button',
  fullWidth = false,
  className = '',
  style,
  title,
}: AccentButtonProps) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`glass-modal-btn-primary inline-flex items-center justify-center gap-2 ${fullWidth ? 'w-full' : ''} ${className}`}
      style={{
        height: 30,
        padding: '0 16px',
        borderRadius: 6,
        fontSize: 12.5,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export default AccentButton;
