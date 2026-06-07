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

export function Toolbar({ onExport, onPrint, onBatchProcess: _onBatchProcess, onOpenPresets: _onOpenPresets, onOpenPlugins: _onOpenPlugins, onShowHelp: _onShowHelp, onUndo, onRedo, canUndo = false, canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1, onAutoAll, onCopyStyle, onPasteStyle, hasStyleClipboard = false, hasImage = false, onToggleOriginal, showOriginal = false, onToggleReference, referenceMode = false }: ToolbarProps) {
  const btnClass = "bg-transparent border text-dark-300 flex items-center justify-center cursor-pointer hover:text-dark-100";
  const btnStyle = {width: '32px', height: '32px', fontSize: '13px', borderRadius: '3px', borderColor: 'var(--border)', transition: 'var(--transition-fast)'};

  return (
    <div className="flex items-center justify-between border-b no-select" style={{padding: '10px 20px', backgroundColor: 'var(--gray-900)', borderBottomColor: 'var(--border)'}}>
      {/* Left side - File and Tools */}
      <div className="flex items-center gap-1.5">
        {electronService.isElectron() && (
          <>
            <button
              onClick={() => electronService.openFile()}
              className={btnClass}
              style={{...btnStyle, width: 'auto', padding: '0 12px'}}
              title="Open Image"
            >
              Open
            </button>
            <button
              onClick={onExport}
              className={btnClass}
              style={{...btnStyle, width: 'auto', padding: '0 12px'}}
              title="Export Image"
            >
              Save
            </button>
            <button
              onClick={onPrint}
              disabled={!hasImage}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px'}}
              title="Print Image (Ctrl+P)"
            >
              Print
            </button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={btnStyle}
              title="Undo (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={btnStyle}
              title="Redo (Ctrl+Shift+Z)"
            >
              ↷
            </button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button
              onClick={onAutoAll}
              disabled={!hasImage}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px', gap: '5px', display: 'flex'}}
              title="Auto-adjust all modules based on image analysis"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.2 4.2l1.4 1.4M10.4 10.4l1.4 1.4M4.2 11.8l1.4-1.4M10.4 5.6l1.4-1.4" />
              </svg>
              Auto All
            </button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button
              onClick={onCopyStyle}
              disabled={!hasImage}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px', gap: '5px', display: 'flex'}}
              title="Analyse and copy the style of the current photo"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v6M5 8h6" />
              </svg>
              Copy Style
            </button>
            <button
              onClick={onPasteStyle}
              disabled={!hasImage || !hasStyleClipboard}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px', gap: '5px', display: 'flex'}}
              title={hasStyleClipboard ? 'Apply the copied style to the current photo' : 'Copy a style first'}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h5v5H4z" />
                <path d="M7 7h5v5H7z" />
              </svg>
              Paste Style
            </button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button
              onClick={onToggleOriginal}
              disabled={!hasImage}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px', gap: '5px', display: 'flex', backgroundColor: showOriginal ? 'var(--gray-700)' : 'transparent', color: showOriginal ? 'var(--white)' : undefined}}
              title="Toggle before/after comparison (B)"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
              Before / After
            </button>
            <button
              onClick={onToggleReference}
              disabled={!hasImage}
              className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
              style={{...btnStyle, width: 'auto', padding: '0 12px', gap: '5px', display: 'flex', backgroundColor: referenceMode ? 'var(--gray-700)' : 'transparent', color: referenceMode ? 'var(--white)' : undefined}}
              title="Compare with a reference photo"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="6" height="12" rx="1" />
                <rect x="9" y="2" width="6" height="12" rx="1" />
              </svg>
              Reference
            </button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button onClick={onZoomOut} className={btnClass} style={btnStyle} title="Zoom Out">−</button>
            <span className="text-center font-mono" style={{fontSize: '11px', minWidth: '50px', fontVariantNumeric: 'tabular-nums', color: 'var(--gray-400)'}}>
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={onZoomIn} className={btnClass} style={btnStyle} title="Zoom In">+</button>

            <div style={{width: '1px', height: '24px', margin: '0 6px', backgroundColor: 'var(--border)'}} />

            <button
              onClick={onFitWindow}
              className={btnClass}
              style={{...btnStyle, width: 'auto', padding: '0 12px'}}
              title="Fit to Window"
            >
              Fit
            </button>
            <button
              onClick={onActualSize}
              className={btnClass}
              style={{...btnStyle, width: 'auto', padding: '0 12px'}}
              title="Actual Size (100%)"
            >
              1:1
            </button>
          </>
        )}
      </div>

      {/* Right-side info removed: dimensions / MP / colour space were hardcoded
          placeholders, and the real values live in the footer status bar. */}
    </div>
  );
}
