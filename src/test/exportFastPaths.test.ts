/**
 * R5 cheap wins (2026-07-20 export-speed task):
 *  - identity export: processOnMainThread returns the INPUT buffer (no defensive full-buffer copy)
 *    when zero modules are active — nothing runs, nothing can mutate it.
 *  - NoiseReductionModule skips its diagnostics-only logQualityMetrics full-buffer loops when the
 *    context carries isExport (pixel output identical either way).
 */

import { ImageProcessingPipeline, type ProcessingContext } from '../services/ImageProcessingPipeline';
import type { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { createNoiseImage, createTestImage } from './testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('identity export skips the defensive input copy (R5)', () => {
  it('zero active modules → the exact input reference is returned (no copy)', async () => {
    const width = 16, height = 16;
    const input = createTestImage(width, height, 0.5, 0.5, 0.5);
    const context: ProcessingContext = { width, height, channels: 4 };
    const pipeline = new ImageProcessingPipeline();

    const out = await pipeline.processImage(input, context, { useWebWorkers: false, cacheResults: false });
    expect(out).toBe(input); // same reference — a 20MP identity export no longer pays a ~320MB copy
  });

  it('with an active module the input is NOT returned and stays untouched', async () => {
    const width = 16, height = 16;
    const input = createTestImage(width, height, 0.5, 0.5, 0.5);
    const before = input.slice();
    const context: ProcessingContext = { width, height, channels: 4 };
    const pipeline = new ImageProcessingPipeline();
    pipeline.getModule<BasicAdjustmentsModule>('basicadj')!.setParams({ exposure: 1.0 });

    const out = await pipeline.processImage(input, context, { useWebWorkers: false, cacheResults: false });
    expect(out).not.toBe(input);
    // The caller's buffer is never mutated by the pipeline (the defensive-copy contract holds
    // whenever any module actually runs).
    expect(Array.from(input)).toEqual(Array.from(before));
  });
});

describe('NoiseReduction logQualityMetrics is skipped on export passes (R5)', () => {
  const width = 16, height = 16;

  const activeModule = () => {
    const mod = new NoiseReductionModule();
    mod.setParams({ enabled: true, method: 'nlmeans', strength: 40, preserveDetail: 70, chromaStrength: 30, lumaStrength: 40 });
    return mod;
  };

  it('runs the metrics on non-export passes and skips them when isExport is set — same pixels', () => {
    const input = createNoiseImage(width, height, 5);

    const modA = activeModule();
    const spyA = jest.spyOn(modA as unknown as { logQualityMetrics(i: Float32Array, o: Float32Array): void }, 'logQualityMetrics');
    const preview = modA.process(input.slice(), { width, height, channels: 4 });
    expect(spyA).toHaveBeenCalledTimes(1);

    const modB = activeModule();
    const spyB = jest.spyOn(modB as unknown as { logQualityMetrics(i: Float32Array, o: Float32Array): void }, 'logQualityMetrics');
    const exported = modB.process(input.slice(), { width, height, channels: 4, isExport: true });
    expect(spyB).not.toHaveBeenCalled();

    // The skip is diagnostics-only: identical output either way.
    expect(Array.from(exported)).toEqual(Array.from(preview));
  });
});
