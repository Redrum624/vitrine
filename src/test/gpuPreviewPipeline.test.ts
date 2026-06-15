/**
 * Pure-logic tests for GpuPreviewPipeline.
 *
 * WebGL2 is unavailable in jsdom (getContext('webgl2') returns null), so these
 * tests can only verify the graceful-degradation path: attach() must return false
 * (not throw) and the pipeline must report itself unavailable. The real render/
 * readback correctness gate is selfTest(), which runs in the Electron app at startup
 * (it needs a live GL context) — NOT here.
 */
import { GpuPreviewPipeline, gpuPreviewPipeline } from '../shaders/GpuPreviewPipeline';

describe('GpuPreviewPipeline (no WebGL2 in jsdom)', () => {
  it('attach() returns false gracefully when WebGL2 is unavailable', () => {
    const pipeline = new GpuPreviewPipeline();
    expect(pipeline.attach()).toBe(false);
    expect(pipeline.isAvailable()).toBe(false);
  });

  it('attach() is idempotent and stays false on repeat calls', () => {
    const pipeline = new GpuPreviewPipeline();
    expect(pipeline.attach()).toBe(false);
    expect(pipeline.attach()).toBe(false);
  });

  it('selfTest() reports FAIL (not throw) when not attached', () => {
    const pipeline = new GpuPreviewPipeline();
    pipeline.attach();
    const r = pipeline.selfTest();
    expect(r.ok).toBe(false);
    expect(Number.isFinite(r.maxDiff)).toBe(false); // Infinity sentinel
  });

  it('exports a shared singleton instance', () => {
    expect(gpuPreviewPipeline).toBeInstanceOf(GpuPreviewPipeline);
  });

  it('setSource/render/readback throw clearly when attach failed', () => {
    const pipeline = new GpuPreviewPipeline();
    pipeline.attach();
    const data = new Float32Array(4 * 4 * 4);
    expect(() => pipeline.setSource(data, 4, 4)).toThrow(/attach/);
    expect(() => pipeline.render([])).toThrow(/attach/);
    expect(() => pipeline.readback()).toThrow(/attach/);
  });
});
