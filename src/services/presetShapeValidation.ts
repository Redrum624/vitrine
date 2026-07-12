/**
 * Import-time shape validation for presets — the single trust boundary for user-supplied
 * preset JSON (round-10 H1, round-9 re-review LOW).
 *
 * App-created presets are always well-formed (captureCurrentSettings emits complete
 * blocks), so PresetService.importPresets is the only route for malformed settings to
 * enter the store. The concrete failure this guards: a PARTIAL lensCorrections block
 * (e.g. vignetting only) wholesale-replaces LensCorrectionsPipelineModule's nested
 * params on apply, after which the derived `isEnabled` getter dereferences the missing
 * sections and throws — outside process()'s try and in the pipeline's isModuleActive.
 *
 * Policy:
 * - UNKNOWN settings keys are tolerated verbatim (forward compat with newer exports).
 * - Each KNOWN block must type-check structurally; a failing block is DROPPED (the
 *   block, not the preset) and reported so the caller can warn per preset.
 * - lensCorrections specifically must carry ALL six sections fully shaped (the getter
 *   dereferences every one of them) — anything less is dropped.
 * - Other known blocks are partial-tolerant (their module setters merge), but any
 *   field that IS present and known must carry the right primitive type.
 * - Presets that can't be salvaged at all (bad id/name, non-object settings) are
 *   rejected outright with a reason.
 */
import type { AdjustmentPreset, PresetSettings } from './PresetService';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
// JSON.parse can still yield Infinity via literals like 1e999 — require finite.
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown): boolean => typeof v === 'boolean';
const str = (v: unknown): v is string => typeof v === 'string';

type Check = (v: unknown) => boolean;

/** Known fields may be ABSENT (module setters merge), but when present must type-check. */
function typedIfPresent(v: unknown, fields: Record<string, Check>): boolean {
  if (!isObj(v)) return false;
  return Object.entries(fields).every(([key, check]) => v[key] === undefined || check(v[key]));
}

const curvePoints: Check = (v) =>
  Array.isArray(v) && v.every((pt) => isObj(pt) && num(pt.x) && num(pt.y));

const cmySection: Check = (v) =>
  isObj(v) && num(v.cyan_red) && num(v.magenta_green) && num(v.yellow_blue);

// The tonecurve/colorbalance blocks are captured by spreading the module's getParams()
// output (ToneCurveModule.getParams → ToneCurveParams, ColorBalanceModule.getParams →
// ColorBalanceParams), NOT the stale `curves`/`preserveLuminosity` shape declared on
// PresetSettings. Validate the REAL captured keys so these validators aren't vacuous on
// actual exported presets (round-10 H2 finding #9).
const rgbCurveObj: Check = (v) =>
  typedIfPresent(v, { red: curvePoints, green: curvePoints, blue: curvePoints });

const rgbNodesObj: Check = (v) =>
  typedIfPresent(v, { red: num, green: num, blue: num });

// 8-color HSL controls ColorBalanceModule captures: <color>_saturation/_luminance/_hue.
const HSL_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'] as const;
const colorBalanceHslFields: Record<string, Check> = Object.fromEntries(
  HSL_COLORS.flatMap((c) => [
    [`${c}_saturation`, num],
    [`${c}_luminance`, num],
    [`${c}_hue`, num],
  ])
);

/**
 * The one block that must be COMPLETE: LensCorrectionsPipelineModule.setParameters
 * replaces `lensCorrectionsParams` wholesale and the derived isEnabled getter reads
 * `enabled` off every section, so all six must be present and fully shaped.
 */
function validLensCorrections(b: unknown): boolean {
  if (!isObj(b)) return false;
  if (b.enabled !== undefined && !bool(b.enabled)) return false;
  const v = b.vignetting;
  const d = b.distortion;
  const ca = b.chromaticAberration;
  const pr = b.profile;
  const bl = b.blur;
  const fg = b.filmGrain;
  return (
    isObj(v) && bool(v.enabled) && num(v.amount) && num(v.midpoint) && num(v.roundness) && num(v.feather) &&
    isObj(d) && bool(d.enabled) && num(d.barrel) && num(d.scale) &&
    isObj(d.perspective) && num(d.perspective.horizontal) && num(d.perspective.vertical) &&
    isObj(ca) && bool(ca.enabled) && num(ca.redCyan) && num(ca.blueMagenta) &&
    isObj(ca.purple) && num(ca.purple.amount) && num(ca.purple.hue) && num(ca.purple.range) &&
    isObj(ca.green) && num(ca.green.amount) && num(ca.green.hue) && num(ca.green.range) &&
    isObj(pr) && bool(pr.enabled) && bool(pr.autoDetect) && str(pr.profileName) && num(pr.strength) &&
    isObj(bl) && bool(bl.enabled) && num(bl.radius) &&
    isObj(fg) && bool(fg.enabled) && num(fg.amount) && num(fg.size)
  );
}

