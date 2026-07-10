import React, { useState, useCallback, useRef } from 'react';
import { Sun, Moon, Sliders, RotateCcw, Zap, Settings } from 'lucide-react';
import { ShadowsHighlightsModule, ShadowsHighlightsParams } from '../../modules/ShadowsHighlightsModule';
import { logger } from '../../utils/Logger';
import { DelayedInputControl } from '../Controls/DelayedInputControl';
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

export const ShadowsHighlightsModuleComponent: React.FC<ShadowsHighlightsModuleComponentProps> = ({
  module,
  onParamsChange,
  onRegisterActions
}) => {
  const [params, setParams] = useState<ShadowsHighlightsParams>(module.getParams());
  const [activeSection, setActiveSection] = useState<'shadows' | 'highlights' | 'advanced'>('shadows');
  const paramsRef = useRef<ShadowsHighlightsParams>(params);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Keep ref in sync
  React.useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Real-time update for onInput (during drag) - immediate UI + processing
  const handleParamChangeRealTime = useCallback((paramName: keyof ShadowsHighlightsParams, value: number) => {
    const newParams = { ...paramsRef.current, [paramName]: value };
    paramsRef.current = newParams;
    setParams(newParams);
    module.setParams({ [paramName]: value });
    onParamsChange?.(newParams);
  }, [module, onParamsChange]);

  // Throttled update for onChange - immediate UI, deferred processing
  const handleParamChange = useCallback((paramName: keyof ShadowsHighlightsParams, value: number) => {
    const newParams = { ...paramsRef.current, [paramName]: value };
    paramsRef.current = newParams;
    setParams(newParams);

    const key = paramName as string;
    if (updateTimeoutRef.current[key]) clearTimeout(updateTimeoutRef.current[key]);
    updateTimeoutRef.current[key] = setTimeout(() => {
      module.setParams({ [paramName]: value });
      onParamsChange?.(newParams);
      delete updateTimeoutRef.current[key];
    }, 16);
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

  const resetParam = useCallback((key: keyof ShadowsHighlightsParams, defaultValue: number) => {
    handleParamChange(key, defaultValue);
  }, [handleParamChange]);

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

  return (
    <div className="space-y-3">
      {/* Preset Buttons */}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => handlePresetApply('subtle')}
          className="px-2 py-1.5 text-xs rounded border transition-colors"
          style={{
            backgroundColor: 'var(--gray-700)',
            borderColor: 'var(--border)',
            color: 'var(--gray-300)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-600)';
            e.currentTarget.style.borderColor = 'var(--border-light)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-700)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          title="Subtle shadow/highlight recovery"
        >
          Subtle
        </button>
        <button
          onClick={() => handlePresetApply('moderate')}
          className="px-2 py-1.5 text-xs rounded border transition-colors"
          style={{
            backgroundColor: 'var(--gray-700)',
            borderColor: 'var(--border)',
            color: 'var(--gray-300)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-600)';
            e.currentTarget.style.borderColor = 'var(--border-light)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-700)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          title="Moderate shadow/highlight recovery"
        >
          Moderate
        </button>
        <button
          onClick={() => handlePresetApply('strong')}
          className="px-2 py-1.5 text-xs rounded border transition-colors"
          style={{
            backgroundColor: 'var(--gray-700)',
            borderColor: 'var(--border)',
            color: 'var(--gray-300)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-600)';
            e.currentTarget.style.borderColor = 'var(--border-light)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-700)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
          title="Strong shadow/highlight recovery"
        >
          Strong
        </button>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-800)'}}>
        <button
          onClick={() => setActiveSection('shadows')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border transition-all"
          style={{
            backgroundColor: activeSection === 'shadows' ? 'var(--gray-600)' : 'transparent',
            borderColor: activeSection === 'shadows' ? 'var(--border-light)' : 'var(--border)',
            color: activeSection === 'shadows' ? 'var(--white)' : 'var(--gray-400)'
          }}
        >
          <Moon className="w-3 h-3" />
          <span>Shadows</span>
        </button>
        <button
          onClick={() => setActiveSection('highlights')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border transition-all"
          style={{
            backgroundColor: activeSection === 'highlights' ? 'var(--gray-600)' : 'transparent',
            borderColor: activeSection === 'highlights' ? 'var(--border-light)' : 'var(--border)',
            color: activeSection === 'highlights' ? 'var(--white)' : 'var(--gray-400)'
          }}
        >
          <Sun className="w-3 h-3" />
          <span>Highlights</span>
        </button>
        <button
          onClick={() => setActiveSection('advanced')}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded border transition-all"
          style={{
            backgroundColor: activeSection === 'advanced' ? 'var(--gray-600)' : 'transparent',
            borderColor: activeSection === 'advanced' ? 'var(--border-light)' : 'var(--border)',
            color: activeSection === 'advanced' ? 'var(--white)' : 'var(--gray-400)'
          }}
        >
          <Settings className="w-3 h-3" />
          <span>Advanced</span>
        </button>
      </div>

      {/* Shadow Controls */}
      {activeSection === 'shadows' && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Moon className="w-4 h-4" style={{color: 'var(--blue-400)'}} />
            <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Shadows</span>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Amount</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.shadows}
                  onChange={(value) => handleParamChange('shadows', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('shadows', 50)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.shadows}
              onInput={(e) => handleParamChangeRealTime('shadows', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('shadows', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('shadows', 50)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #000000, #4b5563, #9ca3af)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Radius */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Radius</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.shadowsRadius}
                  onChange={(value) => handleParamChange('shadowsRadius', value)}
                  min={0.1}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('shadowsRadius', 50)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0.1"
              max="100"
              step="1"
              value={params.shadowsRadius}
              onInput={(e) => handleParamChangeRealTime('shadowsRadius', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('shadowsRadius', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('shadowsRadius', 50)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #1f2937, #374151, #6b7280)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Color Transfer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Transfer</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.shadowsColorTransfer}
                  onChange={(value) => handleParamChange('shadowsColorTransfer', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('shadowsColorTransfer', 0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.shadowsColorTransfer}
              onInput={(e) => handleParamChangeRealTime('shadowsColorTransfer', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('shadowsColorTransfer', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('shadowsColorTransfer', 0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #374151, #3b82f6, #1d4ed8)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Color Correction */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Correction</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.shadowsColorCorrection}
                  onChange={(value) => handleParamChange('shadowsColorCorrection', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('shadowsColorCorrection', 0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.shadowsColorCorrection}
              onInput={(e) => handleParamChangeRealTime('shadowsColorCorrection', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('shadowsColorCorrection', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('shadowsColorCorrection', 0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #374151, #8b5cf6, #7c3aed)',
              }}
              title="Double-click to reset"
            />
          </div>
        </div>
      )}

      {/* Highlight Controls */}
      {activeSection === 'highlights' && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Sun className="w-4 h-4" style={{color: 'var(--yellow-400)'}} />
            <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Highlights</span>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Amount</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.highlights}
                  onChange={(value) => handleParamChange('highlights', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('highlights', 50)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.highlights}
              onInput={(e) => handleParamChangeRealTime('highlights', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('highlights', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('highlights', 50)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #9ca3af, #f3f4f6, #ffffff)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Radius */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Radius</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.highlightsRadius}
                  onChange={(value) => handleParamChange('highlightsRadius', value)}
                  min={0.1}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('highlightsRadius', 50)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0.1"
              max="100"
              step="1"
              value={params.highlightsRadius}
              onInput={(e) => handleParamChangeRealTime('highlightsRadius', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('highlightsRadius', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('highlightsRadius', 50)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #d1d5db, #f3f4f6, #ffffff)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Color Transfer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Transfer</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.highlightsColorTransfer}
                  onChange={(value) => handleParamChange('highlightsColorTransfer', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('highlightsColorTransfer', 0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.highlightsColorTransfer}
              onInput={(e) => handleParamChangeRealTime('highlightsColorTransfer', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('highlightsColorTransfer', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('highlightsColorTransfer', 0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #d1d5db, #fbbf24, #f59e0b)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Color Correction */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Correction</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.highlightsColorCorrection}
                  onChange={(value) => handleParamChange('highlightsColorCorrection', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('highlightsColorCorrection', 0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.highlightsColorCorrection}
              onInput={(e) => handleParamChangeRealTime('highlightsColorCorrection', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('highlightsColorCorrection', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('highlightsColorCorrection', 0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #d1d5db, #f97316, #ea580c)',
              }}
              title="Double-click to reset"
            />
          </div>
        </div>
      )}

      {/* Advanced Controls */}
      {activeSection === 'advanced' && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Settings className="w-4 h-4" style={{color: 'var(--primary-400)'}} />
            <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Advanced Settings</span>
          </div>

          {/* White/Black Points */}
          <div className="space-y-3">
            <span className="text-xs font-medium" style={{color: 'var(--gray-400)'}}>Tone Range</span>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>White Point</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={params.whitePoint}
                    onChange={(value) => handleParamChange('whitePoint', value)}
                    min={-4}
                    max={4}
                    step={0.01}
                    precision={2}
                  />
                  <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>EV</span>
                  <button
                    onClick={() => resetParam('whitePoint', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="-4"
                max="4"
                step="0.01"
                value={params.whitePoint}
                onInput={(e) => handleParamChangeRealTime('whitePoint', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParamChange('whitePoint', parseFloat(e.target.value))}
                onDoubleClick={() => handleParamChange('whitePoint', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #d1d5db, #ffffff)',
                }}
                title="Double-click to reset"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Black Point</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={params.blackPoint}
                    onChange={(value) => handleParamChange('blackPoint', value)}
                    min={-4}
                    max={4}
                    step={0.01}
                    precision={2}
                  />
                  <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>EV</span>
                  <button
                    onClick={() => resetParam('blackPoint', 0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="-4"
                max="4"
                step="0.01"
                value={params.blackPoint}
                onInput={(e) => handleParamChangeRealTime('blackPoint', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParamChange('blackPoint', parseFloat(e.target.value))}
                onDoubleClick={() => handleParamChange('blackPoint', 0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #000000, #374151, #6b7280)',
                }}
                title="Double-click to reset"
              />
            </div>
          </div>

          {/* Compression */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Compression</label>
              <div className="flex items-center gap-1.5">
                <DelayedInputControl
                  value={params.compress}
                  onChange={(value) => handleParamChange('compress', value)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                />
                <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>%</span>
                <button
                  onClick={() => resetParam('compress', 0)}
                  className="p-1 rounded"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--gray-500)',
                    transition: 'var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                    e.currentTarget.style.color = 'var(--white)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--gray-500)';
                  }}
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.compress}
              onInput={(e) => handleParamChangeRealTime('compress', parseFloat((e.target as HTMLInputElement).value))}
              onChange={(e) => handleParamChange('compress', parseFloat(e.target.value))}
              onDoubleClick={() => handleParamChange('compress', 0)}
              className="slider w-full"
              style={{
                background: 'linear-gradient(to right, #374151, #dc2626, #991b1b)',
              }}
              title="Double-click to reset"
            />
          </div>

          {/* Processing Controls */}
          <div className="space-y-3">
            <span className="text-xs font-medium" style={{color: 'var(--gray-400)'}}>Processing</span>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Strength</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={params.strength}
                    onChange={(value) => handleParamChange('strength', value)}
                    min={0}
                    max={2}
                    step={0.01}
                    precision={2}
                  />
                  <span className="text-xs font-mono" style={{color: 'var(--gray-500)', width: '20px'}}>x</span>
                  <button
                    onClick={() => resetParam('strength', 1.0)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={params.strength}
                onInput={(e) => handleParamChangeRealTime('strength', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParamChange('strength', parseFloat(e.target.value))}
                onDoubleClick={() => handleParamChange('strength', 1.0)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #374151, #10b981, #059669)',
                }}
                title="Double-click to reset"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Iterations</label>
                <div className="flex items-center gap-1.5">
                  <DelayedInputControl
                    value={params.iterations}
                    onChange={(value) => handleParamChange('iterations', value)}
                    min={1}
                    max={5}
                    step={1}
                    precision={0}
                  />
                  <button
                    onClick={() => resetParam('iterations', 1)}
                    className="p-1 rounded"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--gray-500)',
                      transition: 'var(--transition-fast)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                      e.currentTarget.style.color = 'var(--white)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-500)';
                    }}
                    title="Reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={params.iterations}
                onInput={(e) => handleParamChangeRealTime('iterations', parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => handleParamChange('iterations', parseFloat(e.target.value))}
                onDoubleClick={() => handleParamChange('iterations', 1)}
                className="slider w-full"
                style={{
                  background: 'linear-gradient(to right, #6b7280, #3b82f6, #1d4ed8)',
                }}
                title="Double-click to reset"
              />
            </div>
          </div>

          {/* Toggle Switches */}
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!params.preserveColor}
                onChange={(e) => handleParamChange('preserveColor', e.target.checked ? 1 : 0)}
                className="rounded"
                style={{borderColor: 'var(--border)'}}
              />
              <span className="text-xs" style={{color: 'var(--gray-300)'}}>Preserve Color</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!params.bilateralFilter}
                onChange={(e) => handleParamChange('bilateralFilter', e.target.checked ? 1 : 0)}
                className="rounded"
                style={{borderColor: 'var(--border)'}}
              />
              <span className="text-xs" style={{color: 'var(--gray-300)'}}>Bilateral Filter</span>
            </label>
          </div>
        </div>
      )}

      {/* Status Indicator */}
      <div className="pt-2" style={{borderTop: '1px solid var(--border)'}}>
        <div className="flex items-center justify-between text-xs" style={{color: 'var(--gray-500)'}}>
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3 h-3" />
            <span>Shadows/Highlights</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(params.shadows > 0 || params.highlights > 0) && (
              <div className="flex items-center gap-1" style={{color: 'var(--green-400)'}}>
                <Zap className="w-3 h-3" />
                <span>Active</span>
              </div>
            )}
            <span>
              S:{params.shadows.toFixed(0)}% H:{params.highlights.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShadowsHighlightsModuleComponent;
