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
  file: 'File',
  edit: 'Editing and rating',
  view: 'View',
  tools: 'Tools',
  processing: 'Processing and effects'
};

// Keycap: the one monospace idiom in the UI. A 2px bottom edge reads as a key, not a chip.
// Shared between the per-shortcut key combos and the footer tip.
const kbdChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 22,
  height: 20,
  padding: '0 6px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  lineHeight: 1,
  borderRadius: 'var(--radius-4)',
  border: '1px solid var(--vt-line)',
  borderBottomWidth: 2,
  background: 'var(--vt-field)',
  color: 'var(--vt-text-2)',
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
              <span style={{ fontSize: 10, color: 'var(--vt-text-3)' }}>+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const totalShortcuts = Object.values(shortcuts).reduce((sum, arr) => sum + arr.length, 0);

  const footer = (
    <div className="flex items-center justify-between" style={{ fontSize: 11.5, color: 'var(--vt-text-3)' }}>
      <span>
        Press <kbd style={kbdChipStyle}>F1</kbd> or <kbd style={kbdChipStyle}>?</kbd> to open or close this list
      </span>
      <span>{totalShortcuts} shortcuts</span>
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
            placeholder="Search shortcuts"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 26 }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '18px 20px' }}>
        <div className="space-y-6">
          {Object.entries(filteredShortcuts).map(([category, categoryShortcuts]) => (
            <section key={category} aria-label={categoryNames[category] || category}>
              <div className="flex items-center" style={{ gap: 10, marginBottom: 6 }}>
                <div className="flex-1 min-w-0">
                  <SectionLabel>{categoryNames[category] || category}</SectionLabel>
                </div>
                <span style={{ fontSize: 11, color: 'var(--vt-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {categoryShortcuts.length}
                </span>
              </div>

              {/* Rows on hairlines, two columns when there's room */}
              <div className="grid grid-cols-1 lg:grid-cols-2" style={{ columnGap: 32 }}>
                {categoryShortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between"
                    style={{ minHeight: 36, gap: 12, borderBottom: '1px solid var(--vt-line-soft)' }}
                  >
                    <span className="truncate" style={{ fontSize: 12.5, color: 'var(--vt-text)' }}>
                      {shortcut.description}
                    </span>
                    <div style={{ flexShrink: 0 }}>
                      {renderShortcutKey(shortcut)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
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
