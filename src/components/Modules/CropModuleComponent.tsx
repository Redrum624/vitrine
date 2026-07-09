import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { CropModule, CropParams, AspectRatio } from '../../modules/CropModule';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';

interface CropModuleComponentProps {
  module: CropModule;
  onParamsChange: (params: CropParams) => void;
  imageWidth: number;
  imageHeight: number;
  imageData?: Float32Array;
  /** Surfaces this module's Auto/Reset to the unified card header (Task 2). */
  onRegisterActions?: RegisterModuleCardActions;
}

export const CropModuleComponent: React.FC<CropModuleComponentProps> = ({
  module,
  onParamsChange,
  imageWidth,
  imageHeight,
  imageData: _imageData,  // Now using processedImageData from appStore instead
  onRegisterActions
}) => {
  const [params, setParams] = useState<CropParams>(module.getParams());
  const paramsRef = useRef<CropParams>(params);
  const [isTransformExpanded, setIsTransformExpanded] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const { setIsAdjustingRotation } = useAppStore();

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

  const handleReset = useCallback(() => {
    module.resetParams();
    const updatedParams = module.getParams();
    paramsRef.current = updatedParams;
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  // Get processed image data from store for Auto-Straighten
  const { processedImageData: storeProcessedData } = useAppStore();

  // Check if we have valid processed image data
  const hasProcessedData = storeProcessedData && typeof storeProcessedData === 'object' && 'data' in storeProcessedData;

  const handleAutoStraighten = useCallback(async () => {
    // Use processedImageData from appStore instead of passed props
    const imgData = storeProcessedData && typeof storeProcessedData === 'object' && 'data' in storeProcessedData
      ? storeProcessedData as { data: Float32Array; width: number; height: number }
      : null;

    if (!imgData || !imgData.data || imgData.width <= 0 || imgData.height <= 0) {
      logger.warn('Auto-straighten requires processed image data');
      return;
    }

    // Detect actual channel count from imageData length
    const expectedPixels = imgData.width * imgData.height;
    const detectedChannels = Math.round(imgData.data.length / expectedPixels);

    if (detectedChannels !== 3 && detectedChannels !== 4) {
      logger.warn(`Auto-straighten: Invalid image data format (expected 3 or 4 channels, got ${detectedChannels})`);
      return;
    }

    logger.info(`Auto-straighten: Analyzing ${imgData.width}×${imgData.height} image with ${detectedChannels} channels`);

    setIsDetecting(true);
    try {
      const context = {
        width: imgData.width,
        height: imgData.height,
        channels: detectedChannels
      };

      const success = module.autoStraighten(imgData.data, context);

      if (success) {
        const updatedParams = module.getParams();
        paramsRef.current = updatedParams;  // Update ref immediately to avoid race condition
        setParams(updatedParams);
        onParamsChange(updatedParams);
        logger.info('Auto-straighten completed successfully');
      } else {
        logger.warn('Auto-straighten: Could not detect reliable lines for straightening');
      }
    } catch (error) {
      logger.error('Auto-straighten failed:', error);
    } finally {
      setIsDetecting(false);
    }
  }, [module, onParamsChange, storeProcessedData]);

  // Card header (Task 2): Auto ⚡ = auto-straighten, Reset ↺ = full crop reset.
  useRegisterModuleCardActions(onRegisterActions, { auto: handleAutoStraighten, reset: handleReset });

  const handleFlipHorizontal = useCallback(() => {
    updateParams({ flipHorizontal: !params.flipHorizontal, enabled: true });
  }, [params.flipHorizontal, updateParams]);

  const handleFlipVertical = useCallback(() => {
    updateParams({ flipVertical: !params.flipVertical, enabled: true });
  }, [params.flipVertical, updateParams]);

  const rotateBy = useCallback((degrees: number) => {
    // Limit to -5 to +5 degrees for straightening
    const newAngle = Math.max(-5, Math.min(5, params.angle + degrees));

    // Check if user has an existing crop
    const hasExistingCrop = params.x !== 0 || params.y !== 0 ||
                            params.width !== 1.0 || params.height !== 1.0;

    if (Math.abs(newAngle) < 0.01) {
      // Reset to no rotation - but preserve crop if user has one
      if (hasExistingCrop) {
        updateParams({ angle: 0, enabled: true });
      } else {
        updateParams({ x: 0, y: 0, width: 1.0, height: 1.0, angle: 0, enabled: true });
      }
    } else {
      if (hasExistingCrop) {
        // Preserve user's crop, just update angle
        updateParams({ angle: newAngle, enabled: true });
      } else {
        // Apply rotation with auto-crop to remove black borders
        const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, newAngle);
        updateParams({ angle: newAngle, enabled: true, ...autoCrop });
      }
    }
  }, [params.angle, params.x, params.y, params.width, params.height, updateParams, module, imageWidth, imageHeight]);

  const handleRotationChange = useCallback((newAngle: number) => {
    // Clamp to -5 to +5 range
    const clampedAngle = Math.max(-5, Math.min(5, newAngle));

    // Check if user has an existing crop
    const hasExistingCrop = params.x !== 0 || params.y !== 0 ||
                            params.width !== 1.0 || params.height !== 1.0;

    if (Math.abs(clampedAngle) < 0.01) {
      // Reset to no rotation - but preserve crop if user has one
      if (hasExistingCrop) {
        updateParams({ angle: 0, enabled: true });
      } else {
        updateParams({ x: 0, y: 0, width: 1.0, height: 1.0, angle: 0, enabled: true });
      }
    } else {
      // During rotation adjustment, just update angle (preserve crop)
      updateParams({ angle: clampedAngle, enabled: true });
    }
  }, [params.x, params.y, params.width, params.height, updateParams]);

  // Apply auto-crop when rotation adjustment ends (mouse up) - only if no existing crop
  const handleRotationEnd = useCallback(() => {
    setIsAdjustingRotation(false);

    // Check if user has an existing crop
    const hasExistingCrop = params.x !== 0 || params.y !== 0 ||
                            params.width !== 1.0 || params.height !== 1.0;

    // Only apply auto-crop if user hasn't already cropped
    if (!hasExistingCrop && Math.abs(params.angle) > 0.01 && imageWidth > 0 && imageHeight > 0) {
      const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, params.angle);
      updateParams({ ...autoCrop });
    }
  }, [setIsAdjustingRotation, params.angle, params.x, params.y, params.width, params.height, module, imageWidth, imageHeight, updateParams]);

  const outputDims = module.getOutputDimensions(imageWidth, imageHeight);
  const cropPercentage = ((outputDims.width * outputDims.height) / (imageWidth * imageHeight) * 100).toFixed(1);

  return (
    <div className="space-y-3">
      {/* Aspect Ratio Selection */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Aspect Ratio</label>
        <select
          value={params.aspectRatio}
          onChange={(e) => handleAspectRatioChange(e.target.value as AspectRatio)}
          className="w-full text-sm rounded px-3 py-2 border"
          style={{
            backgroundColor: 'var(--gray-700)',
            color: 'var(--white)',
            borderColor: 'var(--border)'
          }}
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
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Width</label>
            <input
              type="number"
              value={params.customAspectWidth}
              onChange={(e) => updateParams({ customAspectWidth: parseFloat(e.target.value) || 1 })}
              min="0.1"
              step="0.1"
              className="w-full text-sm rounded px-3 py-2 border"
              style={{
                backgroundColor: 'var(--gray-700)',
                color: 'var(--white)',
                borderColor: 'var(--border)'
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Height</label>
            <input
              type="number"
              value={params.customAspectHeight}
              onChange={(e) => updateParams({ customAspectHeight: parseFloat(e.target.value) || 1 })}
              min="0.1"
              step="0.1"
              className="w-full text-sm rounded px-3 py-2 border"
              style={{
                backgroundColor: 'var(--gray-700)',
                color: 'var(--white)',
                borderColor: 'var(--border)'
              }}
            />
          </div>
        </div>
      )}

      {/* Transform Section */}
      <div className="pt-3" style={{borderTop: '1px solid var(--border)'}}>
        <button
          onClick={() => setIsTransformExpanded(!isTransformExpanded)}
          className="w-full flex items-center justify-between mb-3 text-sm transition-colors"
          style={{
            color: 'var(--white)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--primary-300)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--white)';
          }}
        >
          <div className="flex items-center gap-2">
            <RotateCw className="w-4 h-4" style={{color: 'var(--green-400)'}} />
            <span>Transform</span>
          </div>
          {isTransformExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {isTransformExpanded && (
          <div className="space-y-3">
            {/* Rotation Control */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Rotation</label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => rotateBy(-1)}
                    className="p-1 rounded transition-colors"
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
                    title="Rotate -1°"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <span className="text-sm font-mono w-12 text-center" style={{color: 'var(--white)'}}>
                    {params.angle.toFixed(1)}°
                  </span>
                  <button
                    onClick={() => rotateBy(1)}
                    className="p-1 rounded transition-colors"
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
                    title="Rotate +1°"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <input
                type="range"
                min="-5"
                max="5"
                step="0.1"
                value={params.angle}
                onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
                onMouseDown={() => setIsAdjustingRotation(true)}
                onMouseUp={handleRotationEnd}
                onMouseLeave={handleRotationEnd}
                onTouchStart={() => setIsAdjustingRotation(true)}
                onTouchEnd={handleRotationEnd}
                className="slider w-full"
              />

              {/* Auto-straighten & Quick Rotation */}
              <div className="grid grid-cols-4 gap-1.5 pt-1.5">
                <button
                  onClick={handleAutoStraighten}
                  disabled={isDetecting || !hasProcessedData}
                  className="col-span-4 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded transition-colors shadow-sm"
                  style={{
                    background: 'linear-gradient(to right, #f59e0b, #eab308)',
                    color: 'var(--white)',
                    opacity: isDetecting || !hasProcessedData ? 0.3 : 1,
                    cursor: isDetecting || !hasProcessedData ? 'not-allowed' : 'pointer'
                  }}
                  title="Auto-straighten based on horizon detection"
                >
                  {isDetecting ? (
                    <>
                      <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{borderColor: 'var(--white)', borderTopColor: 'transparent'}} />
                      Detecting...
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3" />
                      Auto-Straighten
                    </>
                  )}
                </button>
                {[-5, -2, 2, 5].map((angle) => (
                  <button
                    key={angle}
                    onClick={() => handleRotationChange(angle)}
                    className="px-2 py-1.5 text-xs rounded transition-colors"
                    style={{
                      backgroundColor: 'var(--gray-700)',
                      color: 'var(--gray-300)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-600)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-700)';
                    }}
                  >
                    {angle > 0 ? '+' : ''}{angle}°
                  </button>
                ))}
              </div>
            </div>

            {/* Flip Controls */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Flip</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={handleFlipHorizontal}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded transition-colors ${
                    params.flipHorizontal ? '' : ''
                  }`}
                  style={{
                    backgroundColor: params.flipHorizontal ? '#22c55e' : 'var(--gray-700)',
                    color: 'var(--white)'
                  }}
                >
                  <FlipHorizontal className="w-4 h-4" />
                  Horizontal
                </button>
                <button
                  onClick={handleFlipVertical}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded transition-colors ${
                    params.flipVertical ? '' : ''
                  }`}
                  style={{
                    backgroundColor: params.flipVertical ? '#22c55e' : 'var(--gray-700)',
                    color: 'var(--white)'
                  }}
                >
                  <FlipVertical className="w-4 h-4" />
                  Vertical
                </button>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Output Info */}
      <div className="text-xs space-y-1 pt-3" style={{borderTop: '1px solid var(--border)', color: 'var(--gray-500)'}}>
        <div className="flex items-center justify-between">
          <span>Original Size:</span>
          <span style={{color: 'var(--white)'}}>{imageWidth} × {imageHeight}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Output Size:</span>
          <span style={{color: 'var(--white)'}}>{outputDims.width} × {outputDims.height}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Crop Area:</span>
          <span style={{color: 'var(--primary-400)'}}>{cropPercentage}%</span>
        </div>
      </div>

    </div>
  );
};
