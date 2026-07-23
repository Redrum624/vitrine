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
  enhance: 'Enhance', highlightrecovery: 'Highlight Recovery',
};
const PARAM_LABELS: Record<string, string> = {
  temperature: 'Temperature', tint: 'Tint', exposure: 'Exposure', contrast: 'Contrast',
  brightness: 'Brightness', highlights: 'Highlights', shadows: 'Shadows', blackPoint: 'Black Point',
  saturation: 'Saturation', vibrance: 'Vibrance', dehaze: 'Dehaze', barrel: 'Barrel', scale: 'Scale',
  amount: 'Amount', midpoint: 'Midpoint', roundness: 'Roundness', feather: 'Feather', strength: 'Strength',
  redCyan: 'Red/Cyan', blueMagenta: 'Blue/Magenta', horizontal: 'Horizontal', vertical: 'Vertical', masterBlend: 'Master',
  // Crop & Transform (v1.37.0 R5)
  x: 'Left', y: 'Top', width: 'Width', height: 'Height', angle: 'Angle', orientation: 'Orientation',
  // White balance / basic (snake_case keys the generic prettifier would mangle)
  black_point: 'Black Point',
  // Color balance wheels
  cyan_red: 'Cyan/Red', magenta_green: 'Magenta/Green', yellow_blue: 'Yellow/Blue',
  // Enhance (labels from the panel's own slider names)
  denoiseStrength: 'Noise Reduction', sharpness: 'Sharpen', alpha: 'Detail Amount',
  hpSigma: 'Detail Radius', psfSigma: 'Deblur Radius', rlIters: 'Deblur Iterations',
  // Noise Reduction module
  chromaStrength: 'Chroma Noise', lumaStrength: 'Luma Noise', preserveDetail: 'Preserve Detail',
};
// Prettify unknown keys: snake_case AND camelCase → Title Case ("red_saturation" → "Red Saturation").
const labelParam = (k: string) => PARAM_LABELS[k] || k
  .replace(/_/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
const fmtNum = (v: number) => {
  if (Number.isInteger(v) && Math.abs(v) >= 10) return String(v); // 6500, -45
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : s; // +0.30, -4.00
};
// Unsigned value for the absolute "old → new" arrow form.
const fmtVal = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

// Zero-centered params (default 0) read best as a signed DELTA ("Exposure +0.35");
// everything else uses the always-correct arrow form ("Temperature 6500 → 4800").
// Curated per the modules' actual defaults — when a key is not listed, arrow form wins.
const ZERO_CENTERED_PATHS = new Set([
  'basicadj.black_point', 'basicadj.exposure', 'basicadj.contrast', 'basicadj.brightness',
  'basicadj.saturation', 'basicadj.vibrance', 'basicadj.dehaze', 'basicadj.highlights', 'basicadj.shadows',
  'temperature.tint',
  'exposure.exposure', 'exposure.black',
  'crop.angle',
  'shadowshighlights.whitePoint', 'shadowshighlights.blackPoint',
]);
// Lens corrections nest under BOTH `lensCorrections` (live) and `lensCorrectionsParams`
// (adapter copy) in the serialized tree — match on the meaningful path tail instead.
const ZERO_CENTERED_LENS_TAILS = [
  'vignetting.amount', 'vignetting.roundness', 'distortion.barrel',
  'perspective.horizontal', 'perspective.vertical',
  'chromaticAberration.redCyan', 'chromaticAberration.blueMagenta',
];
function isZeroCentered(path: string[]): boolean {
  const joined = path.join('.');
  if (ZERO_CENTERED_PATHS.has(joined)) return true;
  const leaf = path[path.length - 1];
  if (path[0] === 'colorbalance') {
    return /^(cyan_red|magenta_green|yellow_blue)$/.test(leaf) || /_(hue|saturation|luminance)$/.test(leaf);
  }
  if (path[0] === 'lenscorrections') return ZERO_CENTERED_LENS_TAILS.some((t) => joined.endsWith(`.${t}`));
  return false;
}

// One changed leaf between two param trees. `prev` is kept (R5) so labels can show
// deltas/arrows; non-numeric leaves (booleans, strings, curve-point arrays) are now
// collected too instead of being silently skipped.
interface LeafChange { path: string[]; prev: unknown; next: unknown; numeric: boolean; }

function diffLeaves(prev: unknown, next: unknown, path: string[], out: LeafChange[]): void {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return;
  const p = (prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}) as Record<string, unknown>;
  for (const [k, nv] of Object.entries(next as Record<string, unknown>)) {
    if (k === 'auto') continue; // meta flag — auto-WB writes temperature/tint anyway
    const pv = p[k];
    if (typeof nv === 'number') {
      if (typeof pv !== 'number' || Math.abs(nv - pv) > 1e-6) {
        out.push({ path: [...path, k], prev: typeof pv === 'number' ? pv : undefined, next: nv, numeric: true });
      }
    } else if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
      diffLeaves(pv, nv, [...path, k], out);
    } else if (JSON.stringify(pv) !== JSON.stringify(nv)) {
      out.push({ path: [...path, k], prev: pv, next: nv, numeric: false });
    }
  }
}

