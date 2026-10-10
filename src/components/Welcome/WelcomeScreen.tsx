import { useState, useEffect } from 'react';
import { Image, Folder, BookOpen, ArrowRight, X } from 'lucide-react';
import { AccentButton } from '../Controls/AccentButton';
import { infoBoxStyle } from '../Dialogs/glassFormStyles';

interface WelcomeScreenProps {
  isVisible: boolean;
  onClose: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenPresets: () => void;
}

const quickActions = [
  {
    id: 'open-file',
    title: 'Open Image',
    description: 'Open a single image file for editing',
    icon: Image,
    shortcut: 'Ctrl+O'
  },
  {
    id: 'open-folder',
    title: 'Browse Folder',
    description: 'Browse and select from a folder of images',
    icon: Folder,
    shortcut: 'Ctrl+Shift+O'
  },
  {
    id: 'presets',
    title: 'Browse Presets',
    description: 'Explore built-in and custom presets',
    icon: BookOpen,
    shortcut: 'Ctrl+P'
  }
];

const tips = [
  'Use Ctrl+Z / Ctrl+Y for undo / redo',
  'Press F1 or Shift+? to view all keyboard shortcuts',
  'Press 1–5 to rate the current image, 0 to clear',
  'Use the histogram to check for clipping in highlights / shadows',
  'Batch-select photos in the filmstrip (Ctrl/Shift+click) to export several at once'
];

export function WelcomeScreen({
  isVisible,
  onClose,
  onOpenFile,
  onOpenFolder,
  onOpenPresets
}: WelcomeScreenProps) {
  const [currentTip, setCurrentTip] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setCurrentTip((prev) => (prev + 1) % tips.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isVisible]);

  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'open-file': onOpenFile(); break;
      case 'open-folder': onOpenFolder(); break;
      case 'presets': onOpenPresets(); break;
    }
    onClose();
  };

  const handleClose = () => {
    if (dontShowAgain) localStorage.setItem('photo-editor-welcome-dismissed', 'true');
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center vt-fade-in"
      style={{ background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div
        role="dialog"
        aria-label="Welcome to Vitrine"
        className="glass-chrome vt-pop-in flex flex-col w-full"
        style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'hidden', borderRadius: 12, transformOrigin: 'center' }}
      >
        {/* Header: mark, name, tagline */}
        <div className="flex items-start flex-shrink-0" style={{ padding: '22px 20px 18px 24px', gap: 14 }}>
          <svg viewBox="0 0 256 256" width="40" height="40" aria-hidden="true" style={{ flex: 'none' }}>
            <defs>
              <linearGradient id="welcomeBladeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#b0b0b0' }} />
                <stop offset="100%" style={{ stopColor: '#505050' }} />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="256" height="256" rx="48" ry="48" fill="#141416" />
            <circle cx="128" cy="128" r="93" fill="none" stroke="#454545" strokeWidth="5" />
            <circle cx="128" cy="128" r="85" fill="#0a0a0a" />
            <g fill="url(#welcomeBladeGradient)" stroke="#252525" strokeWidth="1">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                <path key={deg} d="M98,46 A85,85 0 0,1 158,46 L128,75 L98,105 Z" transform={`rotate(${deg}, 128, 128)`} />
              ))}
            </g>
            <circle cx="128" cy="128" r="25" fill="#0a0a0a" />
          </svg>
          <div className="flex-1 min-w-0" style={{ paddingTop: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--glass-text-title)', letterSpacing: '-0.01em' }}>Welcome to Vitrine</div>
            <div style={{ fontSize: 12.5, color: 'var(--glass-text-muted)', marginTop: 3 }}>The darkroom, behind glass. Everything stays on this computer.</div>
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={handleClose}
            className="glass-pill-btn inline-flex items-center justify-center flex-shrink-0"
            style={{ width: 28, height: 28, borderRadius: 5, border: 0, background: 'transparent', color: 'var(--glass-text-secondary)' }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: '0 16px 16px' }}>
          {/* Get started — a list of actions, like a native start page */}
          <h3 className="sr-only">Quick Start</h3>
          <div className="flex flex-col" style={{ gap: 2 }}>
            {quickActions.map((action, i) => (
              <button
                key={action.id}
                type="button"
                onClick={() => handleQuickAction(action.id)}
                className="glass-pill-btn dc-rise text-left"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px minmax(0, 1fr) auto auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 10px 10px 8px',
                  borderRadius: 7,
                  border: 0,
                  background: 'transparent',
                  animationDelay: `${80 + i * 50}ms`,
                }}
              >
                <span
                  className="inline-flex items-center justify-center"
                  style={{ width: 32, height: 32, borderRadius: 7, background: 'var(--vt-raised)', color: 'var(--glass-text-label)' }}
                >
                  <action.icon size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--glass-text-title)' }}>{action.title}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--glass-text-muted)', marginTop: 1 }}>{action.description}</span>
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--glass-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{action.shortcut}</span>
                <ArrowRight size={14} style={{ color: 'var(--glass-text-muted)' }} />
              </button>
            ))}
          </div>

          {/* Tip — rotates every few seconds with a cross-fade */}
          <div style={{ ...infoBoxStyle, marginTop: 14, padding: '12px 14px' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <h3 style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--glass-text-muted)' }}>Tip</h3>
              <div className="flex" style={{ gap: 4 }} aria-hidden="true">
                {tips.map((_, index) => (
                  <span
                    key={index}
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: index === currentTip ? 'var(--glass-text-label)' : 'var(--vt-line)',
                      width: index === currentTip ? 16 : 4,
                      transition: 'width 380ms var(--ease-spring), background-color 200ms ease',
                    }}
                  />
                ))}
              </div>
            </div>
            <p key={currentTip} className="vt-fade-in" style={{ fontSize: 12.5, lineHeight: 1.5, minHeight: '2.6em', color: 'var(--glass-text-label)', margin: 0 }}>
              {tips[currentTip]}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: '12px 16px', borderTop: '1px solid var(--vt-line)' }}
        >
          <label className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--glass-text-muted)' }}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>Don't show again</span>
          </label>
          <AccentButton onClick={handleClose}>Get Started</AccentButton>
        </div>
      </div>
    </div>
  );
}
