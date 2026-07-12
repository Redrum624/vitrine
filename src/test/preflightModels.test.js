/**
 * Unit tests for the model build-preflight decision logic (scripts/preflight-models.cjs).
 *
 * Plain CommonJS (.js) on purpose: it requires a .cjs build script and exercises pure
 * functions, so it needs neither the ts-jest transform nor the jsdom-oriented setup. Jest's
 * testMatch includes `js`, and eslint (--ext ts,tsx) skips it.
 */
const path = require('path');
const {
  checkModels,
  loadManifest,
} = require('../../scripts/preflight-models.cjs');

const MANIFEST = [
  { file: 'RealESRGAN_x4plus.onnx', feature: 'upscale' },
  { file: 'real_esrgan_x4plus.data', feature: 'upscale weights' },
  { file: 'NAFNet-GoPro-width32.onnx', feature: 'deblur' },
];

describe('checkModels (preflight pure logic)', () => {
  it('ok when every manifest file is present in the dir listing', () => {
    const listing = ['README.md', 'models.manifest.json', ...MANIFEST.map((m) => m.file)];
    const res = checkModels(listing, MANIFEST);
    expect(res.ok).toBe(true);
    expect(res.missing).toHaveLength(0);
    expect(res.present).toHaveLength(3);
  });

  it('reports the exact missing files (with feature) when some are absent', () => {
    const listing = ['README.md', 'RealESRGAN_x4plus.onnx']; // .data + NAFNet missing
    const res = checkModels(listing, MANIFEST);
    expect(res.ok).toBe(false);
    expect(res.missing.map((m) => m.file)).toEqual([
      'real_esrgan_x4plus.data',
      'NAFNet-GoPro-width32.onnx',
    ]);
    // feature is carried through so the CLI can print an actionable message
    expect(res.missing[0].feature).toBe('upscale weights');
  });

  it('all missing on a fresh clone (empty models dir)', () => {
    const res = checkModels([], MANIFEST);
    expect(res.ok).toBe(false);
    expect(res.missing).toHaveLength(3);
  });

  it('empty manifest is trivially ok (no expected models)', () => {
    const res = checkModels(['whatever.onnx'], []);
    expect(res.ok).toBe(true);
    expect(res.missing).toHaveLength(0);
  });

  it('tolerates null/undefined inputs without throwing', () => {
    expect(checkModels(undefined, undefined).ok).toBe(true);
    expect(checkModels(null, MANIFEST).ok).toBe(false);
    expect(checkModels(null, MANIFEST).missing).toHaveLength(3);
  });

  it('extra unrelated files in the dir do not affect the decision', () => {
    const listing = [...MANIFEST.map((m) => m.file), 'stray.onnx', 'notes.txt'];
    expect(checkModels(listing, MANIFEST).ok).toBe(true);
  });
});

describe('loadManifest (real repo manifest)', () => {
  it('parses resources/models/models.manifest.json and lists the three shipped models', () => {
    const manifestPath = path.join(__dirname, '..', '..', 'resources', 'models', 'models.manifest.json');
    const models = loadManifest(manifestPath);
    expect(Array.isArray(models)).toBe(true);
    const files = models.map((m) => m.file).sort();
    expect(files).toEqual([
      'NAFNet-GoPro-width32.onnx',
      'RealESRGAN_x4plus.onnx',
      'real_esrgan_x4plus.data',
    ]);
    // every entry carries a human-readable feature for the failure message
    for (const m of models) expect(typeof m.feature).toBe('string');
  });

  it('throws a clear error when the manifest path does not exist', () => {
    expect(() => loadManifest(path.join(__dirname, 'no-such-manifest.json'))).toThrow(/not found/i);
  });
});
