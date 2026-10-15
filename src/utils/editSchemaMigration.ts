/**
 * Versioned, idempotent migration of saved edit data (v1.40.0, Task 12a).
 *
 * Two semantics changed together; saved edits must keep their LOOK/DIRECTION:
 *  1. Linear-mask Feather was inverted (ramp width D = 1 - feather). It is now D = feather
 *     (higher = softer, like radial)  =>  feather' = 1 - feather, clamped to the 0.01..1 slider.
 *  2. Lens "Vignetting" amount was a lens CORRECTION (+ brightened the edges). It is now a creative
 *     vignette (+ darkens)  =>  amount' = -amount (each edit keeps its direction; the new falloff reaches
 *     further into the frame, so the strength may differ - accepted).
 *
 * Idempotence: every migrated EditState / preset is stamped `schema` / `settingsSchema` =
 * EDIT_SCHEMA_CURRENT; anything carrying that stamp is returned untouched. Inputs are never mutated.
 * Callers: EditPersistenceService.restore + getSavedEditState (edit store, history checkpoints,
 * post-bake edits) and PresetService (stored / imported presets).
 */
export const EDIT_SCHEMA_CURRENT = 2;
export const FEATHER_MIN = 0.01; // the Feather slider range is 0.01..1

interface GeomLike { type?: string; feather?: number }
interface LayerLike { geometry?: GeomLike }
interface LayersBlock { layers?: LayerLike[] }

/** feather' = 1 - feather for LINEAR geometry only; radial / anything else is returned as-is. */
export function migrateLinearFeather<T>(geom: T): T {
  const g = geom as unknown as GeomLike | undefined;
  if (!g || g.type !== 'linear' || typeof g.feather !== 'number' || !Number.isFinite(g.feather)) return geom;
  return { ...g, feather: Math.min(1, Math.max(FEATHER_MIN, 1 - g.feather)) } as unknown as T;
}

function migrateLayersBlock<T>(block: T): T {
  const b = block as unknown as LayersBlock | undefined;
  if (!b || !Array.isArray(b.layers)) return block;
  return {
    ...b,
    layers: b.layers.map((l) => (l && l.geometry ? { ...l, geometry: migrateLinearFeather(l.geometry) } : l)),
  } as unknown as T;
}

interface VignLike { amount?: number }
function negateVignette<T extends VignLike | undefined>(v: T): T {
  if (!v || typeof v.amount !== 'number' || !Number.isFinite(v.amount) || v.amount === 0) return v;
  return { ...v, amount: -v.amount };
}

/** Handles every container shape that carries a vignetting block: preset-flat `{vignetting}`, the
 *  pipeline getParams `{lensCorrectionsParams:{vignetting}, lensCorrections:{vignetting}}`. */
function migrateLensContainer<T extends object | undefined>(container: T): T {
  if (!container || typeof container !== 'object') return container;
  const out = { ...container } as Record<string, unknown>;
  if (out.vignetting) out.vignetting = negateVignette(out.vignetting as VignLike);
  for (const key of ['lensCorrectionsParams', 'lensCorrections']) {
    const inner = out[key] as Record<string, unknown> | undefined;
    if (inner && typeof inner === 'object' && inner.vignetting) {
      out[key] = { ...inner, vignetting: negateVignette(inner.vignetting as VignLike) };
    }
  }
  return out as T;
}

interface ModulesAndLa {
  modules?: Record<string, Record<string, unknown>>;
  localAdjustments?: LayersBlock;
}

function migrateBlock<T>(block: T): T {
  const b = block as unknown as ModulesAndLa;
  const out: ModulesAndLa = { ...b };
  if (b.modules) {
    const modules = { ...b.modules };
    if (modules.lenscorrections) modules.lenscorrections = migrateLensContainer(modules.lenscorrections);
    out.modules = modules;
  }
  if (b.localAdjustments) out.localAdjustments = migrateLayersBlock(b.localAdjustments);
  return out as unknown as T;
}

/** Migrate a persisted / checkpointed EditState. Already-current states are returned as the same object. */
export function migrateEditState<T>(state: T): T {
  if (!state || typeof state !== 'object') return state;
  const st = state as unknown as ModulesAndLa & { schema?: number; editsOnBakedBase?: ModulesAndLa };
  if ((st.schema ?? 1) >= EDIT_SCHEMA_CURRENT) return state;
  const out = migrateBlock(st);
  if (st.editsOnBakedBase) out.editsOnBakedBase = migrateBlock(st.editsOnBakedBase);
  out.schema = EDIT_SCHEMA_CURRENT;
  return out as unknown as T;
}

interface PresetSettingsLike {
  lensCorrections?: object;
  localAdjustments?: LayersBlock;
}

/** Migrate a preset's `settings` object (caller owns the `settingsSchema` stamp / idempotence check). */
export function migratePresetSettings<T>(settings: T): T {
  if (!settings || typeof settings !== 'object') return settings;
  const s = settings as unknown as PresetSettingsLike;
  const out: PresetSettingsLike = { ...s };
  if (s.lensCorrections) out.lensCorrections = migrateLensContainer(s.lensCorrections);
  if (s.localAdjustments) out.localAdjustments = migrateLayersBlock(s.localAdjustments);
  return out as unknown as T;
}
