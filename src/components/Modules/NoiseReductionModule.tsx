import React, { useState, useEffect, useCallback } from 'react';
import { Zap, Settings, TrendingDown, RefreshCw, Camera } from 'lucide-react';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import {
  noiseReductionService,
  NoiseReductionOptions,
  NoiseProfile
} from '../../services/NoiseReductionService';
// import { rawImageService } from '../../services/RawImageService';

interface NoiseReductionModuleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const NoiseReductionModule: React.FC<NoiseReductionModuleProps> = ({
  isEnabled,
  onToggle
}) => {
  const currentImage = useAppStore((state) => state.currentImage);
  const processedImageData = useAppStore((state) => state.processedImageData);
  const { setProcessedImageData } = useAppStore();

  const [options, setOptions] = useState<NoiseReductionOptions>({
    algorithm: 'wavelet',
    strength: 25,
    detail: 75,
    chromaStrength: 20,
    luminanceStrength: 30,
    edgeThreshold: 0.1,
    iterations: 1
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [noiseEstimate, setNoiseEstimate] = useState<{
    luminanceNoise: number;
    chrominanceNoise: number;
    channelNoise: { red: number; green: number; blue: number };
  } | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<NoiseProfile | null>(null);
  const [autoMode, setAutoMode] = useState(true);

  // Load noise profiles and estimate noise on image load
  useEffect(() => {
    // Try to find noise profile for current image
    if (currentImage?.metadata) {
      // Extract camera info from metadata (simplified)
      const camera = 'Canon'; // Would be extracted from EXIF
      const model = 'EOS R5'; // Would be extracted from EXIF
      const iso = 800; // Would be extracted from EXIF

      const profile = noiseReductionService.getNoiseProfile(camera, model, iso);
      setSelectedProfile(profile);

      if (profile) {
        logger.info(`Found noise profile: ${profile.camera} ${profile.model} ISO ${profile.iso}`);
      }
    }

    // Estimate noise in current image
    if (processedImageData && currentImage) {
      try {
        const estimate = noiseReductionService.estimateNoiseLevel(
          processedImageData,
          currentImage.metadata.width,
          currentImage.metadata.height
        );
        setNoiseEstimate(estimate);

        // Auto-adjust settings based on noise level
        if (autoMode) {
          const luminanceLevel = estimate.luminanceNoise * 1000;
          const chromaLevel = estimate.chrominanceNoise * 1000;

          setOptions(prev => ({
            ...prev,
            luminanceStrength: Math.min(100, Math.max(10, luminanceLevel * 2)),
            chromaStrength: Math.min(100, Math.max(5, chromaLevel * 3)),
            strength: Math.min(100, Math.max(15, (luminanceLevel + chromaLevel) * 1.5))
          }));
        }
      } catch (error) {
        logger.error('Failed to estimate noise level:', error);
      }
    }
  }, [currentImage, processedImageData, autoMode]);

  const applyNoiseReduction = useCallback(async () => {
    if (!processedImageData || !currentImage || !isEnabled) return;

    try {
      setIsProcessing(true);
      logger.info('Applying noise reduction...', options);

      const denoisedData = await noiseReductionService.applyNoiseReduction(
        processedImageData,
        currentImage.metadata.width,
        currentImage.metadata.height,
        options
      );

      setProcessedImageData(denoisedData);
      logger.info('Noise reduction applied successfully');

    } catch (error) {
      logger.error('Noise reduction failed:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [processedImageData, currentImage, isEnabled, options, setProcessedImageData]);

  // Apply processing when options change (with debounce)
  useEffect(() => {
    if (!isEnabled) return;

    const debounceTimer = setTimeout(() => {
      applyNoiseReduction();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [applyNoiseReduction, isEnabled]);

  const updateOption = <K extends keyof NoiseReductionOptions>(
    key: K,
    value: NoiseReductionOptions[K]
  ) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  const resetToDefaults = () => {
    setOptions({
      algorithm: 'wavelet',
      strength: 25,
      detail: 75,
      chromaStrength: 20,
      luminanceStrength: 30,
      edgeThreshold: 0.1,
      iterations: 1
    });
  };

  const getNoiseDescription = (level: number): { text: string; color: string } => {
    if (level < 0.005) return { text: 'Very Low', color: 'text-green-400' };
    if (level < 0.015) return { text: 'Low', color: 'text-yellow-400' };
    if (level < 0.030) return { text: 'Moderate', color: 'text-orange-400' };
    return { text: 'High', color: 'text-red-400' };
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Module Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <TrendingDown className="w-5 h-5 text-purple-400" />
          <span className="text-white font-medium">Noise Reduction</span>
          {isProcessing && (
            <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoMode(!autoMode)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              autoMode ? 'bg-purple-500 text-white' : 'bg-gray-700 text-gray-300'
            }`}
            title="Auto-adjust based on noise analysis"
          >
            Auto
          </button>
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
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
          </label>
        </div>
      </div>

      {/* Module Content */}
      {isEnabled && (
        <div className="p-4 space-y-4">

          {/* Noise Analysis */}
          {noiseEstimate && (
            <div className="bg-purple-900/20 border border-purple-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-white">Noise Analysis</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-400">Luminance</div>
                  <div className={`font-mono ${getNoiseDescription(noiseEstimate.luminanceNoise).color}`}>
                    {getNoiseDescription(noiseEstimate.luminanceNoise).text}
                    <span className="text-gray-500 ml-1">
                      ({(noiseEstimate.luminanceNoise * 1000).toFixed(1)})
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Chrominance</div>
                  <div className={`font-mono ${getNoiseDescription(noiseEstimate.chrominanceNoise).color}`}>
                    {getNoiseDescription(noiseEstimate.chrominanceNoise).text}
                    <span className="text-gray-500 ml-1">
                      ({(noiseEstimate.chrominanceNoise * 1000).toFixed(1)})
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="text-red-400">Red</div>
                  <div className="text-white font-mono">
                    {(noiseEstimate.channelNoise.red * 1000).toFixed(1)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-green-400">Green</div>
                  <div className="text-white font-mono">
                    {(noiseEstimate.channelNoise.green * 1000).toFixed(1)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-blue-400">Blue</div>
                  <div className="text-white font-mono">
                    {(noiseEstimate.channelNoise.blue * 1000).toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Camera Noise Profile */}
          {selectedProfile && (
            <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-white">Noise Profile</span>
              </div>
              <div className="text-xs text-green-200">
                <div className="font-medium">{selectedProfile.camera} {selectedProfile.model}</div>
                <div className="text-green-300">ISO {selectedProfile.iso}</div>
              </div>
            </div>
          )}

          {/* Algorithm Selection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-white">Algorithm</span>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Method</label>
              <select
                value={options.algorithm}
                onChange={(e) => updateOption('algorithm', e.target.value as NoiseReductionOptions['algorithm'])}
                className="w-full bg-gray-700 text-white text-sm rounded px-3 py-1.5 border border-gray-600 focus:border-purple-400 focus:outline-none"
                disabled={isProcessing}
              >
                <option value="wavelet">Wavelet (Best Quality)</option>
                <option value="bilateral">Bilateral Filter (Fast)</option>
                <option value="nlm">Non-Local Means (Natural)</option>
                <option value="adaptive">Adaptive (Smart)</option>
              </select>
            </div>
          </div>

          {/* Strength Controls */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Strength: {options.strength}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={options.strength}
                onChange={(e) => updateOption('strength', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                disabled={isProcessing || autoMode}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Detail Preservation: {options.detail}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={options.detail}
                onChange={(e) => updateOption('detail', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                disabled={isProcessing}
              />
            </div>
          </div>

          {/* Advanced Controls */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Luminance: {options.luminanceStrength}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={options.luminanceStrength}
                  onChange={(e) => updateOption('luminanceStrength', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                  disabled={isProcessing || autoMode}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Chroma: {options.chromaStrength}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={options.chromaStrength}
                  onChange={(e) => updateOption('chromaStrength', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                  disabled={isProcessing || autoMode}
                />
              </div>
            </div>

            {options.algorithm === 'wavelet' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Edge Threshold: {(options.edgeThreshold! * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={options.edgeThreshold}
                  onChange={(e) => updateOption('edgeThreshold', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                  disabled={isProcessing}
                />
              </div>
            )}

            {(options.algorithm === 'bilateral' || options.algorithm === 'nlm') && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Iterations: {options.iterations}
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={options.iterations}
                  onChange={(e) => updateOption('iterations', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                  disabled={isProcessing}
                />
              </div>
            )}
          </div>

          {/* Manual Apply Button */}
          <div className="pt-2 border-t border-gray-700">
            <button
              onClick={applyNoiseReduction}
              disabled={isProcessing || !processedImageData || !currentImage}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
            >
              {isProcessing ? 'Processing...' : 'Apply Noise Reduction'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};