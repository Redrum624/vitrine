import { useId } from 'react';
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
  /** 15px header glyph (inherits the label colour). Omit for icon-less dialogs. */
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
 * Shared modal chrome (Safelight): a dimming scrim + a centered, opaque
 * popover-surface card (`.glass-chrome`, radius 10) that scales up from .97
 * on the spring as it opens, a flat header (glyph / title / subtitle / close),
 * a scrollable body slot and an optional footer slot. One wrapper so the
 * dialogs (Export/Batch/ImageSize/...) restate only their own content, not
 * the overlay/card/header boilerplate. The card is fully opaque: dialogs sit
 * on top of the photo, and translucent cards lose contrast over a busy image.
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
      className="fixed inset-0 z-50 flex items-center justify-center vt-fade-in"
      style={{
        background: 'rgba(0, 0, 0, 0.45)',
      }}
      onClick={closeOnOverlayClick && onClose ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`glass-chrome vt-pop-in flex flex-col ${cardClassName}`}
        style={{ borderRadius: 10, overflow: 'hidden', transformOrigin: 'center', ...cardStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center flex-shrink-0"
          style={{
            padding: '12px 10px 12px 16px',
            gap: 10,
            borderBottom: '1px solid var(--vt-line)',
          }}
        >
          {icon && (
            <div
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{
                width: 18,
                height: 18,
                color: 'var(--glass-text-label)',
              }}
            >
              {icon}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div
              id={titleId}
              style={{
                fontSize: 13.5,
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
                  fontSize: 11.5,
                  color: 'var(--glass-text-muted)',
                  lineHeight: 1.35,
                  marginTop: 1,
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
            style={{ padding: '12px 16px', borderTop: '1px solid var(--vt-line)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 28px square close button — a plain glyph with the command-bar hover fill
 *  (.glass-pill-btn), like a native dialog's close button. */
function ModalCloseChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      title="Close"
      onClick={onClick}
      className="glass-pill-btn inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: 28,
        height: 28,
        borderRadius: 5,
        border: 0,
        background: 'transparent',
        color: 'var(--glass-text-secondary)',
      }}
    >
      <X size={15} />
    </button>
  );
}

export default GlassModal;
