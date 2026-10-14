/**
 * Pure-logic tests for GpuPreviewPipeline.
 *
 * WebGL2 is unavailable in jsdom (getContext('webgl2') returns null), so these
 * tests can only verify the graceful-degradation path: attach() must return false
 * (not throw) and the pipeline must report itself unavailable. The real render/
 * readback correctness gate is selfTest(), which runs in the Electron app at startup
 * (it needs a live GL context) — NOT here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { GpuPreviewPipeline, gpuPreviewPipeline, memoizeUniformLocation, edgeMaxReductionSizes } from '../shaders/GpuPreviewPipeline';
import type { PassDescriptor } from '../shaders/passDescriptors';
import { cropPassDescriptor } from '../shaders/passDescriptors';
import { CropModule } from '../modules/CropModule';
import { frameRectOf } from '../modules/cropGeometry';
import { DEFAULT_ENHANCE_PARAMS } from '../utils/enhanceChain';

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

describe('runSubPasses texture-unit ordering (local-adjustments red-render regression)', () => {
  // WebGL2 can't run in jsdom, so the real proof is the in-app selfTest() (local-adj went
  // from maxDiff=1.0 FAIL to 1.19e-7 PASS once this ordering was fixed). This source-level
  // net guards the exact structural invariant that broke it: the local-adjustments blend
  // sub-pass binds u_adjusted=scratch on unit 1, then a MaskUpload on unit 2. resolveTexture()
  // UPLOADS the mask on a cache miss (uploadMask → bindTexture + texImage2D on the ACTIVE
  // unit). If resolveTexture() runs while unit 1 is still active, the upload clobbers unit 1,
  // so the shader samples the R32F mask as the "adjusted" image and renders (mask,0,0)=red.
  // The fix: select gl.activeTexture(gl.TEXTURE0 + u) BEFORE resolveTexture(texture).
  const src = readFileSync(join(__dirname, '..', 'shaders', 'GpuPreviewPipeline.ts'), 'utf8');

  it('selects the texture unit before resolving (avoids upload clobbering the previous unit)', () => {
    // Isolate the runSubPasses binding loop body.
    const loopStart = src.indexOf('for (let u = 0; u < bindings.length; u++)');
    expect(loopStart).toBeGreaterThan(-1);
    const loopBody = src.slice(loopStart, loopStart + 1600);

    const activeIdx = loopBody.indexOf('gl.activeTexture(gl.TEXTURE0 + u)');
    const resolveIdx = loopBody.indexOf('resolveTexture(texture)');
    expect(activeIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(-1);
    // The active-unit selection MUST come first, or a cache-miss mask upload lands on the
    // previous binding's unit and re-introduces the red-render bug.
    expect(activeIdx).toBeLessThan(resolveIdx);
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

describe('resident enhance step (v1.40.0 Task 2)', () => {
  // Normalise CRLF so the 2-space method-closing brace is a stable end anchor.
  const src = readFileSync(join(__dirname, '..', 'shaders', 'GpuPreviewPipeline.ts'), 'utf8').replace(/\r\n/g, '\n');
  const methodBody = (signature: string): string => {
    const start = src.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    // Class methods close with a 2-space-indented brace; nested closures sit deeper.
    const end = src.indexOf('\n  }\n', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it('edgeMaxReductionSizes chains ceil(/4) down to 1x1', () => {
    expect(edgeMaxReductionSizes(961, 1280)).toEqual([[241, 320], [61, 80], [16, 20], [4, 5], [1, 2], [1, 1]]);
    expect(edgeMaxReductionSizes(1, 1)).toEqual([[1, 1]]);
    expect(edgeMaxReductionSizes(4, 4)).toEqual([[1, 1]]);
    expect(edgeMaxReductionSizes(5, 1)).toEqual([[2, 1], [1, 1]]);
  });

  it('render([enhancePass]) throws the before-attach error in jsdom (no crash)', () => {
    const pipeline = new GpuPreviewPipeline();
    pipeline.attach();
    const pass: PassDescriptor = {
      id: 'enhance',
      programKey: 'enhance:resident',
      setUniforms: () => undefined,
      residentStep: { kind: 'enhance', params: { ...DEFAULT_ENHANCE_PARAMS, enabled: true, sharpen: true }, kernelScale: 1 },
    };
    expect(() => pipeline.render([pass])).toThrow(/before a successful attach/);
  });

  it('registers the NR denoise program with the SAME source WebGLImageProcessor uses', () => {
    expect(src).toMatch(/^\s+denoise: FRAG_DENOISE,$/m);
  });

  it('render() dispatches residentStep BEFORE the programs.get(pass.programKey) lookup', () => {
    const body = methodBody('render(passes: PassDescriptor[]): PreviewRenderResult {');
    const resident = body.indexOf('pass.residentStep');
    const lookup = body.indexOf('this.programs.get(pass.programKey)');
    expect(resident).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(resident);
    expect(body).toContain('this.runResidentEnhance(gl, inputTexture, this.ping[idx]!, ');
    expect(body).toContain("failedSteps.push('enhance')");
    // Pools are dropped ONLY on a render with no enhance step — freeing on an enhance frame
    // would re-allocate ~1 GB of FBOs every frame. Every call in render() must be guarded.
    const guarded = 'if (!passes.some((p) => p.residentStep)) this.freeEnhancePools(gl);';
    expect(body).toContain(guarded);
    expect(body.split('this.freeEnhancePools(gl)').length - 1).toBe(1);
  });

  it('frees the enhance pools on resize and destroy', () => {
    expect(methodBody('private ensureFramebuffers(')).toContain('this.freeEnhancePools(gl)');
    expect(methodBody('destroy(): void {')).toContain('this.freeEnhancePools(gl)');
  });
});

// ---------------------------------------------------------------------------
// v1.40.0 Task 10a — geometry step (GPU crop) on a mock WebGL2 context
// ---------------------------------------------------------------------------

/**
 * A recording WebGL2 stand-in: constants resolve to their own names, every unknown method
 * is a no-op returning a fresh handle, textures remember their texImage2D size, and a
 * shader whose source matches `failShader` refuses to compile.
 */
