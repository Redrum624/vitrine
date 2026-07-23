import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy, Info } from 'lucide-react';
import { GlassModal } from '../Dialogs/GlassModal';
import { useAppStore } from '../../stores/appStore';

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
  onAutoContrast?: () => void;
  onAutoWhiteBalance?: () => void;
  onBrightnessContrast?: () => void;
  onLevels?: () => void;
  onCurves?: () => void;
  // State
  canUndo?: boolean;
  canRedo?: boolean;
  showGrid?: boolean;
  showRulers?: boolean;
  showOriginal?: boolean;
  hasImage?: boolean;
}

interface AppInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  repository: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
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
  onWindowHelp,
  onWindowWelcome,
  onImageSize,
  onCanvasSize,
  onRotateCW,
  onRotateCCW,
  onFlipHorizontal,
  onFlipVertical,
  onAutoContrast,
  onAutoWhiteBalance,
  onBrightnessContrast,
  onLevels,
  onCurves,
  canUndo = false,
  canRedo = false,
  showGrid = false,
  showRulers = false,
  showOriginal = false,
  hasImage = false,
}: MenuBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  // Progressive RAW open: while the fast embedded-JPEG preview is on screen and the full
  // decode runs in the background, Image Size / Canvas Size can't seed correct preview
  // dims yet (see App.tsx's seed site) — disable those two entries for the window. Read
  // reactively (hook selector, not getState) so the menu re-renders as `developing` flips.
  const developing = useAppStore((s) => s.developing);

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

  const openAbout = async () => {
    setActiveMenu(null);
    setAboutOpen(true);
    if (!appInfo && window.electronAPI?.getAppInfo) {
      try {
        setAppInfo(await window.electronAPI.getAppInfo());
      } catch {
        // leave appInfo null; the dialog shows what it can
      }
    }
  };

  const openExternal = (url: string) => {
    window.electronAPI?.openExternalUrl?.(url);
  };

  return (
    <>
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
        <span className="font-semibold text-white tracking-wide uppercase" style={{fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px'}}>Vitrine</span>
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
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage && !developing ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && !developing && handleMenuItemClick(onImageSize)}
            >
              Image Size...
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage && !developing ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && !developing && handleMenuItemClick(onCanvasSize)}
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
              onClick={() => hasImage && handleMenuItemClick(onAutoContrast)}
            >
              Auto Contrast
            </button>
            <button
              className={`w-full text-left px-4 py-1.5 text-xs bg-transparent border-0 cursor-pointer ${hasImage ? 'text-dark-200 hover:bg-dark-700' : 'text-dark-500 cursor-not-allowed'}`}
              onClick={() => hasImage && handleMenuItemClick(onAutoWhiteBalance)}
            >
              Auto White Balance
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

      {/* Help Menu ("?") */}
      <div className="relative">
        <button
          aria-label="Help"
          className="bg-transparent border-0 cursor-pointer text-dark-200 hover:text-white"
          style={{padding: '8px 14px', fontSize: '12px', transition: 'var(--transition-fast)', backgroundColor: activeMenu === 'help' ? 'var(--gray-850)' : 'transparent'}}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-850)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = activeMenu === 'help' ? 'var(--gray-850)' : 'transparent'}
          onClick={() => handleMenuClick('help')}
        >
          ?
        </button>
        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 border min-w-[180px] py-1 z-50" style={{backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)', borderRadius: '0'}}>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => handleMenuItemClick(onWindowHelp)}
            >
              Keyboard Shortcuts <span className="float-right text-dark-400">F1</span>
            </button>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={() => openExternal('https://github.com/Redrum624/Vitrine')}
            >
              View on GitHub
            </button>
            <div className="h-px bg-dark-700 my-1"></div>
            <button
              className="w-full text-left px-4 py-1.5 text-xs text-dark-200 hover:bg-dark-700 bg-transparent border-0 cursor-pointer"
              onClick={openAbout}
            >
              About Vitrine
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

    {/* About dialog */}
    <GlassModal
      isOpen={aboutOpen}
      onClose={() => setAboutOpen(false)}
      closeOnOverlayClick
      icon={<Info size={15} />}
      title="About Vitrine"
      cardStyle={{ width: 460, maxWidth: '92vw' }}
    >
      <div style={{ padding: '18px 20px' }}>
        {/* Header: logo + name + version */}
        <div className="flex items-center" style={{ gap: 14, marginBottom: 16 }}>
          <svg viewBox="0 0 256 256" width="44" height="44">
            <defs>
              <linearGradient id="aboutBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#1a1a1a' }} />
                <stop offset="100%" style={{ stopColor: '#0d0d0d' }} />
              </linearGradient>
              <linearGradient id="aboutBladeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#b0b0b0' }} />
                <stop offset="100%" style={{ stopColor: '#505050' }} />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="256" height="256" rx="40" ry="40" fill="url(#aboutBgGradient)" />
            <circle cx="128" cy="128" r="93" fill="none" stroke="#454545" strokeWidth="5" />
            <circle cx="128" cy="128" r="85" fill="#0a0a0a" />
            <g fill="url(#aboutBladeGradient)" stroke="#252525" strokeWidth="1">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                <path key={deg} d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform={`rotate(${deg}, 128, 128)`} />
              ))}
            </g>
            <circle cx="128" cy="128" r="25" fill="#0a0a0a" />
          </svg>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--glass-text-title)', letterSpacing: '0.3px' }}>
              {appInfo?.name || 'Vitrine'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--glass-text-muted)', marginTop: 2 }}>
              Version {appInfo?.version || '…'}
            </div>
          </div>
        </div>

        {appInfo?.description && (
          <p style={{ fontSize: 12.5, color: 'var(--glass-text-label)', lineHeight: 1.5, margin: '0 0 16px' }}>
            {appInfo.description}
          </p>
        )}

        {/* Info grid */}
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 16px',
            fontSize: 12, borderTop: '1px solid var(--glass-border)', paddingTop: 14,
          }}
        >
          <span style={{ color: 'var(--glass-text-muted)' }}>License</span>
          <span style={{ color: 'var(--glass-text-label)' }}>{appInfo?.license || 'PolyForm Noncommercial 1.0.0'}</span>
          <span style={{ color: 'var(--glass-text-muted)' }}>Author</span>
          <span style={{ color: 'var(--glass-text-label)' }}>{appInfo?.author || 'Redrum624'}</span>
          <span style={{ color: 'var(--glass-text-muted)' }}>Engine</span>
          <span style={{ color: 'var(--glass-text-label)' }}>
            Electron {appInfo?.electron || '—'} · Chromium {appInfo?.chrome || '—'} · Node {appInfo?.node || '—'}
          </span>
          <span style={{ color: 'var(--glass-text-muted)' }}>Platform</span>
          <span style={{ color: 'var(--glass-text-label)' }}>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '—'}</span>
          {appInfo?.repository && (
            <>
              <span style={{ color: 'var(--glass-text-muted)' }}>Project</span>
              <button
                type="button"
                onClick={() => openExternal(appInfo.repository)}
                className="text-left bg-transparent border-0 cursor-pointer"
                style={{ color: 'var(--accent)', padding: 0, fontSize: 12, textDecoration: 'underline' }}
              >
                {appInfo.repository.replace(/^https?:\/\//, '')}
              </button>
            </>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--glass-text-muted)', marginTop: 16, lineHeight: 1.5 }}>
          Source-available, non-commercial. Bundled third-party components retain their own licenses.
        </div>
      </div>
    </GlassModal>
    </>
  );
}
