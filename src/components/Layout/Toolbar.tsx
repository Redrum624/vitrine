import { electronService } from '../../services/ElectronService';

interface ToolbarProps {
  onExport?: () => void;
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
}

export function Toolbar({ onExport, onBatchProcess: _onBatchProcess, onOpenPresets: _onOpenPresets, onOpenPlugins: _onOpenPlugins, onShowHelp: _onShowHelp, onUndo, onRedo, canUndo = false, canRedo = false, onZoomIn, onZoomOut, onFitWindow, onActualSize, zoom = 1 }: ToolbarProps) {
  const btnClass = "bg-transparent border border-dark-700 text-dark-300 flex items-center justify-center cursor-pointer transition-all hover:bg-dark-800 hover:border-dark-600 hover:text-dark-100";
  const btnStyle = {width: '32px', height: '32px', fontSize: '13px', borderRadius: '3px'};
  const btnActiveClass = "bg-dark-700 border-dark-600 text-white";

  return (
    <div className="flex items-center justify-between bg-dark-900 border-b border-dark-700 no-select" style={{padding: '10px 20px'}}>
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

            <div className="bg-dark-700" style={{width: '1px', height: '24px', margin: '0 6px'}} />

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

            <div className="bg-dark-700" style={{width: '1px', height: '24px', margin: '0 6px'}} />

            <button className={`${btnClass} ${btnActiveClass}`} style={btnStyle} title="Select">⊙</button>
            <button className={btnClass} style={btnStyle} title="Crop">✂</button>
            <button className={btnClass} style={btnStyle} title="Adjust">⊕</button>
          </>
        )}
      </div>

      {/* Center - Zoom controls */}
      <div className="flex items-center" style={{gap: '6px'}}>
        <button onClick={onZoomOut} className={btnClass} style={btnStyle} title="Zoom Out">−</button>
        <span className="text-center font-mono text-dark-400" style={{fontSize: '11px', minWidth: '50px', fontVariantNumeric: 'tabular-nums'}}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={onZoomIn} className={btnClass} style={btnStyle} title="Zoom In">+</button>

        <div className="bg-dark-700" style={{width: '1px', height: '24px', margin: '0 6px'}} />

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
      </div>

      {/* Right side - Info */}
      <div className="flex items-center text-dark-400" style={{gap: '16px', fontSize: '11px'}}>
        <span>6000 × 4000</span>
        <div className="bg-dark-700" style={{width: '1px', height: '16px'}} />
        <span>24.0 MP</span>
        <div className="bg-dark-700" style={{width: '1px', height: '16px'}} />
        <span>sRGB</span>
      </div>
    </div>
  );
}
