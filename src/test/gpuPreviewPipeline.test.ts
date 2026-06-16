/**
 * Pure-logic tests for GpuPreviewPipeline.
 *
 * WebGL2 is unavailable in jsdom (getContext('webgl2') returns null), so these
 * tests can only verify the graceful-degradation path: attach() must return false
 * (not throw) and the pipeline must report itself unavailable. The real render/
 * readback correctness gate is selfTest(), which runs in the Electron app at startup
 * (it needs a live GL context) — NOT here.
 */
import { GpuPreviewPipeline, gpuPreviewPipeline, memoizeUniformLocation } from '../shaders/GpuPreviewPipeline';

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

describe('memoizeUniformLocation', () => {
  // Stand-ins for the opaque GL handles — identity is all that matters here.
  const programA = {} as WebGLProgram;
  const programB = {} as WebGLProgram;
  const locImage = {} as WebGLUniformLocation;
  const locGain = {} as WebGLUniformLocation;

  it('queries the raw fn only ONCE for a repeated (program, name)', () => {
    const raw = jest.fn(() => locImage);
    const memo = memoizeUniformLocation(raw);

    const first = memo(programA, 'u_image');
    const second = memo(programA, 'u_image');
    const third = memo(programA, 'u_image');

    expect(first).toBe(locImage);
    expect(second).toBe(locImage);
    expect(third).toBe(locImage);
    expect(raw).toHaveBeenCalledTimes(1); // cached after the first lookup
  });

  it('calls through for distinct names and distinct programs', () => {
    const raw = jest.fn((_program: WebGLProgram, name: string) =>
      name === 'u_image' ? locImage : locGain,
    );
    const memo = memoizeUniformLocation(raw);

    // Distinct names on the same program → separate lookups.
    expect(memo(programA, 'u_image')).toBe(locImage);
    expect(memo(programA, 'u_gain')).toBe(locGain);
    // Same names on a DIFFERENT program → not collapsed across programs.
    expect(memo(programB, 'u_image')).toBe(locImage);
    expect(memo(programB, 'u_gain')).toBe(locGain);

    expect(raw).toHaveBeenCalledTimes(4);

    // All four are now cached — no further raw calls.
    memo(programA, 'u_image');
    memo(programA, 'u_gain');
    memo(programB, 'u_image');
    memo(programB, 'u_gain');
    expect(raw).toHaveBeenCalledTimes(4);
  });

  it('caches a null result (raw called once even when it returns null)', () => {
    // A uniform optimized-out of the shader returns null; we must not re-query it.
    const raw = jest.fn(() => null);
    const memo = memoizeUniformLocation(raw);

    expect(memo(programA, 'u_unused')).toBeNull();
    expect(memo(programA, 'u_unused')).toBeNull();
    expect(memo(programA, 'u_unused')).toBeNull();
    expect(raw).toHaveBeenCalledTimes(1); // null is cached via map.has(), not truthiness
  });
});
