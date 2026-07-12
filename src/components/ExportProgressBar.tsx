import { X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Top-left overlay showing multi-export progress. Renders nothing unless an
 * export is in progress (driven by the `exportProgress` store slice). Glass ·
 * Sectioned chrome (small floating pill, not a modal) — progress track uses
 * the standard 5px inset-track spec from SliderRow/the splash screen.
 */
export function ExportProgressBar() {
  const progress = useAppStore((s) => s.exportProgress);
  const requestExportCancel = useAppStore((s) => s.requestExportCancel);

  if (!progress) return null;

  const { current, total, currentName, cancelRequested } = progress;
  const displayed = Math.min(current + 1, total);
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div
      className="glass-chrome dc-rise absolute top-4 left-4 z-50 w-72"
      style={{ borderRadius: 14, padding: '10px 12px' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--glass-text-title)' }}>
          Exporting {displayed} of {total}
        </span>
        <button
          type="button"
          onClick={() => requestExportCancel()}
          disabled={cancelRequested}
          className="glass-pill-btn inline-flex items-center gap-1"
          style={{
            fontSize: 11,
            color: 'var(--glass-text-secondary)',
            borderRadius: 7,
            padding: '2px 6px',
            opacity: cancelRequested ? 0.5 : 1,
            cursor: cancelRequested ? 'default' : 'pointer',
          }}
          title="Cancel export"
        >
          <X size={11} />
          {cancelRequested ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
      {currentName && (
        <div
          className="truncate mb-1.5"
          style={{ fontSize: 10.5, color: 'var(--glass-text-muted)' }}
          title={currentName}
        >
          {currentName}
        </div>
      )}
      <div style={{ position: 'relative', height: 5 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 3,
            background: 'rgba(255,255,255,.09)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,.6)',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 3,
            width: `${percent}%`,
            background: 'var(--accent)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}
