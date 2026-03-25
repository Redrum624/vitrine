import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';

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
  onViewToggleGrid?: () => void;
  onViewToggleRulers?: () => void;
  onViewToggleOriginal?: () => void;
  onWindowPresets?: () => void;
  onWindowBatch?: () => void;
  onWindowPlugins?: () => void;
  onWindowHelp?: () => void;
  onWindowWelcome?: () => void;
  // Image menu
  onImageSize?: () => void;
  onCanvasSize?: () => void;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
  onFlipHorizontal?: () => void;
  onFlipVertical?: () => void;
  // Adjust menu
  onAutoLevels?: () => void;
  onAutoContrast?: () => void;
  onAutoColor?: () => void;
  onBrightnessContrast?: () => void;
  onLevels?: () => void;
  onCurves?: () => void;
  // Filter menu
  onSharpen?: () => void;
  onBlur?: () => void;
  onNoiseReduction?: () => void;
  onVignette?: () => void;
  onFilmGrain?: () => void;
  // State
  canUndo?: boolean;
  canRedo?: boolean;
  showGrid?: boolean;
  showRulers?: boolean;
  showOriginal?: boolean;
  hasImage?: boolean;
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
  onViewToggleGrid,
  onViewToggleRulers,
  onViewToggleOriginal,
  onWindowPresets,
  onWindowBatch,
  onWindowPlugins,
  onWindowHelp,
  onWindowWelcome,
  onImageSize,
  onCanvasSize,
  onRotateCW,
  onRotateCCW,
  onFlipHorizontal,
  onFlipVertical,
  onAutoLevels,
  onAutoContrast,
  onAutoColor,
  onBrightnessContrast,
  onLevels,
  onCurves,
  onSharpen,
  onBlur,
  onNoiseReduction,
  onVignette,
  onFilmGrain,
  canUndo = false,
  canRedo = false,
  showGrid = false,
  showRulers = false,
  showOriginal = false,
  hasImage = false,
}: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  // Check if window is maximized on mount and update state
  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI?.windowIsMaximized) {
        const maximized = await window.electronAPI.windowIsMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.windowMinimize?.();
  };

  const handleMaximize = async () => {
    await window.electronAPI?.windowMaximize?.();
    if (window.electronAPI?.windowIsMaximized) {
      const maximized = await window.electronAPI.windowIsMaximized();
      setIsMaximized(maximized);
    }
  };

  const handleClose = () => {
    window.electronAPI?.windowClose?.();
  };

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
    <div
      className="flex items-center h-9 border-b bg-black relative z-50"
      style={{
        paddingLeft: '20px',
        borderBottomColor: 'var(--border)',
        // @ts-expect-error - WebkitAppRegion is a non-standard CSS property for Electron
        WebkitAppRegion: 'drag'
      }}
    >
      {/* App Logo and Title */}
      <div className="flex items-center" style={{marginRight: '32px', gap: '10px'}}>
        <svg viewBox="0 0 256 256" width="20" height="20">
          <defs>
            <linearGradient id="menuBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{stopColor: '#1a1a1a'}}/>
              <stop offset="100%" style={{stopColor: '#0d0d0d'}}/>
            </linearGradient>
            <linearGradient id="menuBladeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{stopColor: '#b0b0b0'}}/>
              <stop offset="100%" style={{stopColor: '#505050'}}/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="256" height="256" rx="40" ry="40" fill="url(#menuBgGradient)"/>
          <circle cx="128" cy="128" r="93" fill="none" stroke="#454545" strokeWidth="5"/>
          <circle cx="128" cy="128" r="85" fill="#0a0a0a"/>
          <g fill="url(#menuBladeGradient)" stroke="#252525" strokeWidth="1">
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(45, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(90, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(135, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(180, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(225, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(270, 128, 128)"/>
            <path d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform="rotate(315, 128, 128)"/>
          </g>
          <circle cx="128" cy="128" r="25" fill="#0a0a0a"/>
        </svg>
        <span className="font-semibold text-white tracking-wide uppercase" style={{fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px'}}>Photo Editor Pro</span>
      </div>

      {/* Menu items container - not draggable */}
      <div
        className="flex items-center"
        style={{
          // @ts-expect-error - WebkitAppRegion is a non-standard CSS property for Electron
          WebkitAppRegion: 'no-drag'
        }}
      >
      {/* File Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'file' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'file' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('file')}
        >
          File
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
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
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'edit' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'edit' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('edit')}
        >
          Edit
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
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
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'image' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'image' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('image')}
        >
          Image
        </button>
        {activeMenu === 'image' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onImageSize)}
            >
              Image Size...
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onCanvasSize)}
            >
              Canvas Size...
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onRotateCW)}
            >
              Rotate 90° CW
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onRotateCCW)}
            >
              Rotate 90° CCW
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onFlipHorizontal)}
            >
              Flip Horizontal
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onFlipVertical)}
            >
              Flip Vertical
            </button>
          </div>
        )}
      </div>

      {/* Adjust Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'adjust' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'adjust' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('adjust')}
        >
          Adjust
        </button>
        {activeMenu === 'adjust' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onAutoLevels)}
            >
              Auto Levels
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onAutoContrast)}
            >
              Auto Contrast
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onAutoColor)}
            >
              Auto Color
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onBrightnessContrast)}
            >
              Brightness/Contrast...
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onLevels)}
            >
              Levels...
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onCurves)}
            >
              Curves...
            </button>
          </div>
        )}
      </div>

      {/* Filter Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'filter' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'filter' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('filter')}
        >
          Filter
        </button>
        {activeMenu === 'filter' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onSharpen)}
            >
              Sharpen...
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onBlur)}
            >
              Blur...
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onNoiseReduction)}
            >
              Noise Reduction...
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onVignette)}
            >
              Vignette...
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onFilmGrain)}
            >
              Film Grain...
            </button>
          </div>
        )}
      </div>

      {/* View Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'view' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'view' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('view')}
        >
          View
        </button>
        {activeMenu === 'view' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
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
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewToggleOriginal)}
            >
              {showOriginal ? '\u2713 ' : ''}Before / After <span className="float-right text-dark-400">B</span>
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewToggleGrid)}
            >
              {showGrid ? '\u2713 ' : ''}Show Grid
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onViewToggleRulers)}
            >
              {showRulers ? '\u2713 ' : ''}Show Rulers
            </button>
          </div>
        )}
      </div>

      {/* Window Menu */}
      <div className="relative">
        <button
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'window' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'window' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('window')}
        >
          Window
        </button>
        {activeMenu === 'window' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
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
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowWelcome)}
            >
              Welcome Screen...
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Spacer to push window controls to the right */}
      <div className="flex-1" />

      {/* Window Controls */}
      <div
        className="flex items-center h-full"
        style={{
          // @ts-expect-error - WebkitAppRegion is a non-standard CSS property for Electron
          WebkitAppRegion: 'no-drag'
        }}
      >
        <button
          className="flex items-center justify-center w-11 h-full bg-transparent border-0 cursor-pointer text-dark-300 hover:bg-dark-700 hover:text-white transition-colors"
          onClick={handleMinimize}
          title="Minimize"
        >
          <Minus size={16} />
        </button>
        <button
          className="flex items-center justify-center w-11 h-full bg-transparent border-0 cursor-pointer text-dark-300 hover:bg-dark-700 hover:text-white transition-colors"
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Copy size={14} className="rotate-180" /> : <Square size={14} />}
        </button>
        <button
          className="flex items-center justify-center w-11 h-full bg-transparent border-0 cursor-pointer text-dark-300 hover:bg-gray-800 hover:text-white transition-colors"
          onClick={handleClose}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
