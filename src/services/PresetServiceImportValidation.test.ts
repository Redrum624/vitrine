/**
 * Import trust-boundary shape validation (round-10 H1 — round-9 re-review LOW).
 *
 * Before this suite, PresetService.importPresets accepted ANY truthy `settings` payload
 * verbatim. A user-supplied preset JSON carrying a PARTIAL lensCorrections block (e.g.
 * vignetting only) wholesale-replaced the pipeline module's nested params on apply
 * (LensCorrectionsPipelineModule.setParameters ~:107), after which the derived `isEnabled`
 * getter dereferenced the missing sections and THREW — outside process()'s try (~:118) and
 * in the pipeline's isModuleActive. App-created presets always capture all six sections,
 * so the ONLY route in is importPresets (user-supplied JSON): these tests pin validation
 * at that single boundary — invalid KNOWN blocks are dropped with a warning (the preset
 * survives; unknown keys are tolerated for forward compat), unsalvageable presets are
 * skipped with a notification listing names (multi-export toast naming idiom) — plus the
 * belt-and-suspenders null-safe getter tripwire on the module itself.
 */
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { presetService } from './PresetService';
import { notificationService } from './NotificationService';
import {
  LensCorrectionsPipelineModule,
  LensCorrectionsPipelineParams
} from '../modules/LensCorrectionsPipelineModule';
import type { HighlightRecoveryPipelineModule } from '../modules/HighlightRecoveryModule';

function getLC(): LensCorrectionsPipelineModule {
  return imageProcessingPipeline.getModule<LensCorrectionsPipelineModule>('lenscorrections')!;
}

function getHR(): HighlightRecoveryPipelineModule {
  return imageProcessingPipeline.getModule<HighlightRecoveryPipelineModule>('highlightrecovery')!;
}

/** All six sections — the shape captureCurrentSettings always emits. */
function fullLensBlock() {
  return {
    enabled: true,
    vignetting: { enabled: true, amount: 40, midpoint: 1.0, roundness: 0, feather: 50 },
    distortion: { enabled: false, barrel: 0, perspective: { horizontal: 0, vertical: 0 }, scale: 1.0 },
    chromaticAberration: {
      enabled: false, redCyan: 0, blueMagenta: 0,
      purple: { amount: 0, hue: 300, range: 10 },
      green: { amount: 0, hue: 60, range: 10 }
    },
    profile: { enabled: false, autoDetect: true, profileName: '', strength: 100 },
    blur: { enabled: false, radius: 0 },
    filmGrain: { enabled: false, amount: 0, size: 1 }
  };
}

function makePreset(id: string, name: string, settings: unknown): Record<string, unknown> {
  return {
    id, name,
    description: '',
    category: 'custom',
    tags: [],
    createdAt: '', modifiedAt: '',
    settings,
    metadata: { version: '1.0.0', compatibility: ['1.0.0'] }
  };
}

function wrap(presets: unknown[]): string {
  return JSON.stringify({ version: '1.0.0', presets });
}

