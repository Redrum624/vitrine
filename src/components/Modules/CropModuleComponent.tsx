import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Maximize, Grid, RotateCw, FlipHorizontal, FlipVertical, Zap, ChevronDown, ChevronUp } from 'lucide-react';
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

    if (Math.abs(newAngle) > 0.01 && imageWidth > 0 && imageHeight > 0) {
      const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, newAngle);
      updateParams({ ...autoCrop, angle: newAngle, enabled: true });
    }
  }, [params.angle, updateParams, module, imageWidth, imageHeight]);

  const handleRotationChange = useCallback((newAngle: number) => {
    updateParams({ angle: newAngle, enabled: true });

    if (Math.abs(newAngle) > 0.01 && imageWidth > 0 && imageHeight > 0) {
      const autoCrop = module.calculateAutoCropForRotation(imageWidth, imageHeight, newAngle);
      updateParams({ ...autoCrop, angle: newAngle, enabled: true });
    } else if (Math.abs(newAngle) < 0.01) {
      updateParams({ x: 0, y: 0, width: 1.0, height: 1.0, angle: 0, enabled: true });
    }
  }, [updateParams, module, imageWidth, imageHeight]);

  const outputDims = module.getOutputDimensions(imageWidth, imageHeight);
  const cropPercentage = ((outputDims.width * outputDims.height) / (imageWidth * imageHeight) * 100).toFixed(1);

  const hasRotation = Math.abs(params.angle) > 0.01;
  const hasFlip = params.flipHorizontal || params.flipVertical;
  const hasTransform = hasRotation || hasFlip;

  const hasCrop = params.x !== 0 || params.y !== 0 || params.width !== 1.0 || params.height !== 1.0;
  const hasChanges = hasTransform || hasCrop;
  const isPreviewMode = module.isInPreviewMode();

  const { processedImageData } = useAppStore();

  const handleApply = useCallback(() => {
    module.applyChanges();

    if (processedImageData && typeof processedImageData === 'object' && 'data' in processedImageData) {
      const previewData = processedImageData as { data: Float32Array; width: number; height: number; isPreview: boolean };
      imageService.updateCurrentImageData(previewData.data, previewData.width, previewData.height);
      module.resetAfterApply();
      const resetParams = module.getParams();
      setParams(resetParams);
      onParamsChange(resetParams);
      logger.info(`Crop/Transform applied permanently - new image: ${previewData.width}x${previewData.height}`);
    } else {
      logger.warn('No processed image data available to apply');
      setParams(module.getParams());
      onParamsChange(module.getParams());
    }
  }, [module, onParamsChange, processedImageData]);

  const handleCancel = useCallback(() => {
    module.cancelChanges();
    const revertedParams = module.getParams();
    setParams(revertedParams);
    onParamsChange(revertedParams);
    logger.info('Crop/Transform cancelled');
  }, [module, onParamsChange]);

  // Removed auto-enter preview mode - user must click Apply to see crop overlay
  // useEffect(() => {
  //   if (hasChanges && !isPreviewMode) {
  //     module.enterPreviewMode();
  //   }
  // }, [hasChanges, isPreviewMode, module]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{borderBottom: '1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-sm" style={{backgroundColor: 'var(--gray-600)'}} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{color: 'var(--gray-500)', letterSpacing: '0.5px'}}>Controls</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUncrop}
            disabled={!module.isCropped()}
            className="p-1.5 rounded border"
            style={{
              backgroundColor: 'transparent',
              borderColor: 'var(--border)',
              color: 'var(--gray-400)',
              transition: 'var(--transition-fast)',
              opacity: !module.isCropped() ? 0.3 : 1
            }}
            onMouseEnter={(e) => {
              if (module.isCropped()) {
                e.currentTarget.style.backgroundColor = 'var(--gray-800)';
                e.currentTarget.style.borderColor = 'var(--border-light)';
                e.currentTarget.style.color = 'var(--white)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--gray-400)';
            }}
            title="Uncrop to original"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
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
            title="Reset all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

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

      {/* Quick Aspect Ratio Buttons */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Quick Apply</label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => {
              handleAspectRatioChange('1:1');
              handleCenterCrop(1.0);
            }}
            className="px-3 py-2 text-xs rounded transition-colors flex items-center justify-center gap-1.5"
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
            <Grid className="w-3 h-3" />
            Square
          </button>
          <button
            onClick={() => {
              handleAspectRatioChange('16:9');
              handleCenterCrop(16/9);
            }}
            className="px-3 py-2 text-xs rounded transition-colors"
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
            16:9
          </button>
          <button
            onClick={() => {
              handleAspectRatioChange('4:3');
              handleCenterCrop(4/3);
            }}
            className="px-3 py-2 text-xs rounded transition-colors"
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
            4:3
          </button>
        </div>
      </div>

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
                min="-45"
                max="45"
                step="0.1"
                value={params.angle}
                onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
                className="slider w-full"
              />

              {/* Auto-straighten & Quick Rotation */}
              <div className="grid grid-cols-4 gap-1.5 pt-1.5">
                <button
                  onClick={handleAutoStraighten}
                  disabled={isDetecting || !imageData}
                  className="col-span-4 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded transition-colors shadow-sm"
                  style={{
                    background: 'linear-gradient(to right, #f59e0b, #eab308)',
                    color: 'var(--white)',
                    opacity: isDetecting || !imageData ? 0.3 : 1
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
                {[-45, -15, 15, 45].map((angle) => (
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

            {/* Interpolation Method */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Interpolation</label>
              <select
                value={params.resampleMethod}
                onChange={(e) => updateParams({ resampleMethod: e.target.value as 'nearest' | 'bilinear' | 'bicubic' })}
                className="w-full text-sm rounded px-3 py-2 border"
                style={{
                  backgroundColor: 'var(--gray-700)',
                  color: 'var(--white)',
                  borderColor: 'var(--border)'
                }}
              >
                <option value="nearest">Nearest Neighbor (Fast)</option>
                <option value="bilinear">Bilinear (Good)</option>
                <option value="bicubic">Bicubic (Best Quality)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Crop Position Controls */}
      <div className="space-y-3 pt-3" style={{borderTop: '1px solid var(--border)'}}>
        <label className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>Position & Size</label>

        {['x', 'y', 'width', 'height'].map((key) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{color: 'var(--gray-300)'}}>{key.charAt(0).toUpperCase() + key.slice(1)} {key === 'x' || key === 'y' ? 'Position' : ''}</span>
              <span className="text-xs font-mono" style={{color: 'var(--gray-400)'}}>{(params[key as keyof CropParams] as number * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={key === 'width' || key === 'height' ? 0.05 : 0}
              max={key === 'x' ? 1.0 - params.width : key === 'y' ? 1.0 - params.height : key === 'width' ? 1.0 - params.x : 1.0 - params.y}
              step="0.001"
              value={params[key as keyof CropParams] as number}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (key === 'width' || key === 'height') {
                  let newWidth = key === 'width' ? value : params.width;
                  let newHeight = key === 'height' ? value : params.height;
                  const targetRatio = module.getAspectRatioValue();
                  if (targetRatio !== null) {
                    if (key === 'width') {
                      newHeight = newWidth / targetRatio;
                      if (params.y + newHeight > 1.0) {
                        newHeight = 1.0 - params.y;
                        newWidth = newHeight * targetRatio;
                      }
                    } else {
                      newWidth = newHeight * targetRatio;
                      if (params.x + newWidth > 1.0) {
                        newWidth = 1.0 - params.x;
                        newHeight = newWidth / targetRatio;
                      }
                    }
                  }
                  updateParams({ width: newWidth, height: newHeight });
                } else {
                  updateParams({ [key]: value });
                }
              }}
              className="slider w-full"
            />
          </div>
        ))}
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

      {/* Preview/Apply/Cancel Buttons */}
      {hasChanges && !isPreviewMode && (
        <div className="pt-3" style={{borderTop: '1px solid var(--border)'}}>
          <button
            onClick={() => module.enterPreviewMode()}
            className="w-full px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              backgroundColor: 'var(--primary-600)',
              color: 'var(--white)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-700)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-600)';
            }}
          >
            Preview Crop
          </button>
        </div>
      )}

      {isPreviewMode && hasChanges && (
        <div className="flex gap-1.5 pt-3" style={{borderTop: '1px solid var(--border)'}}>
          <button
            onClick={handleApply}
            className="flex-1 px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              backgroundColor: 'var(--primary-600)',
              color: 'var(--white)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-700)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary-600)';
            }}
          >
            Apply
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-2 text-sm font-medium rounded transition-colors"
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
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
