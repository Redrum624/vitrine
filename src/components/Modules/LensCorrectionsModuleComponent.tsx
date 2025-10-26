import React, { useState, useCallback } from 'react';
import { Camera, Zap, Palette, Eye, RotateCcw, Target } from 'lucide-react';
import { LensCorrectionsParams } from '../../modules/LensCorrectionsModule';

interface LensCorrectionsModuleComponentProps {
  parameters: LensCorrectionsParams;
  onParametersChange: (params: Partial<LensCorrectionsParams>) => void;
  onAutoDetectVignetting?: () => void;
  onResetSection?: (section: 'vignetting' | 'distortion' | 'chromaticAberration' | 'all') => void;
  className?: string;
}

type TabType = 'vignetting' | 'distortion' | 'chromatic' | 'profile';

const VIGNETTING_PRESETS = [
  { name: 'Subtle', amount: 20, midpoint: 1.0, roundness: 0, feather: 60 },
  { name: 'Moderate', amount: 40, midpoint: 1.0, roundness: 0, feather: 50 },
  { name: 'Strong', amount: 60, midpoint: 0.8, roundness: -10, feather: 40 },
  { name: 'Wide Lens', amount: 80, midpoint: 0.6, roundness: -20, feather: 30 }
];

const DISTORTION_PRESETS = [
  { name: 'Barrel Weak', barrel: -15, scale: 1.05 },
  { name: 'Barrel Strong', barrel: -35, scale: 1.15 },
  { name: 'Pincushion Weak', barrel: 15, scale: 0.95 },
  { name: 'Pincushion Strong', barrel: 35, scale: 0.85 }
];

