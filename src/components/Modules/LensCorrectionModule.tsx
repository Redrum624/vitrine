import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Settings, Zap, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  lensProfileService,
  LensProfile,
  LensCorrections,
  LensDetectionResult
} from '../../services/LensProfileService';

interface LensCorrectionModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const LensCorrectionModule: React.FC<LensCorrectionModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);
  const { setProcessedImageData } = useAppStore();

  const [detectedLens, setDetectedLens] = useState<LensDetectionResult | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<LensProfile | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<{lens: string; profiles: LensProfile[]}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);

  const [corrections, setCorrections] = useState<LensCorrections>({
    distortion: true,
    vignetting: true,
    chromaticAberration: true,
    autoDetect: true
  });

  // Detect lens from current image metadata
  useEffect(() => {
    if (currentImage?.metadata && autoDetect) {
      try {
        const detection = lensProfileService.detectLens(currentImage.metadata);
        setDetectedLens(detection);

        if (detection.camera && detection.confidence > 0.5) {
          // Get available profiles for detected camera
          const profiles = lensProfileService.getLensProfilesForCamera(detection.camera);
          setAvailableProfiles(profiles);

          // Try to find matching lens profile
          if (detection.lens) {
            const profile = lensProfileService.getLensProfile(
              detection.camera,
              detection.lens,
              detection.focalLength,
              detection.aperture
            );

            if (profile) {
              setSelectedProfile(profile);
              logger.info(`Auto-detected lens profile: ${profile.camera} ${profile.lens} ${profile.focalLength}mm f/${profile.aperture}`);
            }
          }
        }
      } catch (error) {
        logger.error('Failed to detect lens:', error);
        setDetectedLens(null);
      }
    }
  }, [currentImage, autoDetect]);

  // Apply lens corrections when settings change
  const applyLensCorrections = useCallback(async () => {
    if (!processedImageData || !currentImage || !selectedProfile || !isEnabled) return;

    try {
      setIsProcessing(true);
      logger.info('Applying lens corrections...', {
        profile: `${selectedProfile.camera} ${selectedProfile.lens}`,
        corrections
      });

      const correctedData = await lensProfileService.applyLensCorrections(
        processedImageData,
        currentImage.metadata.width,
        currentImage.metadata.height,
        selectedProfile,
        corrections
      );

      setProcessedImageData(correctedData);
      logger.info('Lens corrections applied successfully');

    } catch (error) {
      logger.error('Lens correction failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [processedImageData, currentImage, selectedProfile, isEnabled, corrections, setProcessedImageData]);

  // Apply corrections when settings change (with debounce)
  useEffect(() => {
    if (!isEnabled || !selectedProfile) return;

    const debounceTimer = setTimeout(() => {
      applyLensCorrections();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [applyLensCorrections, isEnabled, selectedProfile]);

  const updateCorrection = <K extends keyof LensCorrections>(
    key: K,
    value: LensCorrections[K]
  ) => {
    setCorrections(prev => ({ ...prev, [key]: value }));
  };

  const handleManualLensSelection = (camera: string, lensName: string, focalLength: number, aperture: number) => {
    const profile = lensProfileService.getLensProfile(camera, lensName, focalLength, aperture);
    if (profile) {
      setSelectedProfile(profile);
      setAutoDetect(false);
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    if (confidence >= 0.4) return 'text-orange-400';
    return 'text-red-400';
  };

  const getConfidenceText = (confidence: number): string => {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    if (confidence >= 0.4) return 'Low';
    return 'Very Low';
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Camera className="w-5 h-5 text-blue-400" />
          <span className="text-white font-medium">Lens Correction</span>
          {isProcessing && (
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoDetect(!autoDetect)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              autoDetect ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300'
            }`}
            title="Auto-detect lens from EXIF data"
          >
            Auto
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
        <div className="p-4 space-y-4">

          {/* Lens Detection Results */}
          {detectedLens && (
            <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">Auto-Detection</span>
                <span className={`text-xs font-mono ${getConfidenceColor(detectedLens.confidence)}`}>
                  {getConfidenceText(detectedLens.confidence)} ({(detectedLens.confidence * 100).toFixed(0)}%)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-400">Camera</div>
                  <div className="text-white">{detectedLens.camera || 'Unknown'}</div>
                </div>
                <div>
                  <div className="text-gray-400">Lens</div>
                  <div className="text-white truncate" title={detectedLens.lens}>
                    {detectedLens.lens || 'Unknown'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Focal Length</div>
                  <div className="text-white">
                    {detectedLens.focalLength ? `${detectedLens.focalLength}mm` : 'Unknown'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Aperture</div>
                  <div className="text-white">
                    {detectedLens.aperture ? `f/${detectedLens.aperture}` : 'Unknown'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Selected Lens Profile */}
          {selectedProfile && (
            <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-white">Active Profile</span>
              </div>
              <div className="text-xs text-green-200">
                <div className="font-medium">
                  {selectedProfile.camera} {selectedProfile.lens}
                </div>
                <div className="text-green-300">
                  {selectedProfile.focalLength}mm f/{selectedProfile.aperture}
                </div>
              </div>
            </div>
          )}

          {/* Manual Lens Selection */}
          {!autoDetect && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-white">Manual Selection</span>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Camera</label>
                <select
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-blue-400 focus:outline-none"
                  onChange={(e) => {
                    const camera = e.target.value;
                    if (camera) {
                      const profiles = lensProfileService.getLensProfilesForCamera(camera);
                      setAvailableProfiles(profiles);
                      setSelectedProfile(null);
                    }
                  }}
                  disabled={isProcessing}
                >
                  <option value="">Select Camera...</option>
                  {lensProfileService.getSupportedCameras().map(camera => (
                    <option key={camera} value={camera}>{camera}</option>
                  ))}
                </select>
              </div>

              {availableProfiles.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Lens</label>
                  <select
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-blue-400 focus:outline-none"
                    onChange={(e) => {
                      const [camera, lens, focalLength, aperture] = e.target.value.split('|');
                      if (camera && lens) {
                        handleManualLensSelection(
                          camera,
                          lens,
                          parseFloat(focalLength),
                          parseFloat(aperture)
                        );
                      }
                    }}
                    disabled={isProcessing}
                  >
                    <option value="">Select Lens...</option>
                    {availableProfiles.map(({ lens, profiles }) =>
                      profiles.map(profile => (
                        <option
                          key={`${profile.camera}_${lens}_${profile.focalLength}_${profile.aperture}`}
                          value={`${profile.camera}|${lens}|${profile.focalLength}|${profile.aperture}`}
                        >
                          {lens} {profile.focalLength}mm f/{profile.aperture}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Correction Controls */}
          {selectedProfile && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-white">Corrections</span>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Barrel/Pincushion Distortion</span>
                  <button
                    onClick={() => updateCorrection('distortion', !corrections.distortion)}
                    className="p-1"
                    disabled={isProcessing}
                  >
                    {corrections.distortion ? (
                      <Eye className="w-4 h-4 text-blue-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </label>

                <label className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Vignetting (Edge Darkening)</span>
                  <button
                    onClick={() => updateCorrection('vignetting', !corrections.vignetting)}
                    className="p-1"
                    disabled={isProcessing}
                  >
                    {corrections.vignetting ? (
                      <Eye className="w-4 h-4 text-blue-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </label>

                <label className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Chromatic Aberration (Color Fringing)</span>
                  <button
                    onClick={() => updateCorrection('chromaticAberration', !corrections.chromaticAberration)}
                    className="p-1"
                    disabled={isProcessing}
                  >
                    {corrections.chromaticAberration ? (
                      <Eye className="w-4 h-4 text-blue-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                </label>
              </div>
            </div>
          )}

          {/* Profile Information */}
          {selectedProfile && (
            <div className="bg-gray-700/50 rounded p-3 text-xs">
              <div className="text-gray-400 mb-1">Profile Details</div>
              <div className="grid grid-cols-2 gap-2 text-gray-300">
                <div>
                  <span className="text-gray-500">Distortion K1:</span> {selectedProfile.distortionK1.toFixed(4)}
                </div>
                <div>
                  <span className="text-gray-500">Vignetting:</span> {selectedProfile.vignettingA.toFixed(2)}
                </div>
                <div>
                  <span className="text-gray-500">CA Red:</span> {selectedProfile.caRedScale.toFixed(4)}
                </div>
                <div>
                  <span className="text-gray-500">CA Blue:</span> {selectedProfile.caBlueScale.toFixed(4)}
                </div>
              </div>
            </div>
          )}

          {/* Manual Apply Button */}
          <div className="pt-2 border-t border-gray-700">
            <button
              onClick={applyLensCorrections}
              disabled={isProcessing || !processedImageData || !currentImage || !selectedProfile}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
            >
              {isProcessing ? 'Processing...' : 'Apply Lens Corrections'}
            </button>
          </div>

          {/* No Profile Warning */}
          {isEnabled && !selectedProfile && (
            <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-3 text-center">
              <div className="text-yellow-200 text-sm">
                No lens profile available for this image
              </div>
              <div className="text-yellow-300 text-xs mt-1">
                Try manual lens selection or check EXIF data
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};