/**
 * CropPipelineModule adapter gate — regression for the v1.29 "crop never
 * applies" bug. process() runs only when BOTH the adapter-level isEnabled and
 * the inner CropModule's params.enabled are true. resetAllModules() on image
 * open clears the adapter flag; the interactive drag path used to enable only
 * the INNER module, so the crop was a pipeline no-op until an app restart
 * restored it through the adapter's setParams mirror. The fix routes apply
 * through setCropRegion (which enables both).
 */
import { CropPipelineModule } from '../modules/CropPipelineModule';

const W = 8;
const H = 8;

function grid(): Float32Array {
  const data = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = i / (W * H);
    data[i * 4 + 3] = 1;
  }
  return data;
}

describe('CropPipelineModule adapter gate', () => {
  test('inner-only enable after reset is a pipeline NO-OP (the historical trap)', () => {
    const adapter = new CropPipelineModule();
    adapter.reset(); // what resetAllModules does on image open — adapter isEnabled=false

    // The old interactive path: enable ONLY the inner module.
    adapter.getCropModule().setParams({ x: 0.25, y: 0.25, width: 0.5, height: 0.5, enabled: true });

    const context = { width: W, height: H, channels: 4 };
    const out = adapter.process(grid(), context);

    expect(adapter.getEnabled()).toBe(false);
    expect(context.width).toBe(W);   // dimensions untouched — crop did not run
    expect(context.height).toBe(H);
    expect(out).toEqual(grid());
  });

  test('setCropRegion enables the adapter and process() actually crops', () => {
    const adapter = new CropPipelineModule();
    adapter.reset();

    adapter.setCropRegion(0.25, 0.25, 0.5, 0.5);

    const context = { width: W, height: H, channels: 4 };
    const out = adapter.process(grid(), context);

    expect(adapter.getEnabled()).toBe(true);
    expect(context.width).toBe(W / 2);
    expect(context.height).toBe(H / 2);
    expect(out.length).toBe((W / 2) * (H / 2) * 4);
  });

  test('suspend (setEnabled false) keeps params so re-enable restores the same crop', () => {
    const adapter = new CropPipelineModule();
    adapter.setCropRegion(0.25, 0.25, 0.5, 0.5);

    adapter.setEnabled(false); // drag-start suspension: full frame visible again
    const context = { width: W, height: H, channels: 4 };
    expect(adapter.process(grid(), context)).toEqual(grid());
    expect(context.width).toBe(W);

    const p = adapter.getCropModule().getParams();
    expect([p.x, p.y, p.width, p.height]).toEqual([0.25, 0.25, 0.5, 0.5]);

    adapter.setCropRegion(p.x, p.y, p.width, p.height); // release re-applies
    const context2 = { width: W, height: H, channels: 4 };
    adapter.process(grid(), context2);
    expect(context2.width).toBe(W / 2);
  });
});
