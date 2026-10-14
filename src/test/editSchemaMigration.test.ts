/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  EDIT_SCHEMA_CURRENT, migrateEditState, migratePresetSettings, migrateLinearFeather,
} from '../utils/editSchemaMigration';

const linear = (feather: number) => ({ type: 'linear', centerX: .5, centerY: .5, radiusX: .3, radiusY: .3, startX: .5, startY: .15, endX: .5, endY: .85, feather, invert: false });
const radial = (feather: number) => ({ ...linear(feather), type: 'radial' });
const lens = (amount: number) => ({
  enabled: true,
  lensCorrectionsParams: { vignetting: { enabled: true, amount, midpoint: 1, roundness: 0, feather: 50 } },
  lensCorrections: { vignetting: { enabled: true, amount, midpoint: 1, roundness: 0, feather: 50 } },
});
const legacyState = () => ({
  version: 1,
  modules: { lenscorrections: lens(30), basicadj: { exposure: 1 } },
  localAdjustments: { enabled: true, layers: [
    { name: 'a', type: 'linear_gradient', enabled: true, opacity: 1, geometry: linear(0.2) },
    { name: 'b', type: 'radial_gradient', enabled: true, opacity: 1, geometry: radial(0.2) },
    { name: 'c', type: 'brush', enabled: true, opacity: 1 },
  ] },
});

describe('migrateLinearFeather', () => {
  it('flips linear feather within the slider range and leaves radial alone', () => {
    expect(migrateLinearFeather(linear(0.2) as any).feather).toBeCloseTo(0.8, 6);
    expect(migrateLinearFeather(linear(0.5) as any).feather).toBeCloseTo(0.5, 6);
    expect(migrateLinearFeather(linear(1) as any).feather).toBeCloseTo(0.01, 6);
    expect(migrateLinearFeather(linear(0) as any).feather).toBeCloseTo(1, 6);
    expect(migrateLinearFeather(radial(0.2) as any).feather).toBe(0.2);
  });
});

describe('migrateEditState', () => {
  it('migrates a legacy (unmarked) state once: linear feather flipped, vignette amount negated, radial untouched', () => {
    const m = migrateEditState(legacyState() as any) as any;
    expect(m.schema).toBe(EDIT_SCHEMA_CURRENT);
    expect(m.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.8, 6);
    expect(m.localAdjustments.layers[1].geometry.feather).toBe(0.2);
    expect(m.modules.lenscorrections.lensCorrectionsParams.vignetting.amount).toBe(-30);
    expect(m.modules.lenscorrections.lensCorrections.vignetting.amount).toBe(-30);
    expect(m.modules.basicadj.exposure).toBe(1);
  });

  it('is idempotent: a second pass (marker present) changes nothing', () => {
    const once = migrateEditState(legacyState() as any);
    const twice = migrateEditState(once as any) as any;
    expect(twice.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.8, 6);
    expect(twice.modules.lenscorrections.lensCorrectionsParams.vignetting.amount).toBe(-30);
  });

  it('does not mutate its input', () => {
    const s = legacyState();
    migrateEditState(s as any);
    expect((s.localAdjustments.layers[0].geometry as any).feather).toBe(0.2);
    expect(s.modules.lenscorrections.lensCorrectionsParams.vignetting.amount).toBe(30);
  });

  it('migrates editsOnBakedBase with the same marker', () => {
    const s: any = { ...legacyState(), editsOnBakedBase: { modules: { lenscorrections: lens(10) }, localAdjustments: legacyState().localAdjustments } };
    const m = migrateEditState(s) as any;
    expect(m.editsOnBakedBase.modules.lenscorrections.lensCorrectionsParams.vignetting.amount).toBe(-10);
    expect(m.editsOnBakedBase.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.8, 6);
  });

  it('leaves an already-current state untouched (same object)', () => {
    const cur = { version: 1, schema: EDIT_SCHEMA_CURRENT, modules: { lenscorrections: lens(-30) } };
    expect(migrateEditState(cur as any)).toBe(cur);
  });
});

describe('migratePresetSettings', () => {
  it('negates the flat lensCorrections vignetting amount and flips linear layer feather, once', () => {
    const settings: any = {
      lensCorrections: { enabled: true, vignetting: { enabled: true, amount: 25, midpoint: 1, roundness: 0, feather: 50 } },
      localAdjustments: { enabled: true, layerCount: 2, layers: [
        { name: 'a', type: 'linear_gradient', enabled: true, opacity: 1, geometry: linear(0.3) },
        { name: 'b', type: 'radial_gradient', enabled: true, opacity: 1, geometry: radial(0.3) },
      ] },
    };
    const m = migratePresetSettings(settings) as any;
    expect(m.lensCorrections.vignetting.amount).toBe(-25);
    expect(m.localAdjustments.layers[0].geometry.feather).toBeCloseTo(0.7, 6);
    expect(m.localAdjustments.layers[1].geometry.feather).toBe(0.3);
    expect(settings.lensCorrections.vignetting.amount).toBe(25); // input not mutated
  });
});
