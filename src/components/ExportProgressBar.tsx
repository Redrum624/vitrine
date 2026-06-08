import { X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Top-left overlay showing multi-export progress. Renders nothing unless an
 * export is in progress (driven by the `exportProgress` store slice).
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
      className="absolute top-4 left-4 z-50 w-72 bg-dark-850/90 backdrop-blur-sm rounded-professional px-3 py-2 shadow-professional"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-dark-200">
          Exporting {displayed} of {total}
        </span>
        <button
          onClick={() => requestExportCancel()}
          disabled={cancelRequested}
          className="flex items-center gap-1 text-xs text-dark-400 hover:text-dark-200 disabled:opacity-50 disabled:cursor-default"
          title="Cancel export"
        >
          <X className="w-3 h-3" />
          {cancelRequested ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
      {currentName && (
        <div className="text-[11px] text-dark-400 truncate mb-1" title={currentName}>
          {currentName}
        </div>
      )}
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: 'var(--gray-700)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, backgroundColor: 'var(--blue-500, #3b82f6)' }}
        />
      </div>
    </div>
  );
}
