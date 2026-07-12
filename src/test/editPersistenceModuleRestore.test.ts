import { editPersistenceService } from '../services/EditPersistenceService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { CropPipelineModule } from '../modules/CropPipelineModule';
import { ExposureModule } from '../modules/ExposureModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import { ColorBalancePipelineModule } from '../modules/ColorBalancePipelineModule';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';

/**
 * Regression for the round-9 IMPORTANT-2 finding: EditPersistenceService.restore()
 * applied module params ONLY via setParams, but crop / exposure / tonecurve /
 * colorbalance / lenscorrections expose NO setParams — so their persisted edits were
 * serialized to disk yet SILENTLY dropped on reopen (baseline reseeded from defaults →
 * first later flush durably erased them). serialize() DOES capture them (getParams
 * exists). These per-module round-trips lock the restore setter-ladder + adapter setters.
 */
describe('EditPersistenceService.restore — all captured module params round-trip', () => {
  const crop = () => imageProcessingPipeline.getModule<CropPipelineModule>('crop')!;
  const exposure = () => imageProcessingPipeline.getModule<ExposureModule>('exposure')!;
  const tonecurve = () => imageProcessingPipeline.getModule<ToneCurvePipelineModule>('tonecurve')!;
  const colorbalance = () => imageProcessingPipeline.getModule<ColorBalancePipelineModule>('colorbalance')!;
  const lens = () => imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!;

  afterEach(() => {
    imageProcessingPipeline.resetAllModules();
  });

  it('crop rect + enabled survive serialize → reset → restore (end-to-end)', () => {
    crop().setCropRegion(0.1, 0.2, 0.5, 0.6);
    expect(crop().getParams().enabled).toBe(true);

    const state = editPersistenceService.serialize();
    imageProcessingPipeline.resetAllModules();
    expect(crop().getParams().enabled).toBe(false); // reset dropped it

    editPersistenceService.restore(state, 100, 100);

    const p = crop().getParams();
    expect(p.enabled).toBe(true);
    expect(p.x).toBeCloseTo(0.1, 5);
    expect(p.y).toBeCloseTo(0.2, 5);
    expect(p.width).toBeCloseTo(0.5, 5);
    expect(p.height).toBeCloseTo(0.6, 5);
    // process() gates on the ADAPTER-level isEnabled too — it must be re-synced,
    // otherwise a restored crop renders as a no-op.
    expect(crop().isEnabled).toBe(true);
  });

  it('exposure params survive serialize → reset → restore', () => {
    exposure().setCurrentParams({ exposure: 0.3, black: 0.05 });

    const state = editPersistenceService.serialize();
    imageProcessingPipeline.resetAllModules();
    expect(exposure().getParams().exposure).toBeCloseTo(0, 5);

    editPersistenceService.restore(state, 100, 100);

    expect((exposure().getParams().exposure as number)).toBeCloseTo(0.3, 5);
    expect((exposure().getParams().black as number)).toBeCloseTo(0.05, 5);
  });

  it('tone curve params survive serialize → reset → restore', () => {
    const curve = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];
    tonecurve().getToneCurveModule().setParams({ baseCurve: curve, baseCurveNodes: 3 });

    const state = editPersistenceService.serialize();
    imageProcessingPipeline.resetAllModules();
    expect(tonecurve().getParams().baseCurve).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);

    editPersistenceService.restore(state, 100, 100);

    expect(tonecurve().getParams().baseCurve).toEqual(curve);
    expect(tonecurve().getParams().baseCurveNodes).toBe(3);
  });

  it('color balance params survive serialize → reset → restore', () => {
    colorbalance().getColorBalanceModule().setParams({ red_saturation: 25, blue_hue: -12 });

    const state = editPersistenceService.serialize();
    imageProcessingPipeline.resetAllModules();
    expect(colorbalance().getParams().red_saturation).toBe(0);

    editPersistenceService.restore(state, 100, 100);

    expect(colorbalance().getParams().red_saturation).toBe(25);
    expect(colorbalance().getParams().blue_hue).toBe(-12);
  });

  it('lens corrections params survive serialize → reset → restore', () => {
    lens().setParameters({
      enabled: true,
      lensCorrectionsParams: {
        ...lens().getParameters().lensCorrectionsParams,
        vignetting: { enabled: true, amount: 50, midpoint: 1.0, roundness: 0, feather: 50 },
      },
    });
    expect(lens().isEnabled).toBe(true);

    const state = editPersistenceService.serialize();
    imageProcessingPipeline.resetAllModules();
    expect(lens().isEnabled).toBe(false);

    editPersistenceService.restore(state, 100, 100);

    const params = lens().getParameters().lensCorrectionsParams;
    expect(params.vignetting.enabled).toBe(true);
    expect(params.vignetting.amount).toBe(50);
    expect(lens().isEnabled).toBe(true);
  });
});
