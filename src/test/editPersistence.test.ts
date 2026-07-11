import { editPersistenceService } from '../services/EditPersistenceService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';

describe('EditPersistenceService', () => {
  const la = () => imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments')!;
  const basicadj = () => imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;

  afterEach(() => {
    imageProcessingPipeline.resetAllModules();
    for (const l of la().getParameters().layers) la().removeLayer(l.id);
    la().disable();
  });

  it('serialize → restore round-trips module params + LA layers (geometry only, no mask buffer)', () => {
    basicadj().setParams({ exposure: 0.42 });
    const id = la().createLayer('radial_gradient', 'Test', 20, 20);
    la().updateLayerBasicAdj(id, { contrast: 0.3 });

    const state = editPersistenceService.serialize();

    // The serialized state must NOT contain the Float32 mask buffer.
    expect(JSON.stringify(state)).not.toContain('"mask"');

    // Simulate reopening the image: reset everything, then restore.
    imageProcessingPipeline.resetAllModules();
    for (const l of la().getParameters().layers) la().removeLayer(l.id);
    expect(basicadj().getParams().exposure).not.toBeCloseTo(0.42, 3);

    editPersistenceService.restore(state, 20, 20);

    expect(basicadj().getParams().exposure).toBeCloseTo(0.42, 5);
    const layers = la().getParameters().layers;
    expect(layers.length).toBe(1);
    expect(layers[0].type).toBe('radial_gradient');
    expect(layers[0].name).toBe('Test');
    expect((layers[0].basicAdj as { contrast?: number } | undefined)?.contrast).toBeCloseTo(0.3, 5);
    // The restored mask is rebuilt at the requested resolution.
    expect(layers[0].mask.length).toBe(20 * 20);
  });

  it('restore ignores a state with a mismatched version', () => {
    const ok = editPersistenceService.restore({ version: 999, modules: {} }, 10, 10);
    expect(ok).toBe(false);
  });

  it('serialize → restore round-trips per-layer LocalAdjustmentParams (was silently reset to defaults)', () => {
    const id = la().createLayer('radial_gradient', 'Test', 20, 20);
    la().updateLayerParameters(id, { exposure: 0.5, saturation: 30 });

    const state = editPersistenceService.serialize();

    // Simulate reopening the image: reset everything, then restore.
    imageProcessingPipeline.resetAllModules();
    for (const l of la().getParameters().layers) la().removeLayer(l.id);

    editPersistenceService.restore(state, 20, 20);

    const layers = la().getParameters().layers;
    expect(layers.length).toBe(1);
    // Before the fix, restore() never called updateLayerParameters — every
    // per-layer LocalAdjustmentParams field silently reset to createLayer's defaults.
    expect(layers[0].parameters.exposure).toBe(0.5);
    expect(layers[0].parameters.saturation).toBe(30);
  });
});
