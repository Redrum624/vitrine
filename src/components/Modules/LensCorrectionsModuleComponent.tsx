import React, { useState, useCallback } from 'react';
import { Camera, Zap, Palette, Eye, RotateCcw, Target } from 'lucide-react';
import { SliderControl } from '../Controls/SliderControl';
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
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={parameters.vignetting.enabled}
            onChange={(e) => handleVignettingChange('enabled', e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-300">Enable Vignetting Correction</span>
        </label>
        <div className="flex gap-1">
          {onAutoDetectVignetting && (
            <button
              onClick={onAutoDetectVignetting}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors flex items-center gap-1"
              title="Auto-detect vignetting"
            >
              <Target size={12} />
              Auto
            </button>
          )}
          {onResetSection && (
            <button
              onClick={() => onResetSection('vignetting')}
              className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
              title="Reset vignetting"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {parameters.vignetting.enabled && (
        <div className="space-y-3">
          {/* Presets */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Presets</h5>
            <div className="grid grid-cols-2 gap-2">
              {VIGNETTING_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyVignettingPreset(preset)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Main Controls */}
          <div className="space-y-3">
            <SliderControl
              label="Amount"
              value={parameters.vignetting.amount}
              min={-100}
              max={100}
              step={1}
              onChange={(value) => handleVignettingChange('amount', value)}
              className="text-xs"
            />

            <SliderControl
              label="Midpoint"
              value={parameters.vignetting.midpoint}
              min={0.1}
              max={2.0}
              step={0.01}
              onChange={(value) => handleVignettingChange('midpoint', value)}
              className="text-xs"
            />

            <SliderControl
              label="Roundness"
              value={parameters.vignetting.roundness}
              min={-100}
              max={100}
              step={1}
              onChange={(value) => handleVignettingChange('roundness', value)}
              className="text-xs"
            />

            <SliderControl
              label="Feather"
              value={parameters.vignetting.feather}
              min={0}
              max={100}
              step={1}
              onChange={(value) => handleVignettingChange('feather', value)}
              className="text-xs"
              showPercentage
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderDistortionTab = () => (
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={parameters.distortion.enabled}
            onChange={(e) => handleDistortionChange('enabled', e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-300">Enable Distortion Correction</span>
        </label>
        {onResetSection && (
          <button
            onClick={() => onResetSection('distortion')}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
            title="Reset distortion"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {parameters.distortion.enabled && (
        <div className="space-y-3">
          {/* Presets */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Presets</h5>
            <div className="grid grid-cols-2 gap-2">
              {DISTORTION_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyDistortionPreset(preset)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Main Controls */}
          <div className="space-y-3">
            <SliderControl
              label="Barrel/Pincushion"
              value={parameters.distortion.barrel}
              min={-100}
              max={100}
              step={1}
              onChange={(value) => handleDistortionChange('barrel', value)}
              className="text-xs"
              description="Negative = Barrel, Positive = Pincushion"
            />

            <SliderControl
              label="Scale"
              value={parameters.distortion.scale}
              min={0.5}
              max={2.0}
              step={0.01}
              onChange={(value) => handleDistortionChange('scale', value)}
              className="text-xs"
            />
          </div>

          {/* Perspective Correction */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Perspective Correction</h5>

            <SliderControl
              label="Horizontal"
              value={parameters.distortion.perspective.horizontal}
              min={-45}
              max={45}
              step={0.1}
              onChange={(value) => handleDistortionChange('perspective', {
                ...parameters.distortion.perspective,
                horizontal: value
              })}
              className="text-xs"
              description="Degrees"
            />

            <SliderControl
              label="Vertical"
              value={parameters.distortion.perspective.vertical}
              min={-45}
              max={45}
              step={0.1}
              onChange={(value) => handleDistortionChange('perspective', {
                ...parameters.distortion.perspective,
                vertical: value
              })}
              className="text-xs"
              description="Degrees"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderChromaticTab = () => (
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={parameters.chromaticAberration.enabled}
            onChange={(e) => handleChromaticAberrationChange('enabled', e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-300">Enable Chromatic Aberration Correction</span>
        </label>
        {onResetSection && (
          <button
            onClick={() => onResetSection('chromaticAberration')}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
            title="Reset chromatic aberration"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {parameters.chromaticAberration.enabled && (
        <div className="space-y-3">
          {/* Lateral Chromatic Aberration */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Lateral Chromatic Aberration</h5>

            <SliderControl
              label="Red/Cyan"
              value={parameters.chromaticAberration.redCyan}
              min={-100}
              max={100}
              step={1}
              onChange={(value) => handleChromaticAberrationChange('redCyan', value)}
              className="text-xs"
            />

            <SliderControl
              label="Blue/Magenta"
              value={parameters.chromaticAberration.blueMagenta}
              min={-100}
              max={100}
              step={1}
              onChange={(value) => handleChromaticAberrationChange('blueMagenta', value)}
              className="text-xs"
            />
          </div>

          {/* Color Fringing */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-300">Color Fringing</h5>

            {/* Purple Fringing */}
            <div className="space-y-2 pl-2 border-l border-purple-500">
              <span className="text-xs text-purple-400 font-medium">Purple Fringing</span>

              <SliderControl
                label="Amount"
                value={parameters.chromaticAberration.purple.amount}
                min={0}
                max={100}
                step={1}
                onChange={(value) => handleChromaticAberrationChange('purple', {
                  ...parameters.chromaticAberration.purple,
                  amount: value
                })}
                className="text-xs"
                showPercentage
              />

              {showAdvanced && (
                <>
                  <SliderControl
                    label="Hue"
                    value={parameters.chromaticAberration.purple.hue}
                    min={0}
                    max={360}
                    step={1}
                    onChange={(value) => handleChromaticAberrationChange('purple', {
                      ...parameters.chromaticAberration.purple,
                      hue: value
                    })}
                    className="text-xs"
                    description="Degrees"
                  />

                  <SliderControl
                    label="Range"
                    value={parameters.chromaticAberration.purple.range}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(value) => handleChromaticAberrationChange('purple', {
                      ...parameters.chromaticAberration.purple,
                      range: value
                    })}
                    className="text-xs"
                  />
                </>
              )}
            </div>

            {/* Green Fringing */}
            <div className="space-y-2 pl-2 border-l border-green-500">
              <span className="text-xs text-green-400 font-medium">Green Fringing</span>

              <SliderControl
                label="Amount"
                value={parameters.chromaticAberration.green.amount}
                min={0}
                max={100}
                step={1}
                onChange={(value) => handleChromaticAberrationChange('green', {
                  ...parameters.chromaticAberration.green,
                  amount: value
                })}
                className="text-xs"
                showPercentage
              />

              {showAdvanced && (
                <>
                  <SliderControl
                    label="Hue"
                    value={parameters.chromaticAberration.green.hue}
                    min={0}
                    max={360}
                    step={1}
                    onChange={(value) => handleChromaticAberrationChange('green', {
                      ...parameters.chromaticAberration.green,
                      hue: value
                    })}
                    className="text-xs"
                    description="Degrees"
                  />

                  <SliderControl
                    label="Range"
                    value={parameters.chromaticAberration.green.range}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(value) => handleChromaticAberrationChange('green', {
                      ...parameters.chromaticAberration.green,
                      range: value
                    })}
                    className="text-xs"
                  />
                </>
              )}
            </div>

            {/* Advanced Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderProfileTab = () => (
    <div className="space-y-4">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={parameters.profile.enabled}
            onChange={(e) => handleProfileChange('enabled', e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-300">Enable Profile-based Correction</span>
        </label>
      </div>

      {parameters.profile.enabled && (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">
            Profile-based correction uses lens manufacturer data to automatically correct distortion,
            vignetting, and chromatic aberration.
          </div>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={parameters.profile.autoDetect}
              onChange={(e) => handleProfileChange('autoDetect', e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-300">Auto-detect lens profile</span>
          </label>

          {!parameters.profile.autoDetect && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-300">Manual Profile Selection</label>
              <select
                value={parameters.profile.profileName}
                onChange={(e) => handleProfileChange('profileName', e.target.value)}
                className="w-full px-3 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
              >
                <option value="">No profile selected</option>
                <option value="canon_ef_24-70_f2.8">Canon EF 24-70mm f/2.8L</option>
                <option value="canon_ef_50_f1.8">Canon EF 50mm f/1.8 STM</option>
                <option value="nikon_nikkor_24-70_f2.8">Nikkor 24-70mm f/2.8E ED VR</option>
                <option value="sony_fe_85_f1.4">Sony FE 85mm f/1.4 GM</option>
              </select>
            </div>
          )}

          <SliderControl
            label="Profile Strength"
            value={parameters.profile.strength}
            min={0}
            max={100}
            step={1}
            onChange={(value) => handleProfileChange('strength', value)}
            className="text-xs"
            showPercentage
          />

          <div className="text-xs text-gray-500 mt-2">
            Current profile: {parameters.profile.profileName || 'Auto-detect'}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Lens Corrections</h3>
        <div className="flex items-center gap-1">
          <Camera size={16} className="text-gray-400" />
          {onResetSection && (
            <button
              onClick={() => onResetSection('all')}
              className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
              title="Reset all corrections"
            >
              <RotateCcw size={12} />
              All
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-600 mb-4">
        {[
          { key: 'vignetting', label: 'Vignetting', icon: Eye },
          { key: 'distortion', label: 'Distortion', icon: Zap },
          { key: 'chromatic', label: 'Chromatic', icon: Palette },
          { key: 'profile', label: 'Profile', icon: Camera }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as TabType)}
            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === key
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'vignetting' && renderVignettingTab()}
        {activeTab === 'distortion' && renderDistortionTab()}
        {activeTab === 'chromatic' && renderChromaticTab()}
        {activeTab === 'profile' && renderProfileTab()}
      </div>

      {/* Status Summary */}
      <div className="mt-4 pt-3 border-t border-gray-600">
        <div className="text-xs text-gray-400">
          <div className="flex items-center justify-between">
            <span>Active Corrections:</span>
            <span className="text-blue-400">
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