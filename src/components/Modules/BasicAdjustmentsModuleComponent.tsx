import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Circle, Trash2 } from 'lucide-react';
import { BasicAdjustmentsModule, BasicAdjParams } from '../../modules/BasicAdjustmentsModule';
import { logger } from '../../utils/Logger';
import { SliderRow } from '../Controls/SliderRow';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';
import { autoAdjustService } from '../../services/AutoAdjustService';
import { imageService } from '../../services/ImageService';
import { imageProcessingPipeline } from '../../services/ImageProcessingPipeline';
import { useAppStore } from '../../stores/appStore';
import { notificationService } from '../../services/NotificationService';
import { guardDeveloping } from '../../utils/developingGuard';
import { keyboardEventBlocked } from '../../utils/keyboardScope';
import type { LocalAdjustmentsPipelineModule } from '../../modules/LocalAdjustmentsPipelineModule';
import type { LocalAdjustmentLayer } from '../../modules/LocalAdjustmentsModule';

const NEUTRAL_BA: BasicAdjParams = {
  black_point: 0, exposure: 0, contrast: 0, brightness: 0,
  saturation: 0, vibrance: 0, dehaze: 0, highlights: 0, shadows: 0,
};

type SliderKey = 'exposure' | 'contrast' | 'highlights' | 'brightness' | 'black_point' | 'shadows' | 'dehaze' | 'saturation' | 'vibrance';
type SliderSection = 'TONE' | 'PRESENCE' | 'COLOR';

interface SliderCfg {
  key: SliderKey;
  label: string;
  section: SliderSection;
  min: number;
  max: number;
  step?: number;       // slider + value-chip step
  rangeStep?: number;  // slider step override
  gradient: string;    // CSS gradient stops (without the linear-gradient wrapper)
}

