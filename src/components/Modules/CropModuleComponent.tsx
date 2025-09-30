import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Crop, RotateCcw, Maximize, Grid } from 'lucide-react';
import { CropModule, CropParams, AspectRatio } from '../../modules/CropModule';
import { logger } from '../../utils/Logger';

interface CropModuleComponentProps {
  module: CropModule;
  onParamsChange: (params: CropParams) => void;
  imageWidth: number;
  imageHeight: number;
}

export const CropModuleComponent: React.FC<CropModuleComponentProps> = ({
  module,
  onParamsChange,
  imageWidth,
  imageHeight
}) => {
  const [params, setParams] = useState<CropParams>(module.getParams());
  const paramsRef = useRef<CropParams>(params);

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

  const enableCrop = useCallback(() => {
    updateParams({ enabled: true });
  }, [updateParams]);

  // Calculate output dimensions
  const outputDims = module.getOutputDimensions(imageWidth, imageHeight);
  const cropPercentage = ((outputDims.width * outputDims.height) / (imageWidth * imageHeight) * 100).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crop className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">Crop</span>
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
            title="Reset crop"
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

      {/* Crop Position Controls */}
      {params.enabled && (
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
      )}

      {/* Output Info */}
      <div className="text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-3">
        <div className="flex items-center justify-between">
          <span>Original Size:</span>
          <span className="text-white">{imageWidth} × {imageHeight}</span>
        </div>
        {params.enabled && (
          <>
            <div className="flex items-center justify-between">
              <span>Cropped Size:</span>
              <span className="text-white">{outputDims.width} × {outputDims.height}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Crop Area:</span>
              <span className="text-blue-400">{cropPercentage}%</span>
            </div>
          </>
        )}
        {!params.enabled && (
          <button
            onClick={enableCrop}
            className="w-full mt-2 px-3 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors"
          >
            Enable Crop
          </button>
        )}
      </div>
    </div>
  );
};
