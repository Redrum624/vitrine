import { useState, useEffect } from 'react';
import { Camera, Image, Folder, BookOpen, Zap, ArrowRight, X } from 'lucide-react';

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
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
              <Camera className="w-5 h-5" style={{ color: 'var(--gray-300)' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Welcome to Photo Editor Pro</h2>
              <p className="text-xs" style={{ color: 'var(--gray-400)' }}>Professional photo editing made simple</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded transition-colors" style={{ color: 'var(--gray-400)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6">
          {/* Quick Start */}
          <div>
            <h3 className="flex items-center gap-2 mb-3 uppercase tracking-wider text-xs font-semibold" style={{ color: 'var(--gray-500)' }}>
              <Zap className="w-4 h-4" style={{ color: 'var(--gray-400)' }} />
              Quick Start
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action.id)}
                  className="p-4 rounded-xl transition-all duration-200 border text-left group"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                >
                  <action.icon className="w-7 h-7 mb-2" style={{ color: 'var(--gray-300)' }} />
                  <h4 className="text-sm font-semibold mb-1 flex items-center justify-between" style={{ color: 'var(--gray-200)' }}>
                    {action.title}
                    <ArrowRight className="w-4 h-4 opacity-50" style={{ color: 'var(--gray-400)' }} />
                  </h4>
                  <p className="text-xs mb-2" style={{ color: 'var(--gray-400)' }}>{action.description}</p>
                  <span className="text-xs px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}>{action.shortcut}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="p-4 rounded-xl border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--gray-300)' }}>💡 Pro Tip</h3>
            <p className="text-sm leading-relaxed min-h-[3rem]" style={{ color: 'var(--gray-400)' }}>{tips[currentTip]}</p>
            <div className="flex gap-1.5 mt-3">
              {tips.map((_, index) => (
                <div key={index} className="h-1 rounded-full transition-all duration-300"
                  style={{ backgroundColor: index === currentTip ? 'var(--gray-400)' : 'var(--gray-600)', width: index === currentTip ? '24px' : '8px' }} />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-between" style={{ borderTopColor: 'var(--border)' }}>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--gray-400)' }}>
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} className="rounded" />
            <span>Don't show again</span>
          </label>
          <button onClick={handleClose} className="px-3 py-1.5 text-xs rounded border transition-colors"
            style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
