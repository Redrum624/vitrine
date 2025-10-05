import { useEffect, useRef } from 'react';
import { CropParams } from '../../modules/CropModule';

interface CropTransformOverlayProps {
  // Image dimensions (processed dimensions after any transforms)
  imageWidth: number;
  imageHeight: number;

  // Crop parameters (normalized 0-1)
  cropParams: CropParams;

  // Canvas viewport state
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };

  // Canvas display dimensions (CSS size)
  canvasDisplayWidth: number;
  canvasDisplayHeight: number;

  // Show overlay only in preview mode
  showOverlay: boolean;
}

/**
 * Overlay component that renders:
 * 1. 3x3 grid (rule of thirds) over the crop region
 * 2. Darkened areas outside the crop region
 * 3. Rotation angle indicator (top-right corner)
 * 4. Rotation center point (blue crosshair at image center)
 * 5. Flip indicators (H-Flip, V-Flip badges)
 *
 * The grid stays straight even when the image is rotated underneath.
 * Visual indicators help users understand active transformations.
 */
export function CropTransformOverlay({
  imageWidth,
  imageHeight,
  cropParams,
  viewport,
  canvasDisplayWidth,
  canvasDisplayHeight,
  showOverlay
}: CropTransformOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !showOverlay || imageWidth === 0 || imageHeight === 0) {
      // Clear overlay if not showing
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas internal resolution to match display size
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasDisplayWidth * dpr;
    canvas.height = canvasDisplayHeight * dpr;
    canvas.style.width = `${canvasDisplayWidth}px`;
    canvas.style.height = `${canvasDisplayHeight}px`;

    // Scale context for device pixel ratio
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvasDisplayWidth, canvasDisplayHeight);

    // Calculate crop region in canvas coordinates
    // The image is centered in the canvas with zoom applied

    // Calculate where the image is rendered on the canvas
    const scaledImageWidth = canvasDisplayWidth * viewport.zoom;
    const scaledImageHeight = canvasDisplayHeight * viewport.zoom;

    // Image position (top-left corner)
    const imageX = (canvasDisplayWidth - scaledImageWidth) / 2 + viewport.panX;
    const imageY = (canvasDisplayHeight - scaledImageHeight) / 2 + viewport.panY;

    // Crop region in normalized coordinates (0-1)
    const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = cropParams;

    // Convert normalized crop coordinates to canvas pixel coordinates
    const cropLeft = imageX + cropX * scaledImageWidth;
    const cropTop = imageY + cropY * scaledImageHeight;
    const cropRight = cropLeft + cropWidth * scaledImageWidth;
    const cropBottom = cropTop + cropHeight * scaledImageHeight;

    const cropDisplayWidth = cropRight - cropLeft;
    const cropDisplayHeight = cropBottom - cropTop;

    // 1. Draw darkened areas outside crop region
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';

    // Top area
    if (cropTop > 0) {
      ctx.fillRect(0, 0, canvasDisplayWidth, cropTop);
    }

    // Bottom area
    if (cropBottom < canvasDisplayHeight) {
      ctx.fillRect(0, cropBottom, canvasDisplayWidth, canvasDisplayHeight - cropBottom);
    }

    // Left area (between crop top and bottom)
    if (cropLeft > 0) {
      ctx.fillRect(0, cropTop, cropLeft, cropDisplayHeight);
    }

    // Right area (between crop top and bottom)
    if (cropRight < canvasDisplayWidth) {
      ctx.fillRect(cropRight, cropTop, canvasDisplayWidth - cropRight, cropDisplayHeight);
    }

    // 2. Draw 3x3 grid (rule of thirds) over crop region
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);

    // Vertical lines (divide crop width into thirds)
    const thirdWidth = cropDisplayWidth / 3;
    for (let i = 1; i < 3; i++) {
      const x = cropLeft + i * thirdWidth;
      ctx.beginPath();
      ctx.moveTo(x, cropTop);
      ctx.lineTo(x, cropBottom);
      ctx.stroke();
    }

    // Horizontal lines (divide crop height into thirds)
    const thirdHeight = cropDisplayHeight / 3;
    for (let i = 1; i < 3; i++) {
      const y = cropTop + i * thirdHeight;
      ctx.beginPath();
      ctx.moveTo(cropLeft, y);
      ctx.lineTo(cropRight, y);
      ctx.stroke();
    }

    // 3. Draw crop region border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(cropLeft, cropTop, cropDisplayWidth, cropDisplayHeight);

    // 4. Draw rotation angle indicator if there's a rotation
    const angle = cropParams.angle || 0;
    if (Math.abs(angle) > 0.1) {
      // Draw rotation angle text in top-right corner of canvas
      const angleText = `${angle > 0 ? '+' : ''}${angle.toFixed(1)}°`;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;

      // Measure text to create background box
      ctx.font = 'bold 14px system-ui';
      const textMetrics = ctx.measureText(angleText);
      const textWidth = textMetrics.width;
      const textHeight = 20;
      const padding = 8;

      const boxX = canvasDisplayWidth - textWidth - padding * 2 - 10;
      const boxY = 10;

      // Draw background box
      ctx.fillRect(boxX, boxY, textWidth + padding * 2, textHeight + padding);
      ctx.strokeRect(boxX, boxY, textWidth + padding * 2, textHeight + padding);

      // Draw text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(angleText, boxX + padding, boxY + padding);

      ctx.restore();

      // Draw rotation center point indicator (small crosshair at image center)
      const centerX = imageX + scaledImageWidth / 2;
      const centerY = imageY + scaledImageHeight / 2;

      ctx.save();
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      const crossSize = 12;

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(centerX - crossSize, centerY);
      ctx.lineTo(centerX + crossSize, centerY);
      ctx.stroke();

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - crossSize);
      ctx.lineTo(centerX, centerY + crossSize);
      ctx.stroke();

      // Small circle at center
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // 5. Draw flip indicators if image is flipped
    const indicators: string[] = [];
    if (cropParams.flipHorizontal) indicators.push('H-Flip');
    if (cropParams.flipVertical) indicators.push('V-Flip');

    if (indicators.length > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.font = 'bold 12px system-ui';

      let offsetY = Math.abs(cropParams.angle || 0) > 0.1 ? 50 : 10;

      indicators.forEach(text => {
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;
        const textHeight = 18;
        const padding = 6;

        const boxX = canvasDisplayWidth - textWidth - padding * 2 - 10;
        const boxY = offsetY;

        // Draw background box
        ctx.fillRect(boxX, boxY, textWidth + padding * 2, textHeight + padding);
        ctx.strokeRect(boxX, boxY, textWidth + padding * 2, textHeight + padding);

        // Draw text
        ctx.fillStyle = 'rgba(255, 200, 100, 0.95)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text, boxX + padding, boxY + padding);

        offsetY += textHeight + padding + 5;
      });

      ctx.restore();
    }

  }, [
    imageWidth,
    imageHeight,
    cropParams,
    viewport,
    canvasDisplayWidth,
    canvasDisplayHeight,
    showOverlay
  ]);

  if (!showOverlay) {
    return null;
  }

  return (
    <canvas
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasDisplayWidth,
        height: canvasDisplayHeight,
        zIndex: 10
      }}
    />
  );
}
