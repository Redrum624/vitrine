/* eslint-disable @typescript-eslint/no-explicit-any */
import { editPersistenceService } from '../services/EditPersistenceService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { presetService } from '../services/PresetService';
import { EDIT_SCHEMA_CURRENT } from '../utils/editSchemaMigration';
import type { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import type { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';

const lens = () => imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!;
const la = () => imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments')!;

const linearGeom = (feather: number) => ({ type: 'linear', centerX: .5, centerY: .5, radiusX: .3, radiusY: .3, startX: .5, startY: .15, endX: .5, endY: .85, feather, invert: false, rotation: 0 });
const radialGeom = (feather: number) => ({ ...linearGeom(feather), type: 'radial' });

function legacyState(): any {
  const base = JSON.parse(JSON.stringify(editPersistenceService.serialize()));
  delete base.schema; // an edit saved before v1.40.0 carries no schema marker
  base.modules.lenscorrections.lensCorrectionsParams.vignetting = { enabled: true, amount: 30, midpoint: 1, roundness: 0, feather: 50 };
  base.modules.lenscorrections.lensCorrections = { vignetting: { enabled: true, amount: 30, midpoint: 1, roundness: 0, feather: 50 } };
  base.localAdjustments = { enabled: true, layers: [
    { name: 'lin', type: 'linear_gradient', enabled: true, opacity: 1, geometry: linearGeom(0.2) },
    { name: 'rad', type: 'radial_gradient', enabled: true, opacity: 1, geometry: radialGeom(0.2) },
  ] };
  return base;
}

describe('edit schema migration - persistence funnel', () => {
  afterEach(() => { imageProcessingPipeline.resetAllModules(); });

  it('restore() of a legacy state migrates once; re-serialize then restore does not migrate again', () => {
    editPersistenceService.restore(legacyState(), 100, 100);
    expect((lens().getParameters().lensCorrectionsParams.vignetting.amount)).toBe(-30);
    const feathers = la().getParameters().layers.map((l) => l.geometry!.feather);
    expect(feathers[0]).toBeCloseTo(0.8, 6); // linear flipped
    expect(feathers[1]).toBe(0.2);           // radial untouched

    // Save -> reopen cycle: serialize stamps the current schema, so the second restore is a no-op.
    const saved = JSON.parse(JSON.stringify(editPersistenceService.serialize()));
    expect(saved.schema).toBe(EDIT_SCHEMA_CURRENT);
    imageProcessingPipeline.resetAllModules();
    editPersistenceService.restore(saved, 100, 100);
    expect((lens().getParameters().lensCorrectionsParams.vignetting.amount)).toBe(-30);
    expect(la().getParameters().layers[0].geometry!.feather).toBeCloseTo(0.8, 6);
    expect(la().getParameters().layers[1].geometry!.feather).toBe(0.2);
  });

  it('getSavedEditState migrates the stored state and restoring the result does not double-apply', async () => {
    const stored = legacyState();
    (window as any).electronAPI = { storeGet: jest.fn(async () => JSON.parse(JSON.stringify(stored))) };
    try {
      const got = await editPersistenceService.getSavedEditState('C:/x.orf');
      expect(got!.schema).toBe(EDIT_SCHEMA_CURRENT);
      editPersistenceService.restore(got!, 100, 100);
      expect((lens().getParameters().lensCorrectionsParams.vignetting.amount)).toBe(-30);
      expect(la().getParameters().layers[0].geometry!.feather).toBeCloseTo(0.8, 6);
    } finally {
      delete (window as any).electronAPI;
    }
  });
});

describe('edit schema migration - presets', () => {
  const KEY = 'photo_editor_presets';
  afterEach(() => { localStorage.removeItem(KEY); });

  it('a legacy imported preset is migrated once and exports stamped (re-import does not migrate again)', () => {
    const legacy = {
      version: '1.0.0',
      presets: [{
        id: 'legacy_vig', name: 'Legacy vignette', description: '', category: 'custom', tags: [],
        createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
        settings: {
          lensCorrections: {
            enabled: true,
            vignetting: { enabled: true, amount: 40, midpoint: 1, roundness: 0, feather: 50 },
            distortion: { enabled: false, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1 },
            chromaticAberration: { enabled: false, redCyan: 0, blueMagenta: 0, purple: { amount: 0, hue: 300, range: 10 }, green: { amount: 0, hue: 60, range: 10 } },
            profile: { enabled: false, autoDetect: true, profileName: '', strength: 100 },
            blur: { enabled: false, radius: 0 },
            filmGrain: { enabled: false, amount: 0, size: 1 },
          },
          localAdjustments: { enabled: true, layerCount: 1, layers: [{ name: 'lin', type: 'linear_gradient', enabled: true, opacity: 1, geometry: linearGeom(0.25) }] },
        },
        metadata: { version: '1.0.0', compatibility: [] },
      }],
    };
    const res = presetService.importPresets(JSON.stringify(legacy));
    expect(res.imported).toBe(1);
    const exported = JSON.parse(presetService.exportPresets(['legacy_vig']));
    const p = exported.presets[0];
    expect(p.settingsSchema).toBe(EDIT_SCHEMA_CURRENT);
    expect(p.settings.lensCorrections.vignetting.amount).toBe(-40);
    expect(p.settings.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.75, 6);

    // Round-trip the export through a fresh id: stamped presets are not migrated again.
    p.id = 'legacy_vig_copy';
    presetService.importPresets(JSON.stringify({ version: '1.0.0', presets: [p] }));
    const again = JSON.parse(presetService.exportPresets(['legacy_vig_copy'])).presets[0];
    expect(again.settings.lensCorrections.vignetting.amount).toBe(-40);
    expect(again.settings.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.75, 6);
  });
});
