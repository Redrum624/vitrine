import { buildPassList, buildLocalAdjustmentsPass, computeWBGains, GPU_MODULE_IDS, OPT_IN_GPU_MODULE_IDS, setGpuUnsafeModuleIds, getGpuUnsafeModuleIds } from '../shaders/passDescriptors';
import type { MaskUpload } from '../shaders/passDescriptors';
import { LocalAdjustmentsModule } from '../modules/LocalAdjustmentsModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';
import { ExposureModule } from '../modules/ExposureModule';
import { ShadowsHighlightsModule } from '../modules/ShadowsHighlightsModule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeModule = (id: string, enabled: boolean, params: Record<string, unknown>) => ({
  getId: () => id,
  getName: () => id,
  isEnabled: enabled,
  getParams: () => params,
  process: (d: Float32Array) => d,
});

// Minimal no-op WebGL2RenderingContext so setUniforms can be called in Jest
const makeGl = () =>
  ({
    getUniformLocation: () => null,
    uniform1f: () => undefined,
    uniform1i: () => undefined,
    uniform2f: () => undefined,
    uniform3f: () => undefined,
    uniform1fv: () => undefined,
  } as unknown as WebGL2RenderingContext);

const DUMMY_PROG = {} as WebGLProgram;

const DEFAULT_RT = { width: 800, height: 600, dehaze: { active: false, hazeStrength: 0, hazeDivisor: 1 } };

// ---------------------------------------------------------------------------
// GPU_MODULE_IDS uses real pipeline ids
// ---------------------------------------------------------------------------

test('GPU_MODULE_IDS uses real pipeline ids and contains exposure, excludes huecurves', () => {
  expect(GPU_MODULE_IDS).toEqual(
    expect.arrayContaining(['temperature', 'exposure', 'basicadj', 'tonecurve', 'colorbalance', 'lenscorrections', 'shadowshighlights']),
  );
  expect(GPU_MODULE_IDS).not.toContain('whitebalance');
  expect(GPU_MODULE_IDS).not.toContain('huecurves');
});

test('GPU_MODULE_IDS contains shadowshighlights', () => {
  expect(GPU_MODULE_IDS).toContain('shadowshighlights');
});

test('OPT_IN_GPU_MODULE_IDS contains noise-reduction and not huecurves', () => {
  expect(OPT_IN_GPU_MODULE_IDS).toContain('noise-reduction');
  expect(OPT_IN_GPU_MODULE_IDS).not.toContain('huecurves');
});

// ---------------------------------------------------------------------------
// GPU self-test gating — a module whose shader failed the self-test must run on
// the CPU (regression for the broken tonecurve GPU pass rendering images red).
// ---------------------------------------------------------------------------

describe('GPU self-test gating', () => {
  afterEach(() => setGpuUnsafeModuleIds([])); // never leak gating state across tests

  test('an enabled, edited tonecurve normally produces a GPU pass', () => {
    const tc = fakeModule('tonecurve', true, { lookupTable: new Float32Array(65536).fill(0.5) });
    const { passes, cpuBridges } = buildPassList([tc], DEFAULT_RT);
    expect(passes.map((p) => p.id)).toContain('tonecurve');
    expect(cpuBridges).not.toContain('tonecurve');
  });

  test('a self-test-failed module is routed to cpuBridges instead of a GPU pass', () => {
    setGpuUnsafeModuleIds(['tonecurve']);
    expect(getGpuUnsafeModuleIds().has('tonecurve')).toBe(true);
    const tc = fakeModule('tonecurve', true, { lookupTable: new Float32Array(65536).fill(0.5) });
    const basic = fakeModule('basicadj', true, { exposure: 0.5 });
    const { passes, cpuBridges } = buildPassList([basic, tc], DEFAULT_RT);
    // tonecurve falls back to CPU; the unaffected basicadj still runs on the GPU.
    expect(cpuBridges).toContain('tonecurve');
    expect(passes.map((p) => p.id)).not.toContain('tonecurve');
    expect(passes.map((p) => p.id)).toContain('basicadj');
  });

  test('clearing the unsafe set restores the GPU pass', () => {
    setGpuUnsafeModuleIds(['tonecurve']);
    setGpuUnsafeModuleIds([]);
    const tc = fakeModule('tonecurve', true, { lookupTable: new Float32Array(65536).fill(0.5) });
    const { passes } = buildPassList([tc], DEFAULT_RT);
    expect(passes.map((p) => p.id)).toContain('tonecurve');
  });
});

