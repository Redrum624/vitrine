/**
 * Reproduction test for "exporting a photo doesn't export it with the edits".
 *
 * The export path (ExportDialog.handleExport) re-decodes the full-res ORIGINAL and runs it
 * back through the SAME singleton pipeline via:
 *     pipeline.processImage(originalPixels, ctx, /*useWebWorkers*\/ false, onProgress, /*cache*\/ false)
 * This test exercises exactly that call on a freshly-constructed pipeline with a real edit
 * set on a module, and asserts the output actually differs from the input. If this passes,
 * the export WIRING applies edits and any field report of "no edits" is a runtime state
 * issue (e.g. edit-restore not re-enabling modules) rather than a broken export path.
 */

import { ImageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { ProcessingContext } from '../services/ImageProcessingPipeline';
import type { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { createTestImage, maxImageDifference } from './testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Force the export contract: main-thread processing (the dialog passes useWebWorkers=false).
jest.mock('../services/WebWorkerImageProcessor', () => ({
  webWorkerImageProcessor: { shouldUseWorkers: () => false, processImage: jest.fn() },
}));

describe('Export applies edits (regression for missing-edits export)', () => {
  it('processImage(...) with a non-default module edit changes the pixels', async () => {
    const width = 16;
    const height = 16;
    const input = createTestImage(width, height, 0.5, 0.5, 0.5);
    const context: ProcessingContext = { width, height, channels: 4 };

    const pipeline = new ImageProcessingPipeline();
    const basic = pipeline.getModule<BasicAdjustmentsModule>('basicadj');
    expect(basic).toBeDefined();
    // A real user edit: brighten by +1 stop.
    basic!.setParams({ exposure: 1.0 });

    // Mirror the export call signature exactly (main thread, no caching).
    const out = await pipeline.processImage(new Float32Array(input), context, { useWebWorkers: false, cacheResults: false });

    expect(out.length).toBe(input.length);
    // The export buffer MUST reflect the edit.
    expect(maxImageDifference(input, out)).toBeGreaterThan(0.05);
  });

  it('a neutral pipeline returns the original unchanged (sanity baseline)', async () => {
    const width = 16;
    const height = 16;
    const input = createTestImage(width, height, 0.5, 0.5, 0.5);
    const context: ProcessingContext = { width, height, channels: 4 };

    const pipeline = new ImageProcessingPipeline();
    const out = await pipeline.processImage(new Float32Array(input), context, { useWebWorkers: false, cacheResults: false });

    expect(maxImageDifference(input, out)).toBeLessThan(0.01);
  });

  it('CROPPED export: the buffer matches the MUTATED context dims, not the source dims', async () => {
    // Regression for the shredded-export bug (v1.29.1): with a crop active the
    // pipeline returns a SMALLER buffer and mutates context.width/height in
    // place. Encoding that buffer with the ORIGINAL dims compresses the image
    // into the top of the frame and leaves a black bottom band. The export
    // callers (ExportDialog, MultiExportService) must read the context back.
    const width = 32;
    const height = 32;
    const input = createTestImage(width, height, 0.5, 0.5, 0.5);
    const context: ProcessingContext = { width, height, channels: 4 };

    const pipeline = new ImageProcessingPipeline();
    const cropModule = pipeline.getModule('crop') as unknown as {
      setCropRegion: (x: number, y: number, w: number, h: number) => void;
    };
    cropModule.setCropRegion(0, 0, 0.5, 0.5);

    const out = await pipeline.processImage(new Float32Array(input), context, { useWebWorkers: false, cacheResults: false });

    // Context reflects the crop…
    expect(context.width).toBe(16);
    expect(context.height).toBe(16);
    // …and the buffer is exactly context dims × RGBA — NOT source dims.
    expect(out.length).toBe(context.width * context.height * 4);
    expect(out.length).not.toBe(input.length);
  });
});
