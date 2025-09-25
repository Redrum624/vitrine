import React from 'react';
import { X, Keyboard, Search } from 'lucide-react';
import { KeyboardShortcut } from '../../services/KeyboardShortcutsService';

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: Record<string, KeyboardShortcut[]>;
}

const categoryNames: Record<string, string> = {
  file: 'File Operations',
  edit: 'Edit Operations',
  view: 'View Controls',
  tools: 'Tool Selection',
  processing: 'Processing & Effects'
};

const categoryIcons: Record<string, string> = {
  file: '📁',
  edit: '✏️',
  view: '👁️',
  tools: '🛠️',
  processing: '⚡'
};

export function ShortcutsHelpDialog({ isOpen, onClose, shortcuts }: ShortcutsHelpDialogProps) {
  const [searchTerm, setSearchTerm] = React.useState('');

  // Filter shortcuts based on search term
  const filteredShortcuts = React.useMemo(() => {
    if (!searchTerm) return shortcuts;

    const filtered: Record<string, KeyboardShortcut[]> = {};

    Object.entries(shortcuts).forEach(([category, categoryShortcuts]) => {
      const matchingShortcuts = categoryShortcuts.filter(shortcut =>
        shortcut.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        formatShortcut(shortcut).toLowerCase().includes(searchTerm.toLowerCase())
      );

      if (matchingShortcuts.length > 0) {
        filtered[category] = matchingShortcuts;
      }
    });

    return filtered;
  }, [shortcuts, searchTerm]);

  const formatShortcut = (shortcut: KeyboardShortcut): string => {
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.shiftKey) parts.push('Shift');
    if (shortcut.altKey) parts.push('Alt');
    parts.push(shortcut.key.toUpperCase());
    return parts.join(' + ');
  };

  const renderShortcutKey = (shortcut: KeyboardShortcut) => {
    const parts = [];
    if (shortcut.ctrlKey) parts.push('Ctrl');
    if (shortcut.shiftKey) parts.push('Shift');
    if (shortcut.altKey) parts.push('Alt');
    parts.push(shortcut.key.toUpperCase());

    return (
      <div className="flex items-center space-x-1">
        {parts.map((part, index) => (
          <React.Fragment key={part}>
            <kbd className="px-2 py-1 text-xs font-mono bg-dark-700 border border-dark-600 rounded text-dark-200">
              {part}
            </kbd>
            {index < parts.length - 1 && (
              <span className="text-dark-400 text-xs">+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg shadow-xl w-4/5 max-w-4xl h-4/5 max-h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-700">
          <div className="flex items-center space-x-3">
            <Keyboard className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-dark-200">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-dark-400 hover:text-dark-200 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-dark-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-dark-400" />
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-md text-dark-200 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-8">
            {Object.entries(filteredShortcuts).map(([category, categoryShortcuts]) => (
              <div key={category} className="space-y-4">
                {/* Category Header */}
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{categoryIcons[category]}</span>
                  <h3 className="text-lg font-semibold text-dark-200">
                    {categoryNames[category] || category}
                  </h3>
                  <div className="flex-1 h-px bg-dark-700" />
                  <span className="text-xs text-dark-400 bg-dark-700 px-2 py-1 rounded">
                    {categoryShortcuts.length} shortcut{categoryShortcuts.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Shortcuts List */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {categoryShortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between p-4 bg-dark-700 rounded-lg border border-dark-600 hover:border-dark-500 transition-colors"
                    >
                      <div className="flex-1">
                        <p className="text-dark-200 font-medium mb-1">
                          {shortcut.description}
                        </p>
                        <p className="text-xs text-dark-400">
                          ID: {shortcut.id}
                        </p>
                      </div>
                      <div className="ml-4">
                        {renderShortcutKey(shortcut)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {Object.keys(filteredShortcuts).length === 0 && (
              <div className="text-center text-dark-400 py-12">
                <Keyboard className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg mb-2">No shortcuts found</p>
                <p className="text-sm">Try adjusting your search terms</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-dark-700 bg-dark-750">
          <div className="flex items-center justify-between text-sm text-dark-400">
            <div className="flex items-center space-x-4">
              <span>💡 Tip: Press <kbd className="px-1 py-0.5 bg-dark-600 rounded text-xs">F1</kbd> or <kbd className="px-1 py-0.5 bg-dark-600 rounded text-xs">?</kbd> to toggle this dialog</span>
            </div>
            <div className="flex items-center space-x-2">
              <span>Total: {Object.values(shortcuts).reduce((sum, arr) => sum + arr.length, 0)} shortcuts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}