const presetLayer: Check = (l) =>
  isObj(l) && str(l.name) && str(l.type) && bool(l.enabled) && num(l.opacity) &&
  (l.geometry === undefined || isObj(l.geometry)) &&
  (l.basicAdj === undefined || isObj(l.basicAdj)) &&
  (l.parameters === undefined || isObj(l.parameters));

/** Structural validators for every KNOWN settings block (mirrors PresetSettings). */
const KNOWN_BLOCK_VALIDATORS: Record<string, Check> = {
  lensCorrections: validLensCorrections,
  exposure: (b) => typedIfPresent(b, {
    enabled: bool, mode: str, black: num, exposure: num,
    deflicker_percentile: num, compensate_exposure_bias: bool
  }),
  whiteBalance: (b) => typedIfPresent(b, {
    enabled: bool, temperature: num, tint: num, preset: str
  }),
  basicAdjustments: (b) => typedIfPresent(b, {
    enabled: bool, black_point: num, exposure: num, contrast: num,
    brightness: num, saturation: num, vibrance: num
  }),
  toneCurve: (b) => typedIfPresent(b, {
    enabled: bool,
    baseCurve: curvePoints, baseCurveNodes: num, baseCurveType: num,
    rgbCurve: rgbCurveObj, rgbCurveNodes: rgbNodesObj,
    exposureFusion: num, exposureStops: num, preserveColors: num,
    autoLevels: bool, autoContrast: bool
  }),
  colorBalance: (b) => typedIfPresent(b, {
    enabled: bool, shadows: cmySection, midtones: cmySection, highlights: cmySection,
    ...colorBalanceHslFields
  }),
  shadowsHighlights: (b) => typedIfPresent(b, {
    enabled: bool, shadows: num, highlights: num, shadowsRadius: num, highlightsRadius: num,
    shadowsColorTransfer: num, highlightsColorTransfer: num, whitePoint: num, blackPoint: num,
    compressHighlights: num, compressShadows: num
  }),
  localAdjustments: (b) => typedIfPresent(b, {
    enabled: bool, layerCount: num,
    layers: (v) => Array.isArray(v) && v.every(presetLayer)
  }),
  highlightRecovery: (b) => typedIfPresent(b, { enabled: bool, strength: num })
};

const CATEGORIES: ReadonlySet<string> = new Set(
  ['portrait', 'landscape', 'street', 'bw', 'vintage', 'cinematic', 'custom']
);

export type SanitizedPresetResult =
  | { ok: true; preset: AdjustmentPreset; droppedBlocks: string[] }
  | { ok: false; name: string; reason: string };

/**
 * Validate + normalize one imported preset. Returns a sanitized COPY (never the raw
 * object): known-invalid settings blocks removed (listed in droppedBlocks), unknown
 * blocks preserved, and presentation fields (description/tags/category/metadata)
 * normalized so downstream consumers (searchPresets, applyPreset stats) can't throw
 * on missing fields.
 */
export function sanitizeImportedPreset(raw: unknown): SanitizedPresetResult {
  const name = isObj(raw) && str(raw.name) && raw.name.length > 0 ? raw.name : 'unnamed';

  if (!isObj(raw)) return { ok: false, name, reason: 'preset is not an object' };
  if (!str(raw.id) || raw.id.length === 0) return { ok: false, name, reason: 'missing or invalid id' };
  if (!str(raw.name) || raw.name.length === 0) return { ok: false, name, reason: 'missing or invalid name' };
  if (!isObj(raw.settings)) return { ok: false, name, reason: 'settings is not an object' };

  const settings = { ...raw.settings } as PresetSettings;
  const droppedBlocks: string[] = [];
  for (const [block, valid] of Object.entries(KNOWN_BLOCK_VALIDATORS)) {
    if (settings[block] !== undefined && !valid(settings[block])) {
      delete settings[block];
      droppedBlocks.push(block);
    }
  }

  const md = isObj(raw.metadata) ? raw.metadata : {};
  const preset: AdjustmentPreset = {
    id: raw.id,
    name: raw.name,
    description: str(raw.description) ? raw.description : '',
    ...(str(raw.author) ? { author: raw.author } : {}),
    category: str(raw.category) && CATEGORIES.has(raw.category)
      ? (raw.category as AdjustmentPreset['category'])
      : 'custom',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(str) : [],
    createdAt: str(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
    modifiedAt: str(raw.modifiedAt) ? raw.modifiedAt : new Date().toISOString(),
    ...(str(raw.thumbnail) ? { thumbnail: raw.thumbnail } : {}),
    settings,
    metadata: {
      version: str(md.version) ? md.version : '1.0.0',
      compatibility: Array.isArray(md.compatibility) ? md.compatibility.filter(str) : [],
      ...(num(md.imageCount) ? { imageCount: md.imageCount as number } : {}),
      ...(num(md.rating) ? { rating: md.rating as number } : {})
    }
  };

  return { ok: true, preset, droppedBlocks };
}
