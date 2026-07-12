import { useState, useEffect } from 'react';
import { Camera, Image, Folder, BookOpen, Zap, ArrowRight, X } from 'lucide-react';
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(5,5,8,.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        role="dialog"
        aria-label="Welcome to Vitrine"
        className="glass-card dc-rise flex flex-col max-w-2xl w-full"
        style={{ background: 'rgba(15,15,19,.92)', maxHeight: '90vh', overflow: 'hidden' }}
      >
        {/* Header */}
        <div
          className="flex items-center flex-shrink-0"
          style={{ padding: '13px 16px', gap: 11, background: 'rgba(0,0,0,.3)', borderBottom: '1px solid var(--glass-border)' }}
        >
          <div
            className="inline-flex items-center justify-center flex-shrink-0"
            style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', border: '1px solid var(--accent-ring)', color: 'var(--accent)' }}
          >
            <Camera size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>Welcome to Vitrine</div>
            <div style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>Develop. Display.</div>
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={handleClose}
            className="glass-pill-btn inline-flex items-center justify-center flex-shrink-0"
            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: 'var(--glass-text-secondary)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6" style={{ padding: '20px 24px' }}>
          {/* Quick Start */}
          <div>
            <h3 className="flex items-center gap-2 mb-3" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--accent)' }}>
              <Zap size={14} />
              Quick Start
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action.id)}
                  className="glass-modal-card-btn text-left"
                  style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                >
                  <action.icon size={22} style={{ marginBottom: 8, color: 'var(--glass-text-label)' }} />
                  <h4 className="flex items-center justify-between" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4, color: 'var(--glass-text-title)' }}>
                    {action.title}
                    <ArrowRight size={14} style={{ opacity: 0.5, color: 'var(--glass-text-muted)' }} />
                  </h4>
                  <p style={{ fontSize: 11, marginBottom: 8, color: 'var(--glass-text-muted)' }}>{action.description}</p>
                  <span
                    style={{
                      fontSize: 10.5, padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(0,0,0,.3)', border: '1px solid var(--glass-border)', color: 'var(--glass-text-label)',
                    }}
                  >
                    {action.shortcut}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div style={infoBoxStyle}>
            <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8, color: 'var(--glass-text-secondary)' }}>💡 Pro Tip</h3>
            <p style={{ fontSize: 12.5, lineHeight: 1.5, minHeight: '3rem', color: 'var(--glass-text-muted)' }}>{tips[currentTip]}</p>
            <div className="flex gap-1.5 mt-3">
              {tips.map((_, index) => (
                <div
                  key={index}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{ background: index === currentTip ? 'var(--accent)' : 'rgba(255,255,255,.14)', width: index === currentTip ? 24 : 8 }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: '14px 16px', borderTop: '1px solid var(--glass-border)' }}
        >
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 11.5, color: 'var(--glass-text-muted)' }}>
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
