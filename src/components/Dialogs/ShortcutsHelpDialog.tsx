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
            <kbd className="px-2 py-1 text-xs font-mono rounded border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}>
              {part}
            </kbd>
            {index < parts.length - 1 && (
              <span className="text-xs" style={{ color: 'var(--gray-400)' }}>+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="rounded-lg shadow-xl w-4/5 max-w-4xl h-4/5 max-h-screen flex flex-col" style={{ backgroundColor: 'var(--gray-900)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="flex items-center space-x-3">
            <Keyboard className="w-5 h-5" style={{ color: 'var(--gray-300)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--white)' }}>Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--gray-400)' }}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-4 border-b" style={{ borderBottomColor: 'var(--border)' }}>
          <div className="relative flex items-center">
            <Search className="absolute left-2 w-4 h-4" style={{ color: 'var(--gray-500)' }} />
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-sm rounded border focus:outline-none"
              style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-200)' }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-8">
            {Object.entries(filteredShortcuts).map(([category, categoryShortcuts]) => (
              <div key={category} className="space-y-4">
                {/* Category Header */}
                <div className="flex items-center space-x-3">
                  <span className="text-xl">{categoryIcons[category]}</span>
                  <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--gray-500)' }}>
                    {categoryNames[category] || category}
                  </h3>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
                  <span className="text-xs px-2 py-1 rounded border" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-400)' }}>
                    {categoryShortcuts.length} shortcut{categoryShortcuts.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Shortcuts List */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {categoryShortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                      style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium mb-1" style={{ color: 'var(--gray-200)' }}>
                          {shortcut.description}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--gray-400)' }}>
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
              <div className="text-center py-12" style={{ color: 'var(--gray-500)' }}>
                <Keyboard className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--gray-300)' }}>No shortcuts found</p>
                <p className="text-xs" style={{ color: 'var(--gray-400)' }}>Try adjusting your search terms</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t" style={{ borderTopColor: 'var(--border)', backgroundColor: 'var(--gray-900)' }}>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--gray-400)' }}>
            <div className="flex items-center space-x-4">
              <span>💡 Tip: Press <kbd className="px-1 py-0.5 rounded border mx-1" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}>F1</kbd> or <kbd className="px-1 py-0.5 rounded border mx-1" style={{ backgroundColor: 'var(--gray-800)', borderColor: 'var(--border)', color: 'var(--gray-300)' }}>?</kbd> to toggle this dialog</span>
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