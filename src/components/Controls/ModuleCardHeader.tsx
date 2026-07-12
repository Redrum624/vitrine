import { useState } from 'react';
import type { ReactNode } from 'react';
import { Zap, RotateCcw } from 'lucide-react';

interface ModuleCardHeaderProps {
  /** 15px accent lucide glyph (e.g. `<Sun size={15} />`); inherits currentColor. */
  icon: ReactNode;
  /** Module title, 12.5px/600. */
  title: string;
  /** State subtitle, 10.5px muted (e.g. "Cloudy · 5900 K", "2 edits active"). */
  subtitle?: string;
  /** Auto ⚡ handler. Omit → no Auto chip (module has no auto function). */
  onAuto?: () => void;
  /** Reset ↺ handler. Omit → no Reset chip. */
  onReset?: () => void;
}

/** 26px square action chip (Auto ⚡ / Reset ↺): radius 8, .04 fill, .1 border. */
function HeaderChip({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      className="inline-flex items-center justify-center"
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
      {children}
    </button>
  );
}

/**
 * Unified module-card header (Glass · Sectioned, §4). Padding 13×16, bg
 * rgba(0,0,0,.3), bottom hairline; 28px accent icon chip · title · state
 * subtitle · Auto⚡ then Reset↺ (same order on every module — modules without
 * an auto function show Reset only). See the Glass UI design spec
 * ("Module card system" → Header) and 4a-module-*.png.
 */
export function ModuleCardHeader({ icon, title, subtitle, onAuto, onReset }: ModuleCardHeaderProps) {
  return (
    <div
      data-testid="module-card-header"
      className="flex items-center"
      style={{
        padding: '13px 16px',
        gap: 11,
        background: 'rgba(0,0,0,.3)',
        borderBottom: '1px solid var(--glass-border)',
      }}
    >
      <div
        data-testid="module-card-icon"
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

      <div className="flex-1 min-w-0">
        <div
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
            data-testid="module-card-subtitle"
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

      {(onAuto || onReset) && (
        <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
          {onAuto && (
            <HeaderChip label="Auto" onClick={onAuto}>
              <Zap size={14} />
            </HeaderChip>
          )}
          {onReset && (
            <HeaderChip label="Reset" onClick={onReset}>
              <RotateCcw size={14} />
            </HeaderChip>
          )}
        </div>
      )}
    </div>
  );
}

export default ModuleCardHeader;
