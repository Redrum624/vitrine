import { useState, useCallback, useEffect } from 'react';
import { CropParams } from '../../modules/CropModule';

interface InteractiveCropHandlesProps {
  // Image dimensions (processed dimensions)
  imageWidth: number;
  imageHeight: number;

  // Crop parameters (normalized 0-1)
  cropParams: CropParams;

  // Callback when crop region changes
  onCropChange: (crop: { x: number; y: number; width: number; height: number }) => void;

  // Canvas viewport state
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };

  // Canvas display dimensions (CSS size)
  canvasDisplayWidth: number;
  canvasDisplayHeight: number;

  // Show handles only in preview mode
  showHandles: boolean;

  // Container ref for coordinate calculations
  containerRef: React.RefObject<HTMLDivElement | null>;
}

type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'center';

/**
 * Interactive crop handles component.
 * Renders draggable handles for resizing and moving the crop region.
 */
export function InteractiveCropHandles({
  imageWidth,
  imageHeight,
  cropParams,
  onCropChange,
  viewport,
  canvasDisplayWidth,
  canvasDisplayHeight,
  showHandles,
  containerRef
}: InteractiveCropHandlesProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<HandleType | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Calculate crop region in canvas pixel coordinates
  const getCropRect = useCallback(() => {
    const scaledImageWidth = canvasDisplayWidth * viewport.zoom;
    const scaledImageHeight = canvasDisplayHeight * viewport.zoom;

    const imageX = (canvasDisplayWidth - scaledImageWidth) / 2 + viewport.panX;
    const imageY = (canvasDisplayHeight - scaledImageHeight) / 2 + viewport.panY;

    const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = cropParams;

    const cropLeft = imageX + cropX * scaledImageWidth;
    const cropTop = imageY + cropY * scaledImageHeight;
    const cropRight = cropLeft + cropWidth * scaledImageWidth;
    const cropBottom = cropTop + cropHeight * scaledImageHeight;

    return {
      left: cropLeft,
      top: cropTop,
      right: cropRight,
      bottom: cropBottom,
      width: cropRight - cropLeft,
      height: cropBottom - cropTop,
      imageX,
      imageY,
      scaledImageWidth,
      scaledImageHeight
    };
  }, [cropParams, viewport, canvasDisplayWidth, canvasDisplayHeight]);

  // Convert canvas pixel coordinates to normalized crop coordinates
  const pixelToNormalized = useCallback((pixelX: number, pixelY: number, pixelWidth: number, pixelHeight: number) => {
    const scaledImageWidth = canvasDisplayWidth * viewport.zoom;
    const scaledImageHeight = canvasDisplayHeight * viewport.zoom;

    const imageX = (canvasDisplayWidth - scaledImageWidth) / 2 + viewport.panX;
    const imageY = (canvasDisplayHeight - scaledImageHeight) / 2 + viewport.panY;

    // Clamp to image bounds
    const clampedX = Math.max(imageX, Math.min(imageX + scaledImageWidth, pixelX));
    const clampedY = Math.max(imageY, Math.min(imageY + scaledImageHeight, pixelY));
    const clampedWidth = Math.max(20, Math.min(imageX + scaledImageWidth - clampedX, pixelWidth));
    const clampedHeight = Math.max(20, Math.min(imageY + scaledImageHeight - clampedY, pixelHeight));

    return {
      x: (clampedX - imageX) / scaledImageWidth,
      y: (clampedY - imageY) / scaledImageHeight,
      width: clampedWidth / scaledImageWidth,
      height: clampedHeight / scaledImageHeight
    };
  }, [viewport, canvasDisplayWidth, canvasDisplayHeight]);

  // Handle mouse down on handles
  const handleMouseDown = useCallback((e: React.MouseEvent, handle: HandleType) => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setIsDragging(true);
    setDragHandle(handle);
    setDragStart({ x: mouseX, y: mouseY });
  }, [containerRef]);

  // Handle mouse move
  useEffect(() => {
    if (!isDragging || !dragHandle || !containerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const deltaX = mouseX - dragStart.x;
      const deltaY = mouseY - dragStart.y;

      const cropRect = getCropRect();

      let newLeft = cropRect.left;
      let newTop = cropRect.top;
      let newRight = cropRect.right;
      let newBottom = cropRect.bottom;

      // Calculate new bounds based on handle type
      switch (dragHandle) {
        case 'nw':
          newLeft = cropRect.left + deltaX;
          newTop = cropRect.top + deltaY;
          break;
        case 'ne':
          newRight = cropRect.right + deltaX;
          newTop = cropRect.top + deltaY;
          break;
        case 'sw':
          newLeft = cropRect.left + deltaX;
          newBottom = cropRect.bottom + deltaY;
          break;
        case 'se':
          newRight = cropRect.right + deltaX;
          newBottom = cropRect.bottom + deltaY;
          break;
        case 'n':
          newTop = cropRect.top + deltaY;
          break;
        case 's':
          newBottom = cropRect.bottom + deltaY;
          break;
        case 'w':
          newLeft = cropRect.left + deltaX;
          break;
        case 'e':
          newRight = cropRect.right + deltaX;
          break;
        case 'center':
          newLeft = cropRect.left + deltaX;
          newTop = cropRect.top + deltaY;
          newRight = cropRect.right + deltaX;
          newBottom = cropRect.bottom + deltaY;
          break;
      }

      // Ensure minimum size
      const minSize = 20;
      if (newRight - newLeft < minSize) {
        if (dragHandle.includes('w')) newLeft = newRight - minSize;
        else newRight = newLeft + minSize;
      }
      if (newBottom - newTop < minSize) {
        if (dragHandle.includes('n')) newTop = newBottom - minSize;
        else newBottom = newTop + minSize;
      }

      // Convert to normalized coordinates
      const normalized = pixelToNormalized(
        newLeft,
        newTop,
        newRight - newLeft,
        newBottom - newTop
      );

      onCropChange(normalized);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragHandle, dragStart, containerRef, getCropRect, pixelToNormalized, onCropChange]);

  if (!showHandles || imageWidth === 0 || imageHeight === 0) {
    return null;
  }

  const cropRect = getCropRect();
  const handleSize = 12;
  const handleOffset = handleSize / 2;

  // Corner handles
  const handles: { type: HandleType; x: number; y: number; cursor: string }[] = [
    { type: 'nw', x: cropRect.left - handleOffset, y: cropRect.top - handleOffset, cursor: 'nw-resize' },
    { type: 'ne', x: cropRect.right - handleOffset, y: cropRect.top - handleOffset, cursor: 'ne-resize' },
    { type: 'sw', x: cropRect.left - handleOffset, y: cropRect.bottom - handleOffset, cursor: 'sw-resize' },
    { type: 'se', x: cropRect.right - handleOffset, y: cropRect.bottom - handleOffset, cursor: 'se-resize' },
  ];

  // Edge handles (midpoints)
  const edgeHandles: { type: HandleType; x: number; y: number; cursor: string }[] = [
    { type: 'n', x: (cropRect.left + cropRect.right) / 2 - handleOffset, y: cropRect.top - handleOffset, cursor: 'n-resize' },
    { type: 's', x: (cropRect.left + cropRect.right) / 2 - handleOffset, y: cropRect.bottom - handleOffset, cursor: 's-resize' },
    { type: 'w', x: cropRect.left - handleOffset, y: (cropRect.top + cropRect.bottom) / 2 - handleOffset, cursor: 'w-resize' },
    { type: 'e', x: cropRect.right - handleOffset, y: (cropRect.top + cropRect.bottom) / 2 - handleOffset, cursor: 'e-resize' },
  ];

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasDisplayWidth,
        height: canvasDisplayHeight,
        zIndex: 15
      }}
    >
      {/* Center drag area (move entire crop) */}
      <div
        className="pointer-events-auto"
        style={{
          position: 'absolute',
          left: cropRect.left,
          top: cropRect.top,
          width: cropRect.width,
          height: cropRect.height,
          cursor: isDragging && dragHandle === 'center' ? 'grabbing' : 'grab',
          opacity: 0 // Invisible but interactive
        }}
        onMouseDown={(e) => handleMouseDown(e, 'center')}
      />

      {/* Corner handles */}
      {handles.map(handle => (
        <div
          key={handle.type}
          className="pointer-events-auto"
          style={{
            position: 'absolute',
            left: handle.x,
            top: handle.y,
            width: handleSize,
            height: handleSize,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '2px solid rgba(0, 0, 0, 0.8)',
            borderRadius: '50%',
            cursor: handle.cursor,
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            transition: isDragging ? 'none' : 'transform 0.1s',
            transform: isDragging && dragHandle === handle.type ? 'scale(1.3)' : 'scale(1)'
          }}
          onMouseDown={(e) => handleMouseDown(e, handle.type)}
        />
      ))}

      {/* Edge handles */}
      {edgeHandles.map(handle => (
        <div
          key={handle.type}
          className="pointer-events-auto"
          style={{
            position: 'absolute',
            left: handle.x,
            top: handle.y,
            width: handleSize,
            height: handleSize,
            backgroundColor: 'rgba(255, 255, 255, 0.85)',
            border: '2px solid rgba(0, 0, 0, 0.7)',
            borderRadius: '3px',
            cursor: handle.cursor,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            transition: isDragging ? 'none' : 'transform 0.1s',
            transform: isDragging && dragHandle === handle.type ? 'scale(1.3)' : 'scale(1)'
          }}
          onMouseDown={(e) => handleMouseDown(e, handle.type)}
        />
      ))}
    </div>
  );
}
