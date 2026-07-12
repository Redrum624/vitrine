/**
 * Bake-aware CheckpointService tests (Task 6 — Phase-1.5 Enhance integration).
 * Covers:
 *  1. recordLabeled stores the exact label verbatim (no describeChange) + bakeDepth.
 *  2. restore() of a bakeDepth:0 checkpoint while bridge depth is 2 → unwindToDepth(0) THEN restore.
 *  3. restore() of a checkpoint whose bakeDepth equals current depth → no unwindToDepth.
 */
import { checkpointService } from '../services/CheckpointService';
import { imageService } from '../services/ImageService';
import { editPersistenceService } from '../services/EditPersistenceService';

describe('CheckpointService — bake-aware (Task 6)', () => {
  let stateCounter = 0;
  const makeState = () =>
    ({ version: 1, modules: { basicadj: { exposure: ++stateCounter } }, localAdjustments: [] } as never);

  const bridge = {
    getDepth: jest.fn<number, []>().mockReturnValue(0),
    unwindToDepth: jest.fn<void, [number]>(),
  };

  beforeEach(() => {
    stateCounter = 0;
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(
      { width: 100, height: 100, filePath: '/test.jpg', data: new Float32Array(40_000) } as never,
    );
    jest.spyOn(editPersistenceService, 'serialize').mockImplementation(makeState);
    jest.spyOn(editPersistenceService, 'restore').mockImplementation(() => false);
    bridge.getDepth.mockClear();
    bridge.getDepth.mockReturnValue(0);
    bridge.unwindToDepth.mockClear();
    checkpointService.clear();
    checkpointService.setBakeBridge(bridge);
  });

  afterEach(() => {
    checkpointService.flush();
    jest.restoreAllMocks();
  });

  it('recordLabeled stores the exact label verbatim and the given bakeDepth', () => {
    checkpointService.recordLabeled('Enhanced ×2', 1);
    const cps = checkpointService.getCheckpoints();
    expect(cps).toHaveLength(1);
    expect(cps[0].label).toBe('Enhanced ×2');
    expect((cps[0] as { bakeDepth?: number }).bakeDepth).toBe(1);
  });

  it('restoring a bakeDepth:0 checkpoint while bridge depth is 2 calls unwindToDepth(0) BEFORE editPersistenceService.restore', () => {
    // Create a checkpoint tagged as bakeDepth:0
    checkpointService.recordLabeled('Before upscale', 0);
    const id = checkpointService.getCheckpoints()[0].id;

    // Simulate the bridge now reporting depth 2 (two upscale levels applied since)
    bridge.getDepth.mockReturnValue(2);

    checkpointService.restore(id);

    expect(bridge.unwindToDepth).toHaveBeenCalledTimes(1);
    expect(bridge.unwindToDepth).toHaveBeenCalledWith(0);
    expect(editPersistenceService.restore).toHaveBeenCalled();

    // unwindToDepth must fire BEFORE editPersistenceService.restore
    const unwindOrder = bridge.unwindToDepth.mock.invocationCallOrder[0];
    const restoreOrder = (editPersistenceService.restore as jest.Mock).mock.invocationCallOrder[0];
    expect(unwindOrder).toBeLessThan(restoreOrder);
  });

  it('restoring a checkpoint whose bakeDepth equals the current depth does NOT call unwindToDepth', () => {
    // Checkpoint is tagged as bakeDepth:2 — same as bridge depth
    checkpointService.recordLabeled('After ×2 upscale', 2);
    const id = checkpointService.getCheckpoints()[0].id;

    bridge.getDepth.mockReturnValue(2);

    checkpointService.restore(id);

    expect(bridge.unwindToDepth).not.toHaveBeenCalled();
    expect(editPersistenceService.restore).toHaveBeenCalled();
  });

  it('recordLabeled always creates a checkpoint even when serialized state is identical to lastSnapshot', () => {
    // Use a fixed state so serialize() returns the SAME JSON on every call
    const fixedState = { version: 1, modules: { basicadj: { exposure: 42 } }, localAdjustments: [] } as never;
    (editPersistenceService.serialize as jest.Mock).mockReturnValue(fixedState);

    // Seed lastSnapshot via record() — produces checkpoint #1 and sets lastSnapshot = JSON.stringify(fixedState)
    checkpointService.record('Opened');
    expect(checkpointService.getCheckpoints()).toHaveLength(1);

    // Bug: serialize() still returns fixedState → json === lastSnapshot → old code returns early, no checkpoint
    // Fix: recordLabeled must ALWAYS push the checkpoint regardless of state identity
    checkpointService.recordLabeled('Enhanced ×2', 1);

    const cps = checkpointService.getCheckpoints();
    expect(cps).toHaveLength(2);
    expect(cps[1].label).toBe('Enhanced ×2');
  });
});
