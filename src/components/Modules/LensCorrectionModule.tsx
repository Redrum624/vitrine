import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Settings, Zap, RefreshCw } from 'lucide-react';
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

      const imageData = processedImageData instanceof Float32Array
        ? processedImageData
        : processedImageData.data;

      const correctedData = await lensProfileService.applyLensCorrections(
        imageData,
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
    if (confidence >= 0.8) return 'text-gray-300';
    if (confidence >= 0.6) return 'text-gray-300';
    if (confidence >= 0.4) return 'text-gray-300';
    return 'text-gray-300';
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
          <Camera className="w-5 h-5 text-gray-300" />
          <span className="text-white font-medium">Lens Correction</span>
          {isProcessing && (
            <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoDetect(!autoDetect)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              autoDetect
                ? 'bg-gray-700 text-white border-gray-500'
                : 'bg-transparent text-gray-400 border-gray-600 hover:text-gray-300'
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
            <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-400"></div>
          </label>
        </div>
      </div>

      {/* Module Content */}
      {isEnabled && (
        <div className="p-4 space-y-4">

          {/* Lens Detection Results */}
          {detectedLens && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-gray-300" />
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
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-gray-300" />
                <span className="text-sm font-medium text-white">Active Profile</span>
              </div>
              <div className="text-xs text-gray-300">
                <div className="font-medium">
                  {selectedProfile.camera} {selectedProfile.lens}
                </div>
                <div className="text-gray-300">
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
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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
                    className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-gray-600 focus:outline-none"
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

              <div className="space-y-1">
                {([
                  { key: 'distortion' as const, label: 'Distortion', desc: 'Barrel / Pincushion' },
                  { key: 'vignetting' as const, label: 'Vignetting', desc: 'Edge darkening' },
                  { key: 'chromaticAberration' as const, label: 'Chromatic Aberration', desc: 'Color fringing' },
                ] as const).map(({ key, label, desc }) => (
                  <button
                    key={key}
                    onClick={() => updateCorrection(key, !corrections[key])}
                    disabled={isProcessing}
                    className="flex items-center gap-3 w-full px-3 py-2 rounded text-left transition-colors hover:bg-gray-700/50 disabled:opacity-50"
                  >
                    <div
                      className="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                      style={{
                        borderColor: corrections[key] ? 'var(--gray-400)' : 'var(--gray-600)',
                        backgroundColor: corrections[key] ? 'var(--gray-500)' : 'transparent',
                      }}
                    >
                      {corrections[key] && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-200 leading-tight">{label}</div>
                      <div className="text-xs text-gray-500 leading-tight">{desc}</div>
                    </div>
                  </button>
                ))}
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
          <div className="pt-3 border-t border-gray-700">
            <button
              onClick={applyLensCorrections}
              disabled={isProcessing || !processedImageData || !currentImage || !selectedProfile}
              className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 px-4 rounded transition-colors"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Processing...
                </span>
              ) : (
                'Apply Lens Corrections'
              )}
            </button>
          </div>

          {/* No Profile Warning */}
          {isEnabled && !selectedProfile && (
            <div className="bg-gray-800/50 border border-gray-600 rounded-lg p-4 text-center">
              <Camera className="w-6 h-6 text-gray-500 mx-auto mb-2" />
              <div className="text-gray-300 text-sm">
                No lens profile available
              </div>
              <div className="text-gray-500 text-xs mt-1">
                Try manual selection or check EXIF data
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};