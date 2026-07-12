import React from 'react';
import { Keyboard, Search } from 'lucide-react';
import { GlassModal } from './GlassModal';
import { SectionLabel } from '../Controls/SectionLabel';
import { inputStyle } from './glassFormStyles';
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

// Mono "kbd chip" idiom for a rendered key part (Ctrl / Shift / Alt / the
// key itself). Shared between the per-shortcut key combos and the footer tip.
const kbdChipStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10.5,
  padding: '3px 7px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,.1)',
  background: 'rgba(255,255,255,.04)',
  color: 'var(--glass-text-label)',
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
      <div className="flex items-center" style={{ gap: 4 }}>
        {parts.map((part, index) => (
          <React.Fragment key={part}>
            <kbd style={kbdChipStyle}>{part}</kbd>
            {index < parts.length - 1 && (
              <span style={{ fontSize: 10, color: 'var(--glass-text-muted)' }}>+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const totalShortcuts = Object.values(shortcuts).reduce((sum, arr) => sum + arr.length, 0);

  const footer = (
    <div className="flex items-center justify-between" style={{ fontSize: 11, color: 'var(--glass-text-muted)' }}>
      <span>
        Tip: Press <kbd style={kbdChipStyle}>F1</kbd> or <kbd style={kbdChipStyle}>?</kbd> to toggle this dialog
      </span>
      <span>Total: {totalShortcuts} shortcuts</span>
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      icon={<Keyboard size={15} />}
      title="Keyboard Shortcuts"
      cardClassName="w-4/5 max-w-4xl h-4/5"
      cardStyle={{ maxHeight: '90vh' }}
      scrollBody={false}
      footer={footer}
    >
      <div className="flex-shrink-0" style={{ padding: '14px 16px', borderBottom: '1px solid var(--glass-border)' }}>
        <div className="relative flex items-center">
          <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--glass-text-muted)' }} />
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 26 }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '18px 20px' }}>
        <div className="space-y-7">
          {Object.entries(filteredShortcuts).map(([category, categoryShortcuts]) => (
            <div key={category} className="space-y-3">
              {/* Category header */}
              <div className="flex items-center" style={{ gap: 10 }}>
                <span style={{ fontSize: 15 }}>{categoryIcons[category]}</span>
                <div className="flex-1 min-w-0">
                  <SectionLabel>{categoryNames[category] || category}</SectionLabel>
                </div>
                <span
                  style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: 'var(--glass-text-muted)',
                  }}
                >
                  {categoryShortcuts.length} shortcut{categoryShortcuts.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Shortcuts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {categoryShortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between"
                    style={{ padding: 10, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ fontSize: 12, fontWeight: 500, color: 'var(--glass-text-label)' }}>
                        {shortcut.description}
                      </p>
                      <p className="truncate" style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}>
                        ID: {shortcut.id}
                      </p>
                    </div>
                    <div style={{ marginLeft: 12, flexShrink: 0 }}>
                      {renderShortcutKey(shortcut)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(filteredShortcuts).length === 0 && (
            <div className="text-center" style={{ padding: '48px 0', color: 'var(--glass-text-muted)' }}>
              <Keyboard size={36} className="mx-auto mb-3 opacity-50" />
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--glass-text-label)' }}>No shortcuts found</p>
              <p style={{ fontSize: 11 }}>Try adjusting your search terms</p>
            </div>
          )}
        </div>
      </div>
    </GlassModal>
  );
}
