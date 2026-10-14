/**
 * v1.40.0 Task 10b — export keeps the CPU CropModule while the preview crops on the GPU.
 *
 * The preview's GPU geometry step and the export's CPU crop must agree on the output
 * frame: both read cropRenderGeometry (single source, Task 10a). This pins
 *  - export dims for the owner's 5200x3904 @ 0.84 deg restored rect == CropModule.getOutputDimensions
 *    (and == the GPU geometry the preview would render at native resolution);
 *  - the export code paths never build a GPU pass list (no GPU route on export).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { ProcessingContext } from '../services/ImageProcessingPipeline';
import type { CropPipelineModule } from '../modules/CropPipelineModule';
import { buildPassList } from '../shaders/passDescriptors';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The owner's restored rect (Task 9a acceptance), 5200x3904 native.
const W = 5200;
const H = 3904;
const R = { x: 0.08855, y: 0.02023, width: 0.91145, height: 0.90364, angle: 0.83659 };

describe('export crop parity (Task 10b)', () => {
  it('export dims for 5200x3904 @ 0.84 deg rect R == CropModule.getOutputDimensions (== GPU geometry)', async () => {
    const pipeline = new ImageProcessingPipeline();
    const crop = pipeline.getModule<CropPipelineModule>('crop')!;
    // 'nearest': the output frame does not depend on the resample method, and the bicubic
    // sampler at 20 MP takes minutes under ts-jest (seconds in the app).
    crop.setParams({ enabled: true, ...R, resampleMethod: 'nearest' });

    const expected = crop.getCropModule().getOutputDimensions(W, H);
    // The GPU route builds the SAME frame (its geometry step reads the same single source).
    const gpu = buildPassList([crop], { width: W, height: H, gpuCrop: true }).passes[0].geometryStep!.geom;
    expect({ width: gpu.outW, height: gpu.outH }).toEqual(expected);

    // Exactly the export call (ExportDialog / MultiExportService): main thread, no cache.
    const context: ProcessingContext = { width: W, height: H, channels: 4, isExport: true };
    const out = await pipeline.processImage(new Float32Array(W * H * 4).fill(0.5), context, {
      useWebWorkers: false, cacheResults: false,
    });
    expect({ width: context.width, height: context.height }).toEqual(expected);
    expect(out.length).toBe(expected.width * expected.height * 4);
  }, 120000);

  it('the export code paths never build a GPU pass list', () => {
    const files = [
      '../services/ExportService.ts',
      '../services/MultiExportService.ts',
      '../components/Dialogs/ExportDialog.tsx',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect({ rel, hit: /buildPassList|passDescriptors|gpuPreviewPipeline/.test(src) }).toEqual({ rel, hit: false });
    }
  });
});
