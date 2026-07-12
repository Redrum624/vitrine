/**
 * Round-9 IMPORTANT-1 + LOW-4: presets must genuinely APPLY the modules Z2 taught them to
 * capture — not just carry a captured block.
 *
 *  - lenscorrections (IMPORTANT-1): applySettingsToPipeline called setModuleEnabled, which
 *    bare-assigned `module.isEnabled` — but LensCorrectionsPipelineModule.isEnabled is
 *    GETTER-ONLY, so the assignment threw a TypeError that PresetService swallowed, aborting
 *    the whole lens apply (setParameters never ran). Separately the captured lens block spread
 *    the sub-effects at the top level while the setter expects `{ lensCorrectionsParams: {...} }`,
 *    so even without the throw the params would not have applied.
 *  - tonecurve / colorbalance (LOW-4): Z2's tests asserted only that the captured block exists;
 *    these assert the APPLIED params so the "presets capture 4 more modules" claim is honest.
 */
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { presetService } from '../services/PresetService';
import type { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import type { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import type { ColorBalancePipelineModule } from '../modules/ColorBalancePipelineModule';

const lens = () => imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!;
const tonecurve = () => imageProcessingPipeline.getModule<ToneCurvePipelineModule>('tonecurve')!;
const colorbalance = () => imageProcessingPipeline.getModule<ColorBalancePipelineModule>('colorbalance')!;

describe('PresetService — modules genuinely apply (round-9 IMPORTANT-1 / LOW-4)', () => {
  afterEach(() => {
    imageProcessingPipeline.resetAllModules();
  });

  test('lens corrections preset round-trips vignetting WITHOUT throwing', () => {
    lens().setParameters({
      enabled: true,
      lensCorrectionsParams: {
        ...lens().getParameters().lensCorrectionsParams,
        vignetting: { enabled: true, amount: 50, midpoint: 1.0, roundness: 0, feather: 50 },
      },
    });
    expect(lens().isEnabled).toBe(true);

    const presetId = presetService.createPresetFromCurrent('Lens Look', '', 'custom', []);
    const preset = presetService.getPreset(presetId)!;
    // Capture must carry the vignetting values.
    expect(preset.settings.lensCorrections).toBeDefined();

    // Reset the module, then apply — the preset's vignetting must win, with no swallowed throw.
    lens().reset();
    expect(lens().isEnabled).toBe(false);

    expect(presetService.applyPreset(presetId)).toBe(true);

    const applied = lens().getParameters().lensCorrectionsParams;
    expect(applied.vignetting.enabled).toBe(true);
    expect(applied.vignetting.amount).toBe(50);
    // isEnabled is derived from the sections → the module actually runs again.
    expect(lens().isEnabled).toBe(true);

    presetService.deletePreset(presetId);
  });

  test('tone curve preset applies its captured curve onto the pipeline', () => {
    const curve = [{ x: 0, y: 0 }, { x: 0.5, y: 0.72 }, { x: 1, y: 1 }];
    tonecurve().getToneCurveModule().setParams({ baseCurve: curve, baseCurveNodes: 3 });

    const presetId = presetService.createPresetFromCurrent('TC Look', '', 'custom', []);

    tonecurve().getToneCurveModule().reset();
    expect(tonecurve().getParams().baseCurveNodes).toBe(2);

    expect(presetService.applyPreset(presetId)).toBe(true);

    expect(tonecurve().getParams().baseCurve).toEqual(curve);
    expect(tonecurve().getParams().baseCurveNodes).toBe(3);

    presetService.deletePreset(presetId);
  });

  test('color balance preset applies its captured grade onto the pipeline', () => {
    colorbalance().getColorBalanceModule().setParams({ red_saturation: 25, blue_hue: -12 });

    const presetId = presetService.createPresetFromCurrent('CB Look', '', 'custom', []);

    colorbalance().getColorBalanceModule().resetParams();
    expect(colorbalance().getParams().red_saturation).toBe(0);

    expect(presetService.applyPreset(presetId)).toBe(true);

    expect(colorbalance().getParams().red_saturation).toBe(25);
    expect(colorbalance().getParams().blue_hue).toBe(-12);

    presetService.deletePreset(presetId);
  });
});
