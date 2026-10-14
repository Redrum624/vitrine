import { useEffect, useRef } from 'react';
import { FileWarning } from 'lucide-react';
import { GlassModal } from './GlassModal';

export type OverwriteChoice = 'replace' | 'keepBoth' | 'cancel';

interface OverwriteConfirmDialogProps {
  isOpen: boolean;
  /** Existing file name for a single export (shown in the body). */
  fileName?: string;
  /** Batch export: how many targets already exist, out of `total`. */
  existingCount?: number;
  total?: number;
  onChoose: (choice: OverwriteChoice) => void;
}

/**
 * Confirm dialog shown before an export would write over an existing file
 * (v1.40.0). Same pattern as GalleryRemoveDialog: Keep both (the safe,
 * non-destructive default) is focused on open, Esc and Cancel dismiss without
 * writing, Replace is the explicit destructive opt-in. GlassModal supplies
 * aria-modal, so global app shortcuts stay blocked underneath.
 */
export function OverwriteConfirmDialog({ isOpen, fileName, existingCount, total, onChoose }: OverwriteConfirmDialogProps) {
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const replaceBtnRef = useRef<HTMLButtonElement>(null);
  const batch = existingCount !== undefined && total !== undefined && total > 1;

  useEffect(() => {
    if (isOpen) keepBtnRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onChoose('cancel');
        return;
      }
      // Focus containment: Tab cycles Cancel -> Replace -> Keep both and never escapes
      // to the Export dialog behind the prompt.
      if (e.key === 'Tab') {
        const order = [cancelBtnRef.current, replaceBtnRef.current, keepBtnRef.current].filter(Boolean) as HTMLButtonElement[];
        if (order.length === 0) return;
        e.preventDefault();
        const i = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (i <= 0 ? order.length - 1 : i - 1) : (i + 1) % order.length;
        order[next].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onChoose]);

  const title = batch ? 'Some files already exist' : 'File already exists';
  const subtitle = batch ? `${existingCount} of ${total} files already exist` : fileName;

  const footer = (
    <div className="flex justify-end" style={{ gap: 8 }}>
      <button ref={cancelBtnRef} type="button" onClick={() => onChoose('cancel')} className="glass-modal-btn-secondary">
        Cancel
      </button>
      <button
        ref={replaceBtnRef}
        type="button"
        onClick={() => onChoose('replace')}
        className="glass-modal-btn-secondary inline-flex items-center justify-center gap-2"
        data-danger=""
      >
        Replace
      </button>
      <button
        ref={keepBtnRef}
        type="button"
        onClick={() => onChoose('keepBoth')}
        className="glass-modal-btn-primary inline-flex items-center justify-center gap-2"
        style={{ height: 30, padding: '0 16px', borderRadius: 'var(--radius-6)', fontSize: 12.5, fontWeight: 600 }}
      >
        Keep both
      </button>
    </div>
  );

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={() => onChoose('cancel')}
      closeOnOverlayClick
      title={title}
      subtitle={subtitle}
      icon={<FileWarning size={15} />}
      cardClassName="w-full"
      cardStyle={{ width: 420 }}
      footer={footer}
    >
      <div className="flex flex-col" style={{ gap: 12, padding: 16 }}>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--glass-text-secondary)' }}>
          {batch ? (
            <>
              <strong style={{ color: 'var(--glass-text-title)' }}>{existingCount} of {total}</strong> files
              already exist in the export folder. Your choice applies to all of them.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--glass-text-title)' }}>{fileName}</strong> already exists in the
              export folder.
            </>
          )}
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--glass-text-muted)' }}>
          <strong style={{ color: 'var(--glass-text-title)' }}>Keep both</strong> saves with the next free
          number (_VIT_1, _VIT_2, …). <strong style={{ color: '#f87171' }}>Replace</strong> overwrites the
          existing {batch ? 'files' : 'file'}.
        </p>
      </div>
    </GlassModal>
  );
}

export default OverwriteConfirmDialog;
