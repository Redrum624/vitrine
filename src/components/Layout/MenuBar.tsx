import { useState } from 'react';

interface MenuBarProps {
  onFileOpen?: () => void;
  onFileImport?: () => void;
  onFileExport?: () => void;
  onEditUndo?: () => void;
  onEditRedo?: () => void;
  onEditReset?: () => void;
  onViewZoomIn?: () => void;
  onViewZoomOut?: () => void;
  onViewFitWindow?: () => void;
  onViewActualSize?: () => void;
  onWindowPresets?: () => void;
  onWindowBatch?: () => void;
  onWindowPlugins?: () => void;
  onWindowHelp?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function MenuBar({
  onFileOpen,
  onFileImport,
  onFileExport,
  onEditUndo,
  onEditRedo,
  onEditReset,
  onViewZoomIn,
  onViewZoomOut,
  onViewFitWindow,
  onViewActualSize,
  onWindowPresets,
  onWindowBatch,
  onWindowPlugins,
  onWindowHelp,
  canUndo = false,
  canRedo = false,
}: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const handleMenuClick = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleMenuItemClick = (action?: () => void) => {
    if (action) {
      action();
    }
    setActiveMenu(null);
  };

  return (
    <div className="flex items-center h-9 border-b border-dark-700 bg-black relative z-50" style={{paddingLeft: '20px', paddingRight: '20px'}}>
      <div className="font-semibold text-white tracking-wide uppercase" style={{fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px', marginRight: '32px'}}>Photo Editor Pro</div>

      {/* File Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('file')}
        >
          File
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onFileOpen)}
            >
              Open... <span className="float-right text-dark-400">Ctrl+O</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onFileImport)}
            >
              Import... <span className="float-right text-dark-400">Ctrl+I</span>
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onFileExport)}
            >
              Export... <span className="float-right text-dark-400">Ctrl+E</span>
            </button>
          </div>
        )}
      </div>

      {/* Edit Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('edit')}
        >
          Edit
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${
                canUndo ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'
              }`}
              onClick={() => canUndo && handleMenuItemClick(onEditUndo)}
              disabled={!canUndo}
            >
              Undo <span className="float-right text-dark-400">Ctrl+Z</span>
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${
                canRedo ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'
              }`}
              onClick={() => canRedo && handleMenuItemClick(onEditRedo)}
              disabled={!canRedo}
            >
              Redo <span className="float-right text-dark-400">Ctrl+Y</span>
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onEditReset)}
            >
              Reset All <span className="float-right text-dark-400">Ctrl+R</span>
            </button>
          </div>
        )}
      </div>

      {/* Image Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('image')}
        >
          Image
        </button>
        {activeMenu === 'image' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Image Size...
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Canvas Size...
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Rotate 90° CW
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Rotate 90° CCW
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Flip Horizontal
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Flip Vertical
            </button>
          </div>
        )}
      </div>

      {/* Adjust Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('adjust')}
        >
          Adjust
        </button>
        {activeMenu === 'adjust' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Auto Levels
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Auto Contrast
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Auto Color
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Brightness/Contrast...
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Levels...
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Curves...
            </button>
          </div>
        )}
      </div>

      {/* Filter Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('filter')}
        >
          Filter
        </button>
        {activeMenu === 'filter' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Sharpen
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Blur
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Noise Reduction
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Vignette
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Film Grain
            </button>
          </div>
        )}
      </div>

      {/* View Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('view')}
        >
          View
        </button>
        {activeMenu === 'view' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewZoomIn)}
            >
              Zoom In <span className="float-right text-dark-400">Ctrl++</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewZoomOut)}
            >
              Zoom Out <span className="float-right text-dark-400">Ctrl+-</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewFitWindow)}
            >
              Fit to Window <span className="float-right text-dark-400">Ctrl+0</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewActualSize)}
            >
              Actual Size <span className="float-right text-dark-400">Ctrl+1</span>
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Show Grid
            </button>
            <button className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer">
              Show Rulers
            </button>
          </div>
        )}
      </div>

      {/* Window Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer hover:bg-dark-850 transition-colors text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px'}}
          onClick={() => handleMenuClick('window')}
        >
          Window
        </button>
        {activeMenu === 'window' && (
          <div className="absolute top-full left-0 mt-0.5 bg-dark-800 border border-dark-700 rounded shadow-lg min-w-[180px] py-1 z-50">
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowPresets)}
            >
              Presets... <span className="float-right text-dark-400">P</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowBatch)}
            >
              Batch Processing... <span className="float-right text-dark-400">B</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowPlugins)}
            >
              Plugin Manager...
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowHelp)}
            >
              Keyboard Shortcuts <span className="float-right text-dark-400">F1</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
