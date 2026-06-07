import { editPersistenceService } from './EditPersistenceService';
import { imageService } from './ImageService';
import { logger } from '../utils/Logger';

// A checkpoint stores a full edit-state snapshot (reusing EditPersistenceService's
// serialize format) so it can be restored later. Mask buffers are never stored — they
// are rebuilt from geometry on restore.
//
// This is SEPARATE from HistoryService (the global Ctrl+Z undo/redo stack): the History
// module is a per-image, persisted, keep-the-full-list checkpoint timeline.
type EditState = ReturnType<typeof editPersistenceService.serialize>;

export interface Checkpoint {
  id: number;
  label: string;
  at: number;       // epoch ms
  state: EditState;
}

interface StoredHistory {
  version: number;
  nextSeq: number;
  checkpoints: Checkpoint[];
}

const HISTORY_VERSION = 1;
const MAX_CHECKPOINTS = 200;
const RECORD_DEBOUNCE_MS = 900;
const SAVE_DEBOUNCE_MS = 800;

/**
 * Per-image edit history. Auto-records a labelled checkpoint after each committed edit
 * (debounced + de-duplicated), keeps the full list, restores any checkpoint, and persists
 * the list per image in the durable userData store (key `history:<filePath>`) so it
 * survives sessions and app updates. Restoring keeps the list intact (new edits append).
 */
class CheckpointService {
  private path: string | null = null;
  private checkpoints: Checkpoint[] = [];
  private activeId: number | null = null;
  private seq = 0;
  private lastSnapshot = '';                                   // dedupe identical states
  private recordTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(): void {
    this.listeners.forEach((f) => { try { f(); } catch { /* listener error — ignore */ } });
  }

  getCheckpoints(): readonly Checkpoint[] { return this.checkpoints; }
  getActiveId(): number | null { return this.activeId; }

  /** Record a checkpoint of the current edit state immediately (de-duplicated). */
  record(label: string): void {
    if (!imageService.getCurrentImage()) return;
    const json = JSON.stringify(editPersistenceService.serialize());
    if (json === this.lastSnapshot) return;                   // nothing changed since last checkpoint
    this.lastSnapshot = json;
    const cp: Checkpoint = { id: ++this.seq, label, at: Date.now(), state: JSON.parse(json) };
    this.checkpoints.push(cp);
    while (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.shift();
    this.activeId = cp.id;
    this.scheduleSave();
    this.emit();
  }

  /** Record after the user stops editing (so a slider drag yields ONE checkpoint). */
  recordDebounced(label: string): void {
    if (this.recordTimer) clearTimeout(this.recordTimer);
    this.recordTimer = setTimeout(() => { this.recordTimer = null; this.record(label); }, RECORD_DEBOUNCE_MS);
  }

  /** Restore a checkpoint by id. Keeps the full list; returns true on success. */
  restore(id: number): boolean {
    const cp = this.checkpoints.find((c) => c.id === id);
    const img = imageService.getCurrentImage();
    if (!cp || !img) return false;
    editPersistenceService.restore(cp.state, img.width, img.height);
    this.activeId = id;
    this.lastSnapshot = JSON.stringify(cp.state);             // restoring is not a new edit
    if (this.recordTimer) { clearTimeout(this.recordTimer); this.recordTimer = null; }
    this.emit();
    return true;
  }

  /** Load the per-image history from the durable store when an image is opened. */
  async loadForPath(path: string): Promise<void> {
    if (this.recordTimer) { clearTimeout(this.recordTimer); this.recordTimer = null; }
    this.path = path;
    this.checkpoints = [];
    this.activeId = null;
    this.seq = 0;
    this.lastSnapshot = '';
    const api = window.electronAPI;
    if (api?.storeGet) {
      try {
        const data = await api.storeGet<StoredHistory>(this.keyFor(path));
        if (data && data.version === HISTORY_VERSION && Array.isArray(data.checkpoints)) {
          this.checkpoints = data.checkpoints;
          this.seq = Math.max(data.nextSeq ?? 0, this.checkpoints.reduce((m, c) => Math.max(m, c.id), 0));
          const last = this.checkpoints[this.checkpoints.length - 1];
          this.activeId = last ? last.id : null;
          this.lastSnapshot = last ? JSON.stringify(last.state) : '';
        }
      } catch (e) {
        logger.warn('history load failed', e);
      }
    }
    this.emit();
  }

  clear(): void {
    this.checkpoints = [];
    this.activeId = null;
    this.lastSnapshot = '';
    if (this.recordTimer) { clearTimeout(this.recordTimer); this.recordTimer = null; }
    this.scheduleSave();
    this.emit();
  }

  private keyFor(path: string): string { return `history:${path}`; }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (!this.path || !window.electronAPI?.storeSet) return;
    const payload: StoredHistory = { version: HISTORY_VERSION, nextSeq: this.seq, checkpoints: this.checkpoints };
    window.electronAPI.storeSet(this.keyFor(this.path), payload);
  }
}

export const checkpointService = new CheckpointService();
