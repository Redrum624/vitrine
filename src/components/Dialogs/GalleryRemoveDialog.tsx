import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { GlassModal } from './GlassModal';

interface GalleryRemoveDialogProps {
  isOpen: boolean;
  /** How many photos the selection holds (drives the "Remove N photos?" title). */
  count: number;
  /** Esc / outside-click / Cancel — dismiss without touching anything. */
  onCancel: () => void;
  /** Default (focused) action: drop the selection from the open folder listing
   *  only. Non-destructive — files stay on disk, edits are kept. */
  onRemoveFromSession: () => void;
  /** Destructive path: move the selected files to the Windows Recycle Bin (via
   *  the trash IPC). Reversible from the Recycle Bin; never a permanent delete. */
  onMoveToTrash: () => void;
}

/**
 * Confirm dialog for the Gallery Del-remove flow (Task P11). Deliberately gives
 * NO direct-delete path: pressing Del always lands here first. The safe,
 * non-destructive "Remove from session" is the focused default; "Move to
 * Recycle Bin" is the explicit destructive opt-in and spells out that files go
 * to the Windows Recycle Bin (recoverable), never a permanent delete. Esc,
 * an outside click, and Cancel all dismiss.
 */
export function GalleryRemoveDialog({
  isOpen,
  count,
  onCancel,
  onRemoveFromSession,
  onMoveToTrash,
}: GalleryRemoveDialogProps) {
  const sessionBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the safe default ("Remove from session") on open so Enter confirms the
  // NON-destructive action, and so the destructive button is never the one a
  // reflexive keypress hits. GlassModal unmounts its subtree when closed, so this
  // re-runs on every open.
  useEffect(() => {
    if (isOpen) sessionBtnRef.current?.focus();
  }, [isOpen]);

  // GlassModal intentionally does not wire Escape (see its file note); wire it
  // here so Esc cancels, per the destructive-path safety contract.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onCancel]);

  const noun = count === 1 ? 'photo' : 'photos';

  const footer = (
    <div className="flex justify-end" style={{ gap: 8 }}>
      <button
        type="button"
        onClick={onCancel}
        className="glass-modal-btn-secondary"
        style={{
          padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
          border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: 'var(--glass-text-secondary)',
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onMoveToTrash}
        className="glass-modal-btn-secondary inline-flex items-center justify-center gap-2"
        style={{
          padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600,
          border: '1px solid rgba(239,68,68,.5)', background: 'transparent', color: '#f87171',
        }}
      >
        <Trash2 size={14} />
        Move to Recycle Bin
      </button>
      {/* Focused default — the safe, non-destructive action. Styled as the primary
          accent button (mirrors AccentButton) but hand-rolled so it can carry a ref
          for the autofocus above. */}
      <button
        ref={sessionBtnRef}
        type="button"
        onClick={onRemoveFromSession}
        className="glass-modal-btn-primary inline-flex items-center justify-center gap-2"
        style={{ padding: '9px 18px', borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        Remove from session
      </button>
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onCancel}
      closeOnOverlayClick
      title={`Remove ${count} ${noun}?`}
      subtitle={`${count} ${noun} selected`}
      icon={<Trash2 size={15} />}
      cardClassName="w-full"
      cardStyle={{ width: 420 }}
      footer={footer}
    >
      <div className="flex flex-col" style={{ gap: 12, padding: 16 }}>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--glass-text-secondary)' }}>
          <strong style={{ color: 'var(--glass-text-title)' }}>Remove from session</strong> keeps the
          files on disk — it only hides the selected {noun} from this folder listing. They reappear the
          next time you open the folder, and your saved edits are kept.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--glass-text-muted)' }}>
          <strong style={{ color: '#f87171' }}>Move to Recycle Bin</strong> sends the file{count === 1 ? '' : 's'} to
          the Windows Recycle Bin. You can restore {count === 1 ? 'it' : 'them'} from there — this app never
          deletes {count === 1 ? 'it' : 'them'} permanently.
        </p>
      </div>
    </GlassModal>
  );
}

export default GalleryRemoveDialog;
