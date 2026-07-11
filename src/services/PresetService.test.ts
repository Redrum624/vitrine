/**
 * Preset round-trip for Local Adjustments layers.
 *
 * Before this suite, PresetService captured only a `layerCount` for local
 * adjustments and its apply path `continue`d over the module entirely — so a
 * preset silently DROPPED every radial/gradient mask on both capture and apply.
 * These tests drive the real pipeline LA module through a full round-trip
 * (build layers → capture preset → clear → apply → assert geometry + params),
 * plus the brush-exclusion note and legacy-preset (no `layers` array) safety.
 */
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { presetService } from './PresetService';
import type { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import type { MaskGeometry } from '../modules/LocalAdjustmentsModule';

const W = 120;
const H = 80;

function getLA(): LocalAdjustmentsPipelineModule {
  return imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments')!;
}

function clearLA(la: LocalAdjustmentsPipelineModule): void {
  for (const l of [...la.getParameters().layers]) la.removeLayer(l.id);
  la.disable();
}

describe('PresetService — Local Adjustments round-trip', () => {
  beforeEach(() => {
    clearLA(getLA());
  });

  afterEach(() => {
    clearLA(getLA());
  });

  test('captures + applies radial and gradient layers with geometry and params', () => {
    const la = getLA();

    const radialGeom: MaskGeometry = {
      type: 'radial', centerX: 0.4, centerY: 0.6, radiusX: 0.25, radiusY: 0.35,
      startX: 0, startY: 0, endX: 1, endY: 1, feather: 0.4, invert: false, rotation: 0.2,
    };
    const radialId = la.createLayer('radial_gradient', 'Radial', W, H);
    la.setLayerGeometry(radialId, radialGeom, W, H);
    la.updateLayerParameters(radialId, { exposure: 0.5, saturation: 30 });
    la.updateLayerOpacity(radialId, 0.8);

    const gradGeom: MaskGeometry = {
      type: 'linear', centerX: 0.5, centerY: 0.3, radiusX: 0.3, radiusY: 0.3,
      startX: 0.5, startY: 0.1, endX: 0.5, endY: 0.9, feather: 0.7, invert: true, rotation: 0,
    };
    const gradId = la.createLayer('linear_gradient', 'Grad', W, H);
    la.setLayerGeometry(gradId, gradGeom, W, H);
    la.updateLayerParameters(gradId, { contrast: -20, temperature: 15 });
    la.enable();

    // Snapshot what we built, then create a preset from the current pipeline.
    const built = [...la.getParameters().layers].map((l) => ({
      name: l.name, type: l.type, geometry: l.geometry, parameters: { ...l.parameters }, opacity: l.opacity,
    }));
    expect(built).toHaveLength(2);

    const presetId = presetService.createPresetFromCurrent('LA Look', 'radial+grad', 'custom', []);
    const preset = presetService.getPreset(presetId)!;
    expect(preset.settings.localAdjustments?.layers).toHaveLength(2);

    // Reset local adjustments entirely, then apply the preset.
    clearLA(la);
    expect(la.getParameters().layers).toHaveLength(0);

    expect(presetService.applyPreset(presetId)).toBe(true);

    const restored = la.getParameters().layers;
    expect(restored).toHaveLength(2);

    // Apply must preserve layer ORDER (not just membership) — index into the
    // restored array directly rather than looking layers up by name.
    expect(restored[0].name).toBe('Radial');
    expect(restored[1].name).toBe('Grad');

    const r = restored[0];
    expect(r.type).toBe('radial_gradient');
    expect(r.geometry).toEqual(radialGeom);
    expect(r.parameters.exposure).toBe(0.5);
    expect(r.parameters.saturation).toBe(30);
    expect(r.opacity).toBeCloseTo(0.8);
    expect(r.enabled).toBe(true);

    const g = restored[1];
    expect(g.type).toBe('linear_gradient');
    expect(g.geometry).toEqual(gradGeom);
    expect(g.parameters.contrast).toBe(-20);
    expect(g.parameters.temperature).toBe(15);

    // The module is re-enabled so the restored masks actually render.
    expect(la.getParameters().enabled).toBe(true);

    presetService.deletePreset(presetId);
  });

  test('excludes brush layers from capture and flags them as unportable', () => {
    const la = getLA();
    la.createLayer('brush', 'Brush', W, H);
    la.createLayer('radial_gradient', 'Keep', W, H);
    la.enable();

    expect(presetService.hasUnportableBrushLayers()).toBe(true);

    const presetId = presetService.createPresetFromCurrent('Mixed', '', 'custom', []);
    const layers = presetService.getPreset(presetId)!.settings.localAdjustments!.layers!;
    expect(layers).toHaveLength(1);
    expect(layers.every((l) => l.type !== 'brush')).toBe(true);

    presetService.deletePreset(presetId);
  });

  test('hasUnportableBrushLayers is false when no brush layers exist', () => {
    const la = getLA();
    la.createLayer('radial_gradient', 'R', W, H);
    la.enable();
    expect(presetService.hasUnportableBrushLayers()).toBe(false);
  });

  test('applying a legacy preset (no layers array) leaves current LA untouched', () => {
    const la = getLA();
    la.createLayer('radial_gradient', 'Keep', W, H);
    la.enable();
    const before = la.getParameters().layers.length;

    // Legacy shape: pre-layer-capture presets stored only { enabled, layerCount }.
    const legacy = {
      version: '1.0.0',
      presets: [{
        id: 'legacy_la_preset',
        name: 'Legacy',
        description: '',
        category: 'custom',
        tags: [],
        createdAt: '', modifiedAt: '',
        settings: { localAdjustments: { enabled: true, layerCount: 3 } },
        metadata: { version: '1.0.0', compatibility: ['1.0.0'] },
      }],
    };
    presetService.importPresets(JSON.stringify(legacy));

    expect(presetService.applyPreset('legacy_la_preset')).toBe(true);
    // No `layers` array in the preset → LA is left exactly as it was (no crash, no wipe).
    expect(la.getParameters().layers.length).toBe(before);

    presetService.deletePreset('legacy_la_preset');
  });

  test('applying a preset with no `localAdjustments` key at all leaves current LA untouched', () => {
    const la = getLA();
    la.createLayer('radial_gradient', 'Keep', W, H);
    la.enable();
    const before = [...la.getParameters().layers];

    // Preset shape with the `localAdjustments` key entirely absent from settings
    // (not just an empty/legacy sub-shape) — e.g. a preset that never touched LA.
    const noLaKey = {
      version: '1.0.0',
      presets: [{
        id: 'no_la_key_preset',
        name: 'No LA Key',
        description: '',
        category: 'custom',
        tags: [],
        createdAt: '', modifiedAt: '',
        settings: {},
        metadata: { version: '1.0.0', compatibility: ['1.0.0'] },
      }],
    };
    presetService.importPresets(JSON.stringify(noLaKey));

    expect(presetService.applyPreset('no_la_key_preset')).toBe(true);
    expect(la.getParameters().layers.length).toBe(before.length);
    expect(la.getParameters().layers.map((l) => l.id)).toEqual(before.map((l) => l.id));

    presetService.deletePreset('no_la_key_preset');
  });

  test('applying a preset with an explicit empty `layers: []` leaves current LA untouched', () => {
    const la = getLA();
    la.createLayer('radial_gradient', 'Keep', W, H);
    la.enable();
    const before = [...la.getParameters().layers];

    // localAdjustments IS present but explicitly carries zero layers — must be a
    // no-op on the target's current layers, not a wipe.
    const emptyLayers = {
      version: '1.0.0',
      presets: [{
        id: 'empty_layers_preset',
        name: 'Empty Layers',
        description: '',
        category: 'custom',
        tags: [],
        createdAt: '', modifiedAt: '',
        settings: { localAdjustments: { enabled: true, layers: [] } },
        metadata: { version: '1.0.0', compatibility: ['1.0.0'] },
      }],
    };
    presetService.importPresets(JSON.stringify(emptyLayers));

    expect(presetService.applyPreset('empty_layers_preset')).toBe(true);
    expect(la.getParameters().layers.length).toBe(before.length);
    expect(la.getParameters().layers.map((l) => l.id)).toEqual(before.map((l) => l.id));

    presetService.deletePreset('empty_layers_preset');
  });
});
