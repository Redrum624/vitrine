/**
 * @jest-environment node
 *
 * Worker-safety regression (v1.29). The pipeline worker imports the REAL
 * ImageProcessingPipeline, which transitively imports the Logger singleton —
 * an unguarded `window` reference there crashed the whole worker bundle at
 * module evaluation ("window is not defined"), so every ≥1MP CPU preview pass
 * hung through 30s dead-worker timeouts (the stuck "Applying…" spinner).
 *
 * This test runs in a NODE environment (no `window`, like a worker scope) and
 * asserts the worker's import graph evaluates and processes an image.
 */

describe('pipeline worker import graph is window-free', () => {
  test('Logger singleton constructs without window', () => {
    expect(typeof window).toBe('undefined');
    expect(() => {
      const { logger } = require('../utils/Logger');
      logger.info('worker-safety probe');
    }).not.toThrow();
  });

  test('ImageProcessingPipeline constructs and processes without window', () => {
    const { ImageProcessingPipeline } = require('../services/ImageProcessingPipeline');
    const pipeline = new ImageProcessingPipeline();
    const W = 8;
    const H = 8;
    const data = new Float32Array(W * H * 4).fill(0.5);
    const context = { width: W, height: H, channels: 4 };
    // useWebWorkers=false: the exact configuration pipeline.worker.ts runs with.
    return expect(
      pipeline.processImage(data, context, { useWebWorkers: false }),
    ).resolves.toBeInstanceOf(Float32Array);
  });
});
