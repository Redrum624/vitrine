/**
 * v1.37.0 R5 — descriptive History labels (user report: "the 'History' is not
 * detailled enough, I don't know what was edited").
 *
 * Locks CheckpointService's describeChange/diffLeaves formatter through the real
 * record() path (module setParams → serialize → diff against lastState):
 * - zero-centered params (default 0) read as a signed DELTA ("Exposure +0.35");
 * - absolute params read as old → new ("Temperature 6500 → 4800");
 * - 2+ changes in one module read as a count ("White Balance: 2 changes");
 * - crop gestures get their own vocabulary (Rotate 90° / Straighten +2.0° / Crop 81%),
 *   including the programmatic writes Auto All makes (angle + wedge-free rect patch);
 * - enabled flips and curve-array edits are no longer invisible;
 * - cross-module edits (preset applies, Auto All) read "Multiple adjustments (n)".
 *
 * Before R5 every one of these read as "<Module> — <Param> <abs value>",
 * a bare module name, "Multiple adjustments" (uncounted), or literal "Edit".
 */
import { checkpointService } from '../services/CheckpointService';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { imageService } from '../services/ImageService';

type ParamSetter = { setParams: (p: Record<string, unknown>) => void };
const mod = (id: string) => imageProcessingPipeline.getModule(id) as unknown as ParamSetter;

const lastLabel = (): string => {
  const cps = checkpointService.getCheckpoints();
  return cps[cps.length - 1].label;
};

describe('CheckpointService — descriptive edit labels (v1.37.0 R5)', () => {
  beforeEach(() => {
    jest.spyOn(imageService, 'getCurrentImage').mockReturnValue(
      { width: 100, height: 80, filePath: '/x.jpg', data: new Float32Array(100 * 80 * 4) } as never,
    );
    imageProcessingPipeline.resetAllModules();
    checkpointService.clear();
    checkpointService.record('Opened'); // baseline — the next record() diffs against it
  });

  afterEach(() => {
    checkpointService.flush(); // clears pending debounce timers
    jest.restoreAllMocks();
  });

  it('single zero-centered numeric change → signed delta', () => {
    mod('basicadj').setParams({ exposure: 0.35 });
    checkpointService.record('Basic Adjustments');
    expect(lastLabel()).toBe('Basic Adjustments — Exposure +0.35');
  });

  it('single absolute numeric change → old → new arrow', () => {
    mod('temperature').setParams({ temperature: 4800 });
    checkpointService.record('White Balance');
    expect(lastLabel()).toBe('White Balance — Temperature 6500 → 4800');
  });

  it('temp+tint drag → per-module count, not temp-only', () => {
    mod('temperature').setParams({ temperature: 5200, tint: -6 });
    checkpointService.record('White Balance');
    expect(lastLabel()).toBe('White Balance: 2 changes');
  });

  it('orientation quarter-turns → "Rotate 90°" / "Rotate 90° CCW"', () => {
    mod('crop').setParams({ orientation: 90, enabled: true });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Rotate 90°');

    mod('crop').setParams({ orientation: 0 });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Rotate 90° CCW'); // delta mod 360 = 270

    mod('crop').setParams({ orientation: 180 });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Rotate 180°');
  });

  it('enabled flip alone → "<Module> on" / "<Module> off"', () => {
    mod('noise-reduction').setParams({ enabled: true });
    checkpointService.record('Noise Reduction');
    expect(lastLabel()).toBe('Noise Reduction on');

    mod('noise-reduction').setParams({ enabled: false });
    checkpointService.record('Noise Reduction');
    expect(lastLabel()).toBe('Noise Reduction off');
  });

  it('curve array edit → "Tone Curve curve edited" (was invisible: non-numeric leaves skipped)', () => {
    mod('tonecurve').setParams({
      baseCurve: [{ x: 0, y: 0 }, { x: 0.4, y: 0.55 }, { x: 1, y: 1 }],
      baseCurveNodes: 3,
    });
    checkpointService.record('Tone Curve');
    expect(lastLabel()).toBe('Tone Curve curve edited');
  });

  it('changes across modules → "Multiple adjustments (n)"', () => {
    mod('basicadj').setParams({ exposure: 0.2 });
    mod('temperature').setParams({ tint: 5 });
    checkpointService.record('Edit');
    expect(lastLabel()).toBe('Multiple adjustments (2)');
  });

  it('crop rect drag (with the enabled rider panels write) → "Crop <area>%"', () => {
    mod('crop').setParams({ enabled: true, x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Crop 81%');
  });

  it('straighten (angle + wedge-free rect patch, as the slider and Auto All write it) → "Straighten +2.0°"', () => {
    mod('crop').setParams({ enabled: true, angle: 2, x: 0.02, y: 0.02, width: 0.96, height: 0.96 });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Straighten +2.0°');
  });

  it('single boolean (non-enabled) change → "<Module> — <Param> on/off"', () => {
    mod('crop').setParams({ flipHorizontal: true });
    checkpointService.record('Crop & Transform');
    expect(lastLabel()).toBe('Crop & Transform — Flip Horizontal on');
  });

  it('the "enabled" rider is dropped when real edits accompany it (label stays specific)', () => {
    mod('noise-reduction').setParams({ enabled: true, strength: 70 });
    checkpointService.record('Noise Reduction');
    expect(lastLabel()).toBe('Noise Reduction — Strength 50 → 70');
  });
});
