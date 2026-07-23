import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { checkpointService } from '../../services/CheckpointService';
import { useAppStore } from '../../stores/appStore';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Absolute HH:MM (24h, local time) for the row's inline clock-time column. */
function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface HistoryPanelProps {
  /** Surfaces "Clear" as the unified card header's Reset ↺ (Task 4 — History had
   * no chrome of its own pre-Task-2, so it wasn't wired in that pass). */
  onRegisterActions?: RegisterModuleCardActions;
}

/**
 * History module: the per-image checkpoint timeline. Every committed edit is recorded
 * automatically; click any checkpoint to restore that state (the full list is kept).
 * Persisted per image and across sessions.
 */
export function HistoryPanel({ onRegisterActions }: HistoryPanelProps = {}) {
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

  // Reset ↺ = Clear history (registered unconditionally — presence of the Reset
  // chip is fixed per moduleCardActions' contract; clearing an already-empty
  // list is a harmless no-op, same as clicking Reset on an unedited module).
  const clear = useCallback(() => checkpointService.clear(), []);
  useRegisterModuleCardActions(onRegisterActions, { reset: clear });

  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {checkpoints.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--glass-text-muted)' }}>
          No checkpoints yet. Every edit is recorded here automatically — once you adjust something, click a
          checkpoint to jump back to it. History is saved per image and kept between sessions.
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {checkpoints.slice().reverse().map((cp) => {
            const isActive = cp.id === activeId;
            return (
              <button
                key={cp.id}
                onClick={() => restore(cp.id)}
                className="w-full flex items-center justify-between text-left"
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: isActive ? 'var(--accent-soft)' : 'rgba(255,255,255,.04)',
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: isActive ? 'var(--accent-ring)' : 'rgba(255,255,255,.1)',
                }}
                title={`${cp.label} — ${isActive ? 'current state' : 'restore this checkpoint'} — ${timeAgo(cp.at, now)}`}
              >
                <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 10,
                      color: isActive ? 'var(--accent)' : 'var(--glass-text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {clockTime(cp.at)}
                  </span>
                  {/* R5: labels are richer/longer now ("Shadows & Highlights — Highlights Radius 50 → 70") —
                      truncate with ellipsis; the button title carries the full label. */}
                  <span className="truncate" style={{ fontSize: 11.5, color: isActive ? 'var(--accent)' : 'var(--glass-text-label)' }}>{cp.label}</span>
                </div>
                {isActive
                  ? <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>current</span>
                  : <RotateCcw size={13} style={{ color: 'var(--glass-text-muted)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
