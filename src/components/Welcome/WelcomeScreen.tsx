import { useState, useEffect } from 'react';
import {
  Camera,
  Image,
  Folder,
  BookOpen,
  Package,
  Star,
  Zap,
  ArrowRight,
  X,
  Monitor,
  Smartphone,
  Printer,
  Globe
} from 'lucide-react';
import { logger } from '../../utils/Logger';

interface WelcomeScreenProps {
  isVisible: boolean;
  onClose: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenPresets: () => void;
  onOpenPlugins: () => void;
  onShowTour: () => void;
}

const recentFiles = [
  { name: 'Mountain_Sunset.raw', path: '/photos/landscapes/mountain_sunset.raw', lastOpened: '2 hours ago' },
  { name: 'Portrait_Edit.jpg', path: '/photos/portraits/portrait_edit.jpg', lastOpened: '1 day ago' },
  { name: 'Street_Photography.dng', path: '/photos/street/street_photo.dng', lastOpened: '3 days ago' },
  { name: 'Wedding_Shot.cr3', path: '/photos/wedding/ceremony.cr3', lastOpened: '1 week ago' }
];

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
  },
  {
    id: 'plugins',
    title: 'Manage Plugins',
    description: 'Install and manage photo editing plugins',
    icon: Package,
    shortcut: 'Ctrl+Shift+M'
  }
];

const exportPresets = [
  { name: 'Web (sRGB, 1920px)', icon: Globe, description: 'Optimized for web display' },
  { name: 'Social Media (Square)', icon: Smartphone, description: 'Perfect for Instagram & social' },
  { name: 'Print (Adobe RGB)', icon: Printer, description: 'High quality for printing' },
  { name: 'Desktop Wallpaper', icon: Monitor, description: 'Full resolution desktop background' }
];

const tips = [
  'Use Ctrl+Z/Ctrl+Y for unlimited undo/redo operations',
  'Press F1 or Shift+? to view all keyboard shortcuts',
  'Right-click on any slider for quick reset options',
  'Use the histogram to check for clipping in highlights/shadows',
  'Local adjustments support pressure-sensitive drawing tablets',
  'Batch processing can apply current settings to multiple images'
];

export function WelcomeScreen({
  isVisible,
  onClose,
  onOpenFile,
  onOpenFolder,
  onOpenPresets,
  onOpenPlugins,
  onShowTour
}: WelcomeScreenProps) {
  const [currentTip, setCurrentTip] = useState(0);
  const [showDontShowAgain, setShowDontShowAgain] = useState(false);

  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(() => {
      setCurrentTip((prev) => (prev + 1) % tips.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [isVisible]);

  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'open-file':
        onOpenFile();
        break;
      case 'open-folder':
        onOpenFolder();
        break;
      case 'presets':
        onOpenPresets();
        break;
      case 'plugins':
        onOpenPlugins();
        break;
    }
    onClose();
  };

  const handleDontShowAgain = () => {
    localStorage.setItem('photo-editor-welcome-dismissed', 'true');
    setShowDontShowAgain(false);
    onClose();
  };

  const handleRecentFile = (filePath: string) => {
    logger.info(`Opening recent file: ${filePath}`);
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
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
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--gray-400)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-6 px-5 py-2.5 border-b text-xs" style={{ borderBottomColor: 'var(--border)', color: 'var(--gray-500)' }}>
          <div className="flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" />
            <span>8 Processing Modules</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            <span>Real-time Processing</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" />
            <span>Plugin System</span>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Quick Actions */}
            <div className="lg:col-span-2 space-y-8">
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center uppercase tracking-wider text-sm" style={{ color: 'var(--gray-500)' }}>
                  <Zap className="w-5 h-5 mr-2" style={{ color: 'var(--gray-400)' }} />
                  Quick Start
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickActions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action.id)}
                      className="p-6 rounded-xl transition-all duration-200 border text-left group"
                      style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-start space-x-4">
                        <action.icon className="w-8 h-8 flex-shrink-0 transition-transform" style={{ color: 'var(--gray-300)' }} />
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--gray-200)' }}>{action.title}</h3>
                          <p className="text-xs mb-3" style={{ color: 'var(--gray-400)' }}>{action.description}</p>
                          <span className="text-xs px-2 py-1 rounded border" style={{ backgroundColor: 'var(--gray-900)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}>{action.shortcut}</span>
                        </div>
                        <ArrowRight className="w-5 h-5 opacity-50 transition-all" style={{ color: 'var(--gray-400)' }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Files */}
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--gray-500)' }}>Recent Files</h2>
                <div className="space-y-3">
                  {recentFiles.map((file, index) => (
                    <button
                      key={index}
                      onClick={() => handleRecentFile(file.path)}
                      className="w-full flex items-center space-x-4 p-4 rounded-lg transition-colors border group"
                      style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                    >
                      <Image className="w-6 h-6" style={{ color: 'var(--gray-400)' }} />
                      <div className="flex-1 text-left">
                        <p className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>
                          {file.name}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{file.path}</p>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--gray-500)' }}>{file.lastOpened}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-8">
              {/* Export Presets */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--gray-500)' }}>Popular Export Presets</h3>
                <div className="space-y-3">
                  {exportPresets.map((preset, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 rounded-lg border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
                      <preset.icon className="w-5 h-5" style={{ color: 'var(--gray-400)' }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>{preset.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--gray-400)' }}>{preset.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tips */}
              <div className="p-5 rounded-xl border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}>
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--gray-300)' }}>💡 Pro Tip</h3>
                <p className="text-sm leading-relaxed min-h-[4rem]" style={{ color: 'var(--gray-400)' }}>{tips[currentTip]}</p>
                <div className="flex space-x-1.5 mt-4">
                  {tips.map((_, index) => (
                    <div
                      key={index}
                      className="h-1 rounded-full transition-all duration-300"
                      style={{
                        backgroundColor: index === currentTip ? 'var(--gray-400)' : 'var(--gray-600)',
                        width: index === currentTip ? '24px' : '8px'
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Getting Started */}
              <div>
                <button
                  onClick={() => {
                    onShowTour();
                    onClose();
                  }}
                  className="w-full p-4 rounded-xl transition-all duration-200 border"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-center space-x-2">
                    <Star className="w-5 h-5" style={{ color: 'var(--gray-300)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--gray-200)' }}>Get Started</span>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--gray-400)' }}>Ready to start editing!</p>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderTopColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--gray-500)' }}>
              <span>Version 1.0.0</span>
              <span>•</span>
              <span>Professional Photo Editor</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--gray-400)' }}>
                <input
                  type="checkbox"
                  checked={showDontShowAgain}
                  onChange={(e) => setShowDontShowAgain(e.target.checked)}
                  className="rounded"
                />
                <span>Don't show again</span>
              </label>
              {showDontShowAgain && (
                <button
                  onClick={handleDontShowAgain}
                  className="px-3 py-1.5 text-xs rounded border transition-colors"
                  style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}
                >
                  Save Preference
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}