import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Crop, RotateCcw, Maximize, Grid, RotateCw, FlipHorizontal, FlipVertical, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { CropModule, CropParams, AspectRatio } from '../../modules/CropModule';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import { imageService } from '../../services/ImageService';

interface CropModuleComponentProps {
  module: CropModule;
  onParamsChange: (params: CropParams) => void;
  imageWidth: number;
  imageHeight: number;
  imageData?: Float32Array;
}

export const CropModuleComponent: React.FC<CropModuleComponentProps> = ({
  module,
  onParamsChange,
  imageWidth,
  imageHeight,
  imageData
}) => {
  const [params, setParams] = useState<CropParams>(module.getParams());
  const paramsRef = useRef<CropParams>(params);
  const [isTransformExpanded, setIsTransformExpanded] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);

  // Keep ref in sync
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // Set original dimensions when image loads
  useEffect(() => {
    if (imageWidth > 0 && imageHeight > 0) {
      module.setOriginalDimensions(imageWidth, imageHeight);
    }
  }, [imageWidth, imageHeight, module]);

  const updateParams = useCallback((newParams: Partial<CropParams>) => {
    const updatedParams = { ...paramsRef.current, ...newParams };
    paramsRef.current = updatedParams;
    setParams(updatedParams);
    module.setParams(newParams);
    onParamsChange(updatedParams);
    logger.debug('Crop params updated:', newParams);
  }, [module, onParamsChange]);

  const handleAspectRatioChange = useCallback((ratio: AspectRatio) => {
    updateParams({ aspectRatio: ratio });

    // If aspect ratio is set, apply it to current crop
    if (ratio !== 'free') {
      const targetRatio = module.getAspectRatioValue();
      if (targetRatio !== null) {
        const adjusted = module.applyCropAspectRatio(
          paramsRef.current.x,
          paramsRef.current.y,
          paramsRef.current.width,
          paramsRef.current.height
        );
        updateParams(adjusted);
      }
    }
  }, [module, updateParams]);

  const handleCenterCrop = useCallback((targetRatio: number) => {
    module.centerCrop(targetRatio, imageWidth, imageHeight);
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
    logger.info(`Center crop applied for ratio ${targetRatio}`);
  }, [module, onParamsChange, imageWidth, imageHeight]);

  const handleUncrop = useCallback(() => {
    module.uncrop();
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  const handleReset = useCallback(() => {
    module.resetParams();
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  // Transform handlers
  const handleAutoStraighten = useCallback(async () => {
    if (!imageData || imageWidth <= 0 || imageHeight <= 0) {
      logger.warn('Auto-straighten requires image data');
      return;
    }

    setIsDetecting(true);
    try {
      const context = {
        width: imageWidth,
        height: imageHeight,
        channels: 4
      };

      const success = module.autoStraighten(imageData, context);

      if (success) {
        const updatedParams = module.getParams();
        setParams(updatedParams);
        onParamsChange(updatedParams);
        logger.info('Auto-straighten completed successfully');
      } else {
        logger.warn('Auto-straighten: No horizon detected');
      }
    } catch (error) {
      logger.error('Auto-straighten failed:', error);
    } finally {
      setIsDetecting(false);
    }
  }, [module, onParamsChange, imageData, imageWidth, imageHeight]);

  const handleFlipHorizontal = useCallback(() => {
    updateParams({ flipHorizontal: !params.flipHorizontal, enabled: true });
  }, [params.flipHorizontal, updateParams]);

  const handleFlipVertical = useCallback(() => {
    updateParams({ flipVertical: !params.flipVertical, enabled: true });
  }, [params.flipVertical, updateParams]);

  const rotateBy = useCallback((degrees: number) => {
    const newAngle = Math.max(-45, Math.min(45, params.angle + degrees));
    updateParams({ angle: newAngle, enabled: true });

    // Auto-crop to remove black borders
    if (Math.abs(newAngle) > 0.01 && imageWidth > 0 && imageHeight > 0) {
      const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, newAngle);
      updateParams({ ...autoCrop, angle: newAngle, enabled: true });
    }
  }, [params.angle, updateParams, module, imageWidth, imageHeight]);

  const handleRotationChange = useCallback((newAngle: number) => {
    updateParams({ angle: newAngle, enabled: true });

    // Auto-crop to remove black borders from rotation
    if (Math.abs(newAngle) > 0.01 && imageWidth > 0 && imageHeight > 0) {
      const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, newAngle);
      updateParams({ ...autoCrop, angle: newAngle, enabled: true });
    } else if (Math.abs(newAngle) < 0.01) {
      // Reset crop when angle is 0
      updateParams({ x: 0, y: 0, width: 1.0, height: 1.0, angle: 0, enabled: true });
    }
  }, [updateParams, module, imageWidth, imageHeight]);

  // Calculate output dimensions
  const outputDims = module.getOutputDimensions(imageWidth, imageHeight);
  const cropPercentage = ((outputDims.width * outputDims.height) / (imageWidth * imageHeight) * 100).toFixed(1);

  // Check if transform is active
  const hasRotation = Math.abs(params.angle) > 0.01;
  const hasFlip = params.flipHorizontal || params.flipVertical;
  const hasTransform = hasRotation || hasFlip;

  // Check if changes need to be applied
  const hasCrop = params.x !== 0 || params.y !== 0 || params.width !== 1.0 || params.height !== 1.0;
  const hasChanges = hasTransform || hasCrop;
  const isPreviewMode = module.isInPreviewMode();

  const { processedImageData } = useAppStore();

  // Handle Apply button
  const handleApply = useCallback(() => {
    // First, apply the changes (exits preview mode)
    module.applyChanges();

    // Get the current processed image data (with crop/transform applied)
    if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
      const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };

      // Update the source image data to be the processed result
      imageService.updateCurrentImageData(previewData.data, previewData.width, previewData.height);

      // Reset crop/transform params since the image is now the cropped/transformed version
      module.resetAfterApply();

      // Update component state with reset params
      const resetParams = module.getParams();
      setParams(resetParams);

      // Trigger re-processing with reset params (which will be identity transform)
      onParamsChange(resetParams);

      logger.info(`Crop/Transform applied permanently - new image: ${previewData.width}x${previewData.height}`);
    } else {
      // Fallback if no processed data available
      logger.warn('No processed image data available to apply');
      setParams(module.getParams());
      onParamsChange(module.getParams());
    }
  }, [module, onParamsChange, processedImageData]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    module.cancelChanges();
    const revertedParams = module.getParams();
    setParams(revertedParams);
    onParamsChange(revertedParams);
    logger.info('Crop/Transform cancelled');
  }, [module, onParamsChange]);

  // Auto-enter preview mode when changes are made
  useEffect(() => {
    if (hasChanges && !isPreviewMode) {
      module.enterPreviewMode();
    }
  }, [hasChanges, isPreviewMode, module]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crop className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">Crop & Transform</span>
          {params.enabled && (
            <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleUncrop}
            disabled={!module.isCropped()}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            title="Uncrop to original"
          >
            <Maximize className="w-3 h-3" />
          </button>
          <button
            onClick={handleReset}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
            title="Reset all"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Aspect Ratio Selection */}
      <div className="space-y-2">
        <label className="block text-xs text-gray-400">Aspect Ratio</label>
        <select
          value={params.aspectRatio}
          onChange={(e) => handleAspectRatioChange(e.target.value as AspectRatio)}
          className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-400 focus:outline-none"
        >
          <option value="free">Free</option>
          <option value="original">Original</option>
          <option value="1:1">Square (1:1)</option>
          <option value="4:3">Standard (4:3)</option>
          <option value="3:2">Classic 35mm (3:2)</option>
          <option value="16:9">Widescreen (16:9)</option>
          <option value="3:4">Portrait 4:3</option>
          <option value="2:3">Portrait 3:2</option>
          <option value="9:16">Portrait 16:9</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Custom Aspect Ratio */}
      {params.aspectRatio === 'custom' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Width</label>
            <input
              type="number"
              value={params.customAspectWidth}
              onChange={(e) => updateParams({ customAspectWidth: parseFloat(e.target.value) || 1 })}
              min="0.1"
              step="0.1"
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Height</label>
            <input
              type="number"
              value={params.customAspectHeight}
              onChange={(e) => updateParams({ customAspectHeight: parseFloat(e.target.value) || 1 })}
              min="0.1"
              step="0.1"
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Quick Aspect Ratio Buttons */}
      <div className="space-y-2">
        <label className="block text-xs text-gray-400">Quick Apply</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              handleAspectRatioChange('1:1');
              handleCenterCrop(1.0);
            }}
            className="px-3 py-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1"
          >
            <Grid className="w-3 h-3" />
            Square
          </button>
          <button
            onClick={() => {
              handleAspectRatioChange('16:9');
              handleCenterCrop(16/9);
            }}
            className="px-3 py-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            16:9
          </button>
          <button
            onClick={() => {
              handleAspectRatioChange('4:3');
              handleCenterCrop(4/3);
            }}
            className="px-3 py-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            4:3
          </button>
        </div>
      </div>

      {/* Transform Section */}
      <div className="border-t border-gray-700 pt-3">
        <button
          onClick={() => setIsTransformExpanded(!isTransformExpanded)}
          className="w-full flex items-center justify-between mb-3 text-sm font-medium text-white hover:text-blue-300 transition-colors"
        >
          <div className="flex items-center gap-2">
            <RotateCw className="w-4 h-4 text-green-400" />
            <span>Transform</span>
            {hasTransform && (
              <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-300 rounded">
                Active
              </span>
            )}
          </div>
          {isTransformExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {isTransformExpanded && (
          <div className="space-y-3">
            {/* Rotation Control */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Rotation</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => rotateBy(-1)}
                    className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white transition-colors"
                    title="Rotate -1°"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <span className="text-sm font-mono text-white w-12 text-center">
                    {params.angle.toFixed(1)}°
                  </span>
                  <button
                    onClick={() => rotateBy(1)}
                    className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white transition-colors"
                    title="Rotate +1°"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Rotation Slider */}
              <input
                type="range"
                min="-45"
                max="45"
                step="0.1"
                value={params.angle}
                onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />

              {/* Auto-straighten & Quick Rotation */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={handleAutoStraighten}
                  disabled={isDetecting || !imageData}
                  className="col-span-4 flex items-center justify-center gap-2 px-3 py-2 text-xs text-white bg-yellow-600 hover:bg-yellow-700 rounded transition-colors disabled:opacity-30"
                  title="Auto-straighten based on horizon detection"
                >
                  {isDetecting ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Detecting...
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3" />
                      Auto-Straighten
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleRotationChange(-45)}
                  className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  -45°
                </button>
                <button
                  onClick={() => handleRotationChange(-15)}
                  className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  -15°
                </button>
                <button
                  onClick={() => handleRotationChange(15)}
                  className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  +15°
                </button>
                <button
                  onClick={() => handleRotationChange(45)}
                  className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  +45°
                </button>
              </div>
            </div>

            {/* Flip Controls */}
            <div className="space-y-2">
              <label className="block text-xs text-gray-400">Flip</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleFlipHorizontal}
                  className={`flex items-center justify-center gap-2 px-3 py-2 text-xs rounded transition-colors ${
                    params.flipHorizontal
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <FlipHorizontal className="w-4 h-4" />
                  Horizontal
                </button>
                <button
                  onClick={handleFlipVertical}
                  className={`flex items-center justify-center gap-2 px-3 py-2 text-xs rounded transition-colors ${
                    params.flipVertical
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <FlipVertical className="w-4 h-4" />
                  Vertical
                </button>
              </div>
            </div>

            {/* Advanced Transform Options */}
            <div className="space-y-2">
              <label className="block text-xs text-gray-400">Options</label>

              {/* Interpolation Method */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Interpolation</label>
                <select
                  value={params.resampleMethod}
                  onChange={(e) => updateParams({ resampleMethod: e.target.value as 'nearest' | 'bilinear' | 'bicubic' })}
                  className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-green-400 focus:outline-none"
                >
                  <option value="nearest">Nearest Neighbor (Fast)</option>
                  <option value="bilinear">Bilinear (Good)</option>
                  <option value="bicubic">Bicubic (Best Quality)</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Crop Position Controls */}
      <div className="space-y-3 border-t border-gray-700 pt-3">
          <label className="block text-xs text-gray-400">Position & Size</label>

          {/* X Position */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">X Position</span>
              <span className="text-xs text-white">{(params.x * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max={1.0 - params.width}
              step="0.001"
              value={params.x}
              onChange={(e) => updateParams({ x: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Y Position */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">Y Position</span>
              <span className="text-xs text-white">{(params.y * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max={1.0 - params.height}
              step="0.001"
              value={params.y}
              onChange={(e) => updateParams({ y: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Width */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">Width</span>
              <span className="text-xs text-white">{(params.width * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max={1.0 - params.x}
              step="0.001"
              value={params.width}
              onChange={(e) => {
                let newWidth = parseFloat(e.target.value);
                let newHeight = params.height;

                // Apply aspect ratio constraint if set
                const targetRatio = module.getAspectRatioValue();
                if (targetRatio !== null) {
                  newHeight = newWidth / targetRatio;
                  if (params.y + newHeight > 1.0) {
                    newHeight = 1.0 - params.y;
                    newWidth = newHeight * targetRatio;
                  }
                }

                updateParams({ width: newWidth, height: newHeight });
              }}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Height */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">Height</span>
              <span className="text-xs text-white">{(params.height * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max={1.0 - params.y}
              step="0.001"
              value={params.height}
              onChange={(e) => {
                let newHeight = parseFloat(e.target.value);
                let newWidth = params.width;

                // Apply aspect ratio constraint if set
                const targetRatio = module.getAspectRatioValue();
                if (targetRatio !== null) {
                  newWidth = newHeight * targetRatio;
                  if (params.x + newWidth > 1.0) {
                    newWidth = 1.0 - params.x;
                    newHeight = newWidth / targetRatio;
                  }
                }

                updateParams({ width: newWidth, height: newHeight });
              }}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

      {/* Output Info */}
      <div className="text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-3">
        <div className="flex items-center justify-between">
          <span>Original Size:</span>
          <span className="text-white">{imageWidth} × {imageHeight}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Output Size:</span>
          <span className="text-white">{outputDims.width} × {outputDims.height}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Crop Area:</span>
          <span className="text-blue-400">{cropPercentage}%</span>
        </div>
      </div>

      {/* Apply/Cancel Buttons - Show when in preview mode */}
      {isPreviewMode && hasChanges && (
        <div className="flex gap-2 border-t border-gray-700 pt-3">
          <button
            onClick={handleApply}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Apply
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Preview Mode Indicator */}
      {isPreviewMode && (
        <div className="text-xs text-yellow-400 flex items-center gap-1 border-t border-gray-700 pt-2">
          <span>⚠️ Preview Mode - Click Apply to commit changes</span>
        </div>
      )}
    </div>
  );
};