describe('PresetService — import shape validation (trust boundary)', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(notificationService, 'warning').mockImplementation(() => 'id');
    errorSpy = jest.spyOn(notificationService, 'error').mockImplementation(() => 'id');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    getLC().reset();
  });

  test('a PARTIAL lensCorrections block is dropped at import (block, not preset) and never reaches the module', () => {
    const lc = getLC();
    const before = JSON.parse(JSON.stringify(lc.getParameters())) as LensCorrectionsPipelineParams;

    // The exact finding shape: vignetting only — five sections missing.
    const partial = makePreset('h1_partial_lens', 'Partial Lens', {
      lensCorrections: {
        enabled: true,
        vignetting: { enabled: true, amount: 50, midpoint: 1.0, roundness: 0, feather: 50 }
      }
    });

    const res = presetService.importPresets(wrap([partial]));

    // Preset survives; the malformed block does not.
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('Partial Lens');
    expect(res.warnings[0]).toContain('lensCorrections');

    const stored = presetService.getPreset('h1_partial_lens')!;
    expect(stored.settings.lensCorrections).toBeUndefined();

    // A user-visible warning names the affected preset (multi-export toast idiom).
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][1])).toContain('Partial Lens');

    // Applying the salvaged preset must not throw and must leave the module untouched.
    expect(presetService.applyPreset('h1_partial_lens')).toBe(true);
    expect(() => lc.isEnabled).not.toThrow();
    expect(lc.isEnabled).toBe(false);
    expect(JSON.parse(JSON.stringify(lc.getParameters()))).toEqual(before);

    presetService.deletePreset('h1_partial_lens');
  });

  test('a FULLY-valid lensCorrections block imports intact and applies to the module', () => {
    const lc = getLC();
    const valid = makePreset('h1_valid_lens', 'Valid Lens', { lensCorrections: fullLensBlock() });

    const res = presetService.importPresets(wrap([valid]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(0);

    const stored = presetService.getPreset('h1_valid_lens')!;
    expect(stored.settings.lensCorrections).toBeDefined();
    expect(stored.settings.lensCorrections!.vignetting.amount).toBe(40);

    expect(presetService.applyPreset('h1_valid_lens')).toBe(true);
    expect(lc.getParameters().lensCorrectionsParams.vignetting.enabled).toBe(true);
    expect(lc.getParameters().lensCorrectionsParams.vignetting.amount).toBe(40);
    expect(lc.isEnabled).toBe(true);

    presetService.deletePreset('h1_valid_lens');
  });

  test('garbage (non-JSON) input → nothing imported, error collected, error notification', () => {
    const res = presetService.importPresets('this is not json {{');
    expect(res.imported).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('unsalvageable presets (non-object settings / missing name) are skipped with a notification listing names', () => {
    // `settings: 'oops'` is truthy — the OLD guard (`!preset.settings`) let it straight in.
    const badSettings = makePreset('h1_bad_settings', 'Bad Settings', 'oops');
    const noName = { ...makePreset('h1_no_name', '', {}), name: undefined };

    const res = presetService.importPresets(wrap([badSettings, noName]));

    expect(res.imported).toBe(0);
    expect(res.errors).toHaveLength(2);
    expect(presetService.getPreset('h1_bad_settings')).toBeUndefined();
    expect(presetService.getPreset('h1_no_name')).toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][1]);
    expect(msg).toContain('Bad Settings');
    expect(msg).toContain('unnamed');
  });

  test('wrong-typed KNOWN blocks are dropped per-block; valid sibling blocks survive and apply', () => {
    const hr = getHR();
    const mixed = makePreset('h1_mixed', 'Mixed', {
      exposure: { enabled: 'yes', exposure: 'bright' }, // wrong primitive types
      toneCurve: 5, // block is not even an object
      highlightRecovery: { enabled: true, strength: 25 } // valid — must survive
    });

    const res = presetService.importPresets(wrap([mixed]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('exposure');
    expect(res.warnings[0]).toContain('toneCurve');

    const stored = presetService.getPreset('h1_mixed')!;
    expect(stored.settings.exposure).toBeUndefined();
    expect(stored.settings.toneCurve).toBeUndefined();
    expect(stored.settings.highlightRecovery).toEqual({ enabled: true, strength: 25 });

    // The salvaged preset still applies its valid block.
    expect(presetService.applyPreset('h1_mixed')).toBe(true);
    expect(hr.getParams().strength).toBe(25);

    hr.resetParams();
    hr.setEnabled(true);
    presetService.deletePreset('h1_mixed');
  });

  test('unknown settings keys are tolerated (forward compat) — no warning, key preserved', () => {
    const future = makePreset('h1_future', 'Future', {
      someFutureModule: { enabled: true, newKnob: 7 }
    });

    const res = presetService.importPresets(wrap([future]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(presetService.getPreset('h1_future')!.settings.someFutureModule).toEqual({ enabled: true, newKnob: 7 });

    presetService.deletePreset('h1_future');
  });

  test('established legacy shapes still import cleanly with no warnings', () => {
    const presets = [
      makePreset('h1_legacy_empty', 'Legacy Empty', {}),
      makePreset('h1_legacy_count', 'Legacy Count', { localAdjustments: { enabled: true, layerCount: 3 } }),
      makePreset('h1_legacy_layers', 'Legacy Layers', { localAdjustments: { enabled: true, layers: [] } })
    ];

    const res = presetService.importPresets(wrap(presets));
    expect(res.imported).toBe(3);
    expect(res.warnings).toHaveLength(0);
    expect(res.errors).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();

    for (const id of ['h1_legacy_empty', 'h1_legacy_count', 'h1_legacy_layers']) {
      presetService.deletePreset(id);
    }
  });
});

describe('PresetService — toneCurve/colorBalance validators match the REAL getParams shape (H2 #9)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(notificationService, 'warning').mockImplementation(() => 'id');
    jest.spyOn(notificationService, 'error').mockImplementation(() => 'id');
  });
  afterEach(() => jest.restoreAllMocks());

  // The shape ToneCurveModule.getParams() actually emits (baseCurve/rgbCurve/…), NOT the
  // stale `curves.{master,…}` the old validator checked.
  function realToneCurve() {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    return {
      enabled: true,
      baseCurve: line, baseCurveNodes: 2, baseCurveType: 1,
      rgbCurve: { red: line, green: line, blue: line },
      rgbCurveNodes: { red: 2, green: 2, blue: 2 },
      exposureFusion: 0, exposureStops: 1, preserveColors: 1,
      autoLevels: false, autoContrast: false,
    };
  }
  // The shape ColorBalanceModule.getParams() actually emits (cmy ranges + 8-color HSL).
  function realColorBalance() {
    return {
      enabled: true,
      shadows: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      midtones: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      highlights: { cyan_red: 0, magenta_green: 0, yellow_blue: 0 },
      red_saturation: 0, red_luminance: 0, red_hue: 0,
      blue_saturation: 10, blue_luminance: -5, blue_hue: 180,
    };
  }

  test('a real-shape toneCurve/colorBalance block imports intact with no warning', () => {
    const p = makePreset('h2_real', 'Real Shape', {
      toneCurve: realToneCurve(),
      colorBalance: realColorBalance(),
    });
    const res = presetService.importPresets(wrap([p]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(0);
    const stored = presetService.getPreset('h2_real')!;
    expect(stored.settings.toneCurve).toBeDefined();
    expect(stored.settings.colorBalance).toBeDefined();
    presetService.deletePreset('h2_real');
  });

  test('non-vacuity: a broken baseCurve is now DROPPED (old validator ignored it, checking phantom `curves`)', () => {
    const bad = realToneCurve() as unknown as Record<string, unknown>;
    bad.baseCurve = [{ x: 'nope', y: 0 }]; // x not numeric → curvePoints fails
    const p = makePreset('h2_bad_tc', 'Bad ToneCurve', { toneCurve: bad });

    const res = presetService.importPresets(wrap([p]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('toneCurve');
    expect(presetService.getPreset('h2_bad_tc')!.settings.toneCurve).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    presetService.deletePreset('h2_bad_tc');
  });

  test('non-vacuity: a non-numeric 8-color HSL field is now DROPPED on colorBalance', () => {
    const bad = realColorBalance() as unknown as Record<string, unknown>;
    bad.red_saturation = 'lots'; // was an unknown/tolerated key under the old validator
    const p = makePreset('h2_bad_cb', 'Bad ColorBalance', { colorBalance: bad });

    const res = presetService.importPresets(wrap([p]));
    expect(res.imported).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('colorBalance');
    expect(presetService.getPreset('h2_bad_cb')!.settings.colorBalance).toBeUndefined();
    presetService.deletePreset('h2_bad_cb');
  });

  test('a malformed rgbCurve channel (broken nested points) is dropped', () => {
    const bad = realToneCurve() as unknown as Record<string, unknown>;
    bad.rgbCurve = { red: [{ x: 0, y: 0 }], green: 'no', blue: [] };
    const p = makePreset('h2_bad_rgb', 'Bad RGB', { toneCurve: bad });

    const res = presetService.importPresets(wrap([p]));
    expect(res.imported).toBe(1);
    expect(res.warnings[0]).toContain('toneCurve');
    expect(presetService.getPreset('h2_bad_rgb')!.settings.toneCurve).toBeUndefined();
    presetService.deletePreset('h2_bad_rgb');
  });
});

describe('LensCorrectionsPipelineModule — null-safe isEnabled (belt-and-suspenders)', () => {
  function partialParams(vignettingEnabled: boolean) {
    return {
      vignetting: { enabled: vignettingEnabled, amount: 50, midpoint: 1.0, roundness: 0, feather: 50 }
    } as unknown as LensCorrectionsPipelineParams['lensCorrectionsParams'];
  }

  test('the pre-fix crash shape (vignetting disabled, five sections missing) no longer throws', () => {
    // Fresh instance so the singleton in the pipeline is untouched.
    const m = new LensCorrectionsPipelineModule();

    // Wholesale replace with a vignetting-only block whose enabled flag is FALSE:
    // the old getter's `||` chain then dereferenced the missing `distortion` section
    // and threw "Cannot read properties of undefined (reading 'enabled')" — OUTSIDE
    // process()'s try (isModuleActive, process gate). It must fail safe instead.
    m.setParameters({ lensCorrectionsParams: partialParams(false) });

    expect(() => m.isEnabled).not.toThrow();
    expect(m.isEnabled).toBe(false);
  });

  test('a partial payload is treated as disabled even when its one section is enabled', () => {
    const m = new LensCorrectionsPipelineModule();
    // Pre-fix the `||` chain short-circuited on vignetting.enabled === true and reported
    // the module active on structurally-broken params. Fail-safe means OFF: half-formed
    // state must never drive processing.
    m.setParameters({ lensCorrectionsParams: partialParams(true) });

    expect(() => m.isEnabled).not.toThrow();
    expect(m.isEnabled).toBe(false);
  });
});
