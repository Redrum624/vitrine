import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Cpu, Palette, Image, Zap, Camera } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import { advancedRawProcessor, AdvancedRawProcessingOptions, CameraProfile } from '../../services/AdvancedRawProcessor';
import { rawImageService, RawImageData } from '../../services/RawImageService';
import { CameraProfile as CameraProfileType } from '../../services/CameraProfileService';
import { cameraMetadataService } from '../../services/CameraMetadataService';

interface AdvancedRawModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const AdvancedRawModule: React.FC<AdvancedRawModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const setProcessedImageData = useAppStore((state) => state.setProcessedImageData);
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

  // Standard-mode decode cache: the native decoder ignores per-call options, so
  // the demosaiced pixels are identical for a given file regardless of slider
  // positions. Cache the base decode per path to avoid re-decoding identical
  // bytes on every option change.
  const baseRawCacheRef = useRef<{ path: string; result: RawImageData } | null>(null);
  // Monotonic token so only the latest in-flight apply commits its result, and
  // an in-flight guard so an option burst cannot launch overlapping decodes.
  const applyTokenRef = useRef(0);
  // Last Float32 buffer pushed to the store, so standard mode can skip a no-op
  // redraw when the cached decode is unchanged.
  const lastPushedDataRef = useRef<Float32Array | null>(null);

  // Initialize advanced processor and load camera profile
  useEffect(() => {
    let ignore = false;

    const initializeProcessor = async () => {
      try {
        const formats = await advancedRawProcessor.getSupportedFormats();
        if (!ignore) setSupportedFormats(formats);

        // Load available camera profiles
        const profiles = rawImageService.getAvailableCameraProfiles();
        if (!ignore) setAvailableProfiles(profiles);

        // Load the camera profile from the file's real EXIF make/model. Returns
        // null for RAW (exifreader can't parse ORF/CR2/...) -> hide the card
        // rather than show a fabricated camera.
        const info = await cameraMetadataService.getCameraInfo(currentImage);
        if (ignore) return;

        if (info?.make && info.model) {
          const profile = advancedRawProcessor.getCameraProfile(info.make, info.model);
          setCameraProfile(profile);
        } else {
          setCameraProfile(null);
        }
      } catch (error) {
        logger.error('Failed to initialize advanced RAW processor:', error);
      }
    };

    initializeProcessor();

    return () => {
      ignore = true;
    };
  }, [currentImage, currentImagePath]);

  const applyProcessing = useCallback(async () => {
    if (!currentImagePath || !isEnabled) return;

    // Take a token for this run; only the latest run is allowed to commit, so a
    // burst of slider changes that overlaps an in-flight decode cannot push a
    // stale frame after the newest one.
    const token = ++applyTokenRef.current;
    const path = currentImagePath;

    try {
      setIsProcessing(true);
      logger.info('Applying advanced RAW processing...');

      if (professionalMode) {
        // Use professional quality processing with advanced algorithms
        logger.info(`Using professional mode with ${demosaicAlgorithm} demosaicing`);

        const result = await rawImageService.processRawWithProfessionalQuality(
          currentImagePath,
          {
            demosaicAlgorithm,
            bayerPattern,
            applyNoiseProfiling: options.denoiseThreshold > 0,
            applyNoiseReduction: options.denoiseThreshold > 0,
            noiseReductionOptions: {
              chromaStrength: options.chromaDenoiseThreshold * 100,
              luminanceStrength: options.denoiseThreshold * 100
            },
            applyLensCorrection: options.applyLensCorrections,
            whiteBalanceMode: options.whiteBalanceMode === 'camera' ? 'camera' : 'daylight'
          }
        );

        if (token !== applyTokenRef.current) return; // superseded by a newer run

        // Push the reprocessed RAW into the store so the canvas redraws.
        setProcessedImageData({
          data: result.data,
          width: result.width,
          height: result.height,
          isPreview: true
        });
        lastPushedDataRef.current = result.data;
        logger.info('Professional RAW processing completed');
      } else {
        // Standard processing routes through the real main-process decoder
        // (window.electronAPI.decodeRawFile -> native dcraw_emu). Do NOT use
        // advancedRawProcessor.processRawFile here: it depends on the browser
        // LibRaw WASM which 404s and returns a mock buffer.
        //
        // The native decoder honors NONE of the standard-mode per-call options
        // (decodeRawFile receives only the path), so the demosaiced pixels are
        // identical for a given file regardless of slider positions. We decode
        // once per path and reuse the cached buffer instead of re-decoding the
        // same bytes on every option change. The standard controls do not alter
        // this output today; threading them into dcraw_emu flags would be a
        // separate feature, so we deliberately avoid a fragile half-application.
        logger.debug('Advanced RAW processing parameters:', options);

        let result = baseRawCacheRef.current?.path === path
          ? baseRawCacheRef.current.result
          : null;

        if (!result) {
          const decoded = await rawImageService.loadRawImage(currentImagePath, options);
          if (token !== applyTokenRef.current) return; // superseded by a newer run
          baseRawCacheRef.current = { path, result: decoded };
          result = decoded;
        }

        // Skip a no-op canvas redraw when the cached decode is unchanged (the
        // standard options can't alter the native output, so re-pushing the same
        // buffer would only cost a redraw).
        if (lastPushedDataRef.current === result.data) {
          logger.debug('Standard RAW decode unchanged; skipping redundant redraw');
          return;
        }

        // Push the decoded RAW into the store so the canvas redraws.
        setProcessedImageData({
          data: result.data,
          width: result.width,
          height: result.height,
          isPreview: true
        });
        lastPushedDataRef.current = result.data;
        logger.info('Standard RAW processing completed');
      }

    } catch (error) {
      logger.error('Advanced RAW processing failed:', error);
    } finally {
      if (token === applyTokenRef.current) setIsProcessing(false);
    }
  }, [currentImagePath, isEnabled, options, professionalMode, demosaicAlgorithm, bayerPattern, setProcessedImageData]);

  // Drop the cached base decode when the open file changes so a new path always
  // triggers a fresh decode.
  useEffect(() => {
    baseRawCacheRef.current = null;
    lastPushedDataRef.current = null;
  }, [currentImagePath]);

  // Apply processing when options change, debounced (~300ms trailing) so a
  // slider drag produces a single apply after the user settles instead of one
  // decode per tick. The latest-token guard in applyProcessing handles any
  // remaining overlap.
  useEffect(() => {
    if (!isEnabled || !currentImagePath) return;
    const handle = setTimeout(() => {
      applyProcessing();
    }, 300);
    return () => clearTimeout(handle);
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
          <Cpu className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Advanced RAW Processing</span>
          {isProcessing && (
            <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
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
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gray-400"></div>
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
                <Settings className="w-4 h-4 text-gray-300" />
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
            <div className="bg-gray-800 rounded-lg p-3 border border-gray-600">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-gray-300" />
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
          <div className="bg-gray-700 rounded-lg p-3 border border-gray-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-gray-300" />
                <span className="text-sm font-medium text-white">Professional Mode</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={professionalMode}
                  onChange={(e) => setProfessionalMode(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gray-400"></div>
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Enables advanced demosaicing algorithms and professional camera profiles
            </p>
          </div>

          {/* Demosaicing Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Image className="w-4 h-4 text-gray-300" />
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
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                      className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
              <Palette className="w-4 h-4 text-gray-300" />
              <span className="text-sm font-medium text-white">White Balance</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Mode</label>
                <select
                  value={options.whiteBalanceMode}
                  onChange={(e) => updateOption('whiteBalanceMode', e.target.value as 'camera' | 'auto' | 'custom')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                      className="w-full h-2 bg-gradient-to-r from-gray-900 via-white to-black rounded-lg appearance-none cursor-pointer"
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
                      className="w-full h-2 bg-gradient-to-r from-gray-900 via-gray-300 to-magenta-400 rounded-lg appearance-none cursor-pointer"
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
              <Zap className="w-4 h-4 text-gray-300" />
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
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
                  disabled={isProcessing}
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.highlightRecovery}
                    onChange={(e) => updateOption('highlightRecovery', e.target.checked)}
                    className="rounded border-gray-600 text-gray-300 focus:ring-gray-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Highlight Recovery</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.shadowBoost}
                    onChange={(e) => updateOption('shadowBoost', e.target.checked)}
                    className="rounded border-gray-600 text-gray-300 focus:ring-gray-400 focus:ring-2"
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
              <Palette className="w-4 h-4 text-gray-300" />
              <span className="text-sm font-medium text-white">Color</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Color Space</label>
                <select
                  value={options.colorSpace}
                  onChange={(e) => updateOption('colorSpace', e.target.value as 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                    className="rounded border-gray-600 text-gray-300 focus:ring-gray-400 focus:ring-2"
                    disabled={isProcessing}
                  />
                  <span className="ml-2 text-xs text-gray-300">Use Camera Profile</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={options.applyLensCorrections}
                    onChange={(e) => updateOption('applyLensCorrections', e.target.checked)}
                    className="rounded border-gray-600 text-gray-300 focus:ring-gray-400 focus:ring-2"
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
              <Settings className="w-4 h-4 text-gray-300" />
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
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
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
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-200"
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