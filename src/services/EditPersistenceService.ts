import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { imageService } from './ImageService';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import type { MaskGeometry, LocalAdjustmentParams } from '../modules/LocalAdjustmentsModule';
import { logger } from '../utils/Logger';
import { useAppStore } from '../stores/appStore';
import { DEFAULT_RAW_DECODE_OPTIONS, type RawDecodeOptions, type BakedUpscaleIntent } from '../types/electron';

const STORE_VERSION = 1;

/**
 * Shape-validate persisted RAW decode options. The store JSON is durable and survives app updates,
 * so a value written by an older/buggy build (or hand-edited / partially-corrupt file) can carry a
 * demosaic/highlightMode outside the current enums. Passing such a value downstream would feed an
 * invalid `-q`/highlight to the decoder and desync the RawDecodePanel's selects. Accept only the
 * exact known enum members. Kept in sync with types/electron.ts (DemosaicAlgo / HighlightMode).
 */
function isValidRawDecodeOptions(o: unknown): o is RawDecodeOptions {
  if (!o || typeof o !== 'object') return false;
  const opts = o as Record<string, unknown>;
  const demosaicOk = opts.demosaic === 'ahd' || opts.demosaic === 'dcb';
  const highlightOk =
    opts.highlightMode === 'off' || opts.highlightMode === 'blend' || opts.highlightMode === 'reconstruct';
  return demosaicOk && highlightOk;
}

/**
 * Shape-validate a persisted `bakedUpscale` intent value. Same rationale as
 * isValidRawDecodeOptions: the store JSON is durable and survives app updates, so a value
 * written by an older/buggy build (or a hand-edited/partially-corrupt store) can carry a
 * scale/mode outside the current enums. Unlike decode options there is no safe DEFAULT to
 * substitute — fabricating a {scale,mode} would falsely claim a bake that never happened — so
 * corrupt or absent input simply means "no durable upscale intent" (null).
 */
function isValidBakedUpscaleIntent(o: unknown): o is BakedUpscaleIntent {
  if (!o || typeof o !== 'object') return false;
  const v = o as Record<string, unknown>;
  const scaleOk = v.scale === 2 || v.scale === 4;
  const modeOk = v.mode === 'ai' || v.mode === 'standard';
  return scaleOk && modeOk;
}

type LayerType = 'brush' | 'linear_gradient' | 'radial_gradient' | 'parametric';

interface SerializedLayer {
  name: string;
  type: LayerType;
  enabled: boolean;
  opacity: number;
  geometry?: MaskGeometry;
  basicAdj?: Record<string, number>;
  parameters?: Record<string, unknown>;
}

interface EditState {
  version: number;
  modules: Record<string, Record<string, unknown>>;
  localAdjustments?: { enabled: boolean; layers: SerializedLayer[] };
  // RAW decode options the current image's base was decoded with. Persisted so the next
  // open decodes the base with the same demosaic/highlight settings (see getSavedRawDecodeOptions).
  // NOTE: this is intentionally NOT re-applied by restore() — decode options are a property of
  // the base image, not the module-edit timeline. Re-applying on a checkpoint restore (which does
  // NOT re-decode) would desync the displayed options from the actually-decoded pixels.
  rawDecodeOptions?: RawDecodeOptions;
  // Durable upscale INTENT (Q7): present iff the image was baked to an ×scale upscale. Honest
  // INTENT persistence — NOT the ~2GB upscaled pixels: the saved `modules` are the PRE-bake
  // (native-dims) params, and this marker records "then upscale ×scale". On reopen the panel
  // surfaces a one-click re-apply and the export path warns rather than silently dropping it.
  // Optional + never version-bumped, so old saved states (no field) restore cleanly as "no intent".
  // Written by persistBakedUpscaleIntent (on bake) and emitted by serialize() from the store's
  // upscaleIntent, so it round-trips through flush (does not get destroyed by a later edit's save).
  bakedUpscale?: BakedUpscaleIntent;
}

/**
 * Per-image edit persistence. Serializes every pipeline module's params plus the
 * Local Adjustment layers (geometry only — the Float32 mask is rebuilt from geometry)
 * to a durable userData JSON store keyed by the image's file path, and restores them
 * when the image is reopened. Survives sessions AND app updates (userData persists).
 */
class EditPersistenceService {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private baseline = ''; // serialized post-load state — edits are saved only once it changes

  private keyForPath(path: string): string {
    return `edits:${path}`;
  }

