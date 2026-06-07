import { useState, useEffect } from 'react';
import { RotateCcw, Trash2, Clock } from 'lucide-react';
import { checkpointService } from '../../services/CheckpointService';
import { useAppStore } from '../../stores/appStore';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * History module: the per-image checkpoint timeline. Every committed edit is recorded
 * automatically; click any checkpoint to restore that state (the full list is kept).
 * Persisted per image and across sessions.
 */
export function HistoryPanel() {
  const [, force] = useState(0);
  useEffect(() => checkpointService.subscribe(() => force((n) => n + 1)), []);

  const checkpoints = checkpointService.getCheckpoints();
  const activeId = checkpointService.getActiveId();
  const now = Date.now();

  const restore = (id: number) => {
    if (checkpointService.restore(id)) {
      imageProcessingPipeline.invalidateModuleCache('localadjustments');
      useAppStore.getState().notifyExternalParamsChange(); // re-key panels to the restored params
      useAppStore.getState().triggerReprocessing();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3" style={{ color: 'var(--gray-500)' }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--gray-500)', letterSpacing: '0.5px' }}>History</span>
        </div>
        {checkpoints.length > 0 && (
          <button
            onClick={() => checkpointService.clear()}
            className="p-1.5 rounded border"
            style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--gray-400)' }}
            title="Clear history for this image"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {checkpoints.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--gray-500)' }}>
          No checkpoints yet. Every edit is recorded here automatically — once you adjust something, click a
          checkpoint to jump back to it. History is saved per image and kept between sessions.
        </p>
      ) : (
        <div className="space-y-1">
          {checkpoints.slice().reverse().map((cp) => {
            const isActive = cp.id === activeId;
            return (
              <button
                key={cp.id}
                onClick={() => restore(cp.id)}
                className="w-full flex items-center justify-between px-3 py-2 rounded border text-left"
                style={{
                  backgroundColor: isActive ? 'var(--gray-700)' : 'transparent',
                  borderColor: isActive ? 'var(--primary-500)' : 'var(--border)',
                }}
                title={isActive ? 'Current state' : 'Restore this checkpoint'}
              >
                <div className="flex flex-col">
                  <span className="text-xs" style={{ color: 'var(--gray-200)' }}>{cp.label}</span>
                  <span className="font-mono" style={{ color: 'var(--gray-500)', fontSize: '10px' }}>{timeAgo(cp.at, now)}</span>
                </div>
                {isActive
                  ? <span className="text-xs" style={{ color: 'var(--primary-400)' }}>current</span>
                  : <RotateCcw className="w-3 h-3" style={{ color: 'var(--gray-500)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