export const LensCorrectionsModuleComponent: React.FC<LensCorrectionsModuleComponentProps> = ({
  parameters,
  onParametersChange,
  onAutoDetectVignetting,
  onResetSection,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('vignetting');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleVignettingChange = useCallback((key: string, value: number | boolean) => {
    onParametersChange({
      vignetting: {
        ...parameters.vignetting,
        [key]: value
      }
    });
  }, [parameters.vignetting, onParametersChange]);

  const handleDistortionChange = useCallback((key: string, value: number | boolean | object) => {
    if (key === 'perspective') {
      onParametersChange({
        distortion: {
          ...parameters.distortion,
          perspective: value as { horizontal: number; vertical: number }
        }
      });
    } else {
      onParametersChange({
        distortion: {
          ...parameters.distortion,
          [key]: value
        }
      });
    }
  }, [parameters.distortion, onParametersChange]);

  const handleChromaticAberrationChange = useCallback((key: string, value: number | boolean | object) => {
    if (key === 'purple' || key === 'green') {
      onParametersChange({
        chromaticAberration: {
          ...parameters.chromaticAberration,
          [key]: value
        }
      });
    } else {
      onParametersChange({
        chromaticAberration: {
          ...parameters.chromaticAberration,
          [key]: value
        }
      });
    }
  }, [parameters.chromaticAberration, onParametersChange]);

  const handleProfileChange = useCallback((key: string, value: number | boolean | string) => {
    onParametersChange({
      profile: {
        ...parameters.profile,
        [key]: value
      }
    });
  }, [parameters.profile, onParametersChange]);

  const applyVignettingPreset = useCallback((preset: typeof VIGNETTING_PRESETS[0]) => {
    onParametersChange({
      vignetting: {
        ...parameters.vignetting,
        enabled: true,
        ...preset
      }
    });
  }, [parameters.vignetting, onParametersChange]);

  const applyDistortionPreset = useCallback((preset: typeof DISTORTION_PRESETS[0]) => {
    onParametersChange({
      distortion: {
        ...parameters.distortion,
        enabled: true,
        ...preset,
        perspective: { horizontal: 0, vertical: 0 }
      }
    });
  }, [parameters.distortion, onParametersChange]);

  const renderVignettingTab = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={parameters.vignetting.enabled}
            onChange={(e) => handleVignettingChange('enabled', e.target.checked)}
            className="rounded"
            style={{borderColor: 'var(--border)'}}
          />
          <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Enable Vignetting</span>
        </label>
        <div className="flex gap-1.5">
          {onAutoDetectVignetting && (
            <button
              onClick={onAutoDetectVignetting}
              className="px-2 py-1 text-xs rounded transition-colors flex items-center gap-1"
              style={{
                backgroundColor: 'var(--primary-600)',
                color: 'var(--white)'
              }}
              title="Auto-detect vignetting"
            >
              <Target className="w-3 h-3" />
              Auto
            </button>
          )}
          {onResetSection && (
            <button
              onClick={() => onResetSection('vignetting')}
              className="p-1 rounded"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--gray-400)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                e.currentTarget.style.color = 'var(--white)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--gray-400)';
              }}
              title="Reset vignetting"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {parameters.vignetting.enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Presets</label>
            <div className="grid grid-cols-2 gap-1.5">
              {VIGNETTING_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyVignettingPreset(preset)}
                  className="px-2 py-1 text-xs rounded transition-colors"
                  style={{
                    backgroundColor: 'var(--gray-700)',
                    color: 'var(--white)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-600)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-700)';
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {[
              { key: 'amount', label: 'Amount', min: -100, max: 100, step: 1 },
              { key: 'midpoint', label: 'Midpoint', min: 0.1, max: 2.0, step: 0.01 },
              { key: 'roundness', label: 'Roundness', min: -100, max: 100, step: 1 },
              { key: 'feather', label: 'Feather', min: 0, max: 100, step: 1 }
            ].map(({ key, label, min, max, step }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>{label}</label>
                  <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                    {typeof parameters.vignetting[key as keyof typeof parameters.vignetting] === 'number'
                      ? (parameters.vignetting[key as keyof typeof parameters.vignetting] as number).toFixed(key === 'midpoint' ? 2 : 0)
                      : '0'}
                    {key === 'feather' ? '%' : ''}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={parameters.vignetting[key as keyof typeof parameters.vignetting] as number}
                  onChange={(e) => handleVignettingChange(key, parseFloat(e.target.value))}
                  className="slider w-full"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderDistortionTab = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={parameters.distortion.enabled}
            onChange={(e) => handleDistortionChange('enabled', e.target.checked)}
            className="rounded"
            style={{borderColor: 'var(--border)'}}
          />
          <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Enable Distortion</span>
        </label>
        {onResetSection && (
          <button
            onClick={() => onResetSection('distortion')}
            className="p-1 rounded"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--gray-400)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Reset distortion"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      {parameters.distortion.enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Presets</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DISTORTION_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyDistortionPreset(preset)}
                  className="px-2 py-1 text-xs rounded transition-colors"
                  style={{
                    backgroundColor: 'var(--gray-700)',
                    color: 'var(--white)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-600)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--gray-700)';
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {[
              { key: 'barrel', label: 'Barrel/Pincushion', min: -100, max: 100, step: 1, desc: 'Negative = Barrel, Positive = Pincushion' },
              { key: 'scale', label: 'Scale', min: 0.5, max: 2.0, step: 0.01, desc: null }
            ].map(({ key, label, min, max, step, desc }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>{label}</label>
                  <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                    {(parameters.distortion[key as keyof typeof parameters.distortion] as number).toFixed(key === 'scale' ? 2 : 0)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={parameters.distortion[key as keyof typeof parameters.distortion] as number}
                  onChange={(e) => handleDistortionChange(key, parseFloat(e.target.value))}
                  className="slider w-full"
                />
                {desc && <div className="text-xs" style={{color: 'var(--gray-500)'}}>{desc}</div>}
              </div>
            ))}
          </div>

          <div className="space-y-1.5 pt-3" style={{borderTop: '1px solid var(--border)'}}>
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Perspective Correction</label>

            {['horizontal', 'vertical'].map((key) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium capitalize" style={{color: 'var(--gray-300)'}}>{key}</span>
                  <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                    {parameters.distortion.perspective[key as keyof typeof parameters.distortion.perspective].toFixed(1)}°
                  </span>
                </div>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={0.1}
                  value={parameters.distortion.perspective[key as keyof typeof parameters.distortion.perspective]}
                  onChange={(e) => handleDistortionChange('perspective', {
                    ...parameters.distortion.perspective,
                    [key]: parseFloat(e.target.value)
                  })}
                  className="slider w-full"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderChromaticTab = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={parameters.chromaticAberration.enabled}
            onChange={(e) => handleChromaticAberrationChange('enabled', e.target.checked)}
            className="rounded"
            style={{borderColor: 'var(--border)'}}
          />
          <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Enable Chromatic Aberration</span>
        </label>
        {onResetSection && (
          <button
            onClick={() => onResetSection('chromaticAberration')}
            className="p-1 rounded"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--gray-400)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-800)';
              e.currentTarget.style.color = 'var(--white)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Reset chromatic aberration"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      {parameters.chromaticAberration.enabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Lateral Chromatic Aberration</label>

            {[
              { key: 'redCyan', label: 'Red/Cyan' },
              { key: 'blueMagenta', label: 'Blue/Magenta' }
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>{label}</span>
                  <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                    {(() => {
                      const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                      return typeof value === 'number' ? value : 0;
                    })()}
                  </span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={typeof parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration] === 'number'
                    ? parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration] as number
                    : 0}
                  onChange={(e) => handleChromaticAberrationChange(key, parseFloat(e.target.value))}
                  className="slider w-full"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-3" style={{borderTop: '1px solid var(--border)'}}>
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Color Fringing</label>

            {[
              { key: 'purple', label: 'Purple Fringing', color: '#a855f7' },
              { key: 'green', label: 'Green Fringing', color: '#22c55e' }
            ].map(({ key, label, color }) => (
              <div key={key} className="space-y-2 pl-2" style={{borderLeft: `2px solid ${color}`}}>
                <span className="text-xs font-medium" style={{color}}>{label}</span>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Amount</span>
                    <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                      {(() => {
                        const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                        return typeof value === 'object' && value !== null && 'amount' in value
                          ? (value as {amount: number; hue: number; range: number}).amount
                          : 0;
                      })()}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={(() => {
                      const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                      return typeof value === 'object' && value !== null && 'amount' in value
                        ? (value as {amount: number; hue: number; range: number}).amount
                        : 0;
                    })()}
                    onChange={(e) => {
                      const current = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                      if (typeof current === 'object' && current !== null && 'amount' in current) {
                        handleChromaticAberrationChange(key, {
                          amount: parseFloat(e.target.value),
                          hue: (current as {amount: number; hue: number; range: number}).hue,
                          range: (current as {amount: number; hue: number; range: number}).range
                        });
                      }
                    }}
                    className="slider w-full"
                  />
                </div>

                {showAdvanced && (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Hue</span>
                        <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                          {(() => {
                            const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                            return typeof value === 'object' && value !== null && 'hue' in value
                              ? (value as {amount: number; hue: number; range: number}).hue
                              : 0;
                          })()}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        step={1}
                        value={(() => {
                          const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                          return typeof value === 'object' && value !== null && 'hue' in value
                            ? (value as {amount: number; hue: number; range: number}).hue
                            : 0;
                        })()}
                        onChange={(e) => {
                          const current = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                          if (typeof current === 'object' && current !== null && 'hue' in current) {
                            handleChromaticAberrationChange(key, {
                              amount: (current as {amount: number; hue: number; range: number}).amount,
                              hue: parseFloat(e.target.value),
                              range: (current as {amount: number; hue: number; range: number}).range
                            });
                          }
                        }}
                        className="slider w-full"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Range</span>
                        <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>
                          {(() => {
                            const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                            return typeof value === 'object' && value !== null && 'range' in value
                              ? (value as {amount: number; hue: number; range: number}).range
                              : 0;
                          })()}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={(() => {
                          const value = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                          return typeof value === 'object' && value !== null && 'range' in value
                            ? (value as {amount: number; hue: number; range: number}).range
                            : 0;
                        })()}
                        onChange={(e) => {
                          const current = parameters.chromaticAberration[key as keyof typeof parameters.chromaticAberration];
                          if (typeof current === 'object' && current !== null && 'range' in current) {
                            handleChromaticAberrationChange(key, {
                              amount: (current as {amount: number; hue: number; range: number}).amount,
                              hue: (current as {amount: number; hue: number; range: number}).hue,
                              range: parseFloat(e.target.value)
                            });
                          }
                        }}
                        className="slider w-full"
                      />
                    </div>
                  </>
                )}
              </div>
            ))}

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs transition-colors"
              style={{color: 'var(--primary-400)'}}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderProfileTab = () => (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={parameters.profile.enabled}
          onChange={(e) => handleProfileChange('enabled', e.target.checked)}
          className="rounded"
          style={{borderColor: 'var(--border)'}}
        />
        <span className="text-sm font-medium" style={{color: 'var(--gray-300)'}}>Enable Profile-based Correction</span>
      </label>

      {parameters.profile.enabled && (
        <div className="space-y-3">
          <div className="text-xs" style={{color: 'var(--gray-400)'}}>
            Profile-based correction uses lens manufacturer data to automatically correct distortion,
            vignetting, and chromatic aberration.
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={parameters.profile.autoDetect}
              onChange={(e) => handleProfileChange('autoDetect', e.target.checked)}
              className="rounded"
              style={{borderColor: 'var(--border)'}}
            />
            <span className="text-xs" style={{color: 'var(--gray-300)'}}>Auto-detect lens profile</span>
          </label>

          {!parameters.profile.autoDetect && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Manual Profile Selection</label>
              <select
                value={parameters.profile.profileName}
                onChange={(e) => handleProfileChange('profileName', e.target.value)}
                className="w-full px-3 py-1 text-xs rounded border"
                style={{
                  backgroundColor: 'var(--gray-700)',
                  color: 'var(--white)',
                  borderColor: 'var(--border)'
                }}
              >
                <option value="">No profile selected</option>
                <option value="canon_ef_24-70_f2.8">Canon EF 24-70mm f/2.8L</option>
                <option value="canon_ef_50_f1.8">Canon EF 50mm f/1.8 STM</option>
                <option value="nikon_nikkor_24-70_f2.8">Nikkor 24-70mm f/2.8E ED VR</option>
                <option value="sony_fe_85_f1.4">Sony FE 85mm f/1.4 GM</option>
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Profile Strength</label>
              <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>{parameters.profile.strength}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={parameters.profile.strength}
              onChange={(e) => handleProfileChange('strength', parseFloat(e.target.value))}
              className="slider w-full"
            />
          </div>

          <div className="text-xs mt-2" style={{color: 'var(--gray-500)'}}>
            Current profile: {parameters.profile.profileName || 'Auto-detect'}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          {onResetSection && (
            <button
              onClick={() => onResetSection('all')}
              className="p-1.5 rounded border"
              style={{
                backgroundColor: 'transparent',
                borderColor: 'var(--border)',
                color: 'var(--gray-400)',
                transition: 'var(--transition-fast)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                e.currentTarget.style.borderColor = 'var(--border-light)';
                e.currentTarget.style.color = 'var(--white)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--gray-400)';
              }}
              title="Reset all corrections"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg p-1" style={{backgroundColor: 'var(--gray-700)'}}>
        {[
          { key: 'vignetting', label: 'Vignetting', icon: Eye },
          { key: 'distortion', label: 'Distortion', icon: Zap },
          { key: 'chromatic', label: 'Chromatic', icon: Palette },
          { key: 'profile', label: 'Profile', icon: Camera }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabType)}
            className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
              activeTab === key ? 'shadow-sm' : 'bg-transparent'
            }`}
            style={{
              backgroundColor: activeTab === key ? 'var(--gray-600)' : 'transparent',
              color: activeTab === key ? 'var(--white)' : 'var(--gray-300)'
            }}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-3">
        {activeTab === 'vignetting' && renderVignettingTab()}
        {activeTab === 'distortion' && renderDistortionTab()}
        {activeTab === 'chromatic' && renderChromaticTab()}
        {activeTab === 'profile' && renderProfileTab()}
      </div>

      {/* Status Summary */}
      <div className="pt-3" style={{borderTop: '1px solid var(--border)'}}>
        <div className="text-xs" style={{color: 'var(--gray-400)'}}>
          <div className="flex items-center justify-between">
            <span>Active Corrections:</span>
            <span style={{color: 'var(--primary-400)'}}>
              {[
                parameters.vignetting.enabled && 'Vignetting',
                parameters.distortion.enabled && 'Distortion',
                parameters.chromaticAberration.enabled && 'Chromatic',
                parameters.profile.enabled && 'Profile'
              ].filter(Boolean).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LensCorrectionsModuleComponent;