// Slider order + §4 groupings: TONE (Exposure, Contrast, Highlights, Brightness,
// Black Point, Shadows) / PRESENCE (Dehaze) / COLOR (Saturation, Vibrance).
// Highlights/Shadows replace the old standalone Shadows & Highlights module.
const BASIC_ADJ_SLIDERS: SliderCfg[] = [
  { key: 'exposure', label: 'Exposure', section: 'TONE', min: -1, max: 1, step: 0.01, gradient: '#000000, #6b7280, #ffffff' },
  { key: 'contrast', label: 'Contrast', section: 'TONE', min: -2.5, max: 2.5, step: 0.01, gradient: '#6b7280, #000000' },
  { key: 'highlights', label: 'Highlights', section: 'TONE', min: -1, max: 1, step: 0.01, gradient: '#6b7280, #ffffff' },
  { key: 'brightness', label: 'Brightness', section: 'TONE', min: -2, max: 2, step: 0.01, gradient: '#000000, #6b7280, #ffffff' },
  { key: 'black_point', label: 'Black Point', section: 'TONE', min: -1, max: 1, step: 0.01, gradient: '#ffffff, #000000' },
  { key: 'shadows', label: 'Shadows', section: 'TONE', min: -1, max: 1, step: 0.01, gradient: '#000000, #6b7280' },
  { key: 'dehaze', label: 'Dehaze', section: 'PRESENCE', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#94a3b8, #64748b, #334155, #0ea5e9' },
  { key: 'saturation', label: 'Saturation', section: 'COLOR', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#6b7280, #3b82f6, #10b981, #eab308, #f97316, #ef4444' },
  { key: 'vibrance', label: 'Vibrance', section: 'COLOR', min: -1, max: 1, step: 0.01, rangeStep: 0.05, gradient: '#64748b, #a855f7, #ec4899, #f43f5e, #f97316' },
];

const SLIDER_SECTIONS: SliderSection[] = ['TONE', 'PRESENCE', 'COLOR'];

/** Title-case display text for each section id (SectionLabel uppercases via CSS). */
const SECTION_LABELS: Record<SliderSection, string> = { TONE: 'Tone', PRESENCE: 'Presence', COLOR: 'Color' };

/** "+0.35" / "0.00" / "-0.20" — the Glass · Sectioned edited-chip format (see 4a-develop.png). */
const formatSigned = (v: number): string => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

interface BasicAdjustmentsModuleComponentProps {
  module: BasicAdjustmentsModule;
  onParamsChange?: (params: Partial<BasicAdjParams>) => void;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

export function BasicAdjustmentsModuleComponent({
  module,
  onParamsChange,
  onRegisterActions
}: BasicAdjustmentsModuleComponentProps) {
  const [params, setParams] = useState<BasicAdjParams>(module.getParams());
  const paramsRef = useRef<BasicAdjParams>(params);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Immediate UI update for smooth slider movement
  const updateParamImmediate = useCallback((key: keyof BasicAdjParams, value: number) => {
    const newParams = { ...paramsRef.current, [key]: value };
    paramsRef.current = newParams;
    setParams(newParams);
  }, []);

  // Throttled module update for performance
  const updateParam = useCallback((key: keyof BasicAdjParams, value: number) => {
    // Clear any existing timeout for this parameter
    if (updateTimeoutRef.current[key]) {
      clearTimeout(updateTimeoutRef.current[key]);
    }

    // Update UI immediately for smooth feedback
    updateParamImmediate(key, value);

    // Throttle the actual module and processing updates
    updateTimeoutRef.current[key] = setTimeout(() => {
      const newParams = { ...paramsRef.current, [key]: value };
      module.setParams({ [key]: value });
      onParamsChange?.(newParams);
      logger.debug(`BasicAdj ${key} updated:`, value);
      delete updateTimeoutRef.current[key];
    }, 16); // ~60fps for smooth updates
  }, [module, onParamsChange, updateParamImmediate]);

  const resetAll = useCallback(() => {
    module.resetParams();
    const resetParams = module.getParams();
    setParams(resetParams);
    onParamsChange?.(resetParams);
    logger.info('BasicAdj: All parameters reset to defaults');
  }, [module, onParamsChange]);

  // Image-aware auto: analyse the current image and apply the computed basic
  // adjustments. Lifted verbatim from the old inner-header ⚡ button so the card
  // header's Auto keeps identical semantics (Task 2).
  const handleAuto = useCallback(() => {
    // Reads currentImage pixels directly — during the progressive-open developing window
    // that's the graded preview, not the neutral full-res base (L3 review round 2).
    if (guardDeveloping(notificationService.info.bind(notificationService), 'Auto Basic Adjustments')) return;
    const img = imageService.getCurrentImage();
    if (!img) { logger.warn('No image for auto adjust'); return; }
    const stats = autoAdjustService.analyse(img.data, img.width, img.height);
    const computed = autoAdjustService.autoBasicAdj(stats);
    module.setParams(computed);
    const newParams = module.getParams() as BasicAdjParams;
    setParams(newParams);
    onParamsChange?.(newParams);
    logger.info('Auto adjustments applied (image-aware)');
  }, [module, onParamsChange]);

  useRegisterModuleCardActions(onRegisterActions, { auto: handleAuto, reset: resetAll });

  // ── Local Adjustments: mask tools + per-mask "second Basic Adjustments" ─────
  const [masks, setMasks] = useState<LocalAdjustmentLayer[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [maskBA, setMaskBA] = useState<BasicAdjParams>(NEUTRAL_BA);
  const [maskFeather, setMaskFeather] = useState(0.5);

  const getLA = useCallback(
    () => imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments') ?? null,
    []
  );
  const reprocess = () => {
    // The pipeline caches each module's result keyed by its params; the mask's huge
    // Float32 mask in those params makes the key unreliable, so force-invalidate the
    // Local Adjustments cache whenever a mask changes — otherwise the masked edit
    // (slider/feather/geometry) is computed but the stale cached result is shown.
    imageProcessingPipeline.invalidateModuleCache('localadjustments');
    useAppStore.getState().triggerReprocessing();
  };

  const refreshMasks = useCallback(() => {
    const la = getLA();
    setMasks(la ? la.getParameters().layers.filter(l => l.type === 'radial_gradient' || l.type === 'linear_gradient') : []);
  }, [getLA]);

  useEffect(() => { refreshMasks(); }, [refreshMasks]);

  const selectMask = useCallback((id: string) => {
    const la = getLA(); if (!la) return;
    la.setActiveLayer(id);
    setSelectedMaskId(id);
    const layer = la.getParameters().layers.find(l => l.id === id);
    setMaskBA({ ...NEUTRAL_BA, ...(layer?.basicAdj ?? {}) });
    setMaskFeather(layer?.geometry?.feather ?? 0.5);
    reprocess();
  }, [getLA]);

  // Deselect the active mask: hides its per-mask card + sliders and removes the
  // on-canvas overlay (clears the active layer). Mirrors the "click off the image"
  // path. Triggered by re-clicking the already-active mask chip.
  const deselectMask = useCallback(() => {
    setSelectedMaskId(null);
    getLA()?.clearActiveLayer();
    reprocess();
  }, [getLA]);

  const createMask = useCallback((type: 'radial_gradient' | 'linear_gradient') => {
    const la = getLA(); const img = imageService.getCurrentImage();
    if (!la || !img) { logger.warn('Local Adjustments: no image/module'); return; }
    const base = type === 'radial_gradient' ? 'Circle' : 'Gradient';
    const n = la.getParameters().layers.filter(l => l.name.startsWith(base)).length;
    const id = la.createLayer(type, n > 0 ? `${base} ${n + 1}` : base, img.width, img.height);
    la.updateLayerBasicAdj(id, {}); // mark it as a Basic-Adjustments mask
    refreshMasks();
    selectMask(id);
  }, [getLA, refreshMasks, selectMask]);

  const deleteMask = useCallback((id: string) => {
    const la = getLA(); if (!la) return;
    la.removeLayer(id);
    if (selectedMaskId === id) setSelectedMaskId(null);
    refreshMasks();
    reprocess();
  }, [getLA, refreshMasks, selectedMaskId]);

  const updateMaskBA = useCallback((key: keyof BasicAdjParams, value: number) => {
    if (!selectedMaskId) return;
    setMaskBA(prev => ({ ...prev, [key]: value }));
    getLA()?.updateLayerBasicAdj(selectedMaskId, { [key]: value });
    reprocess();
  }, [getLA, selectedMaskId]);

  const updateMaskFeather = useCallback((value: number) => {
    const la = getLA(); const img = imageService.getCurrentImage();
    if (!la || !img || !selectedMaskId) return;
    setMaskFeather(value);
    const layer = la.getParameters().layers.find(l => l.id === selectedMaskId);
    if (layer?.geometry) la.setLayerGeometry(selectedMaskId, { ...layer.geometry, feather: value }, img.width, img.height);
    reprocess();
  }, [getLA, selectedMaskId]);

  const selectedMask = masks.find(m => m.id === selectedMaskId) ?? null;

  // Press Delete/Backspace to delete the selected mask (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedMaskId) return;
      // Shared guard (keyboardScope.ts): don't delete the mask while typing in a
      // field OR while a modal dialog is open (its own Del/Backspace wins).
      if (keyboardEventBlocked(e)) return;
      e.preventDefault();
      deleteMask(selectedMaskId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMaskId, deleteMask]);

  const renderMaskSlider = (cfg: SliderCfg) => (
    <SliderRow
      key={cfg.key}
      label={cfg.label}
      value={maskBA[cfg.key] as number}
      defaultValue={0}
      min={cfg.min}
      max={cfg.max}
      step={cfg.rangeStep ?? cfg.step ?? 0.01}
      typingStep={cfg.step ?? 0.01}
      onChange={(v) => updateMaskBA(cfg.key, v)}
      formatValue={formatSigned}
      trackBackground={`linear-gradient(to right, ${cfg.gradient})`}
    />
  );

  const renderSlider = (cfg: SliderCfg) => (
    <SliderRow
      key={cfg.key}
      label={cfg.label}
      value={params[cfg.key] as number}
      defaultValue={0}
      min={cfg.min}
      max={cfg.max}
      step={cfg.rangeStep ?? cfg.step ?? 0.01}
      typingStep={cfg.step ?? 0.01}
      onChange={(v) => updateParam(cfg.key, v)}
      formatValue={formatSigned}
      trackBackground={`linear-gradient(to right, ${cfg.gradient})`}
    />
  );

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Local Adjustments mask tools */}
      <div className="flex flex-col" style={{ gap: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SectionLabel>Masks</SectionLabel>
          </div>
          <ChipButton onClick={() => createMask('radial_gradient')} title="Add a circle / oval mask">
            <Circle className="w-3.5 h-3.5" style={{ marginRight: 6 }} /> Circle
          </ChipButton>
          <ChipButton onClick={() => createMask('linear_gradient')} title="Add a linear gradient mask">
            <span style={{ fontSize: 13, lineHeight: 1, marginRight: 6 }}>▤</span> Gradient
          </ChipButton>
        </div>
        {masks.length > 0 && (
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {masks.map(mk => (
              <ChipButton
                key={mk.id}
                active={mk.id === selectedMaskId}
                onClick={() => (mk.id === selectedMaskId ? deselectMask() : selectMask(mk.id))}
                title={mk.id === selectedMaskId ? 'Click again to hide this mask and its sliders' : 'Select this mask'}
              >
                {mk.type === 'radial_gradient' ? '◯' : '▤'} {mk.name}
              </ChipButton>
            ))}
          </div>
        )}
      </div>

      {/* Per-mask Local Adjustments sliders — directly under the mask buttons, only
          when a mask is selected; in a distinct panel to set it apart from the
          global Basic Adjustments below. */}
      {selectedMask && (
        <div
          className="flex flex-col"
          style={{ gap: 12, borderRadius: 10, border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,.25)', padding: 12 }}
        >
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
              {selectedMask.type === 'radial_gradient' ? '◯' : '▤'} {selectedMask.name}
            </span>
            <button
              onClick={() => deleteMask(selectedMask.id)}
              className="inline-flex items-center justify-center"
              style={{ padding: 4, borderRadius: 6, color: '#f87171', background: 'transparent' }}
              title="Delete mask (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--glass-text-secondary)' }}>
            Drag on the image to place / move / resize / rotate this mask. Click its chip above again to hide it. Press Del to delete.
          </div>
          <SliderRow
            label="Feather"
            value={maskFeather}
            defaultValue={0.5}
            min={0.01}
            max={1}
            step={0.01}
            onChange={updateMaskFeather}
            formatValue={(v) => v.toFixed(2)}
          />
          <div className="flex flex-col" style={{ gap: 12 }}>
            {BASIC_ADJ_SLIDERS.map(renderMaskSlider)}
          </div>
        </div>
      )}

      {/* Global Basic Adjustments — §4 groupings: TONE / PRESENCE / COLOR. */}
      {SLIDER_SECTIONS.map((section) => (
        <div key={section} className="flex flex-col" style={{ gap: 12 }}>
          <SectionLabel>{SECTION_LABELS[section]}</SectionLabel>
          {BASIC_ADJ_SLIDERS.filter((cfg) => cfg.section === section).map(renderSlider)}
        </div>
      ))}
    </div>
  );
}
