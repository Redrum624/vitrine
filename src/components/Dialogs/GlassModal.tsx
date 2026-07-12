import { useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';

export interface GlassModalProps {
  isOpen: boolean;
  /** Omit for a dialog that deliberately has no close affordance today (rare) —
   *  the close chip and any close-on-X behavior only appear when this is set.
   *  GlassModal never wires Escape/click-outside itself; each consumer already
   *  owns whatever close semantics it has (see file-level note below). */
  onClose?: () => void;
  /** Header title, also the dialog's accessible name (aria-labelledby). */
  title: string;
  /** Muted state subtitle under the title (e.g. "3 images queued"). */
  subtitle?: string;
  /** 28px accent icon chip, module-card header anatomy. Omit for icon-less dialogs. */
  icon?: ReactNode;
  /** Extra header controls rendered before the close chip (rare; most dialogs
   *  only need the standard close affordance). */
  headerActions?: ReactNode;
  /** Footer slot (typically a button row). Omitted entirely when not given —
   *  no empty footer bar is rendered. */
  footer?: ReactNode;
  children: ReactNode;
  /** Card sizing varies a lot per dialog (Export/Batch are large + tabbed,
   *  ImageSize is a small fixed-width card) — passed straight through. */
  cardClassName?: string;
  cardStyle?: CSSProperties;
  /** Default body slot is independently scrollable but NOT padded — each
   *  consumer pads its own content (via bodyStyle/bodyClassName or padding
   *  inside children). Set false for dialogs that manage their own internal
   *  scroll regions (e.g. a non-scrolling sidebar next to scrollable tab
   *  content). */
  scrollBody?: boolean;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  /** Opt-in click-outside-to-dismiss on the scrim (calls `onClose`). Default
   *  false — most dialogs in this app only ever exposed an explicit close
   *  button. MenuBar's About dialog is the one existing exception (it already
   *  dismissed on an outside click before this port), so it passes `true`
   *  here to keep that exact behavior; every other consumer leaves this
   *  unset. Clicks inside the card never bubble to the scrim regardless. */
  closeOnOverlayClick?: boolean;
}

/**
 * Shared Glass · Sectioned modal chrome: scrim + centered glass card + the
 * module-card header anatomy (icon chip / title / subtitle / action chips)
 * + a scrollable body slot + an optional footer slot. One wrapper so the
 * ported dialogs (Export/Batch/ImageSize/...) restate only their own
 * content, not the overlay/card/header boilerplate.
 *
 * Card opacity decision: `.glass-card`'s default --glass-bg is rgba(15,15,19,.78)
 * (tuned for panels sitting beside the canvas). Modals sit ON TOP of the busy
 * canvas/filmstrip, so at .78 alpha body text loses contrast against whatever
 * image is behind it — this component overrides to rgba(15,15,19,.92) (still
 * translucent enough to read as "glass", opaque enough to stay legible over
 * any image). Decided once here rather than per-dialog.
 *
 * Escape is deliberately NOT imposed here: this app's existing dialogs only
 * ever expose an explicit close button (no Escape-to-dismiss anywhere in the
 * codebase today), so adding it here would be a new behavior, not a re-skin.
 * Click-outside is opt-in per dialog via `closeOnOverlayClick` (default off,
 * for the same reason) — MenuBar's About dialog is the one existing
 * exception that already dismissed on an outside click, so it opts in to
 * keep that exact behavior. Consumers otherwise keep wiring exactly the
 * close affordances they already have; GlassModal just renders the close
 * chip when `onClose` is supplied.
 */
export function GlassModal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  headerActions,
  footer,
  children,
  cardClassName = '',
  cardStyle,
  scrollBody = true,
  bodyClassName = '',
  bodyStyle,
  closeOnOverlayClick = false,
}: GlassModalProps) {
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(5,5,8,.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={closeOnOverlayClick && onClose ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`glass-card dc-rise flex flex-col ${cardClassName}`}
        style={{ background: 'rgba(15,15,19,.92)', overflow: 'hidden', ...cardStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center flex-shrink-0"
          style={{
            padding: '13px 16px',
            gap: 11,
            background: 'rgba(0,0,0,.3)',
            borderBottom: '1px solid var(--glass-border)',
          }}
        >
          {icon && (
            <div
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-ring)',
                color: 'var(--accent)',
              }}
            >
              {icon}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div
              id={titleId}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--glass-text-title)',
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontSize: 10.5,
                  color: 'var(--glass-text-muted)',
                  lineHeight: 1.35,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {subtitle}
              </div>
            )}
          </div>

          {headerActions}
          {onClose && <ModalCloseChip onClick={onClose} />}
        </div>

        <div
          className={`${scrollBody ? 'flex-1 overflow-y-auto' : 'flex-1 flex flex-col overflow-hidden'} ${bodyClassName}`}
          style={bodyStyle}
        >
          {children}
        </div>

        {footer && (
          <div
            data-testid="glass-modal-footer"
            className="flex-shrink-0"
            style={{ padding: '14px 16px', borderTop: '1px solid var(--glass-border)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 26px square close chip — same hover/press idiom as ModuleCardHeader's
 *  action chips (local JS hover state; there's no shared component for this
 *  exact square-icon-button shape to import). */
function ModalCloseChip({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label="Close"
      title="Close"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: hovered ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)',
        background: hovered ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
        color: hovered ? 'var(--accent)' : 'var(--glass-text-secondary)',
        cursor: 'pointer',
        transform: pressed ? 'scale(.96)' : 'scale(1)',
        transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease',
      }}
    >
      <X size={14} />
    </button>
  );
}

export default GlassModal;