  /** Snapshot the current pipeline state (all modules + LA layers, no mask buffers). */
  serialize(): EditState {
    const modules: Record<string, Record<string, unknown>> = {};
    for (const [id, module] of imageProcessingPipeline.getModules()) {
      if (id === 'localadjustments') continue; // handled separately (layers)
      try {
        const m = module as { getParams?: () => Record<string, unknown> };
        if (typeof m.getParams === 'function') modules[id] = m.getParams();
      } catch (e) {
        logger.warn(`serialize: getParams failed for ${id}`, e);
      }
    }

    const state: EditState = {
      version: STORE_VERSION,
      modules,
      rawDecodeOptions: useAppStore.getState().rawDecodeOptions,
    };

    // Emit the durable upscale intent from the store's single source of truth. This is what makes
    // the marker round-trip through flush: after a reopen, restoreState seeds the flush baseline
    // from serialize() — which now includes bakedUpscale — so a later unrelated edit's flush writes
    // a state that STILL carries the marker instead of silently destroying it (P2 progressive
    // destruction). Null while no upscale is active/pending → the field is simply omitted.
    const intent = useAppStore.getState().upscaleIntent;
    if (intent) state.bakedUpscale = { scale: intent.scale, mode: intent.mode };

    const la = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
    if (la) {
      const params = la.getParameters();
      const layers: SerializedLayer[] = (params.layers || []).map((l) => ({
        name: l.name,
        type: l.type,
        enabled: l.enabled,
        opacity: l.opacity,
        geometry: l.geometry,
        basicAdj: l.basicAdj as Record<string, number> | undefined,
        parameters: l.parameters as Record<string, unknown> | undefined,
      }));
      state.localAdjustments = { enabled: !!params.enabled, layers };
    }
    return state;
  }

  /** Apply a serialized edit state to the (already-reset) pipeline at width×height. */
  restore(state: EditState, width: number, height: number): boolean {
    if (!state || state.version !== STORE_VERSION) return false;

    for (const [id, params] of Object.entries(state.modules || {})) {
      const module = imageProcessingPipeline.getModule(id) as { setParams?: (p: unknown) => void } | undefined;
      if (module && typeof module.setParams === 'function') {
        try { module.setParams(params); } catch (e) { logger.warn(`restore: setParams failed for ${id}`, e); }
      }
    }

    const la = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
    if (la) {
      for (const l of la.getParameters().layers || []) la.removeLayer(l.id);
      const saved = state.localAdjustments;
      if (saved) {
        for (const sl of saved.layers) {
          const id = la.createLayer(sl.type, sl.name, width, height);
          if (sl.geometry) la.setLayerGeometry(id, sl.geometry, width, height);
          if (sl.parameters) la.updateLayerParameters(id, sl.parameters as Partial<LocalAdjustmentParams>);
          if (sl.basicAdj) la.updateLayerBasicAdj(id, sl.basicAdj);
          if (typeof sl.opacity === 'number') la.updateLayerOpacity(id, sl.opacity);
          la.toggleLayer(id, sl.enabled);
        }
        if (saved.enabled) la.enable(); else la.disable();
      }
    }
    imageProcessingPipeline.invalidateModuleCache('localadjustments');
    return true;
  }

  /**
   * Fetch the full saved edit state for an image path in ONE IPC read — decode options
   * AND module edits live in the same durable store entry. The image-open flow reads this
   * once up front (before decode): the decode options seed the base decode, and the same
   * state is then applied (restoreState) BEFORE the first pipeline pass — so persisted edits
   * render on the first pass, with no second read, no double pass, and no unedited flash.
   */
  async getSavedEditState(path: string): Promise<EditState | null> {
    try {
      return window.electronAPI?.storeGet
        ? await window.electronAPI.storeGet<EditState>(this.keyForPath(path))
        : null;
    } catch (e) {
      logger.warn('getSavedEditState failed', e);
      return null;
    }
  }

  /**
   * Apply a PRE-FETCHED edit state to the (already-reset) pipeline at width×height and
   * seed the persistence baseline. Synchronous — NO IPC (the state was already read by
   * getSavedEditState). Pass `null` for a pristine image (nothing to restore) to still
   * seed the baseline so no spurious save fires. The open flow calls this from
   * ImageService's beforeNotify hook so edits apply BEFORE the first pipeline pass.
   * `logPath` only labels the "Restored saved edits" log line. Returns true if edits applied.
   */
  restoreState(state: EditState | null, width: number, height: number, logPath = ''): boolean {
    let restored = false;
    try {
      if (state) {
        restored = this.restore(state, width, height);
        if (restored) logger.info(`Restored saved edits for ${logPath}`);
      }
    } catch (e) {
      logger.warn('restoreState failed', e);
    }
    // Baseline = the post-restore state. Edits are persisted only once the state differs,
    // so unedited images and the load-triggered reprocess never write a spurious save.
    this.baseline = JSON.stringify(this.serialize());
    return restored;
  }

  /** Load + apply saved edits for an image path (one IPC read). Returns true if anything was restored. */
  async restoreForPath(path: string, width: number, height: number): Promise<boolean> {
    const state = await this.getSavedEditState(path);
    return this.restoreState(state, width, height, path);
  }

  /**
   * Read the saved RAW decode options for an image path WITHOUT touching the pipeline.
   * Used before the initial decode so the base is decoded with the same options the user
   * last chose (or null → caller falls back to DEFAULT_RAW_DECODE_OPTIONS). This is the
   * read half of the persist/restore round-trip for decode options; the write half is
   * serialize() embedding useAppStore's rawDecodeOptions into the durable edit state.
   */
  async getSavedRawDecodeOptions(path: string): Promise<RawDecodeOptions | null> {
    const saved = (await this.getSavedEditState(path))?.rawDecodeOptions;
    return this.validateSavedRawDecodeOptions(saved);
  }