// True when a path names a curve payload (baseCurve, rgbCurve.red, baseCurveNodes, …).
// path[0] (the module id, e.g. 'tonecurve') is excluded so it doesn't match everything.
const isCurvePath = (path: string[]) => path.slice(1).some((seg) => /curve/i.test(seg));

const CROP_RECT_KEYS = new Set(['x', 'y', 'width', 'height']);

// Crop gestures get their own vocabulary: quarter-turns, straighten, rect drags.
// Returns null when the change mix doesn't match a known gesture (generic rules apply).
function describeCropChange(changes: LeafChange[], next: EditState): string | null {
  const top = (key: string) => changes.find((c) => c.path.length === 2 && c.path[1] === key);
  const orientation = top('orientation');
  const angle = top('angle');
  const rect = changes.filter((c) => c.path.length === 2 && CROP_RECT_KEYS.has(c.path[1]));
  // Riders that legitimately accompany these gestures without changing their meaning:
  // the rect (straighten runs ensureWedgeFreeCrop), enabled, and the aspect-ratio lock.
  const others = changes.filter((c) => !(
    c.path.length === 2 &&
    (CROP_RECT_KEYS.has(c.path[1]) || ['enabled', 'aspectRatio', 'orientation', 'angle'].includes(c.path[1]))
  ));
  if (others.length > 0) return null;
  if (orientation && !angle && typeof orientation.next === 'number') {
    const from = typeof orientation.prev === 'number' ? orientation.prev : 0;
    const d = (((orientation.next as number) - from) % 360 + 360) % 360;
    if (d === 90) return 'Rotate 90°';
    if (d === 180) return 'Rotate 180°';
    if (d === 270) return 'Rotate 90° CCW';
    return null;
  }
  if (angle && !orientation && typeof angle.next === 'number') {
    const d = (angle.next as number) - (typeof angle.prev === 'number' ? angle.prev : 0);
    return `Straighten ${d >= 0 ? '+' : ''}${d.toFixed(1)}°`;
  }
  if (rect.length > 0 && !angle && !orientation) {
    const cp = (next.modules?.crop || {}) as Record<string, unknown>;
    const w = typeof cp.width === 'number' ? cp.width : 1;
    const h = typeof cp.height === 'number' ? cp.height : 1;
    return `Crop ${Math.round(w * h * 100)}%`;
  }
  return null;
}