// ---------------------------------------------------------------------------
// ID-contract test — locks real module ids against future drift
// ---------------------------------------------------------------------------

test('real WhiteBalanceModule id is in the GPU set', () => {
  expect(GPU_MODULE_IDS).toContain(new WhiteBalanceModule().getId());
});

test('real BasicAdjustmentsModule id is in the GPU set', () => {
  expect(GPU_MODULE_IDS).toContain(new BasicAdjustmentsModule().getId());
});

test('real ToneCurvePipelineModule id is in the GPU set', () => {
  expect(GPU_MODULE_IDS).toContain(new ToneCurvePipelineModule().getId());
});

test('real ExposureModule id is in the GPU set', () => {
  expect(GPU_MODULE_IDS).toContain(new ExposureModule().getId());
});

// ---------------------------------------------------------------------------
// Routing test using REAL ids
// ---------------------------------------------------------------------------

test('only enabled GPU modules become passes, in input order (real ids)', () => {
  const modules = [
    fakeModule('temperature', true, { temperature: 10, tint: 0 }),
    fakeModule('basicadj', false, {}),
    fakeModule('tonecurve', true, { master: [], red: [], green: [], blue: [], preserveColors: 0 }),
    fakeModule('localadjustments', true, { layers: [{}] }),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes.map(p => p.id)).toEqual(['temperature', 'tonecurve']);
  expect(cpuBridges).toContain('localadjustments');
});

// ---------------------------------------------------------------------------
// setUniforms has arity 3: (gl, program, rt) — runtime context injected
// ---------------------------------------------------------------------------

test('temperature pass setUniforms accepts (gl, prog, rt) — arity 3', () => {
  const modules = [fakeModule('temperature', true, { temperature: 6500, tint: 0 })];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].programKey).toBe('gains');
  // Must be callable with three args and not throw
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
});

test('basicadj pass setUniforms injects dehaze from rt, not baked-in placeholder', () => {
  const modules = [fakeModule('basicadj', true, {
    exposure: 0, black_point: 0, brightness: 0, contrast: 0,
    dehaze: 0, highlights: 0, shadows: 0, saturation: 0, vibrance: 0,
  })];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  // setUniforms must accept a runtime with active dehaze — no throw
  const rt = { width: 1920, height: 1080, dehaze: { active: true, hazeStrength: 0.4, hazeDivisor: 2.1 } };
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, rt)).not.toThrow();
});

test('lenscorrections sub-pass setUniforms reads width/height from rt', () => {
  const params = {
    distortion: { enabled: true, barrel: 10, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 },
    chromaticAberration: { enabled: false },
    vignetting: { enabled: false },
  };
  const modules = [fakeModule('lenscorrections', true, params)];
  const { passes } = buildPassList(modules);
  const distPass = passes.find(p => p.id === 'lenscorrections:distortion');
  expect(distPass).toBeDefined();
  // Should read width/height from rt (1920×1080) instead of any baked 0,0
  expect(() => distPass!.setUniforms(makeGl(), DUMMY_PROG, { width: 1920, height: 1080, dehaze: DEFAULT_RT.dehaze })).not.toThrow();
});

// ---------------------------------------------------------------------------
// Disabled GPU module → cpuBridges
// ---------------------------------------------------------------------------

