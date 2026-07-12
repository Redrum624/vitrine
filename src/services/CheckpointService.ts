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
  /** Depth of the EnhanceService restore stack at the time this checkpoint was recorded.
   *  0 = no baked upscale active. Used by restore() to unwind the bake before re-applying params. */
  bakeDepth?: number;
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

const MODULE_NAMES: Record<string, string> = {
  exposure: 'Exposure', temperature: 'White Balance', basicadj: 'Basic Adjustments',
  tonecurve: 'Tone Curve', colorbalance: 'Color Balance', 'noise-reduction': 'Noise Reduction',
  shadowshighlights: 'Shadows & Highlights', lenscorrections: 'Lens Corrections',
  localadjustments: 'Local Adjustments', huecurves: 'Hue Curves', crop: 'Crop & Transform',
};
const PARAM_LABELS: Record<string, string> = {
  temperature: 'Temperature', tint: 'Tint', exposure: 'Exposure', contrast: 'Contrast',
  brightness: 'Brightness', highlights: 'Highlights', shadows: 'Shadows', blackPoint: 'Black Point',
  saturation: 'Saturation', vibrance: 'Vibrance', dehaze: 'Dehaze', barrel: 'Barrel', scale: 'Scale',
  amount: 'Amount', midpoint: 'Midpoint', roundness: 'Roundness', feather: 'Feather', strength: 'Strength',
  redCyan: 'Red/Cyan', blueMagenta: 'Blue/Magenta', horizontal: 'Horizontal', vertical: 'Vertical', masterBlend: 'Master',
};
const labelParam = (k: string) => PARAM_LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const fmtNum = (v: number) => {
  if (Number.isInteger(v) && Math.abs(v) >= 10) return String(v); // 6500, -45
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : s; // +0.30, -4.00
};

// Collect changed numeric leaves (one path each) between two param trees.
function diffLeaves(prev: unknown, next: unknown, path: string[], out: { path: string[]; value: number }[]): void {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return;
  const p = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  for (const [k, nv] of Object.entries(next as Record<string, unknown>)) {
    if (k === 'enabled' || k === 'auto') continue;
    const pv = p[k];
    if (typeof nv === 'number') {
      if (typeof pv !== 'number' || Math.abs(nv - pv) > 1e-6) out.push({ path: [...path, k], value: nv });
    } else if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
      diffLeaves(pv, nv, [...path, k], out);
    }
  }
}

// Describe what changed between two edit states, e.g. "White Balance — Tint -4.00".
function describeChange(prev: EditState | null, next: EditState): string | null {
  if (!prev) return null;
  const out: { path: string[]; value: number }[] = [];
  for (const mod of Object.keys(next.modules || {})) diffLeaves((prev.modules || {})[mod], next.modules[mod], [mod], out);
  if (out.length === 0) {
    return JSON.stringify(prev.localAdjustments) !== JSON.stringify(next.localAdjustments) ? 'Local Adjustments' : null;
  }
  if (out.length > 3) return 'Multiple adjustments';
  const c = out[0];
  const mod = c.path[0];
  const leaf = c.path[c.path.length - 1];
  return `${MODULE_NAMES[mod] || mod} — ${labelParam(leaf)} ${fmtNum(c.value)}`;
}

/**
 * Per-image edit history. Auto-records a labelled checkpoint after each committed edit
 * (debounced + de-duplicated), keeps the full list, restores any checkpoint, and persists
 * the list per image in the durable userData store (key `history:<filePath>`) so it
 * survives sessions and app updates. Restoring keeps the list intact (new edits append).
 */
// Bridge injected by EnhanceService at startup to avoid a direct import cycle
// (EnhanceService already imports CheckpointService, so CheckpointService importing
// EnhanceService would create a cycle). The bridge defaults to a no-op so all
// existing behaviour is unchanged when no upscale pipeline is wired.
interface BakeBridge {
  getDepth: () => number;
  unwindToDepth: (depth: number) => void;
}

class CheckpointService {
  private path: string | null = null;
  private checkpoints: Checkpoint[] = [];
  private activeId: number | null = null;
  private seq = 0;
  private lastSnapshot = '';                                   // dedupe identical states
  private lastState: EditState | null = null;                  // parsed last state, for change labels
  private recordTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private bakeBridge: BakeBridge = { getDepth: () => 0, unwindToDepth: () => {} };

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(): void {
    this.listeners.forEach((f) => { try { f(); } catch { /* listener error — ignore */ } });
  }

  getCheckpoints(): readonly Checkpoint[] { return this.checkpoints; }
  getActiveId(): number | null { return this.activeId; }

