/**
 * TRIPWIRE: AI motion deblur must run WHOLE-FRAME in the main process and NEVER enter the tiled CPU
 * worker pipeline (tiledPipeline.ts). NAFNet's receptive field is effectively unbounded (TLC window
 * 384 + U-Net ×16 downsampling), so no finite `moduleApron` can bound it — a tiled pass would seam
 * or corrupt. This enforces the spike's Gate 4 apron statement by SOURCE-SCAN, so a future edit that
 * wires deblur into the tiled path (or grants it an apron) fails a test at introduction time.
 */
import fs from 'fs';
import path from 'path';
import { moduleApron } from '../utils/tiledPipeline';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('AI motion deblur is whole-frame only (never tiled)', () => {
  it('moduleApron grants NO apron to any deblur-ish module id (so it cannot join the tiled chain)', () => {
    for (const id of ['aideblur', 'motiondeblur', 'deblur', 'nafnet']) {
      expect(moduleApron(id, {})).toBe(0);
    }
  });

  it('the tiled-path code contains no reference to the AI deblur runtime', () => {
    for (const rel of ['utils/tiledPipeline.ts', 'services/WebWorkerImageProcessor.ts']) {
      const src = read(rel).toLowerCase();
      expect(src).not.toContain('aideblur');
      expect(src).not.toContain('nafnet');
    }
  });

  it('AI deblur is not registered as a pipeline module (it is a service bake, not a tiled module)', () => {
    // The apron switch enumerates every real spatial pipeline module id; none is a deblur AI stage.
    const tiled = read('utils/tiledPipeline.ts');
    expect(tiled).not.toMatch(/case\s+['"](ai)?deblur['"]/i);
    expect(tiled).not.toMatch(/case\s+['"]motiondeblur['"]/i);
  });

  it('applyMotionDeblur routes through the whole-frame aiDeblurClient IPC (not the worker tiler)', () => {
    const enh = read('services/EnhanceService.ts');
    expect(enh).toContain('applyMotionDeblur');
    expect(enh).toMatch(/aiDeblurClient\.run\(/);
  });
});