function mockGlCanvas(failShader?: RegExp) {
  const log = {
    texImage: [] as Array<{ tex: object; w: number; h: number }>,
    readPixels: [] as Array<[number, number]>,
    viewport: [] as Array<[number, number]>,
  };
  const shaderSrc = new Map<object, string>();
  let boundTex: object | null = null;
  const overrides: Record<string, (...a: unknown[]) => unknown> = {
    getExtension: () => ({}),
    getParameter: () => 16384,
    shaderSource: (sh, src) => { shaderSrc.set(sh as object, src as string); },
    getShaderParameter: (sh) => !(failShader && failShader.test(shaderSrc.get(sh as object) ?? '')),
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: (_p, name) => name,
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
    bindTexture: (_t, tex) => { boundTex = tex as object; },
    texImage2D: (...a) => { log.texImage.push({ tex: boundTex as object, w: a[3] as number, h: a[4] as number }); },
    readPixels: (...a) => { log.readPixels.push([a[2] as number, a[3] as number]); },
    viewport: (...a) => { log.viewport.push([a[2] as number, a[3] as number]); },
    getError: () => 0,
  };
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop in overrides) return overrides[prop];
      if (/^[A-Z0-9_]+$/.test(prop)) return prop;
      return () => ({});
    },
    set() { return true; },
  });
  const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement;
  return { canvas, log };
}

describe('geometry step: GPU crop resizes the working frame (Task 10a)', () => {
  const W = 37, H = 23;
  const geomFor = () => {
    const m = new CropModule();
    m.setParams({ enabled: true, angle: 3.3, orientation: 90, flipHorizontal: true });
    return m.getRenderGeometry(W, H);
  };
  const exposurePass: PassDescriptor = { id: 'exposure', programKey: 'exposure', setUniforms: () => undefined };

  it('crop at passes[0] resizes the FBOs to out dims; getSize/readback follow; next frame restores source dims', () => {
    const { canvas, log } = mockGlCanvas();
    const pipeline = new GpuPreviewPipeline();
    expect(pipeline.attach(canvas)).toBe(true);
    pipeline.setSource(new Float32Array(W * H * 4), W, H);
    const geom = geomFor();
    expect([geom.outW, geom.outH]).not.toEqual([W, H]);
    log.texImage.length = 0;

    const res = pipeline.render([cropPassDescriptor(geom), exposurePass]);
    expect(res).toEqual({ width: geom.outW, height: geom.outH, frameRect: frameRectOf(geom) });
    // Both ping-pong targets reallocated at the output dims; every draw viewport is out-sized.
    expect(log.texImage.filter((t) => t.w === geom.outW && t.h === geom.outH)).toHaveLength(2);
    expect(log.viewport.length).toBeGreaterThan(0);
    expect(log.viewport.every(([w, h]) => w === geom.outW && h === geom.outH)).toBe(true);
    expect(pipeline.getSize()).toEqual({ width: geom.outW, height: geom.outH });
    expect(pipeline.readback().length).toBe(geom.outW * geom.outH * 4);
    expect(log.readPixels[log.readPixels.length - 1]).toEqual([geom.outW, geom.outH]);

    // A crop-free frame on the SAME source goes back to the source dims.
    const res2 = pipeline.render([exposurePass]);
    expect(res2).toEqual({ width: W, height: H });
    expect(pipeline.getSize()).toEqual({ width: W, height: H });
    expect(pipeline.readback().length).toBe(W * H * 4);
  });

  it('a missing crop program is a reported failure and the frame stays at source dims', () => {
    const { canvas } = mockGlCanvas(/u_cropOrigin/);
    const pipeline = new GpuPreviewPipeline();
    expect(pipeline.attach(canvas)).toBe(true);
    pipeline.setSource(new Float32Array(W * H * 4), W, H);
    const res = pipeline.render([cropPassDescriptor(geomFor()), exposurePass]);
    expect(res).toEqual({ width: W, height: H, failedSteps: ['crop'] });
    expect(pipeline.getSize()).toEqual({ width: W, height: H });
  });

  it('a geometry step anywhere but passes[0] is a reported failure (never drawn mid-chain)', () => {
    const { canvas } = mockGlCanvas();
    const pipeline = new GpuPreviewPipeline();
    expect(pipeline.attach(canvas)).toBe(true);
    pipeline.setSource(new Float32Array(W * H * 4), W, H);
    const res = pipeline.render([exposurePass, cropPassDescriptor(geomFor())]);
    expect(res).toEqual({ width: W, height: H, failedSteps: ['crop'] });
  });

  it('selfTest probes crop with the shared descriptor and gates it (incl. the catch-all)', () => {
    const src = readFileSync(join(__dirname, '..', 'shaders', 'GpuPreviewPipeline.ts'), 'utf8');
    const body = src.slice(src.indexOf('selfTest(): {'));
    expect(body).toContain('cropPassDescriptor(');
    expect(body).toContain("if (!cropOk) unsafe.push('crop');");
    const catchAll = body.slice(body.indexOf('} catch (e) {'));
    expect(catchAll).toMatch(/unsafe: \[[^\]]*'crop'[^\]]*\]/);
  });
});
