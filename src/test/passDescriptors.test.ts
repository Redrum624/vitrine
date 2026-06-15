import { buildPassList, GPU_MODULE_IDS } from '../shaders/passDescriptors';

const fakeModule = (id: string, enabled: boolean, params: Record<string, unknown>) => ({
  getId: () => id, getName: () => id, isEnabled: enabled,
  getParams: () => params, process: (d: Float32Array) => d,
});

test('only enabled GPU modules become passes, in input order', () => {
  const modules = [
    fakeModule('whitebalance', true, { temperature: 10 }),
    fakeModule('basicadj', false, {}),
    fakeModule('tonecurve', true, { master: [] }),
    fakeModule('localadjustments', true, { layers: [{}] }),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes.map(p => p.id)).toEqual(['whitebalance', 'tonecurve']);
  expect(cpuBridges).toContain('localadjustments'); // not GPU-capable in P1
});

test('GPU_MODULE_IDS matches the verified WebGL ops', () => {
  expect(GPU_MODULE_IDS).toEqual(expect.arrayContaining([
    'whitebalance','basicadj','tonecurve','colorbalance','lenscorrections','huecurves',
  ]));
});

test('disabled GPU module goes to cpuBridges, not passes', () => {
  const modules = [
    fakeModule('basicadj', false, { exposure: 0 }),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toContain('basicadj');
});

test('cpu-only module always goes to cpuBridges', () => {
  const modules = [
    fakeModule('crop', true, {}),
    fakeModule('noisereduction', true, {}),
    fakeModule('sharpen', true, {}),
  ];
  const { passes, cpuBridges } = buildPassList(modules);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toEqual(['crop', 'noisereduction', 'sharpen']);
});

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

test('lenscorrections identity distortion is skipped', () => {
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
  // When no sub-passes, entire module falls to cpuBridges (nothing to do on GPU)
  expect(cpuBridges).toContain('lenscorrections');
});

test('empty module list returns empty results', () => {
  const { passes, cpuBridges } = buildPassList([]);
  expect(passes).toHaveLength(0);
  expect(cpuBridges).toHaveLength(0);
});

test('whitebalance pass has correct programKey and setUniforms is a function', () => {
  const modules = [fakeModule('whitebalance', true, { temperature: 6500, tint: 0 })];
  const { passes } = buildPassList(modules);
  expect(passes).toHaveLength(1);
  expect(passes[0].programKey).toBe('gains');
  expect(typeof passes[0].setUniforms).toBe('function');
});

test('tonecurve pass carries luts', () => {
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
