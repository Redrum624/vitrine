/**
 * W3 fix round 1 — finding M1: the DEFAULT-params exposure pass is load-bearing when lens
 * vignetting is active.
 *
 * Pipeline order is crop(0) → lenscorrections(1) → exposure(2) → everything else. Pre-W3 the
 * exposure module ALWAYS ran (its deflicker defaults failed the generic identity check) and its
 * output clamp to [0,1] doubled as the pipeline's clamp for the ONE upstream producer of >1
 * values: vignetting correction, whose multiplicative factor is unclamped (up to 1 + 9·strength
 * at the corners). The W3 exposure identity fast path (394afa5) must therefore NOT fire while
 * vignetting is active, or every downstream module sees >1 inputs and output bytes change vs
 * pre-W3. These tests pin the restored behaviour and the gate's precision.
 */

import { ImageProcessingPipeline, type ProcessingContext } from '../services/ImageProcessingPipeline';
import { LensCorrectionsPipelineModule } from '../modules/LensCorrectionsPipelineModule';
import type { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { createTestImage } from './testUtils';

jest.mock('../utils/Logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const W = 32, H = 32;
const ctx = (): ProcessingContext => ({ width: W, height: H, channels: 4 });

/** Uniform bright input — vignetting amount 100 doubles the corners (0.9 → 1.8 > 1). */
const brightInput = () => createTestImage(W, H, 0.9, 0.9, 0.9);

const enableVignetting = (pipeline: ImageProcessingPipeline, amount: number) => {
  pipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!
    .updateVignettingParams({ enabled: true, amount });
};

/** Downstream-of-exposure module with a guaranteed <1 gain: basicadj exposure −1 (≈×0.5). */
const enableDownstream = (pipeline: ImageProcessingPipeline) => {
  pipeline.getModule<BasicAdjustmentsModule>('basicadj')!.setParams({ exposure: -1.0 });
};

const run = (pipeline: ImageProcessingPipeline, input: Float32Array) =>
  pipeline.processImage(input, ctx(), { useWebWorkers: false, cacheResults: false });

/** Exactly what a default-params exposure pass does: clamp RGB to [0,1], alpha untouched. */
const clamp01 = (buf: Float32Array): Float32Array => {
  const out = new Float32Array(buf);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(1, out[i + c]));
  }
  return out;
};

/** Raw lens output OUTSIDE the pipeline (no identity logic involved) — the >1 producer. */
const rawVignettingOutput = (input: Float32Array): Float32Array => {
  const lens = new LensCorrectionsPipelineModule();
  lens.updateVignettingParams({ enabled: true, amount: 100 });
  return lens.process(new Float32Array(input), ctx());
};

const maxRgb = (buf: Float32Array): number => {
  let max = -Infinity;
  for (let i = 0; i < buf.length; i += 4) {
    for (let c = 0; c < 3; c++) if (buf[i + c] > max) max = buf[i + c];
  }
  return max;
};

describe('default exposure clamps vignetting overshoot (pre-W3 bytes, finding M1)', () => {
  it('premise: vignetting correction produces pipeline values > 1', () => {
    expect(maxRgb(rawVignettingOutput(brightInput()))).toBeGreaterThan(1);
  });

  it('vignetting + default exposure + active downstream module → output equals the pre-W3 clamp-at-position-2 behaviour', async () => {
    const input = brightInput();
    const rawLens = rawVignettingOutput(input);

    // Reference: what pre-W3 produced — the always-run default exposure pass clamped the lens
    // output to [0,1] BEFORE the downstream module saw it.
    const clampedPipeline = new ImageProcessingPipeline();
    enableDownstream(clampedPipeline);
    const expected = await run(clampedPipeline, clamp01(rawLens));

    // Discrimination guard: the same downstream module fed the UNclamped lens output must
    // differ, otherwise this scenario could not detect the missing clamp at all.
    const unclampedPipeline = new ImageProcessingPipeline();
    enableDownstream(unclampedPipeline);
    const unclamped = await run(unclampedPipeline, rawLens);
    expect(Array.from(unclamped)).not.toEqual(Array.from(expected));

    // The real pipeline: vignetting active, exposure at DEFAULTS, downstream active. The
    // exposure identity skip must not fire — output must match the clamped reference exactly.
    const fullPipeline = new ImageProcessingPipeline();
    enableVignetting(fullPipeline, 100);
    enableDownstream(fullPipeline);
    const actual = await run(fullPipeline, input);

    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('gate precision: vignetting section enabled with amount 0 keeps the exposure skip (only lens runs)', async () => {
    const pipeline = new ImageProcessingPipeline();
    enableVignetting(pipeline, 0); // section on, but a 0-amount vignette produces no >1 values
    const totals: number[] = [];
    await pipeline.processImage(brightInput(), ctx(), {
      useWebWorkers: false, cacheResults: false,
      onProgress: (_done, total) => totals.push(total),
    });
    // lens runs (its derived enabled flag is on) but default exposure stays identity-skipped.
    expect(totals[totals.length - 1]).toBe(1);
  });

  it('gate: vignetting amount ≠ 0 pulls the default exposure pass back in (lens + exposure run)', async () => {
    const pipeline = new ImageProcessingPipeline();
    enableVignetting(pipeline, 100);
    const totals: number[] = [];
    await pipeline.processImage(brightInput(), ctx(), {
      useWebWorkers: false, cacheResults: false,
      onProgress: (_done, total) => totals.push(total),
    });
    expect(totals[totals.length - 1]).toBe(2);
  });

  it('no vignetting → the exposure identity fast path still fires (R5 preserved: input reference returned)', async () => {
    const pipeline = new ImageProcessingPipeline();
    const input = brightInput();
    const out = await run(pipeline, input);
    expect(out).toBe(input);
  });
});
