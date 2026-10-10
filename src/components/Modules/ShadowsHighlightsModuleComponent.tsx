import React, { useState, useCallback, useRef } from 'react';
import { ShadowsHighlightsModule, ShadowsHighlightsParams } from '../../modules/ShadowsHighlightsModule';
import { logger } from '../../utils/Logger';
import { SliderRow } from '../Controls/SliderRow';
import { Segmented, type SegmentedOption } from '../Controls/Segmented';
import { ChipButton } from '../Controls/ChipButton';
import { SectionLabel } from '../Controls/SectionLabel';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';
import { notificationService } from '../../services/NotificationService';
import { guardDeveloping } from '../../utils/developingGuard';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface ShadowsHighlightsModuleComponentProps {
  module: ShadowsHighlightsModule;
  onParamsChange?: (params: Partial<ShadowsHighlightsParams>) => void;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

type PresetType = 'subtle' | 'moderate' | 'strong' | 'highlights-only' | 'shadows-only';

type Section = 'shadows' | 'highlights' | 'advanced';
const SECTION_OPTIONS: SegmentedOption<Section>[] = [
  { value: 'shadows', label: 'Shadows' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'advanced', label: 'Advanced' },
];

export const ShadowsHighlightsModuleComponent: React.FC<ShadowsHighlightsModuleComponentProps> = ({
  module,
  onParamsChange,
  onRegisterActions
}) => {
  const [params, setParams] = useState<ShadowsHighlightsParams>(module.getParams());
  const [activeSection, setActiveSection] = useState<Section>('shadows');
  const paramsRef = useRef<ShadowsHighlightsParams>(params);

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Immediate UI + processing: SliderRow fires per input event while dragging, as the old
  // range inputs did through onInput.
  const handleParamChange = useCallback((paramName: keyof ShadowsHighlightsParams, value: number) => {
    const newParams = { ...paramsRef.current, [paramName]: value };
    paramsRef.current = newParams;
    setParams(newParams);
    module.setParams({ [paramName]: value });
    onParamsChange?.(newParams);
  }, [module, onParamsChange]);

  const handlePresetApply = useCallback((preset: PresetType) => {
    module.applyPreset(preset);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info(`Applied ShadowsHighlights preset: ${preset}`);
  }, [module, onParamsChange]);

  const handleReset = useCallback(() => {
    module.resetParams();
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info('ShadowsHighlights parameters reset to defaults');
  }, [module, onParamsChange]);

  // Image-aware auto — lifted verbatim from the old inner-header ⚡ button so the
  // card header's Auto keeps identical semantics (Task 2).
  const handleAuto = useCallback(() => {
    // Reads currentImage pixels directly — during the progressive-open developing window
    // that's the graded preview, not the neutral full-res base (L3 review round 2).
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Auto Shadows/Highlights')) return;
    const img = imageService.getCurrentImage();
    if (!img) { logger.warn('No image for auto SH'); return; }
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    const computed = autoAdjustService.autoShadowsHighlights(stats);
    module.setParams(computed as ShadowsHighlightsParams);
    const newParams = module.getParams();
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info('Auto shadows/highlights applied (image-aware)');
  }, [module, onParamsChange]);

  useRegisterModuleCardActions(onRegisterActions, { auto: handleAuto, reset: handleReset });

  // Booleans go straight to the module (the numeric throttle above is for slider drags).
  const handleToggle = useCallback((paramName: 'preserveColor' | 'bilateralFilter', value: boolean) => {
    const newParams = { ...paramsRef.current, [paramName]: value };
    paramsRef.current = newParams;
    setParams(newParams);
    module.setParams({ [paramName]: value });
    onParamsChange?.(newParams);
  }, [module, onParamsChange]);

  const percent = (v: number) => `${Math.round(v)}%`;
  const ev = (v: number) => `${v > 0 ? '+' : v < 0 ? '\u2212' : ''}${Math.abs(v).toFixed(2)} EV`;

  const toneControls = (tone: 'shadows' | 'highlights') => (
    <>
      <SliderRow label="Amount" value={params[tone]} defaultValue={50} min={0} max={100} step={1}
        formatValue={percent} onChange={(v) => handleParamChange(tone, v)} />
      <SliderRow label="Radius" value={params[`${tone}Radius`]} defaultValue={50} min={0.1} max={100} step={1}
        formatValue={percent} onChange={(v) => handleParamChange(`${tone}Radius`, v)} />
      <SliderRow label="Color transfer" value={params[`${tone}ColorTransfer`]} defaultValue={0} min={0} max={100} step={1}
        formatValue={percent} onChange={(v) => handleParamChange(`${tone}ColorTransfer`, v)} />
      <SliderRow label="Color correction" value={params[`${tone}ColorCorrection`]} defaultValue={0} min={0} max={100} step={1}
        formatValue={percent} onChange={(v) => handleParamChange(`${tone}ColorCorrection`, v)} />
    </>
  );

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {/* Presets — one-click starting points */}
      <div className="grid grid-cols-3" style={{ gap: 6 }}>
        <ChipButton onClick={() => handlePresetApply('subtle')} title="Subtle shadow/highlight recovery">Subtle</ChipButton>
        <ChipButton onClick={() => handlePresetApply('moderate')} title="Moderate shadow/highlight recovery">Moderate</ChipButton>
        <ChipButton onClick={() => handlePresetApply('strong')} title="Strong shadow/highlight recovery">Strong</ChipButton>
      </div>

      <Segmented
        options={SECTION_OPTIONS}
        value={activeSection}
        onChange={setActiveSection}
        className="w-full"
      />

      {/* Keyed so a section switch cross-fades instead of popping */}
      <div key={activeSection} className="flex flex-col vt-fade-in" style={{ gap: 12 }}>
        {activeSection === 'shadows' && toneControls('shadows')}
        {activeSection === 'highlights' && toneControls('highlights')}

        {activeSection === 'advanced' && (
          <>
            <SectionLabel>Tone range</SectionLabel>
            <SliderRow label="White point" value={params.whitePoint} defaultValue={0} min={-4} max={4} step={0.01}
              formatValue={ev} onChange={(v) => handleParamChange('whitePoint', v)} />
            <SliderRow label="Black point" value={params.blackPoint} defaultValue={0} min={-4} max={4} step={0.01}
              formatValue={ev} onChange={(v) => handleParamChange('blackPoint', v)} />

            <SectionLabel>Processing</SectionLabel>
            <SliderRow label="Compression" value={params.compress} defaultValue={0} min={0} max={100} step={1}
              formatValue={percent} onChange={(v) => handleParamChange('compress', v)} />
            <SliderRow label="Strength" value={params.strength} defaultValue={1} min={0} max={2} step={0.01}
              formatValue={(v) => `${v.toFixed(2)}\u00d7`} onChange={(v) => handleParamChange('strength', v)} />
            <SliderRow label="Iterations" value={params.iterations} defaultValue={1} min={1} max={5} step={1}
              onChange={(v) => handleParamChange('iterations', v)} />

            <div className="flex flex-col" style={{ gap: 8, paddingTop: 2 }}>
              <label className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'var(--vt-text-2)' }}>
                <input type="checkbox" checked={!!params.preserveColor}
                  onChange={(e) => handleToggle('preserveColor', e.target.checked)} />
                Preserve color
              </label>
              <label className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'var(--vt-text-2)' }}>
                <input type="checkbox" checked={!!params.bilateralFilter}
                  onChange={(e) => handleToggle('bilateralFilter', e.target.checked)} />
                Bilateral filter
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ShadowsHighlightsModuleComponent;
