import { ImageProcessingPipeline, PipelineModule } from '../services/ImageProcessingPipeline';
import { exportService } from '../services/ExportService';

/**
 * Covers the export changes:
 *  - default options (Adobe RGB, highest bit depth for the default format, original size)
 *  - the pipeline's optional progress/yield hook used by the single-image export so the
 *    top-left bar animates and the renderer stays responsive instead of freezing.
 */
describe('Export default options', () => {
  test('default to Adobe RGB, 16-bit, original dimensions', () => {
    const opts = exportService.getDefaultOptions();
    expect(opts.colorSpace).toBe('adobergb');
    expect(opts.bitDepth).toBe(16); // highest the default format (PNG) supports
    // No width/height set => export at the original dimensions (no resize).
    expect(opts.width).toBeUndefined();
    expect(opts.height).toBeUndefined();
  });
});

describe('ImageProcessingPipeline progress hook', () => {
  const makeFakeModule = (onProcess: () => void): PipelineModule => ({
    getId: () => 'fake-progress-module',
    getName: () => 'Fake',
    isEnabled: true,
    // Non-zero numeric param => not identity => the module actually runs.
    getParams: () => ({ amount: 1 }),
    process: (input: Float32Array) => { onProcess(); return input; },
  });

  test('reports progress per running module, ending with done === total', async () => {
    const pipeline = new ImageProcessingPipeline();
    let processed = 0;
    pipeline.addModule(makeFakeModule(() => { processed++; }), 0);

    const calls: Array<[number, number]> = [];
    const input = new Float32Array(4 * 4 * 4);
    await pipeline.processImage(
      input,
      { width: 4, height: 4, channels: 4 },
      {
        useWebWorkers: false,
        onProgress: (done, total) => calls.push([done, total]),
      },
    );

    expect(processed).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [lastDone, lastTotal] = calls[calls.length - 1];
    expect(lastTotal).toBeGreaterThanOrEqual(1);
    expect(lastDone).toBe(lastTotal);
  });

  test('runs normally when no progress hook is supplied', async () => {
    const pipeline = new ImageProcessingPipeline();
    let processed = 0;
    pipeline.addModule(makeFakeModule(() => { processed++; }), 0);

    const input = new Float32Array(4 * 4 * 4);
    const out = await pipeline.processImage(input, { width: 4, height: 4, channels: 4 }, { useWebWorkers: false });

    expect(out).toBeInstanceOf(Float32Array);
    expect(processed).toBe(1);
  });
});
