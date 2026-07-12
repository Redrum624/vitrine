import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Zap, Maximize } from 'lucide-react';
import { CropModule, CropParams, AspectRatio } from '../../modules/CropModule';
import { logger } from '../../utils/Logger';
import { useAppStore } from '../../stores/appStore';
import { useRegisterModuleCardActions, type RegisterModuleCardActions } from '../Controls/moduleCardActions';
import { SliderRow } from '../Controls/SliderRow';
import { SectionLabel } from '../Controls/SectionLabel';
import { ChipButton } from '../Controls/ChipButton';

// Real AspectRatio option set (CropModule.ts) — the reference mockup shows a
// simplified illustrative subset; every ratio the module supports stays reachable.
const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' },
  { value: 'custom', label: 'Custom' },
];

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

  // Restored from the pre-Task-2 header (dropped in 919f2da along with the whole
  // inner header row) — lives in the card body now, as an "Uncrop" chip.
  const handleUncrop = useCallback(() => {
    module.uncrop();
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
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Ratio */}
      <div className="flex flex-col" style={{ gap: 10 }}>
        <SectionLabel>Ratio</SectionLabel>
        <div className="grid grid-cols-3" style={{ gap: 6 }}>
          {ASPECT_RATIO_OPTIONS.map((opt) => (
            <ChipButton
              key={opt.value}
              active={params.aspectRatio === opt.value}
              onClick={() => handleAspectRatioChange(opt.value)}
            >
              {opt.label}
            </ChipButton>
          ))}
        </div>

        {params.aspectRatio === 'custom' && (
          <div className="grid grid-cols-2" style={{ gap: 6 }}>
            <div className="flex flex-col" style={{ gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>Width</label>
              <input
                type="number"
                value={params.customAspectWidth}
                onChange={(e) => updateParams({ customAspectWidth: parseFloat(e.target.value) || 1 })}
                min="0.1"
                step="0.1"
                style={{
                  fontSize: 12,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.1)',
                  background: 'rgba(255,255,255,.04)',
                  color: 'var(--glass-text-label)',
                }}
              />
            </div>
            <div className="flex flex-col" style={{ gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--glass-text-label)' }}>Height</label>
              <input
                type="number"
                value={params.customAspectHeight}
                onChange={(e) => updateParams({ customAspectHeight: parseFloat(e.target.value) || 1 })}
                min="0.1"
                step="0.1"
                style={{
                  fontSize: 12,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,.1)',
                  background: 'rgba(255,255,255,.04)',
                  color: 'var(--glass-text-label)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Geometry */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        <SectionLabel>Geometry</SectionLabel>

        <SliderRow
          label="Rotation"
          value={params.angle}
          defaultValue={0}
          min={-5}
          max={5}
          step={0.1}
          onChange={handleRotationChange}
          formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
          legend={{ left: '-5°', center: '0°', right: '+5°' }}
          onDragStart={() => setIsAdjustingRotation(true)}
          onDragEnd={handleRotationEnd}
        />

        <div className="grid grid-cols-3" style={{ gap: 6 }}>
          <ChipButton onClick={() => rotateBy(-1)} title="Rotate -1°">
            <RotateCcw size={13} />
          </ChipButton>
          <ChipButton
            className="flex items-center gap-1.5"
            onClick={handleAutoStraighten}
            disabled={isDetecting || !hasProcessedData}
            title="Auto-straighten based on horizon detection"
          >
            {isDetecting ? (
              <span
                className="animate-spin"
                style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,.35)', borderTopColor: 'currentColor', flexShrink: 0 }}
              />
            ) : (
              <Zap size={13} />
            )}
            {isDetecting ? 'Detecting…' : 'Auto-Straighten'}
          </ChipButton>
          <ChipButton onClick={() => rotateBy(1)} title="Rotate +1°">
            <RotateCw size={13} />
          </ChipButton>
        </div>

        <div className="grid grid-cols-4" style={{ gap: 6 }}>
          {[-5, -2, 2, 5].map((angle) => (
            <ChipButton key={angle} onClick={() => handleRotationChange(angle)}>
              {angle > 0 ? '+' : ''}{angle}°
            </ChipButton>
          ))}
        </div>

        <div className="grid grid-cols-2" style={{ gap: 6 }}>
          <ChipButton className="flex items-center gap-1.5" active={params.flipHorizontal} onClick={handleFlipHorizontal}>
            <FlipHorizontal size={13} /> Flip H
          </ChipButton>
          <ChipButton className="flex items-center gap-1.5" active={params.flipVertical} onClick={handleFlipVertical}>
            <FlipVertical size={13} /> Flip V
          </ChipButton>
        </div>

        {/* Uncrop — restored from the pre-Task-2 header (see handleUncrop above). */}
        <ChipButton
          className="flex items-center gap-1.5"
          onClick={handleUncrop}
          disabled={!module.isCropped()}
          title="Uncrop to original"
        >
          <Maximize size={13} /> Uncrop
        </ChipButton>
      </div>

      {/* Output Info */}
      <div className="flex flex-col" style={{ gap: 4, paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: 11 }}>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--glass-text-muted)' }}>Original Size</span>
          <span style={{ color: 'var(--glass-text-secondary)', fontFamily: 'ui-monospace, monospace' }}>{imageWidth} × {imageHeight}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--glass-text-muted)' }}>Output Size</span>
          <span style={{ color: 'var(--glass-text-secondary)', fontFamily: 'ui-monospace, monospace' }}>{outputDims.width} × {outputDims.height}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--glass-text-muted)' }}>Crop Area</span>
          <span style={{ color: 'var(--accent)', fontFamily: 'ui-monospace, monospace' }}>{cropPercentage}%</span>
        </div>
      </div>
    </div>
  );
};