// One changed leaf → one specific label.
function describeSingleChange(name: string, c: LeafChange): string {
  const leaf = c.path[c.path.length - 1];
  if (leaf === 'enabled' && typeof c.next === 'boolean') {
    // Module-level flip → "Noise Reduction on"; nested section → "Lens Corrections — Vignetting on".
    const scope = c.path.length > 2 ? `${name} — ${labelParam(c.path[c.path.length - 2])}` : name;
    return `${scope} ${c.next ? 'on' : 'off'}`;
  }
  if (c.numeric) {
    const nv = c.next as number;
    // "Exposure — Exposure +0.35" reads doubled when the sole param carries the
    // module's own name — collapse to the module name alone.
    const prefix = labelParam(leaf) === name ? name : `${name} — ${labelParam(leaf)}`;
    if (typeof c.prev === 'number') {
      if (isZeroCentered(c.path)) return `${prefix} ${fmtNum(nv - c.prev)}`;
      return `${prefix} ${fmtVal(c.prev)} → ${fmtVal(nv)}`;
    }
    return `${prefix} ${fmtNum(nv)}`; // prev unknown (old saved state) — absolute
  }
  if (isCurvePath(c.path)) return `${name} curve edited`;
  if (typeof c.next === 'boolean') return `${name} — ${labelParam(leaf)} ${c.next ? 'on' : 'off'}`;
  if (typeof c.next === 'string' && typeof c.prev === 'string') return `${name} — ${labelParam(leaf)} ${c.prev} → ${c.next}`;
  return `${name} adjusted`;
}

// All of one module's changed leaves → one label.
function describeModuleChange(mod: string, changes: LeafChange[], next: EditState): string {
  const name = MODULE_NAMES[mod] || mod;
  if (mod === 'crop') {
    const label = describeCropChange(changes, next);
    if (label) return label;
  }
  // A curve drag writes the node array plus its bookkeeping (node count/type) — one edit.
  if (changes.every((c) => isCurvePath(c.path))) return `${name} curve edited`;
  if (changes.length === 1) return describeSingleChange(name, changes[0]);
  return `${name}: ${changes.length} changes`;
}

// Describe what changed between two edit states, e.g. "White Balance — Tint -4.00",
// "Temperature 6500 → 4800", "Crop 81%", "Multiple adjustments (12)".
function describeChange(prev: EditState | null, next: EditState): string | null {
  if (!prev) return null;
  const all: LeafChange[] = [];
  for (const mod of Object.keys(next.modules || {})) diffLeaves((prev.modules || {})[mod], next.modules[mod], [mod], all);
  // Local adjustments serialize separately (layer list) — count them as one change.
  if (JSON.stringify(prev.localAdjustments) !== JSON.stringify(next.localAdjustments)) {
    all.push({ path: ['localadjustments', 'layers'], prev: undefined, next: undefined, numeric: false });
  }
  if (all.length === 0) return null;

  const byModule = new Map<string, LeafChange[]>();
  for (const c of all) {
    const list = byModule.get(c.path[0]);
    if (list) list.push(c); else byModule.set(c.path[0], [c]);
  }
  // Drop `enabled` flips that ride along with real edits in the same module — panels set
  // enabled:true with the first drag, and the flip is implied by the edit itself.
  for (const [mod, list] of byModule) {
    const pruned = list.filter((c) => c.path[c.path.length - 1] !== 'enabled');
    if (pruned.length > 0 && pruned.length < list.length) byModule.set(mod, pruned);
  }
  const changes = [...byModule.values()].flat();
  if (byModule.size > 1) return `Multiple adjustments (${changes.length})`;
  const [mod] = byModule.keys();
  return describeModuleChange(mod, byModule.get(mod)!, next);
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

  /** Record a checkpoint with a forced, verbatim label. Use this (instead of record) for
   *  machine-generated entries like "Enhanced ×2" or "Auto All" where describeChange must
   *  NOT run (it would return a generic summary like "Multiple adjustments (8)").
   *  `bakeDepth` defaults to the current bake depth (param-only callers omit it).
   *  No state-identity dedupe by default — a bake changes pixels/dims that serialize() does
   *  NOT capture, so two param-identical states are genuinely different milestones. Param-only
   *  callers (Auto All) pass `dedupe: true` so a repeat no-op click records nothing. */
  recordLabeled(label: string, bakeDepth: number = this.bakeBridge.getDepth(), dedupe = false): void {
    if (!imageService.getCurrentImage()) return;
    const state = editPersistenceService.serialize();
    const json = JSON.stringify(state);
    if (dedupe && json === this.lastSnapshot) return;         // repeat no-op — nothing changed
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
