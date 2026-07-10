import type { CSSProperties } from 'react';
import { electronService } from '../../services/ElectronService';

interface ToolbarProps {
  onExport?: () => void;
  onPrint?: () => void;
  onBatchProcess?: () => void;
  onOpenPresets?: () => void;
  onOpenPlugins?: () => void;
  onShowHelp?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitWindow?: () => void;
  onActualSize?: () => void;
  zoom?: number;
  onAutoAll?: () => void;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  hasStyleClipboard?: boolean;
  hasImage?: boolean;
  onToggleOriginal?: () => void;
  showOriginal?: boolean;
  onToggleReference?: () => void;
  referenceMode?: boolean;
}

// Base layout for an idle pill button — interactive :hover/:disabled states come
// from .glass-pill-btn in index.css (inline styles can't express pseudo-classes).
const pillBtn: CSSProperties = {
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 10px',
  gap: '5px',
  fontSize: '12.5px',
  borderRadius: '9px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--glass-text-chrome-primary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const pillIconBtn: CSSProperties = { ...pillBtn, width: '30px', padding: '0', fontSize: '15px' };

const divider: CSSProperties = { width: '1px', height: '18px', margin: '0 4px', background: 'var(--glass-border)' };

// A toggle that is "on" (Before/After, Reference) reads as an accent-soft tile.
const toggleActive: CSSProperties = {
  background: 'var(--accent-soft)',
  border: '1px solid var(--accent-ring)',
  color: 'var(--accent)',
};

export function Toolbar({ onExport, onPrint, onUndo: _onUndo, onRedo: _onRedo, canUndo: _canUndo = false, canRedo: _canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1, onAutoAll, onCopyStyle, onPasteStyle, hasStyleClipboard = false, hasImage = false, onToggleOriginal, showOriginal = false, onToggleReference, referenceMode = false }: ToolbarProps) {
  if (!electronService.isElectron()) return <div />;

  return (
    <div
      className="glass-chrome flex items-center no-select"
      style={{ borderRadius: '14px', padding: '6px 8px', gap: '3px' }}
    >
      <button onClick={() => electronService.openFile()} className="glass-pill-btn" style={pillBtn} title="Open Image">
        Open
      </button>
      <button onClick={onExport} className="glass-pill-btn" style={pillBtn} title="Export Image">
        Export
      </button>
      <button onClick={onPrint} disabled={!hasImage} className="glass-pill-btn" style={pillBtn} title="Print Image (Ctrl+P)">
        Print
      </button>

      <div style={divider} />

      {/* Auto All — the solid-accent primary (mirrors Enhance's Apply). */}
      <button
        onClick={onAutoAll}
        disabled={!hasImage}
        className="glass-pill-primary"
        style={{
          ...pillBtn,
          padding: '0 14px',
          fontWeight: 600,
          color: '#0b0b0c',
          background: 'var(--accent)',
          boxShadow: '0 0 0 1px var(--accent-ring), 0 6px 20px rgba(59, 130, 246, 0.35)',
        }}
        title="Auto-adjust all modules based on image analysis"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" />
        </svg>
        Auto All
      </button>

      <div style={divider} />

      <button onClick={onCopyStyle} disabled={!hasImage} className="glass-pill-btn" style={pillBtn} title="Analyse and copy the style of the current photo">
        Copy Style
      </button>
      <button
        onClick={onPasteStyle}
        disabled={!hasImage || !hasStyleClipboard}
        className="glass-pill-btn"
        style={pillBtn}
        title={hasStyleClipboard ? 'Apply the copied style to the current photo' : 'Copy a style first'}
      >
        Paste Style
      </button>

      <div style={divider} />

      <button
        onClick={onToggleOriginal}
        disabled={!hasImage}
        className="glass-pill-btn"
        style={{ ...pillBtn, ...(showOriginal ? toggleActive : null) }}
        title="Toggle before/after comparison (B)"
      >
        Before / After
      </button>
      <button
        onClick={onToggleReference}
        disabled={!hasImage}
        className="glass-pill-btn"
        style={{ ...pillBtn, ...(referenceMode ? toggleActive : null) }}
        title="Compare with a reference photo"
      >
        Reference
      </button>

      <div style={divider} />

      {/* Zoom cluster at the right end. The % readout doubles as the 1:1 action
          (click → Actual Size) — matches the reference pill (− 100% + Fit) while
          keeping both the readout and the actual-size semantics. */}
      <button onClick={onZoomOut} className="glass-pill-btn" style={pillIconBtn} title="Zoom Out">−</button>
      <button
        onClick={onActualSize}
        className="glass-pill-btn font-mono"
        style={{ ...pillBtn, padding: '0 6px', minWidth: '46px', fontSize: '11.5px', fontVariantNumeric: 'tabular-nums', color: 'var(--glass-text-chrome-idle)' }}
        title="Actual Size — 100% (1:1)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={onZoomIn} className="glass-pill-btn" style={pillIconBtn} title="Zoom In">+</button>
      <button onClick={onFitWindow} className="glass-pill-btn" style={pillBtn} title="Fit to Window">Fit</button>
    </div>
  );
}
