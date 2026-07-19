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
export function isValidRawDecodeOptions(o: unknown): o is RawDecodeOptions {
  if (!o || typeof o !== 'object') return false;
  const opts = o as Record<string, unknown>;
  const demosaicOk = opts.demosaic === 'ahd' || opts.demosaic === 'dcb';
  const highlightOk =
    opts.highlightMode === 'off' || opts.highlightMode === 'blend' || opts.highlightMode === 'reconstruct';
  // cameraMatch was added after demosaic/highlightMode shipped: absent (older
  // edit states — keeps their pre-feature look) or boolean are both valid.
  const cameraMatchOk = opts.cameraMatch === undefined || typeof opts.cameraMatch === 'boolean';
  return demosaicOk && highlightOk && cameraMatchOk;
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
  // Durable DEBLUR intent (Z1, mirror of bakedUpscale): a PRESENCE marker (no payload — motion
  // deblur is dimension-preserving and AI-only, so there is nothing but "a deblur was baked" to
  // record). Written by persistBakedDeblurIntent (on bake) and emitted by serialize() from the
  // store's deblurIntent. Optional + never version-bumped → old states restore as "no deblur".
  bakedDeblur?: Record<string, never>;
  // Ordered replay list when MULTIPLE bakes are in the durable intent: e.g. ['upscale','deblur'].
  // NOTE (review MEDIUM fix): a live STACKED bake is in-session only (its intent never persists —
  // see stackedBakeActive below), so this field is no longer produced by the bake persist writers.
  // Both markers can still coexist on disk via the UNAPPLIED-intent corner (a reopened, not-yet-
  // re-applied intent folded into a fresh single bake's persist) — the reopen re-apply then derives
  // the order from the markers (Canvas seeds ['upscale','deblur']). Kept optional + tolerated on
  // read for forward/backward compatibility; emitted by serialize() only from an in-session store
  // bakeOrder >1 (reaches checkpoints, never the edits store).
  bakeOrder?: ('upscale' | 'deblur')[];
  // Edits made AFTER a bake (Z1 — the standing MEDIUM). A bake resets the pipeline modules to
  // NEUTRAL (the pre-bake edits are incorporated into the new base pixels), so a normal flush of the
  // post-bake module state would clobber the pre-bake `modules` above. Instead the post-bake edits
  // are REDIRECTED here (same shapes as the top level) while `modules` stays frozen at the pre-bake
  // state. On reopen + re-apply they are replayed on top of the re-derived baked base. NOT emitted
  // by serialize() (it is a persistence-only concern) — written exclusively by flush()'s redirect
  // path, so checkpoints (which snapshot serialize()) never capture it and stay orthogonal to it.
  editsOnBakedBase?: { modules: Record<string, Record<string, unknown>>; localAdjustments?: { enabled: boolean; layers: SerializedLayer[] } };
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
  // POST-BAKE REDIRECT state (Z1). While a bake marker is live, flush() writes the current
  // post-bake edits into `editsOnBakedBase` on top of this FROZEN pre-bake top-level, instead of
  // clobbering the pre-bake `modules`. Set by the persist writers at bake time; survives a stacked
  // window untouched (the first bake's snapshot stays authoritative); cleared on a full unwind
  // (persistNow) or a fresh open (restoreState). `bakedEditsBaseline` tracks the LAST-written
  // post-bake edits so an untouched post-bake state writes nothing.
  private bakedBaseState: EditState | null = null;
  private bakedEditsBaseline = '';
  // THE STACKED CORNER (Z1 review MEDIUM). There is ONE `modules` slot on disk, but a stacked bake
  // has TWO distinct pre-bake states (the pre-first-bake grading vs the post-first-bake state the
  // second bake baked from). Persisting the SECOND bake's intent would overwrite disk.modules with
  // the POST-first-bake state — permanently dropping the user's original pre-first-bake edits
  // (a regression: pre-Z1 the second bake simply didn't persist, so disk kept the correct state).
  // So a bake that STACKS onto an already-live bake is IN-SESSION ONLY: its intent is never
  // persisted, disk keeps the FIRST bake's pre-bake modules + intent, and the reopen notice offers
  // re-apply of the FIRST bake only. While stacked, the flush REDIRECT is suspended too (this
  // flag): post-second-bake edits are edits on a DOUBLY-baked base — replaying them after
  // re-applying only the FIRST bake would be wrong — so they are in-session only as well, and any
  // editsOnBakedBase already on disk stays FROZEN at its pre-second-bake content (it belongs to
  // the first bake level and replays correctly there). Cleared WITHOUT any disk write when the
  // stack unwinds back to a single level (resumeRedirectAfterStackedUnwind), on a full unwind
  // (persistNow), or when a new image opens (restoreState).
  private stackedBakeActive = false;

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
    const store = useAppStore.getState();
    const intent = store.upscaleIntent;
    if (intent) state.bakedUpscale = { scale: intent.scale, mode: intent.mode };
    // Deblur intent + stacked bake order mirror the upscale marker: emitted from the store so they
    // round-trip through flush (a later unrelated edit's save re-writes them instead of destroying
    // them — the same P2 progressive-destruction guard). bakeOrder is emitted only when >1 bake is
    // stacked; a single bake is fully described by its marker alone.
    if (store.deblurIntent) state.bakedDeblur = {};
    if (store.bakeOrder.length > 1) state.bakeOrder = [...store.bakeOrder];

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
      // Setter ladder mirroring applyWorkerConfig / the getParams getter shapes: most modules
      // expose setParams, but exposure uses setCurrentParams and lenscorrections uses
      // setParameters — before this ladder restore() only tried setParams, so crop / exposure /
      // tonecurve / colorbalance / lenscorrections were serialized but SILENTLY dropped on reopen
      // (the P2 progressive-destruction class). getParams captured them, so accepting exactly
      // those shapes back is a pure round-trip (no schema change; old persisted states restore).
      const module = imageProcessingPipeline.getModule(id) as {
        setParams?: (p: unknown) => void;
        setParameters?: (p: unknown) => void;
        setCurrentParams?: (p: unknown) => void;
      } | undefined;
      if (!module) continue;
      try {
        if (typeof module.setParams === 'function') module.setParams(params);
        else if (typeof module.setParameters === 'function') module.setParameters(params);
        else if (typeof module.setCurrentParams === 'function') module.setCurrentParams(params);
        else logger.warn(`restore: no param setter for ${id}`);
      } catch (e) {
        logger.warn(`restore: setParams failed for ${id}`, e);
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
    // A fresh open has no active bake (the base is the freshly-decoded native pixels) — drop any
    // post-bake redirect state carried over from a previous image so flush() takes the normal path.
    this.bakedBaseState = null;
    this.bakedEditsBaseline = '';
    this.stackedBakeActive = false;
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

  /**
   * Shape-validate a persisted `bakeOrder` array (mirrors validateBakedUpscaleIntent's spirit).
   * The store JSON is durable and survives app updates, so an old/buggy build or a tampered store
   * could carry entries outside the current enum. Keep only the known 'upscale' | 'deblur' tokens
   * (in their persisted order); a non-array or an all-junk array yields undefined so the caller
   * falls back to the marker-derived default order.
   */
  validateBakeOrder(saved: unknown): ('upscale' | 'deblur')[] | undefined {
    if (!Array.isArray(saved)) return undefined;
    const filtered = saved.filter((e): e is 'upscale' | 'deblur' => e === 'upscale' || e === 'deblur');
    return filtered.length > 0 ? filtered : undefined;
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
    // POST-BAKE REDIRECT (Z1). A baked upscale/deblur has reset the pipeline modules to neutral
    // (their pre-bake edits are incorporated into the new base pixels). A normal flush of that
    // neutral state would clobber the user's PRE-bake saved edits — so instead of SUPPRESSING the
    // save (the pre-Z1 behavior), we REDIRECT it: the current post-bake module state is written into
    // `editsOnBakedBase` on top of the FROZEN pre-bake top-level captured at bake time, leaving the
    // pre-bake `modules` + intent markers untouched. On reopen + re-apply these edits replay on top
    // of the re-derived baked base.
    if (imageService.isBakedUpscaleActive() || imageService.isBakedDeblurActive()) {
      // Safety: no captured pre-bake state (should not happen — the bake writers set it). Do NOT
      // fall through to a normal flush, which would clobber the pre-bake modules with neutral state.
      if (!this.bakedBaseState) return;
      // STACKED bake live → the redirect is suspended (see the stackedBakeActive doc): post-second-
      // bake edits are in-session only, and disk stays frozen at the FIRST bake's state.
      if (this.stackedBakeActive) return;
      const edits = this.currentBakedEdits();
      const editsJson = JSON.stringify(edits);
      if (editsJson === this.bakedEditsBaseline) return; // post-bake state unchanged — nothing new
      this.bakedEditsBaseline = editsJson;
      const state: EditState = { ...this.bakedBaseState, editsOnBakedBase: edits };
      this.baseline = JSON.stringify(state);
      this.write(img.filePath, state);
      return;
    }
    const json = JSON.stringify(this.serialize());
    if (json === this.baseline) return; // unchanged since load — nothing to persist
    this.baseline = json;
    this.write(img.filePath, JSON.parse(json));
  }

  /** Persist `state` under the current image's key, deep-cloned so no live reference leaks into the
   *  store and any `undefined` fields are dropped. Single write path for flush/persist* callers. */
  private write(filePath: string, state: EditState): void {
    try {
      window.electronAPI!.storeSet(this.keyForPath(filePath), JSON.parse(JSON.stringify(state)));
    } catch (e) {
      logger.warn('persist write failed', e);
    }
  }

  /** The current (post-bake) module + LA edits, in the `editsOnBakedBase` shape. */
  private currentBakedEdits(): EditState['editsOnBakedBase'] {
    const s = this.serialize();
    return { modules: s.modules, localAdjustments: s.localAdjustments };
  }

  /** Freeze `diskState` (the just-written pre-bake top-level) as the redirect base, and snapshot the
   *  current post-bake edits as the baseline so an UNTOUCHED post-bake flush writes nothing. */
  private setBakedBaseline(diskState: EditState): void {
    const { editsOnBakedBase: _omit, ...rest } = diskState;
    void _omit;
    this.bakedBaseState = rest;
    this.bakedEditsBaseline = JSON.stringify(this.currentBakedEdits());
    this.baseline = JSON.stringify(rest);
  }

  /**
   * Apply a persisted `editsOnBakedBase` (post-bake module + LA edits) to the ALREADY-RE-BAKED
   * pipeline during a reopen re-apply, so the user gets back exactly the post-bake edits they had
   * last session. Routes through the same restore() path as a normal edit-state apply; does NOT
   * itself persist — the caller triggers a reprocess and a flush (which the redirect path writes).
   */
  applyPostBakeEdits(edits: NonNullable<EditState['editsOnBakedBase']>, width: number, height: number): void {
    this.restore({ version: STORE_VERSION, modules: edits.modules, localAdjustments: edits.localAdjustments }, width, height);
  }

  /**
   * Suspend the flush REDIRECT because a bake just STACKED onto an already-live bake (Z1 review
   * MEDIUM — see the stackedBakeActive field doc for the full corner). Called by EnhanceService
   * INSTEAD of a persist writer for the second (and any deeper) bake level: nothing is written,
   * disk keeps the FIRST bake's pre-bake modules + intent + frozen editsOnBakedBase, and subsequent
   * flushes write nothing until the stack unwinds back to a single level
   * (resumeRedirectAfterStackedUnwind re-enables).
   */
  suspendRedirectForStackedBake(): void {
    this.stackedBakeActive = true;
  }

  /**
   * A partial unwind has landed on the SINGLE remaining (first) bake level: resume the flush
   * redirect WITHOUT writing anything (Z1 re-review MEDIUM). Stacked levels never persisted, so the
   * disk ALREADY holds exactly this level's correct state — the frozen pre-bake top-level, its
   * intent marker(s), and any editsOnBakedBase made between the bakes (they belong to THIS level
   * and stay valid). The S1-era persistNow write here was not just unnecessary but HARMFUL:
   * serialize() reflects the just-restored POPPED level's edit state (the post-first-bake params,
   * or pure neutral), so writing it clobbered the pre-first-bake modules and dropped
   * editsOnBakedBase — durably losing the user's grading (reviewer repro: edit → upscale → edit →
   * deblur → revert once). bakedBaseState/bakedEditsBaseline still hold the first bake's frozen
   * snapshot, so clearing the suspension re-arms the redirect correctly. Bonus self-heal: if a
   * between-bakes edit never reached disk (its 800ms debounced flush lost the race to the second
   * bake's suspension), the next flush redirect-writes the restored params as editsOnBakedBase.
   *
   * DISK-MARKER NOTE (documented micro-decision): skipping the write also means a remaining-top-
   * DEBLUR pop keeps any UNAPPLIED upscale marker on disk (the in-session store clears
   * upscaleIntent, but the disk state — written by persistBakedDeblurIntent's fold — still offers
   * the unapplied upscale on reopen). That is the better outcome: the unapplied intent was never
   * consumed by this session, so erasing it would have lost a still-valid re-apply offer.
   */
  resumeRedirectAfterStackedUnwind(): void {
    this.stackedBakeActive = false;
  }

  /**
   * Durably re-attach post-bake edits to the persisted state (Z1 review LOW + replay write).
   * Two callers in the reopen re-apply flow (EnhanceModuleComponent.handleReapply):
   *  (a) SUCCESS — after the bakes replayed and applyPostBakeEdits restored the edits, this writes
   *      them back to disk deterministically (each bake's persist write had consumed the field);
   *  (b) MID-REPLAY FAILURE — a later bake threw AFTER an earlier bake's persist already consumed
   *      editsOnBakedBase from disk; re-attaching the already-read edits keeps them recoverable by
   *      a retry or the next reopen instead of silently dropping them.
   * Writes {frozen pre-bake top-level, editsOnBakedBase} and re-seeds the baselines (so an
   * unchanged follow-up flush writes nothing). No-ops when NO bake persisted this session
   * (bakedBaseState null — the disk was never touched, so the edits are still there).
   */
  persistPostBakeEdits(edits: NonNullable<EditState['editsOnBakedBase']>): void {
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    if (!this.bakedBaseState) return;
    const state: EditState = { ...this.bakedBaseState, editsOnBakedBase: edits };
    // Seed the redirect baseline from the LIVE pipeline (not from `edits`): "nothing new to redirect
    // since this write". Critical for the failure path — the read edits were NOT applied to the
    // pipeline there, so seeding from `edits` would make the app-close flush see the (neutral)
    // post-bake pipeline as a change and overwrite the just-re-attached edits. A REAL later edit
    // still overwrites them — the correct two-timelines invalidation.
    this.bakedEditsBaseline = JSON.stringify(this.currentBakedEdits());
    this.baseline = JSON.stringify(state);
    this.write(img.filePath, state);
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
    // Rebuild the marker set from the explicit args + the store (the single source of truth) rather
    // than inheriting whatever serialize() froze into baseState — so a stale marker can't leak.
    // Folding the store's deblurIntent preserves an UNAPPLIED (reopened, not-yet-re-applied) deblur
    // intent instead of erasing it — this writer never runs while a deblur bake is LIVE (a stacked
    // bake skips persistence entirely; see suspendRedirectForStackedBake).
    const state: EditState = this.withStackMarkers(baseState, { scale, mode }, useAppStore.getState().deblurIntent);
    // Freeze this as the post-bake redirect base so subsequent post-bake edits write into
    // editsOnBakedBase rather than clobbering these pre-bake modules.
    this.setBakedBaseline(state);
    this.write(img.filePath, state);
  }

  /**
   * Deblur mirror of persistBakedUpscaleIntent (Z1). Persists the PRE-deblur edit state plus the
   * `bakedDeblur` presence marker for the current image: flush() redirects while a bake is live, so
   * THIS is the single write that captures the durable deblur intent. `baseState` is the serialize()
   * snapshot taken BEFORE the bake reset the modules, so a reopen restores the user's real pre-deblur
   * edits (the deblurred pixels re-derive on re-apply). Folds in an UNAPPLIED upscale intent from the
   * store (this writer never runs while an upscale bake is LIVE — a stacked bake skips persistence;
   * see suspendRedirectForStackedBake), and freezes the post-bake redirect base (setBakedBaseline).
   */
  persistBakedDeblurIntent(baseState: EditState): void {
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    const store = useAppStore.getState();
    const upscale = store.upscaleIntent ? { scale: store.upscaleIntent.scale, mode: store.upscaleIntent.mode } : undefined;
    const state: EditState = this.withStackMarkers(baseState, upscale, true);
    this.setBakedBaseline(state);
    this.write(img.filePath, state);
  }

  /**
   * Build a persist state = baseState's pre-bake modules/LA/rawDecodeOptions + a clean bake-marker
   * set (`bakedUpscale` from `upscale`, `bakedDeblur` from `deblur`, `bakeOrder` from the store when
   * stacked). Strips any stale markers serialize() may have frozen into baseState.
   */
  private withStackMarkers(baseState: EditState, upscale?: BakedUpscaleIntent, deblur = false): EditState {
    const out: EditState = { version: baseState.version ?? STORE_VERSION, modules: baseState.modules };
    if (baseState.localAdjustments) out.localAdjustments = baseState.localAdjustments;
    if (baseState.rawDecodeOptions) out.rawDecodeOptions = baseState.rawDecodeOptions;
    if (upscale) out.bakedUpscale = { scale: upscale.scale, mode: upscale.mode };
    if (deblur) out.bakedDeblur = {};
    const order = useAppStore.getState().bakeOrder;
    if (order.length > 1) out.bakeOrder = [...order];
    return out;
  }

  /**
   * Force-persist the current pipeline state for the current image NOW, bypassing the baseline-diff
   * short-circuit (but re-seeding the baseline). SINGLE production caller: EnhanceService's
   * _popAndRestore FULL unwind to the native base — the bake markers and store intents are already
   * cleared, so serialize() emits a marker-free state, durably erasing a previously-persisted
   * intent, and the post-bake redirect machinery is reset so a normal flush resumes.
   *
   * The S1-era PARTIAL-unwind write was REMOVED (Z1 re-review MEDIUM): stacked levels never
   * persist, so at any partial landing the disk already holds the FIRST bake's correct state —
   * writing serialize() (the just-restored popped-level params) there clobbered the pre-first-bake
   * modules and dropped editsOnBakedBase. Partial landings now go through
   * resumeRedirectAfterStackedUnwind (no write) instead. Do NOT call this while a bake marker is
   * live — it would persist the post-bake (neutral) module state over the pre-bake saved edits.
   */
  persistNow(): void {
    const img = imageService.getCurrentImage();
    if (!img?.filePath || !window.electronAPI?.storeSet) return;
    const cur = this.serialize();
    this.baseline = JSON.stringify(cur);
    this.bakedBaseState = null;
    this.bakedEditsBaseline = '';
    this.stackedBakeActive = false;
    this.write(img.filePath, cur);
  }
}

export const editPersistenceService = new EditPersistenceService();