  /** Index of the active checkpoint in the timeline, or -1 if none / not found. */
  private activeIndex(): number {
    if (this.activeId == null) return -1;
    return this.checkpoints.findIndex((c) => c.id === this.activeId);
  }

  /** True if there is an earlier checkpoint to step back to (drives the Undo button). */
  canUndo(): boolean { return this.activeIndex() > 0; }

  /** True if there is a later checkpoint to step forward to (drives the Redo button). */
  canRedo(): boolean {
    const i = this.activeIndex();
    return i >= 0 && i < this.checkpoints.length - 1;
  }

  /** Undo: move the active position one checkpoint back and restore it. Returns true if it moved. */
  undo(): boolean {
    const i = this.activeIndex();
    if (i <= 0) return false;
    return this.restore(this.checkpoints[i - 1].id);
  }

  /** Redo: move the active position one checkpoint forward and restore it. Returns true if it moved. */
  redo(): boolean {
    const i = this.activeIndex();
    if (i < 0 || i >= this.checkpoints.length - 1) return false;
    return this.restore(this.checkpoints[i + 1].id);
  }

  /** Wire the bake bridge (called once by EnhanceService at startup). The bridge exposes
   *  the EnhanceService restore-stack depth and unwind without creating an import cycle. */
  setBakeBridge(bridge: BakeBridge): void {
    this.bakeBridge = bridge;
  }

  /** Record a checkpoint of the current edit state immediately (de-duplicated). The label
   *  describes the actual change (e.g. "White Balance — Tint -4.00"); `fallbackLabel` is
   *  used only when the change can't be summarised (multi-change or first checkpoint). */
  record(fallbackLabel: string): void {
    if (!imageService.getCurrentImage()) return;
    const state = editPersistenceService.serialize();
    const json = JSON.stringify(state);
    if (json === this.lastSnapshot) return;                   // nothing changed since last checkpoint
    const label = describeChange(this.lastState, state) || fallbackLabel;
    this.lastSnapshot = json;
    const parsed = JSON.parse(json) as EditState;
    this.lastState = parsed;
    const bakeDepth = this.bakeBridge.getDepth();
    const cp: Checkpoint = { id: ++this.seq, label, at: Date.now(), state: parsed, bakeDepth };
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

  /** Record a checkpoint with a forced, verbatim label and an explicit bakeDepth.
   *  Use this (instead of record) for machine-generated entries like "Enhanced ×2" where
   *  describeChange must NOT run (it may return a generic summary that overwrites the label).
   *  No state-identity dedupe — a bake changes pixels/dims that serialize() does NOT capture,
   *  so two param-identical states are genuinely different milestones and must both be recorded. */
  recordLabeled(label: string, bakeDepth: number): void {
    if (!imageService.getCurrentImage()) return;
    const state = editPersistenceService.serialize();
    const json = JSON.stringify(state);
    this.lastSnapshot = json;
    const parsed = JSON.parse(json) as EditState;
    this.lastState = parsed;
    const cp: Checkpoint = { id: ++this.seq, label, at: Date.now(), state: parsed, bakeDepth };
    this.checkpoints.push(cp);
    while (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.shift();
    this.activeId = cp.id;
    this.scheduleSave();
    this.emit();
  }

  /** Restore a checkpoint by id. Keeps the full list; returns true on success.
   *
   * LIMITATION (bake-aware): History supports UNDOING an upscale (restoring a lower-bakeDepth
   * checkpoint unwinds the bake first, then re-applies the edit params for the smaller image).
   * It does NOT redo an upscale by clicking an "Enhanced ×N" entry — re-run Apply Upscale to redo.
   */
  restore(id: number): boolean {
    const cp = this.checkpoints.find((c) => c.id === id);
    if (!cp) return false;

    // Unwind the bake stack if this checkpoint predates the current bake level.
    const cpDepth = cp.bakeDepth ?? 0;
    const currentDepth = this.bakeBridge.getDepth();
    if (cpDepth < currentDepth) {
      this.bakeBridge.unwindToDepth(cpDepth);
    }

    // Read dims AFTER the potential unwind — dimensions may have changed.
    const img = imageService.getCurrentImage();
    if (!img) return false;

    editPersistenceService.restore(cp.state, img.width, img.height);
    this.activeId = id;
    this.lastSnapshot = JSON.stringify(cp.state);             // restoring is not a new edit
    this.lastState = cp.state;
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
    this.lastState = null;
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
          this.lastState = last ? last.state : null;
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
    this.lastState = null;
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