  /**
   * Shape-validate an ALREADY-FETCHED persisted rawDecodeOptions value — the synchronous core of
   * getSavedRawDecodeOptions, split out so a caller that already holds the edit state (Canvas's
   * single up-front getSavedEditState read) can run the SAME validation WITHOUT paying a second IPC
   * round-trip. Returns null when nothing was persisted (caller uses DEFAULT), the value itself when
   * it is a valid shape, or DEFAULT_RAW_DECODE_OPTIONS when it is persisted-but-corrupt (out-of-enum
   * demosaic/highlightMode from an old/buggy build or a tampered store) rather than propagating an
   * invalid decode option to the store/decoder.
   */
  validateSavedRawDecodeOptions(saved: unknown): RawDecodeOptions | null {
    if (saved === undefined || saved === null) return null; // nothing persisted → caller uses DEFAULT
    return isValidRawDecodeOptions(saved) ? saved : DEFAULT_RAW_DECODE_OPTIONS;
  }

  /**
   * Shape-validate an ALREADY-FETCHED persisted `bakedUpscale` intent value — the synchronous
   * seed for the store's upscaleIntent. Canvas's open flow reads this from the single up-front
   * getSavedEditState result (mirrors validateSavedRawDecodeOptions for the sibling
   * rawDecodeOptions field, same one-IPC-read rationale). A corrupt or missing value returns
   * null (no intent) — there is no safe DEFAULT to substitute here, unlike decode options.
   */
  validateBakedUpscaleIntent(saved: unknown): BakedUpscaleIntent | null {
    return isValidBakedUpscaleIntent(saved) ? saved : null;
  }

  /** Debounced save of the current image's edits — call after any edit. */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 800);
  }

  /** Immediate save of the current image's edits — call before switching images and on app close. */
  flush(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    // Suppress while EITHER bake is active. A baked upscale/deblur has reset the pipeline modules to
    // neutral (their edits are baked into the new base); persisting that neutral state would clobber
    // the user's PRE-bake saved edits. The pre-bake state is written explicitly at bake time
    // (persistBakedUpscaleIntent for upscale; a plain flush before the deblur reset), and revert's
    // persistNow re-writes the restored state marker-free once fully unwound.
    if (imageService.isBakedUpscaleActive() || imageService.isBakedDeblurActive()) return;
    const json = JSON.stringify(this.serialize());
    if (json === this.baseline) return; // unchanged since load — nothing to persist
    this.baseline = json;
    try {
      window.electronAPI.storeSet(this.keyForPath(img.filePath), JSON.parse(json));
    } catch (e) {
      logger.warn('flush save failed', e);
    }
  }

  /**
   * Persist the PRE-bake edit state (native-dims module params) plus the upscale INTENT marker for
   * the current image. Called by EnhanceService.applyUpscale right after a bake: flush() early-returns
   * while a bake is active (it would otherwise persist the upscaled-dims params over the native saved
   * state), so THIS is the single write that captures the intent. `baseState` is the serialize()
   * snapshot taken BEFORE the bake reset the modules, so the persisted module params re-derive the
   * SAME upscale when re-applied on reopen. The flush baseline is set to what we just wrote so a later
   * revert's persistNow (marker-free) is correctly seen as a change.
   */
  persistBakedUpscaleIntent(baseState: EditState, scale: 2 | 4, mode: 'ai' | 'standard'): void {
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    const state: EditState = { ...baseState, bakedUpscale: { scale, mode } };
    const json = JSON.stringify(state);
    this.baseline = json;
    try {
      window.electronAPI.storeSet(this.keyForPath(img.filePath), JSON.parse(json));
    } catch (e) {
      logger.warn('persistBakedUpscaleIntent failed', e);
    }
  }

  /**
   * Force-persist the current pipeline state for the current image NOW, bypassing the baseline-diff
   * short-circuit (but re-seeding the baseline). Two callers in EnhanceService._popAndRestore:
   * (a) FULL unwind to the native base — the store's upscaleIntent has been cleared, so serialize()
   * emits NO bakedUpscale marker, durably erasing a previously-persisted intent; (b) PARTIAL unwind
   * of stacked bakes — the store carries the remaining level's re-seeded {scale, mode}, so the disk
   * marker is corrected to match (a quit right after the partial revert must not offer the popped
   * level's stale re-apply). Safe in both: the persisted marker mirrors the live store exactly.
   */
  persistNow(): void {
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    const json = JSON.stringify(this.serialize());
    this.baseline = json;
    try {
      window.electronAPI.storeSet(this.keyForPath(img.filePath), JSON.parse(json));
    } catch (e) {
      logger.warn('persistNow failed', e);
    }
  }
}

export const editPersistenceService = new EditPersistenceService();
