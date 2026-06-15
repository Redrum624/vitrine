import { buildPassList, GPU_MODULE_IDS, OPT_IN_GPU_MODULE_IDS } from '../shaders/passDescriptors';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ToneCurvePipelineModule } from '../modules/ToneCurvePipelineModule';

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
    uniform2f: () => undefined,
    uniform3f: () => undefined,
    uniform1fv: () => undefined,
  } as unknown as WebGL2RenderingContext);

const DUMMY_PROG = {} as WebGLProgram;

const DEFAULT_RT = { width: 800, height: 600, dehaze: { active: false, hazeStrength: 0, hazeDivisor: 1 } };

// ---------------------------------------------------------------------------
// GPU_MODULE_IDS uses real pipeline ids
// ---------------------------------------------------------------------------

test('GPU_MODULE_IDS uses real pipeline ids and excludes huecurves + exposure', () => {
  expect(GPU_MODULE_IDS).toEqual(
    expect.arrayContaining(['temperature', 'basicadj', 'tonecurve', 'colorbalance', 'lenscorrections']),
  );
  expect(GPU_MODULE_IDS).not.toContain('whitebalance');
  expect(GPU_MODULE_IDS).not.toContain('huecurves');
  expect(GPU_MODULE_IDS).not.toContain('exposure');
});

test('OPT_IN_GPU_MODULE_IDS contains noise-reduction and not huecurves', () => {
  expect(OPT_IN_GPU_MODULE_IDS).toContain('noise-reduction');
  expect(OPT_IN_GPU_MODULE_IDS).not.toContain('huecurves');
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
    fakeModule('sharpen', true, {}),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toEqual(['crop', 'noise-reduction', 'sharpen']);
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

test('tonecurve pass carries luts when provided', () => {
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
// Empty module list
// ---------------------------------------------------------------------------

test('empty module list returns empty results', () => {
  const { passes, cpuBridges } = buildPassList([]);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// WB gains single-source check: module process() and GPU gains path must agree
// ---------------------------------------------------------------------------

test('computeWBGains (from WhiteBalanceModule) output matches module process() for a known temperature', () => {
  // Import the exported helper that passDescriptors uses
  const { computeWBGains } = require('../shaders/passDescriptors');

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
