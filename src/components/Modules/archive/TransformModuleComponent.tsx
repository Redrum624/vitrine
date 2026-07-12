import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Zap } from 'lucide-react';
import { TransformModule, TransformParams } from '../../modules/TransformModule';
import { logger } from '../../utils/Logger';

interface TransformModuleComponentProps {
  module: TransformModule;
  onParamsChange: (params: TransformParams) => void;
  onAutoStraighten?: () => void;
  imageData?: Float32Array;
  imageWidth?: number;
  imageHeight?: number;
}

export const TransformModuleComponent: React.FC<TransformModuleComponentProps> = ({
  module,
  onParamsChange,
  onAutoStraighten,
  imageData,
  imageWidth,
  imageHeight
}) => {
  const [params, setParams] = useState<TransformParams>(module.getParams());
  const paramsRef = useRef<TransformParams>(params);
  const [isDetecting, setIsDetecting] = useState(false);

  // Keep ref in sync
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const updateParams = useCallback((newParams: Partial<TransformParams>) => {
    const updatedParams = { ...paramsRef.current, ...newParams };
    paramsRef.current = updatedParams;
    setParams(updatedParams);
    module.setParams(newParams);
    onParamsChange(updatedParams);
    logger.debug('Transform params updated:', newParams);
  }, [module, onParamsChange]);

  const handleAutoStraighten = useCallback(async () => {
    if (!imageData || !imageWidth || !imageHeight) {
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
        onAutoStraighten?.();
        logger.info('Auto-straighten completed successfully');
      } else {
        logger.warn('Auto-straighten: No horizon detected');
      }
    } catch (error) {
      logger.error('Auto-straighten failed:', error);
    } finally {
      setIsDetecting(false);
    }
  }, [module, onParamsChange, onAutoStraighten, imageData, imageWidth, imageHeight]);

  const handleReset = useCallback(() => {
    module.resetParams();
    const updatedParams = module.getParams();
    setParams(updatedParams);
    onParamsChange(updatedParams);
  }, [module, onParamsChange]);

  const handleFlipHorizontal = useCallback(() => {
    updateParams({ flipHorizontal: !params.flipHorizontal, enabled: true });
  }, [params.flipHorizontal, updateParams]);

  const handleFlipVertical = useCallback(() => {
    updateParams({ flipVertical: !params.flipVertical, enabled: true });
  }, [params.flipVertical, updateParams]);

  const rotateBy = useCallback((degrees: number) => {
    const newAngle = Math.max(-45, Math.min(45, params.angle + degrees));
    updateParams({ angle: newAngle, enabled: true });
  }, [params.angle, updateParams]);

  const enableTransform = useCallback(() => {
    updateParams({ enabled: true });
  }, [updateParams]);

  // Calculate output dimensions if canvas expanded
  const hasRotation = Math.abs(params.angle) > 0.01;
  const outputDims = hasRotation && params.expandCanvas
    ? module.getRotatedDimensions(imageWidth || 1920, imageHeight || 1080, params.angle)
    : { width: imageWidth || 1920, height: imageHeight || 1080 };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCw className="w-4 h-4 text-gray-300" />
          <span className="text-sm font-medium text-white">Transform</span>
          {params.enabled && (
            <span className="text-xs px-2 py-0.5 bg-gray-800 text-gray-300 rounded">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAutoStraighten}
            disabled={isDetecting || !imageData}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-30"
            title="Auto-straighten based on horizon detection"
          >
            {isDetecting ? (
              <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={handleReset}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
            title="Reset transform"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Rotation Control */}
      <div className="space-y-3">
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
          onChange={(e) => updateParams({ angle: parseFloat(e.target.value), enabled: true })}
          className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
        />

        {/* Quick Rotation Buttons */}
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => updateParams({ angle: -45, enabled: true })}
            className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            -45°
          </button>
          <button
            onClick={() => updateParams({ angle: -15, enabled: true })}
            className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            -15°
          </button>
          <button
            onClick={() => updateParams({ angle: 15, enabled: true })}
            className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            +15°
          </button>
          <button
            onClick={() => updateParams({ angle: 45, enabled: true })}
            className="px-2 py-1.5 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            +45°
          </button>
        </div>
      </div>

      {/* Flip Controls */}
      <div className="space-y-2 border-t border-gray-700 pt-3">
        <label className="block text-xs text-gray-400">Flip</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleFlipHorizontal}
            className={`flex items-center justify-center gap-2 px-3 py-2 text-xs rounded transition-colors ${
              params.flipHorizontal
                ? 'bg-gray-800 text-white'
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
                ? 'bg-gray-800 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <FlipVertical className="w-4 h-4" />
            Vertical
          </button>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="space-y-3 border-t border-gray-700 pt-3">
        <label className="block text-xs text-gray-400">Options</label>

        {/* Canvas Expansion */}
        <label className="flex items-center justify-between">
          <span className="text-xs text-gray-300">Expand Canvas</span>
          <input
            type="checkbox"
            checked={params.expandCanvas}
            onChange={(e) => updateParams({ expandCanvas: e.target.checked })}
            className="rounded border-gray-600 text-gray-300 focus:ring-gray-400 focus:ring-2"
          />
        </label>

        {/* Interpolation Method */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Interpolation</label>
          <select
            value={params.interpolation}
            onChange={(e) => updateParams({ interpolation: e.target.value as TransformParams['interpolation'] })}
            className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-gray-600 focus:outline-none"
          >
            <option value="nearest">Nearest Neighbor (Fast)</option>
            <option value="bilinear">Bilinear (Good)</option>
            <option value="bicubic">Bicubic (Best Quality)</option>
          </select>
        </div>

        {/* Fill Color (when canvas expanded) */}
        {params.expandCanvas && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Fill Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={`#${Math.floor(params.fillColor[0] * 255).toString(16).padStart(2, '0')}${Math.floor(params.fillColor[1] * 255).toString(16).padStart(2, '0')}${Math.floor(params.fillColor[2] * 255).toString(16).padStart(2, '0')}`}
                onChange={(e) => {
                  const hex = e.target.value;
                  const r = parseInt(hex.slice(1, 3), 16) / 255;
                  const g = parseInt(hex.slice(3, 5), 16) / 255;
                  const b = parseInt(hex.slice(5, 7), 16) / 255;
                  updateParams({ fillColor: [r, g, b, 1] });
                }}
                className="w-12 h-8 rounded border border-gray-600 cursor-pointer"
              />
              <span className="text-xs text-gray-400">Background fill for expanded areas</span>
            </div>
          </div>
        )}
      </div>

      {/* Output Info */}
      <div className="text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-3">
        {hasRotation && params.expandCanvas && (
          <>
            <div className="flex items-center justify-between">
              <span>Original Size:</span>
              <span className="text-white">{imageWidth || 0} × {imageHeight || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Output Size:</span>
              <span className="text-gray-300">{outputDims.width} × {outputDims.height}</span>
            </div>
          </>
        )}
        {!params.enabled && (
          <button
            onClick={enableTransform}
            className="w-full mt-2 px-3 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-800 rounded transition-colors"
          >
            Enable Transform
          </button>
        )}
        {params.enabled && (
          <div className="flex items-center gap-1 text-gray-300">
            <Zap className="w-3 h-3" />
            <span>Use auto-straighten to detect horizon</span>
          </div>
        )}
      </div>
    </div>
  );
};