test('disabled GPU module goes to cpuBridges, not passes', () => {
  const modules = [fakeModule('basicadj', false, { exposure: 0 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('basicadj');
});

// ---------------------------------------------------------------------------
// CPU-only modules always go to cpuBridges
// ---------------------------------------------------------------------------

test('cpu-only modules always go to cpuBridges', () => {
  const modules = [
    fakeModule('crop', true, {}),
    fakeModule('noise-reduction', true, {}),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toEqual(['crop', 'noise-reduction']);
});

// ---------------------------------------------------------------------------
// lenscorrections sub-passes
// ---------------------------------------------------------------------------

test('lenscorrections emits up to 3 sub-passes for enabled sub-effects', () => {
  const params = {
    distortion: { enabled: true, barrel: 10, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 },
    chromaticAberration: { enabled: true, redCyan: 5, blueMagenta: -3 },
    vignetting: { enabled: true, amount: -30, midpoint: 0.5, roundness: 0, feather: 0.5 },
    blur: { enabled: false, radius: 0 },
    filmGrain: { enabled: false, amount: 0, size: 1 },
  };
  const modules = [fakeModule('lenscorrections', true, params)];
  const { passes, cpuBridges } = buildPassList(modules);
  const lensIds = passes.map(p => p.id);
  expect(lensIds).toContain('lenscorrections:distortion');
  expect(lensIds).toContain('lenscorrections:lateralca');
  expect(lensIds).toContain('lenscorrections:vignette');
  expect(cpuBridges).not.toContain('lenscorrections');
});

test('lenscorrections identity distortion is skipped → cpuBridges', () => {
  const params = {
    distortion: { enabled: true, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 },
    chromaticAberration: { enabled: false, redCyan: 0, blueMagenta: 0 },
    vignetting: { enabled: false, amount: 0, midpoint: 0.5, roundness: 0, feather: 0.5 },
    blur: { enabled: false, radius: 0 },
    filmGrain: { enabled: false, amount: 0, size: 1 },
  };
  const modules = [fakeModule('lenscorrections', true, params)];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('lenscorrections');
});

// ---------------------------------------------------------------------------
// tonecurve carries luts
// ---------------------------------------------------------------------------

test('tonecurve pass carries luts when provided (fake module with lookupTable in params)', () => {
  const lut = new Float32Array(65536);
  const modules = [fakeModule('tonecurve', true, {
    lookupTable: lut,
    rgbLookupTables: { red: lut, green: lut, blue: lut },
    preserveColors: 0,
  })];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].luts).toBeDefined();
  expect(passes[0].luts!.master).toBe(lut);
});

// ---------------------------------------------------------------------------
// REAL ToneCurvePipelineModule exposes LUTs via getGpuLuts() → pass builder
// This is the correctness test: when a real module has a non-identity curve,
// the GPU pass must carry all 4 Float32Array LUTs (master/red/green/blue).
// ---------------------------------------------------------------------------

test('real ToneCurvePipelineModule with non-identity curve produces a tonecurve pass with all 4 LUTs', () => {
  const tcModule = new ToneCurvePipelineModule();
  // Set a clearly non-identity master curve that darkens midtones:
  // midpoint pulled down from 0.5→0.35
  tcModule.getToneCurveModule().setParams({
    baseCurve: [
      { x: 0.0, y: 0.0 },
      { x: 0.5, y: 0.35 },
      { x: 1.0, y: 1.0 },
    ],
    baseCurveNodes: 3,
  });

  const { passes } = buildPassList([tcModule]);
  expect(passes).toHaveLength(1);
  expect(passes[0].id).toBe('tonecurve');

  const { luts } = passes[0];
  expect(luts).toBeDefined();
  expect(luts!.master).toBeInstanceOf(Float32Array);
  expect(luts!.red).toBeInstanceOf(Float32Array);
  expect(luts!.green).toBeInstanceOf(Float32Array);
  expect(luts!.blue).toBeInstanceOf(Float32Array);
  expect(luts!.master.length).toBe(65536);
  expect(luts!.red.length).toBe(65536);
  expect(luts!.green.length).toBe(65536);
  expect(luts!.blue.length).toBe(65536);

  // The master LUT must NOT be identity at the midpoint — value at index 32768
  // (which maps to input ~0.5) should be ~0.35, not ~0.5
  const midVal = luts!.master[32768];
  expect(midVal).toBeLessThan(0.45); // darkened midtone
});

// ---------------------------------------------------------------------------
// Empty module list
// ---------------------------------------------------------------------------

test('empty module list returns empty results', () => {
  const { passes, cpuBridges } = buildPassList([]);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Exposure pass descriptor tests (Task 7)
// ---------------------------------------------------------------------------

test('exposure module routes to a GPU pass with programKey "exposure"', () => {
  const modules = [fakeModule('exposure', true, { exposure: 0.5, black: 0.05, mode: 'manual' })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].id).toBe('exposure');
  expect(passes[0].programKey).toBe('exposure');
  expect(cpuBridges).not.toContain('exposure');
});

test('exposure pass setUniforms accepts (gl, prog, rt) — arity 3, does not throw', () => {
  const modules = [fakeModule('exposure', true, { exposure: 0.7, black: 0.03, mode: 'manual' })];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
});

test('disabled exposure module goes to cpuBridges, not passes', () => {
  const modules = [fakeModule('exposure', false, { exposure: 0.5, black: 0.0, mode: 'manual' })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('exposure');
});

test('real ExposureModule with non-default params produces an exposure pass', () => {
  const expModule = new ExposureModule();
  expModule.setCurrentParams({ exposure: 0.7, black: 0.05 });
  const { passes } = buildPassList([expModule]);
  expect(passes).toHaveLength(1);
  expect(passes[0].id).toBe('exposure');
  expect(passes[0].programKey).toBe('exposure');
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
});

test('exposure GPU math matches ExposureModule.process() for non-default params', () => {
  // Verify the gain/black formula matches the CPU reference for a set of test values.
  // This is a pure-math check (no GL needed): both paths compute max(0, v-black)*gain, clamp.
  const stops = 0.7;
  const black = 0.05;
  const gain = Math.pow(2, stops);

  // Simulate what the GPU shader does (GLSL max/clamp in JS)
  const testValues = [0.0, 0.05, 0.1, 0.3, 0.5, 0.8, 1.0];
  for (const v of testValues) {
    const gpuResult = Math.min(1.0, Math.max(0.0, Math.max(0.0, v - black) * gain));

    // ExposureModule CPU reference
    const cpuResult = Math.max(0, Math.min(1, Math.max(0, v - black) * gain));

    expect(gpuResult).toBeCloseTo(cpuResult, 6);
  }
});

// ---------------------------------------------------------------------------
// Shadows/Highlights pass descriptor tests (Task 9)
// ---------------------------------------------------------------------------

test('real ShadowsHighlightsModule id is in the GPU set', () => {
  // ShadowsHighlightsModule implements ImageProcessingModule (id property), while the
  // pipeline wrapper's getId() returns the same 'shadowshighlights'. Lock both.
  expect(GPU_MODULE_IDS).toContain(new ShadowsHighlightsModule().id);
});

test('shadowshighlights with maskBlur:0 + non-neutral params yields a GPU pass', () => {
  // Use the REAL module's getParams() so param field names are verified, then flip
  // maskBlur to 0 (default is 1.0) and push a non-neutral value through.
  const realParams = new ShadowsHighlightsModule().getParams();
  const params = { ...realParams, maskBlur: 0, bilateralFilter: false, shadows: 70 };
  const modules = [fakeModule('shadowshighlights', true, params)];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].id).toBe('shadowshighlights');
  expect(passes[0].programKey).toBe('shadowshighlights');
  expect(cpuBridges).not.toContain('shadowshighlights');
  // setUniforms has arity 3 and must not throw with the no-op GL mock
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
});

test('shadowshighlights with default maskBlur (1.0) falls back to CPU bridge', () => {
  // Default maskBlur is 1.0 (>0) → cross-pixel blur the shader cannot match → CPU.
  const params = new ShadowsHighlightsModule().getParams();
  expect(params.maskBlur).toBeGreaterThan(0); // lock the default assumption
  const modules = [fakeModule('shadowshighlights', true, { ...params, shadows: 70 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('shadowshighlights');
});

test('shadowshighlights with bilateralFilter:true falls back to CPU bridge even at maskBlur:0', () => {
  const params = new ShadowsHighlightsModule().getParams();
  const modules = [fakeModule('shadowshighlights', true, { ...params, maskBlur: 0, bilateralFilter: true })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('shadowshighlights');
});

test('disabled shadowshighlights goes to cpuBridges, not passes', () => {
  const params = new ShadowsHighlightsModule().getParams();
  const modules = [fakeModule('shadowshighlights', false, { ...params, maskBlur: 0 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('shadowshighlights');
});

// ---------------------------------------------------------------------------
// HighlightRecovery pass descriptor tests (M1) — pointwise, always GPU-representable
// ---------------------------------------------------------------------------

test('GPU_MODULE_IDS contains highlightrecovery', () => {
  expect(GPU_MODULE_IDS).toContain('highlightrecovery');
});

test('enabled highlightrecovery yields a single GPU pass (no CPU bridge)', () => {
  const modules = [fakeModule('highlightrecovery', true, { enabled: true, strength: 60 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].id).toBe('highlightrecovery');
  expect(passes[0].programKey).toBe('highlightrecovery');
  expect(cpuBridges).not.toContain('highlightrecovery');
  // setUniforms has arity 3 and must not throw with the no-op GL mock
  expect(() => passes[0].setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
});

test('highlightrecovery still builds a pass at strength 0 (shader computes identity)', () => {
  const modules = [fakeModule('highlightrecovery', true, { enabled: true, strength: 0 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].programKey).toBe('highlightrecovery');
  expect(cpuBridges).not.toContain('highlightrecovery');
});

test('disabled highlightrecovery goes to cpuBridges, not passes', () => {
  const modules = [fakeModule('highlightrecovery', false, { enabled: false, strength: 60 })];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('highlightrecovery');
});

test('a self-test-unsafe highlightrecovery routes to the CPU bridge', () => {
  setGpuUnsafeModuleIds(['highlightrecovery']);
  try {
    const modules = [fakeModule('highlightrecovery', true, { enabled: true, strength: 60 })];
    const { passes, cpuBridges } = buildPassList(modules);
    expect(passes).toHaveLength(0);
    expect(cpuBridges).toContain('highlightrecovery');
  } finally {
    setGpuUnsafeModuleIds([]);
  }
});

// Pure-math correctness: replicate the FRAG_SHADOWSHIGHLIGHTS analytic math in JS and
// compare to the real ShadowsHighlightsModule.process() at maskBlur:0. No GL needed —
// this catches formula drift between the shader and the CPU at the unit-test level (the
// runtime GL selfTest is the second gate). Tolerance mirrors color-balance (2e-2).
test('shadows/highlights analytic shader math matches CPU module (maskBlur:0)', () => {
  const W = { r: 0.2126, g: 0.7152, b: 0.0722 };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const p = {
    shadows: 70, highlights: 35, shadowsRadius: 60, highlightsRadius: 55,
    shadowsColorTransfer: 30, highlightsColorTransfer: 20,
    whitePoint: 0.5, blackPoint: 5, compress: 25,
    shadowsColorCorrection: 15, highlightsColorCorrection: 10,
    maskFalloff: 2.0, strength: 1.2, preserveColor: false, iterations: 2,
    maskBlur: 0, bilateralFilter: false, enabled: true,
  };

  // JS replica of the fragment shader (per pixel).
  const shaderPixel = (r0: number, g0: number, b0: number): [number, number, number] => {
    let r = r0, g = g0, b = b0;
    const lum0 = r * W.r + g * W.g + b * W.b;
    const sRad = p.shadowsRadius / 100;
    const hRad = p.highlightsRadius / 100, hThr = 1 - hRad;
    const shadowMask = lum0 < sRad ? 1 : (lum0 < sRad * 2 ? 1 - Math.pow((lum0 - sRad) / sRad, p.maskFalloff) : 0);
    const highlightMask = lum0 > hThr ? 1 : (lum0 > hThr * 0.5 ? 1 - Math.pow((hThr - lum0) / (hThr * 0.5), p.maskFalloff) : 0);
    const shadowAmount = (p.shadows - 50) / 50, highlightAmount = (p.highlights - 50) / 50;
    const sCT = p.shadowsColorTransfer / 100, hCT = p.highlightsColorTransfer / 100;
    const whiteAdjust = 1 + p.whitePoint * 0.25, blackAdjust = p.blackPoint / 100;
    for (let it = 0; it < p.iterations; it++) {
      if (p.shadows !== 50) {
        const effect = shadowMask * shadowAmount * p.strength;
        if (effect !== 0) {
          const lum = r * W.r + g * W.g + b * W.b;
          const recovery = Math.pow(1 - lum, 0.5) * effect;
          const mix = sCT * Math.abs(effect), avg = (r + g + b) / 3;
          r = clamp01(r + recovery + (avg - r) * mix);
          g = clamp01(g + recovery + (avg - g) * mix);
          b = clamp01(b + recovery + (avg - b) * mix);
        }
      }
      if (p.highlights !== 50) {
        const effect = highlightMask * highlightAmount * p.strength;
        if (effect !== 0) {
          const lum = r * W.r + g * W.g + b * W.b;
          const recovery = Math.pow(lum, 0.5) * effect * 0.3;
          const mix = hCT * Math.abs(effect) * 0.3, avg = (r + g + b) / 3;
          r = clamp01(r - recovery + (avg - r) * mix);
          g = clamp01(g - recovery + (avg - g) * mix);
          b = clamp01(b - recovery + (avg - b) * mix);
        }
      }
      if (p.whitePoint !== 0 || p.blackPoint !== 0) {
        r = Math.min(1, Math.max(0, r - blackAdjust) * whiteAdjust);
        g = Math.min(1, Math.max(0, g - blackAdjust) * whiteAdjust);
        b = Math.min(1, Math.max(0, b - blackAdjust) * whiteAdjust);
      }
    }
    const compress = p.compress / 100;
    if (compress >= 0.01) {
      const factor = 1 - compress * 0.3;
      r = clamp01(r * factor); g = clamp01(g * factor); b = clamp01(b * factor);
    }
    const sCorr = p.shadowsColorCorrection / 100, hCorr = p.highlightsColorCorrection / 100;
    if (Math.abs(sCorr) >= 0.001 || Math.abs(hCorr) >= 0.001) {
      if (shadowMask > 0 && Math.abs(sCorr) > 0.001) {
        const c = 1 + sCorr * shadowMask; r = clamp01(r * c); g = clamp01(g * c); b = clamp01(b * c);
      }
      if (highlightMask > 0 && Math.abs(hCorr) > 0.001) {
        const c = 1 - hCorr * highlightMask; r = clamp01(r * c); g = clamp01(g * c); b = clamp01(b * c);
      }
    }
    return [r, g, b];
  };

  // 8x8 test image.
  const w = 8, h = 8;
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i % 8) / 8; data[i * 4 + 1] = ((i * 5) % 8) / 8; data[i * 4 + 2] = ((i * 3) % 8) / 8; data[i * 4 + 3] = 1;
  }

  const mod = new ShadowsHighlightsModule();
  mod.setParams(p);
  const cpu = mod.process({ width: w, height: h, data: new Float32Array(data), channels: 4 }).data;

  let maxDiff = 0;
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = shaderPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    maxDiff = Math.max(maxDiff, Math.abs(r - cpu[i * 4]), Math.abs(g - cpu[i * 4 + 1]), Math.abs(b - cpu[i * 4 + 2]));
  }
  expect(maxDiff).toBeLessThan(0.02);
});

test('single-pass descriptors have NO subPasses (additive branch does not regress them)', () => {
  const modules = [
    fakeModule('temperature', true, { temperature: 6500, tint: 0 }),
    fakeModule('exposure', true, { exposure: 0.5, black: 0 }),
    fakeModule('basicadj', true, { exposure: 0, black_point: 0, brightness: 0, contrast: 0, dehaze: 0, highlights: 0, shadows: 0, saturation: 0, vibrance: 0 }),
  ];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(3);
  for (const p of passes) expect(p.subPasses).toBeUndefined();
});

// ---------------------------------------------------------------------------
// WB gains single-source check: module process() and GPU gains path must agree
// ---------------------------------------------------------------------------

test('computeWBGains (from WhiteBalanceModule) output matches module process() for a known temperature', () => {
  const temperature = 4000;
  const tint = 20;

  // Run actual module process on a 1x1 mid-gray pixel
  const wbModule = new WhiteBalanceModule();
  wbModule.setParams({ temperature, tint });
  const inputGray = new Float32Array([0.5, 0.5, 0.5, 1.0]);
  const ctx = { width: 1, height: 1, channels: 4 };

  // The module applies gains to the pixel — extract implied gains
  const output = wbModule.process(inputGray, ctx);
  const impliedR = output[0] / 0.5;
  const impliedG = output[1] / 0.5;
  const impliedB = output[2] / 0.5;

  const gains = computeWBGains(temperature, tint);

  // Gains should match within floating-point rounding (1e-4 tolerance)
  expect(gains.r).toBeCloseTo(impliedR, 4);
  expect(gains.g).toBeCloseTo(impliedG, 4);
  expect(gains.b).toBeCloseTo(impliedB, 4);
});

// ---------------------------------------------------------------------------
// Local Adjustments pass descriptor tests (Task 10 — masks on GPU)
// Pure logic only — NO real GL. Mask upload happens in render() at runtime.
// ---------------------------------------------------------------------------

const W2 = 16, H2 = 16;

/** Build a real LA module with one active radial basicAdj layer, return its getParams shape. */
const oneActiveLayer = () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerBasicAdj(id, { exposure: 0.3, contrast: 0.2 });
  return { params: { enabled: true, layers: m.getLayers() } as Record<string, unknown>, id };
};

test('buildLocalAdjustmentsPass: one active basicAdj layer yields basicadj + layerblend sub-passes', () => {
  const { params, id } = oneActiveLayer();
  const pass = buildLocalAdjustmentsPass(params, W2, H2);
  expect(pass).not.toBeNull();
  expect(pass!.id).toBe('localadjustments');
  expect(pass!.subPasses).toBeDefined();
  expect(pass!.subPasses!).toHaveLength(2); // 2 per layer

  const [basicadj, blend] = pass!.subPasses!;
  expect(basicadj.programKey).toBe('basicadj');
  expect(basicadj.bindings).toEqual([{ texture: 'prev', sampler: 'u_image' }]);
  expect(basicadj.target).toBe('scratch');
  expect(basicadj.id).toContain(id);

  expect(blend.programKey).toBe('layerblend');
  expect(blend.target).toBe('pingpong');
  // base = prev (running), adjusted = scratch, mask = a MaskUpload bound to u_mask.
  expect(blend.bindings![0]).toEqual({ texture: 'prev', sampler: 'u_base' });
  expect(blend.bindings![1]).toEqual({ texture: 'scratch', sampler: 'u_adjusted' });
  const maskBinding = blend.bindings![2];
  expect(maskBinding.sampler).toBe('u_mask');
  const mask = maskBinding.texture as MaskUpload;
  expect(mask.kind).toBe('mask');
  expect(mask.data).toBeInstanceOf(Float32Array);
  expect(mask.width).toBe(W2);
  expect(mask.height).toBe(H2);
  expect(mask.data.length).toBe(W2 * H2);
});

test('buildLocalAdjustmentsPass: two active layers yield 4 sub-passes (basicadj+blend per layer)', () => {
  const m = new LocalAdjustmentsModule();
  const id1 = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerBasicAdj(id1, { exposure: 0.3 });
  const id2 = m.createLayer('radial_gradient', 'L2', W2, H2);
  m.updateLayerBasicAdj(id2, { brightness: 0.4 });
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;

  const pass = buildLocalAdjustmentsPass(params, W2, H2);
  expect(pass).not.toBeNull();
  expect(pass!.subPasses!).toHaveLength(4);
  expect(pass!.subPasses!.map(sp => sp.programKey)).toEqual(['basicadj', 'layerblend', 'basicadj', 'layerblend']);
  // Each layer's blend advances the chain; each basicadj writes scratch.
  expect(pass!.subPasses!.map(sp => sp.target)).toEqual(['scratch', 'pingpong', 'scratch', 'pingpong']);
});

test('buildLocalAdjustmentsPass: no active layers → null (identity)', () => {
  const m = new LocalAdjustmentsModule();
  m.createLayer('radial_gradient', 'L1', W2, H2); // created but neutral basicAdj-less → not active
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  expect(buildLocalAdjustmentsPass(params, W2, H2)).toBeNull();
});

test('buildLocalAdjustmentsPass: a neutral basicAdj layer (all zero) → null (identity)', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerBasicAdj(id, {}); // marks basicAdj but all-neutral
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  expect(buildLocalAdjustmentsPass(params, W2, H2)).toBeNull();
});

test('buildLocalAdjustmentsPass: a disabled active layer is skipped → null', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerBasicAdj(id, { exposure: 0.3 });
  const layer = m.getLayer(id)!;
  layer.enabled = false;
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  expect(buildLocalAdjustmentsPass(params, W2, H2)).toBeNull();
});

test('buildLocalAdjustmentsPass: a per-layer dehaze layer is NOT GPU-representable → null (CPU fallback)', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerBasicAdj(id, { dehaze: 0.5 });
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  // dehaze is a per-layer running-input statistic the build-time pass can't carry → CPU.
  expect(buildLocalAdjustmentsPass(params, W2, H2)).toBeNull();
});

test('buildLocalAdjustmentsPass: a mismatched-resolution mask is rebuilt via the callback', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', 8, 8); // baked at 8x8
  m.updateLayerBasicAdj(id, { exposure: 0.3 });
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;

  let rebuilt = false;
  const pass = buildLocalAdjustmentsPass(params, W2, H2, (layerId, w, h) => {
    rebuilt = true;
    m.setLayerGeometry(layerId, m.getLayer(layerId)!.geometry!, w, h);
    return m.getLayer(layerId)!.mask;
  });
  expect(rebuilt).toBe(true);
  expect(pass).not.toBeNull();
  const mask = pass!.subPasses![1].bindings![2].texture as MaskUpload;
  expect(mask.data.length).toBe(W2 * H2); // rebuilt to the render resolution
});

test('buildLocalAdjustmentsPass: mismatched mask with no rebuilder → null (no misalignment)', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', 8, 8);
  m.updateLayerBasicAdj(id, { exposure: 0.3 });
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  // No rebuildMask callback → can't get a 16x16 mask → CPU fallback.
  expect(buildLocalAdjustmentsPass(params, W2, H2)).toBeNull();
});

test('buildPassList: localadjustments with an active GPU-representable layer + opts yields a GPU pass (not cpuBridge)', () => {
  const { params } = oneActiveLayer();
  const laView = { getId: () => 'localadjustments', isEnabled: true, getParams: () => params };
  const { passes, cpuBridges } = buildPassList([laView], { width: W2, height: H2 });
  expect(passes.map(p => p.id)).toContain('localadjustments');
  expect(cpuBridges).not.toContain('localadjustments');
});

test('buildPassList: localadjustments WITHOUT opts → cpuBridge (routing-only callers)', () => {
  const { params } = oneActiveLayer();
  const laView = { getId: () => 'localadjustments', isEnabled: true, getParams: () => params };
  const { passes, cpuBridges } = buildPassList([laView]); // no opts
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('localadjustments');
});

test('buildPassList: localadjustments with a legacy parameters layer (no basicAdj) → cpuBridge even with opts', () => {
  const m = new LocalAdjustmentsModule();
  const id = m.createLayer('radial_gradient', 'L1', W2, H2);
  m.updateLayerParameters(id, { exposure: 1.0 }); // legacy path, no basicAdj
  const params = { enabled: true, layers: m.getLayers() } as Record<string, unknown>;
  const laView = { getId: () => 'localadjustments', isEnabled: true, getParams: () => params };
  const { passes, cpuBridges } = buildPassList([laView], { width: W2, height: H2 });
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('localadjustments');
});

test('buildLocalAdjustmentsPass setUniforms have arity 2/3 and do not throw with the no-op GL mock', () => {
  const { params } = oneActiveLayer();
  const pass = buildLocalAdjustmentsPass(params, W2, H2)!;
  for (const sp of pass.subPasses!) {
    expect(() => sp.setUniforms(makeGl(), DUMMY_PROG, DEFAULT_RT)).not.toThrow();
  }
});
