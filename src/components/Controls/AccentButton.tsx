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
 * Glass · Sectioned solid-accent primary action: bg var(--accent), text
 * #0b0b0c, 12.5px/700, radius 11, glow 0 2px 18px var(--accent-ring). This is
 * the modal-footer primary (Export, Apply, Create and Start Batch Job, ...) —
 * hover (translateY(-1px) + brightness) / press (scale .98) / disabled states
 * live in `.glass-modal-btn-primary` (src/index.css) so call sites don't each
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
        padding: '9px 18px',
        borderRadius: 11,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export default AccentButton;
