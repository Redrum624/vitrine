import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { imageService } from './ImageService';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import type { MaskGeometry } from '../modules/LocalAdjustmentsModule';
import { logger } from '../utils/Logger';
import { useAppStore } from '../stores/appStore';
import type { RawDecodeOptions } from '../types/electron';

const STORE_VERSION = 1;

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
    return (await this.getSavedEditState(path))?.rawDecodeOptions ?? null;
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
    if (imageService.isBakedUpscaleActive()) return;
    const json = JSON.stringify(this.serialize());
    if (json === this.baseline) return; // unchanged since load — nothing to persist
    this.baseline = json;
    try {
      window.electronAPI.storeSet(this.keyForPath(img.filePath), JSON.parse(json));
    } catch (e) {
      logger.warn('flush save failed', e);
    }
  }
}

export const editPersistenceService = new EditPersistenceService();
