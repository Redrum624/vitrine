/**
 * Preset round-trip for Highlight Recovery (round-8 review LOW, adjudicated INCLUDE for round 9).
 *
 * Before this suite, captureCurrentSettings/applySettingsToPipeline had no switch case for the S5
 * `highlightrecovery` module, so a preset saved from an image with HR strength silently dropped it
 * (and — separately — the shared `moduleInterface.isEnabled?.()` expression threw for every module
 * exposing `isEnabled` as a plain boolean field, which is what actually blocked tonecurve/
 * colorbalance/shadowshighlights capture too; fixed alongside this case since HR needed the same
 * expression to work at all). These tests drive the real pipeline HR module through a full
 * round-trip and the legacy-preset (no `highlightRecovery` key) safety net.
 */
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { presetService } from './PresetService';
import type { HighlightRecoveryPipelineModule } from '../modules/HighlightRecoveryModule';

function getHR(): HighlightRecoveryPipelineModule {
  return imageProcessingPipeline.getModule<HighlightRecoveryPipelineModule>('highlightrecovery')!;
}

describe('PresetService — Highlight Recovery round-trip', () => {
  afterEach(() => {
    getHR().resetParams();
    getHR().setEnabled(true);
  });

  test('captures the current HR strength into the preset', () => {
    const hr = getHR();
    hr.setParams({ strength: 42 });

    const presetId = presetService.createPresetFromCurrent('HR Look', '', 'custom', []);
    const preset = presetService.getPreset(presetId)!;

    expect(preset.settings.highlightRecovery).toEqual({ enabled: true, strength: 42 });
    presetService.deletePreset(presetId);
  });

  test('applies a preset\'s HR strength onto the current pipeline module', () => {
    const hr = getHR();
    hr.setParams({ strength: 30 });
    const presetId = presetService.createPresetFromCurrent('HR Look', '', 'custom', []);

    // Reset to a different value, then apply — the preset's strength must win.
    hr.setParams({ strength: 0 });
    expect(presetService.applyPreset(presetId)).toBe(true);

    expect(hr.getParams().strength).toBe(30);
    expect(hr.getParams().enabled).toBe(true);
    presetService.deletePreset(presetId);
  });

  test('a disabled HR module round-trips enabled:false', () => {
    const hr = getHR();
    hr.setParams({ strength: 55 });
    hr.setEnabled(false);

    const presetId = presetService.createPresetFromCurrent('HR Off', '', 'custom', []);
    const preset = presetService.getPreset(presetId)!;
    expect(preset.settings.highlightRecovery).toEqual({ enabled: false, strength: 55 });

    hr.setEnabled(true);
    expect(presetService.applyPreset(presetId)).toBe(true);
    expect(hr.getEnabled()).toBe(false);
    presetService.deletePreset(presetId);
  });

  test('applying a legacy preset (no highlightRecovery key) leaves the target HR untouched', () => {
    const hr = getHR();
    hr.setParams({ strength: 66 });

    const legacy = {
      version: '1.0.0',
      presets: [{
        id: 'legacy_no_hr_preset',
        name: 'Legacy',
        description: '',
        category: 'custom',
        tags: [],
        createdAt: '', modifiedAt: '',
        settings: {}, // no highlightRecovery key at all — mirrors a pre-round-9 preset
        metadata: { version: '1.0.0', compatibility: ['1.0.0'] },
      }],
    };
    presetService.importPresets(JSON.stringify(legacy));

    expect(presetService.applyPreset('legacy_no_hr_preset')).toBe(true);
    expect(hr.getParams().strength).toBe(66); // untouched, not reset to 0

    presetService.deletePreset('legacy_no_hr_preset');
  });
});

/**
 * Regression lock for the isEnabled type-bug repair (Z2 review follow-up): before round 9,
 * `moduleInterface.isEnabled?.()` threw "is not a function" for EVERY module exposing isEnabled
 * as a boolean field — silently dropping tonecurve/colorbalance/shadowshighlights (and
 * lenscorrections) from preset capture. HR's own tests above cover the new module; this suite
 * locks the REPAIRED capture of a formerly-dropped one so the throw-and-drop can't return.
 */
describe('PresetService — formerly-dropped module capture (isEnabled repair)', () => {
  test('tonecurve params are captured into the preset (threw-and-dropped before round 9)', () => {
    // ToneCurvePipelineModule exposes `isEnabled` as a plain boolean field — exactly the shape
    // that made the old `moduleInterface.isEnabled?.()` throw during capture.
    const tc = imageProcessingPipeline.getModule('tonecurve') as unknown as {
      isEnabled: boolean;
      setEnabled: (v: boolean) => void;
    };
    expect(typeof tc.isEnabled).toBe('boolean'); // the bug-triggering shape, pinned
    tc.setEnabled(true);

    const presetId = presetService.createPresetFromCurrent('TC Look', '', 'custom', []);
    const preset = presetService.getPreset(presetId)!;

    // The load-bearing assertion: the block EXISTS (capture no longer throws-and-drops it).
    expect(preset.settings.toneCurve).toBeDefined();

    presetService.deletePreset(presetId);
  });
});
