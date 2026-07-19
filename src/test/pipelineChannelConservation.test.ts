/**
 * Pipeline channel/length conservation — regression for the corrupted-export
 * class of bug (v1.29.1): the EXPORT path hands the pipeline a 4-channel
 * buffer with context.channels=4 hardcoded and encodes the result as RGBA. A
 * module that returns a 3-channel (or otherwise shorter) buffer silently
 * corrupts the export: content compressed into the top ¾ of the frame with a
 * black bottom quarter (user-reported on a phone portrait JPG with Auto All).
 *
 * Every module is activated ALONE with non-identity params on RGBA input; the
 * output must stay width*height*4 (post-crop dims for the crop module).
 */
import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';

const W = 32;
const H = 24;

function rgba(): Float32Array {
  const d = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = (i % W) / W;
    d[i * 4 + 1] = 0.5;
    d[i * 4 + 2] = 0.25;
    d[i * 4 + 3] = 1;
  }
  return d;
}

// Non-identity params per module id (enough to make each module ACTIVE the way
// Auto All / user edits would).
const ACTIVATE: Record<string, Record<string, unknown>> = {
  crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5, enabled: true },
  exposure: { exposure: 1.2, enabled: true },
  temperature: { temperature: 7500, tint: 10, enabled: true },
  basicadj: { brightness: 20, contrast: 15, saturation: 10, enabled: true },
  tonecurve: { enabled: true, curvePoints: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] },
  colorbalance: { shadowsRed: 20, midtonesBlue: 15, enabled: true },
  shadowshighlights: { shadows: 70, highlights: 30, enabled: true },
  highlightrecovery: { strength: 50, enabled: true },
  lenscorrections: { vignetting: { enabled: true, amount: -50, midpoint: 1 }, enabled: true },
  'noise-reduction': { strength: 40, detail: 50, enabled: true },
  enhance: { sharpenAmount: 60, enabled: true },
};

// Modules expose different param setters (setParams / setCurrentParams /
// setParameters) — apply through whichever exists.
function applyParams(m: unknown, params: Record<string, unknown>): void {
  const mod = m as Record<string, unknown>;
  for (const name of ['setParams', 'setCurrentParams', 'setParameters']) {
    if (typeof mod[name] === 'function') {
      (mod[name] as (p: unknown) => void).call(mod, params);
      return;
    }
  }
  throw new Error('no param setter found');
}

describe('pipeline channel conservation (export contract: RGBA in → RGBA out)', () => {
  const ids = new ImageProcessingPipeline().getOrderedModules().map((m) => m.getId());

  test.each(ids)('module "%s" active alone keeps the buffer at W*H*4', async (id) => {
    const p = new ImageProcessingPipeline();
    for (const mid of ids) {
      const target = mid === id;
      p.setModuleEnabled(mid, target);
      if (target && ACTIVATE[id]) {
        // getOrderedModules() returns thin adapters — fetch the REAL module.
        applyParams(p.getModule(mid), ACTIVATE[id]);
      }
    }

    const context = { width: W, height: H, channels: 4 };
    const out = await p.processImage(rgba(), context, { useWebWorkers: false, cacheResults: false });
    // Post-crop dims × RGBA — for every non-crop module this is W*H*4 unchanged.
    expect(out.length).toBe(context.width * context.height * 4);
  });

  test('ALL modules active together keep the buffer at W*H*4', async () => {
    const p = new ImageProcessingPipeline();
    for (const mid of ids) {
      p.setModuleEnabled(mid, true);
      const params = ACTIVATE[mid];
      if (params) applyParams(p.getModule(mid), params);
    }
    const context = { width: W, height: H, channels: 4 };
    const out = await p.processImage(rgba(), context, { useWebWorkers: false, cacheResults: false });
    expect(out.length).toBe(context.width * context.height * 4);
  });
});
