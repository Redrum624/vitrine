import { checkpointService } from '../services/CheckpointService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageService } from '../services/ImageService';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';

describe('CheckpointService', () => {
  const basicadj = () => imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj')!;
  const la = () => imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments')!;

  beforeEach(() => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(
      { width: 10, height: 10, filePath: '/x.jpg', data: new Float32Array(400) } as never,
    );
    imageProcessingPipeline.resetAllModules();
    checkpointService.clear();
  });

  afterEach(() => {
    checkpointService.flush(); // clears any pending debounce timers
    jest.restoreAllMocks();
  });

  it('records one checkpoint per distinct state and de-dupes identical states', () => {
    basicadj().setParams({ exposure: 0.3 });
    checkpointService.record('A');
    checkpointService.record('A again'); // identical state → no new checkpoint
    expect(checkpointService.getCheckpoints().length).toBe(1);

    basicadj().setParams({ exposure: 0.6 });
    checkpointService.record('B');
    expect(checkpointService.getCheckpoints().length).toBe(2);
  });

  it('restore() applies a checkpoint and KEEPS the full list', () => {
    basicadj().setParams({ exposure: 0.3 });
    checkpointService.record('A');
    const firstId = checkpointService.getCheckpoints()[0].id;

    basicadj().setParams({ exposure: 0.9 });
    checkpointService.record('B');
    expect(basicadj().getParams().exposure).toBeCloseTo(0.9, 5);

    expect(checkpointService.restore(firstId)).toBe(true);
    expect(basicadj().getParams().exposure).toBeCloseTo(0.3, 5); // state restored
    expect(checkpointService.getCheckpoints().length).toBe(2);   // list kept (not truncated)
    expect(checkpointService.getActiveId()).toBe(firstId);
  });

  it('labels checkpoints by the actual change (e.g. "White Balance — Tint -4.00")', () => {
    const wb = imageProcessingPipeline.getModule('temperature') as unknown as { setParams: (p: Record<string, unknown>) => void };
    wb.setParams({ temperature: 6500, tint: 0 });
    checkpointService.record('Opened'); // baseline
    wb.setParams({ tint: -4 });
    checkpointService.record('White Balance'); // fallback only used if change can't be summarised
    const cps = checkpointService.getCheckpoints();
    const label = cps[cps.length - 1].label;
    expect(label).toContain('White Balance');
    expect(label).toContain('Tint');
    expect(label).toContain('-4');
  });

  it('record() is a no-op when no image is loaded', () => {
    (imageService.getCurrentImage as jest.Mock).mockReturnValue(null);
    checkpointService.record('X');
    expect(checkpointService.getCheckpoints().length).toBe(0);
  });

  it('undo()/redo() step the active position through the timeline and restore state', () => {
    basicadj().setParams({ exposure: 0.1 }); checkpointService.record('A');
    basicadj().setParams({ exposure: 0.5 }); checkpointService.record('B');
    basicadj().setParams({ exposure: 0.9 }); checkpointService.record('C');
    const [a, b, c] = checkpointService.getCheckpoints();

    expect(checkpointService.getActiveId()).toBe(c.id);
    expect(checkpointService.canUndo()).toBe(true);
    expect(checkpointService.canRedo()).toBe(false);

    expect(checkpointService.undo()).toBe(true); // -> B
    expect(checkpointService.getActiveId()).toBe(b.id);
    expect(basicadj().getParams().exposure).toBeCloseTo(0.5, 5);
    expect(checkpointService.canRedo()).toBe(true);

    expect(checkpointService.undo()).toBe(true); // -> A
    expect(checkpointService.getActiveId()).toBe(a.id);
    expect(basicadj().getParams().exposure).toBeCloseTo(0.1, 5);
    expect(checkpointService.canUndo()).toBe(false);
    expect(checkpointService.undo()).toBe(false); // oldest → no-op

    expect(checkpointService.redo()).toBe(true); // -> B
    expect(checkpointService.getActiveId()).toBe(b.id);
    expect(basicadj().getParams().exposure).toBeCloseTo(0.5, 5);

    expect(checkpointService.redo()).toBe(true); // -> C
    expect(checkpointService.getActiveId()).toBe(c.id);
    expect(checkpointService.canRedo()).toBe(false);
    expect(checkpointService.redo()).toBe(false); // newest → no-op
  });

  it('undo()/redo() round-trip per-layer LocalAdjustmentParams (CheckpointService.restore path)', () => {
    const id = la().createLayer('radial_gradient', 'Test', 10, 10);
    la().updateLayerParameters(id, { exposure: 0.2 });
    checkpointService.record('A');

    la().updateLayerParameters(id, { exposure: 0.8 });
    checkpointService.record('B');
    expect(la().getParameters().layers[0].parameters.exposure).toBeCloseTo(0.8, 5);

    expect(checkpointService.undo()).toBe(true);
    // Before the fix, editPersistenceService.restore() never re-applied per-layer
    // parameters, so this would come back at the createLayer default (0), not 0.2.
    expect(la().getParameters().layers[0].parameters.exposure).toBeCloseTo(0.2, 5);

    expect(checkpointService.redo()).toBe(true);
    expect(la().getParameters().layers[0].parameters.exposure).toBeCloseTo(0.8, 5);
  });

  it('canUndo/canRedo are false with zero or one checkpoint', () => {
    expect(checkpointService.canUndo()).toBe(false);
    expect(checkpointService.canRedo()).toBe(false);
    basicadj().setParams({ exposure: 0.2 }); checkpointService.record('only');
    expect(checkpointService.canUndo()).toBe(false);
    expect(checkpointService.canRedo()).toBe(false);
  });
});
