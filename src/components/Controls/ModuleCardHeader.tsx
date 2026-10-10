import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

interface ModuleCardHeaderProps {
  /** 15px lucide glyph (e.g. `<Sun size={15} />`); inherits currentColor. */
  icon: ReactNode;
  /** Module title, 13px/600. */
  title: string;
  /** State subtitle, 11.5px muted (e.g. "Cloudy · 5900 K", "2 edits active"). */
  subtitle?: string;
  /** Auto handler. Omit → no Auto button (module has no auto function). */
  onAuto?: () => void;
  /** Reset ↺ handler. Omit → no Reset button. */
  onReset?: () => void;
}

const actionBase = {
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 5,
  border: 0,
  background: 'transparent',
  color: 'var(--glass-text-secondary)',
} as const;

/**
 * Module header in the docked inspector (Safelight): glyph · title · state
 * subtitle, then the actions — Auto, then Reset ↺ (same order on every
 * module; modules without an auto function show Reset only). Flat: no band,
 * no accent icon tile — just a hairline below, like a native inspector
 * section. Hover/press fills come from `.glass-pill-btn` in src/index.css.
 */
export function ModuleCardHeader({ icon, title, subtitle, onAuto, onReset }: ModuleCardHeaderProps) {
  return (
    <div
      data-testid="module-card-header"
      className="flex items-center"
      style={{
        minHeight: 52,
        padding: '10px 10px 10px 16px',
        gap: 10,
        borderBottom: '1px solid var(--glass-border)',
      }}
    >
      <div
        data-testid="module-card-icon"
        className="inline-flex items-center justify-center flex-shrink-0"
        style={{ width: 18, height: 18, color: 'var(--glass-text-label)' }}
      >
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div
          style={{
            fontSize: 13,
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
            data-testid="module-card-subtitle"
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

      {(onAuto || onReset) && (
        <div className="flex items-center flex-shrink-0" style={{ gap: 2 }}>
          {onAuto && (
            <button
              type="button"
              aria-label="Auto"
              title="Auto-adjust this module from the photo"
              onClick={onAuto}
              className="glass-pill-btn"
              style={{ ...actionBase, padding: '0 9px', fontSize: 12, fontWeight: 600 }}
            >
              Auto
            </button>
          )}
          {onReset && (
            <button
              type="button"
              aria-label="Reset"
              title="Reset this module"
              onClick={onReset}
              className="glass-pill-btn"
              style={{ ...actionBase, width: 26 }}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ModuleCardHeader;
