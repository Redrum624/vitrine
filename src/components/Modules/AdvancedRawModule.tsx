import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Cpu, Palette, Image, Zap, Camera } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import { advancedRawProcessor, AdvancedRawProcessingOptions, CameraProfile } from '../../services/AdvancedRawProcessor';
import { rawImageService } from '../../services/RawImageService';
import { CameraProfile as CameraProfileType } from '../../services/CameraProfileService';

interface AdvancedRawModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const AdvancedRawModule: React.FC<AdvancedRawModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const currentImagePath = currentImage?.path || null;

  // Processing options state
  const [options, setOptions] = useState<AdvancedRawProcessingOptions>({
    demosaicQuality: 'good',
    whiteBalanceMode: 'camera',
    exposureCompensation: 0.0,
    highlightRecovery: true,
    shadowBoost: false,
    colorSpace: 'sRGB',
    outputBitDepth: 16,
    outputSize: 'full',
    useManufacturerProfile: true,
    applyLensCorrections: false,
    denoiseThreshold: 0.0,
    chromaDenoiseThreshold: 0.0,
    sharpening: 0.0
  });

  // Camera profile info
  const [cameraProfile, setCameraProfile] = useState<CameraProfile | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<CameraProfileType[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [supportedFormats, setSupportedFormats] = useState<string[]>([]);

  // Advanced processing options
  const [demosaicAlgorithm, setDemosaicAlgorithm] = useState<'VNG' | 'AHD' | 'LMMSE'>('VNG');
  const [bayerPattern, setBayerPattern] = useState<'RGGB' | 'BGGR' | 'GRBG' | 'GBRG'>('RGGB');
  const [professionalMode, setProfessionalMode] = useState(false);

  // Initialize advanced processor and load camera profile
  useEffect(() => {
    const initializeProcessor = async () => {
      try {
        const formats = await advancedRawProcessor.getSupportedFormats();
        setSupportedFormats(formats);

        // Load available camera profiles
        const profiles = rawImageService.getAvailableCameraProfiles();
        setAvailableProfiles(profiles);

        // Load camera profile if image is available
        if (currentImagePath) {
          // For now, use mock metadata - in real implementation this would come from app state
          const metadata = { make: 'Olympus', model: 'OM-D E-M1 Mark III' };

          if (metadata?.make && metadata.model) {
            const profile = advancedRawProcessor.getCameraProfile(metadata.make, metadata.model);
            setCameraProfile(profile);
          }
        }
      } catch (error) {
        logger.error('Failed to initialize advanced RAW processor:', error);
      }
    };

    initializeProcessor();
  }, [currentImagePath]);

  const applyProcessing = useCallback(async () => {
    if (!currentImagePath || !isEnabled) return;

    try {
      setIsProcessing(true);
      logger.info('Applying advanced RAW processing...');

      if (professionalMode) {
        // Use professional quality processing with advanced algorithms
        logger.info(`Using professional mode with ${demosaicAlgorithm} demosaicing`);

        await rawImageService.processRawWithProfessionalQuality(
          currentImagePath,
          {
            demosaicAlgorithm,
            bayerPattern,
            applyNoiseProfiling: options.denoiseThreshold > 0,
            applyLensCorrection: options.applyLensCorrections,
            whiteBalanceMode: options.whiteBalanceMode === 'camera' ? 'camera' : 'daylight'
          }
        );

        // Update the image store with processed data
        // This would be implemented based on your app store structure
        logger.info('Professional RAW processing completed');
      } else {
        // Standard processing using the existing pipeline
        logger.debug('Advanced RAW processing parameters:', options);

        // In a real implementation, this would:
        // 1. Call advancedRawProcessor.processRawFile() with new options
        // 2. Update the image store with the new processed data
        // 3. Trigger canvas refresh
      }

    } catch (error) {
      logger.error('Advanced RAW processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [currentImagePath, isEnabled, options, professionalMode, demosaicAlgorithm, bayerPattern]);

  // Apply processing when options change
  useEffect(() => {
    if (isEnabled && currentImagePath) {
      applyProcessing();
    }
  }, [options, isEnabled, currentImagePath, applyProcessing]);

  const updateOption = <K extends keyof AdvancedRawProcessingOptions>(
    key: K,
    value: AdvancedRawProcessingOptions[K]
  ) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const resetToDefaults = () => {
    setOptions(advancedRawProcessor.getDefaultProcessingOptions());
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-blue-400" />
          <span className="text-white font-medium">Advanced RAW Processing</span>
          {isProcessing && (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefaults}
            className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            disabled={isProcessing}
          >
            Reset
          </button>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
          </label>
        </div>
      </div>

      {/* Module Content */}
      {isEnabled && (
        <div className="p-4 space-y-6">

          {/* Camera Profile Info */}
          {cameraProfile && (
            <div className="bg-gray-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-white">Camera Profile</span>
              </div>
              <div className="text-xs text-gray-300">
                <div>{cameraProfile.make} {cameraProfile.model}</div>
                <div>Color Space: {cameraProfile.dngColorSpace === 0 ? 'sRGB' : 'Other'}</div>
                <div>Baseline Exposure: {cameraProfile.baselineExposure.toFixed(2)} EV</div>
              </div>
            </div>
          )}

          {/* Professional Camera Profiles */}
          {professionalMode && availableProfiles.length > 0 && (
            <div className="bg-purple-900/20 rounded-lg p-3 border border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-white">Available Camera Profiles</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {availableProfiles.slice(0, 8).map((profile) => (
                  <div key={profile.id} className="bg-gray-800 rounded p-2 border border-gray-600">
                    <div className="font-medium text-white">{profile.make}</div>
                    <div className="text-gray-400 truncate">{profile.model}</div>
                  </div>
                ))}
              </div>
              {availableProfiles.length > 8 && (
                <div className="text-xs text-gray-400 mt-2">
                  And {availableProfiles.length - 8} more profiles...
                </div>
              )}
            </div>
          )}

          {/* Professional Mode Toggle */}
          <div className="bg-gray-700 rounded-lg p-3 border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-white">Professional Mode</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={professionalMode}
                  onChange={(e) => setProfessionalMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Enables advanced demosaicing algorithms and professional camera profiles
            </p>
          </div>

          {/* Demosaicing Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">Demosaicing</span>
            </div>

            <div className="space-y-3">
              {professionalMode ? (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Algorithm</label>
                    <select
                      value={demosaicAlgorithm}
                      onChange={(e) => setDemosaicAlgorithm(e.target.value as 'VNG' | 'AHD' | 'LMMSE')}
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                      disabled={isProcessing}
                    >
                      <option value="VNG">VNG (Variable Number of Gradients)</option>
                      <option value="AHD">AHD (Adaptive Homogeneity-Directed)</option>
                      <option value="LMMSE">LMMSE (Linear Minimum Mean Square Error)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Bayer Pattern</label>
                    <select
                      value={bayerPattern}
                      onChange={(e) => setBayerPattern(e.target.value as 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG')}
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                      disabled={isProcessing}
                    >
                      <option value="RGGB">RGGB</option>
                      <option value="BGGR">BGGR</option>
                      <option value="GRBG">GRBG</option>
                      <option value="GBRG">GBRG</option>
                    </select>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Quality</label>
                  <select
                    value={options.demosaicQuality}
                    onChange={(e) => updateOption('demosaicQuality', e.target.value as 'draft' | 'good' | 'best')}
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                    disabled={isProcessing}
                  >
                    <option value="draft">Draft (Linear)</option>
                    <option value="good">Good (VNG)</option>
                    <option value="best">Best (AHD)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">Output Size</label>
                <select
                  value={options.outputSize}
                  onChange={(e) => updateOption('outputSize', e.target.value as 'full' | 'half' | 'quarter')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value="full">Full Size</option>
                  <option value="half">Half Size</option>
                  <option value="quarter">Quarter Size</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Bit Depth</label>
                <select
                  value={options.outputBitDepth}
                  onChange={(e) => updateOption('outputBitDepth', parseInt(e.target.value) as 8 | 16)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value={8}>8-bit</option>
                  <option value={16}>16-bit</option>
                </select>
              </div>
            </div>
          </div>

          {/* White Balance Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium text-white">White Balance</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Mode</label>
                <select
                  value={options.whiteBalanceMode}
                  onChange={(e) => updateOption('whiteBalanceMode', e.target.value as 'camera' | 'auto' | 'custom')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-orange-400 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value="camera">Use Camera WB</option>
                  <option value="auto">Auto WB</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {options.whiteBalanceMode === 'custom' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Temperature: {options.temperature || 6500}K
                    </label>
                    <input
                      type="range"
                      min="2000"
                      max="25000"
                      step="100"
                      value={options.temperature || 6500}
                      onChange={(e) => updateOption('temperature', parseInt(e.target.value))}
                      className="w-full h-2 bg-gradient-to-r from-blue-400 via-white to-yellow-400 rounded-lg appearance-none cursor-pointer"
                      disabled={isProcessing}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Tint: {((options.tint || 1.0) - 1.0).toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0.2"
                      max="2.5"
                      step="0.01"
                      value={options.tint || 1.0}
                      onChange={(e) => updateOption('tint', parseFloat(e.target.value))}
                      className="w-full h-2 bg-gradient-to-r from-green-400 via-gray-300 to-magenta-400 rounded-lg appearance-none cursor-pointer"
                      disabled={isProcessing}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Exposure & Tone Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium text-white">Exposure & Tone</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Exposure: {options.exposureCompensation.toFixed(2)} EV
                </label>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  step="0.1"
                  value={options.exposureCompensation}
                  onChange={(e) => updateOption('exposureCompensation', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-yellow-400"
                  disabled={isProcessing}
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.highlightRecovery}
                    onChange={(e) => updateOption('highlightRecovery', e.target.checked)}
                    className="rounded border-gray-600 text-yellow-400 focus:ring-yellow-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Highlight Recovery</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.shadowBoost}
                    onChange={(e) => updateOption('shadowBoost', e.target.checked)}
                    className="rounded border-gray-600 text-yellow-400 focus:ring-yellow-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Shadow Boost</span>
                </label>
              </div>
            </div>
          </div>

          {/* Color Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-white">Color</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Color Space</label>
                <select
                  value={options.colorSpace}
                  onChange={(e) => updateOption('colorSpace', e.target.value as 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-blue-400 focus:outline-none"
                  disabled={isProcessing}
                >
                  <option value="sRGB">sRGB</option>
                  <option value="AdobeRGB">Adobe RGB</option>
                  <option value="ProPhotoRGB">ProPhoto RGB</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.useManufacturerProfile}
                    onChange={(e) => updateOption('useManufacturerProfile', e.target.checked)}
                    className="rounded border-gray-600 text-blue-400 focus:ring-blue-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Use Camera Profile</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.applyLensCorrections}
                    onChange={(e) => updateOption('applyLensCorrections', e.target.checked)}
                    className="rounded border-gray-600 text-blue-400 focus:ring-blue-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Lens Corrections</span>
                </label>
              </div>
            </div>
          </div>

          {/* Quality Enhancement Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-white">Quality Enhancement</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Noise Reduction: {options.denoiseThreshold.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={options.denoiseThreshold}
                  onChange={(e) => updateOption('denoiseThreshold', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-400"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Sharpening: {options.sharpening.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={options.sharpening}
                  onChange={(e) => updateOption('sharpening', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-400"
                  disabled={isProcessing}
                />
              </div>
            </div>
          </div>

          {/* Supported Formats Info */}
          {supportedFormats.length > 0 && (
            <div className="mt-4 p-3 bg-gray-700 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Supported RAW Formats:</div>
              <div className="text-xs text-gray-300 flex flex-wrap gap-1">
                {supportedFormats.map((format, index) => (
                  <span key={format} className="bg-gray-600 px-1.5 py-0.5 rounded">
                    {format}
                    {index < supportedFormats.length - 1 && ','}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};