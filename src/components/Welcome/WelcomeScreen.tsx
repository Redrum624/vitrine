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
    shortcut: 'Ctrl+O',
    color: 'bg-blue-600 hover:bg-blue-700'
  },
  {
    id: 'open-folder',
    title: 'Browse Folder',
    description: 'Browse and select from a folder of images',
    icon: Folder,
    shortcut: 'Ctrl+Shift+O',
    color: 'bg-green-600 hover:bg-green-700'
  },
  {
    id: 'presets',
    title: 'Browse Presets',
    description: 'Explore built-in and custom presets',
    icon: BookOpen,
    shortcut: 'Ctrl+P',
    color: 'bg-purple-600 hover:bg-purple-700'
  },
  {
    id: 'plugins',
    title: 'Manage Plugins',
    description: 'Install and manage photo editing plugins',
    icon: Package,
    shortcut: 'Ctrl+Shift+M',
    color: 'bg-orange-600 hover:bg-orange-700'
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

  // Rotate tips every 4 seconds
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
    // Would integrate with file opening logic
    onClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-gradient-to-br from-dark-800 to-dark-900 rounded-2xl shadow-2xl max-w-6xl w-11/12 max-h-[90vh] overflow-hidden border border-dark-600">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 p-8 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-4">
            <div className="bg-white/20 p-4 rounded-2xl">
              <Camera className="w-12 h-12" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">Welcome to Photo Editor Pro</h1>
              <p className="text-xl opacity-90">Professional photo editing made simple</p>
            </div>
          </div>

          <div className="mt-6 flex items-center space-x-6 text-sm opacity-75">
            <div className="flex items-center space-x-2">
              <Star className="w-4 h-4" />
              <span>8 Processing Modules</span>
            </div>
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4" />
              <span>Real-time Processing</span>
            </div>
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4" />
              <span>Plugin System</span>
            </div>
          </div>
        </div>

        <div className="p-8 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Quick Actions */}
            <div className="lg:col-span-2 space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-dark-200 mb-4 flex items-center">
                  <Zap className="w-6 h-6 mr-2 text-blue-400" />
                  Quick Start
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickActions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action.id)}
                      className={`${action.color} text-white p-6 rounded-xl transition-all duration-200 transform hover:scale-105 hover:shadow-lg group`}
                    >
                      <div className="flex items-start space-x-4">
                        <action.icon className="w-8 h-8 flex-shrink-0 group-hover:scale-110 transition-transform" />
                        <div className="text-left flex-1">
                          <h3 className="text-lg font-semibold mb-1">{action.title}</h3>
                          <p className="text-sm opacity-90 mb-2">{action.description}</p>
                          <span className="text-xs bg-white/20 px-2 py-1 rounded">{action.shortcut}</span>
                        </div>
                        <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Files */}
              <div>
                <h2 className="text-xl font-semibold text-dark-200 mb-4">Recent Files</h2>
                <div className="space-y-2">
                  {recentFiles.map((file, index) => (
                    <button
                      key={index}
                      onClick={() => handleRecentFile(file.path)}
                      className="w-full flex items-center space-x-4 p-4 bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors group"
                    >
                      <Image className="w-8 h-8 text-dark-400 group-hover:text-blue-400 transition-colors" />
                      <div className="flex-1 text-left">
                        <p className="text-dark-200 font-medium group-hover:text-blue-400 transition-colors">
                          {file.name}
                        </p>
                        <p className="text-xs text-dark-400">{file.path}</p>
                      </div>
                      <span className="text-xs text-dark-500">{file.lastOpened}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Export Presets */}
              <div>
                <h3 className="text-lg font-semibold text-dark-200 mb-3">Popular Export Presets</h3>
                <div className="space-y-2">
                  {exportPresets.map((preset, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 bg-dark-750 rounded-lg">
                      <preset.icon className="w-5 h-5 text-dark-400" />
                      <div>
                        <p className="text-sm font-medium text-dark-200">{preset.name}</p>
                        <p className="text-xs text-dark-400">{preset.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tips */}
              <div className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 p-6 rounded-xl border border-blue-800/30">
                <h3 className="text-lg font-semibold text-blue-200 mb-3">💡 Pro Tip</h3>
                <p className="text-sm text-blue-100 leading-relaxed">{tips[currentTip]}</p>
                <div className="flex space-x-1 mt-4">
                  {tips.map((_, index) => (
                    <div
                      key={index}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        index === currentTip ? 'bg-blue-400 w-6' : 'bg-blue-800 w-1'
                      }`}
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
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white p-4 rounded-xl transition-all duration-200 transform hover:scale-105"
                >
                  <div className="flex items-center justify-center space-x-2">
                    <Star className="w-5 h-5" />
                    <span className="font-medium">Get Started</span>
                  </div>
                  <p className="text-sm opacity-90 mt-1">Ready to start editing!</p>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-dark-700 p-6 bg-dark-750">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 text-sm text-dark-400">
              <span>Version 1.0.0</span>
              <span>•</span>
              <span>Professional Photo Editor</span>
            </div>
            <div className="flex items-center space-x-3">
              <label className="flex items-center space-x-2 text-sm text-dark-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDontShowAgain}
                  onChange={(e) => setShowDontShowAgain(e.target.checked)}
                  className="rounded"
                />
                <span>Don't show this again</span>
              </label>
              {showDontShowAgain && (
                <button
                  onClick={handleDontShowAgain}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
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