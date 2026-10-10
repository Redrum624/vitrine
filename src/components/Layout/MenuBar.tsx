import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Minus, Square, X, Copy, Info, Check } from 'lucide-react';
import { Segmented } from '../Controls/Segmented';
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

const WORKSPACE_OPTIONS: { value: 'gallery' | 'develop'; label: string }[] = [
  { value: 'gallery', label: 'Gallery' },
  { value: 'develop', label: 'Develop' },
];

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
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);

  // Close an open menu on an outside click or Escape (capture phase, so the
  // menu closes before other Escape handlers act).
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeMenu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as HTMLElement)) setActiveMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [activeMenu]);

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

  type MenuEntry =
    | { label: string; shortcut?: string; onSelect?: () => void; disabled?: boolean; checked?: boolean }
    | 'separator';

  const imageGated = !hasImage || developing;
  const menus: { id: string; label: string; ariaLabel?: string; items: MenuEntry[] }[] = [
    {
      id: 'file', label: 'File', items: [
        { label: 'Open...', shortcut: 'Ctrl+O', onSelect: onFileOpen },
        { label: 'Import...', shortcut: 'Ctrl+I', onSelect: onFileImport },
        'separator',
        { label: 'Export...', shortcut: 'Ctrl+E', onSelect: onFileExport },
      ],
    },
    {
      id: 'edit', label: 'Edit', items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: onEditUndo, disabled: !canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Y', onSelect: onEditRedo, disabled: !canRedo },
        'separator',
        { label: 'Reset All', shortcut: 'Ctrl+R', onSelect: onEditReset },
      ],
    },
    {
      id: 'image', label: 'Image', items: [
        { label: 'Image Size...', onSelect: onImageSize, disabled: imageGated },
        { label: 'Canvas Size...', onSelect: onCanvasSize, disabled: imageGated },
        'separator',
        { label: 'Rotate 90° CW', onSelect: onRotateCW, disabled: !hasImage },
        { label: 'Rotate 90° CCW', onSelect: onRotateCCW, disabled: !hasImage },
        { label: 'Flip Horizontal', onSelect: onFlipHorizontal, disabled: !hasImage },
        { label: 'Flip Vertical', onSelect: onFlipVertical, disabled: !hasImage },
      ],
    },
    {
      id: 'adjust', label: 'Adjust', items: [
        { label: 'Auto Contrast', onSelect: onAutoContrast, disabled: !hasImage },
        { label: 'Auto White Balance', onSelect: onAutoWhiteBalance, disabled: !hasImage },
        'separator',
        { label: 'Brightness/Contrast...', onSelect: onBrightnessContrast },
        { label: 'Levels...', onSelect: onLevels },
        { label: 'Curves...', onSelect: onCurves },
      ],
    },
    {
      id: 'view', label: 'View', items: [
        { label: 'Zoom In', shortcut: 'Ctrl++', onSelect: onViewZoomIn },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', onSelect: onViewZoomOut },
        { label: 'Fit to Window', shortcut: 'Ctrl+0', onSelect: onViewFitWindow },
        { label: 'Actual Size', shortcut: 'Ctrl+1', onSelect: onViewActualSize },
        'separator',
        { label: 'Before / After', shortcut: 'B', onSelect: onViewToggleOriginal, checked: showOriginal },
        'separator',
        { label: 'Show Grid', onSelect: onViewToggleGrid, checked: showGrid },
        { label: 'Show Rulers', onSelect: onViewToggleRulers, checked: showRulers },
      ],
    },
    {
      id: 'window', label: 'Window', items: [
        { label: 'Presets...', shortcut: 'P', onSelect: onWindowPresets },
        { label: 'Batch Processing...', shortcut: 'B', onSelect: onWindowBatch },
        'separator',
        { label: 'Keyboard Shortcuts', shortcut: 'F1', onSelect: onWindowHelp },
        'separator',
        { label: 'Welcome Screen...', onSelect: onWindowWelcome },
      ],
    },
    {
      id: 'help', label: '?', ariaLabel: 'Help', items: [
        { label: 'Keyboard Shortcuts', shortcut: 'F1', onSelect: onWindowHelp },
        { label: 'View on GitHub', onSelect: () => openExternal('https://github.com/Redrum624/vitrine') },
        'separator',
        { label: 'About Vitrine', onSelect: openAbout },
      ],
    },
  ];

  const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const workspaceIndex = viewMode === 'gallery' ? 0 : 1;

  return (
    <>
    <div
      ref={barRef}
      className="flex items-center relative z-50 no-select"
      style={{
        height: 40,
        flex: 'none',
        background: 'var(--vt-chrome)',
        borderBottom: '1px solid var(--vt-line-soft)',
        WebkitAppRegion: 'drag',
      } as CSSProperties}
    >
      {/* App mark */}
      <div className="flex items-center" style={{ padding: '0 8px 0 14px' }} aria-hidden="true">
        <svg viewBox="0 0 256 256" width="16" height="16">
          <defs>
            <linearGradient id="menuBladeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: '#b0b0b0' }} />
              <stop offset="100%" style={{ stopColor: '#505050' }} />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="256" height="256" rx="48" ry="48" fill="#202023" />
          <circle cx="128" cy="128" r="93" fill="none" stroke="#454545" strokeWidth="8" />
          <circle cx="128" cy="128" r="85" fill="#0a0a0a" />
          <g fill="url(#menuBladeGradient)" stroke="#252525" strokeWidth="1">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <path key={deg} d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform={`rotate(${deg}, 128, 128)`} />
            ))}
          </g>
          <circle cx="128" cy="128" r="25" fill="#0a0a0a" />
        </svg>
      </div>

      {/* Menus — not draggable. Once one is open, hovering another switches to it (Windows behaviour). */}
      <nav className="flex items-center h-full" aria-label="Application menu" style={noDrag}>
        {menus.map((menu) => {
          const open = activeMenu === menu.id;
          return (
            <div key={menu.id} className="relative flex items-center h-full">
              <button
                type="button"
                aria-label={menu.ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
                className="glass-pill-btn"
                onClick={() => handleMenuClick(menu.id)}
                onMouseEnter={() => { if (activeMenu && activeMenu !== menu.id) setActiveMenu(menu.id); }}
                style={{
                  height: 28,
                  padding: '0 9px',
                  borderRadius: 5,
                  border: 0,
                  fontSize: 12.5,
                  color: open ? 'var(--vt-text)' : 'var(--glass-text-label)',
                  background: open ? 'var(--vt-hover)' : 'transparent',
                }}
              >
                {menu.label}
              </button>
              {open && (
                <div
                  role="menu"
                  aria-label={menu.ariaLabel ?? menu.label}
                  className="glass-chrome vt-pop-in absolute"
                  style={{ top: 36, left: 0, minWidth: 236, padding: 5, borderRadius: 8, transformOrigin: 'top left', zIndex: 60 }}
                >
                  {menu.items.map((item, i) =>
                    item === 'separator' ? (
                      <div key={`sep-${i}`} role="separator" style={{ height: 1, margin: '5px 6px', background: 'var(--vt-line)' }} />
                    ) : (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        aria-disabled={item.disabled || undefined}
                        disabled={item.disabled}
                        className="glass-pill-btn"
                        onClick={() => { if (!item.disabled) handleMenuItemClick(item.onSelect); }}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '16px minmax(0, 1fr) auto',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          height: 28,
                          padding: '0 10px 0 6px',
                          borderRadius: 5,
                          border: 0,
                          background: 'transparent',
                          fontSize: 12.5,
                          textAlign: 'left',
                          color: 'var(--vt-text)',
                        }}
                      >
                        <span aria-hidden="true" style={{ display: 'flex', opacity: item.checked ? 1 : 0 }}>
                          <Check size={13} strokeWidth={2.2} />
                        </span>
                        <span>{item.label}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>{item.shortcut ?? ''}</span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Workspace switch — centred in the title bar, available from both views. */}
      <div style={{ position: 'absolute', left: '50%', top: 7, transform: 'translateX(-50%)', ...noDrag }}>
        <Segmented<'gallery' | 'develop'>
          options={WORKSPACE_OPTIONS}
          value={workspaceIndex === 0 ? 'gallery' : 'develop'}
          onChange={setViewMode}
          className="vt-workspace-switch"
        />
      </div>

      {/* Spacer to push window controls to the right */}
      <div className="flex-1" />

      {/* Window controls — Windows caption buttons: 46px wide, red close on hover. */}
      <div className="flex items-center h-full" style={noDrag}>
        <button type="button" className="vt-caption-btn" onClick={handleMinimize} title="Minimize" aria-label="Minimize">
          <Minus size={15} strokeWidth={1.5} />
        </button>
        <button type="button" className="vt-caption-btn" onClick={handleMaximize} title={isMaximized ? 'Restore' : 'Maximize'} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <Copy size={13} strokeWidth={1.5} className="rotate-180" /> : <Square size={12} strokeWidth={1.5} />}
        </button>
        <button type="button" className="vt-caption-btn is-close" onClick={handleClose} title="Close" aria-label="Close">
          <X size={16} strokeWidth={1.5} />
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
