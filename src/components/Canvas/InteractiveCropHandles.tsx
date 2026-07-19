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

  // Callback when drag starts (to prevent canvas panning)
  onDragStart?: () => void;

  // Callback when drag ends
  onDragEnd?: () => void;

  // Canvas viewport state
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };

  // Canvas display dimensions (CSS size) — the VIEWPORT box (canvas element).
  canvasDisplayWidth: number;
  canvasDisplayHeight: number;

  // Content (fit-rect) base the image scales by: content = contentWidth × zoom. In the
  // viewport-canvas model (Task R5) the box (canvasDisplay*) grows with zoom while the
  // content scales by the fit-rect. Defaults to canvasDisplay* (⇒ pre-R5 behaviour).
  contentWidth?: number;
  contentHeight?: number;

  // Show handles only in preview mode
  showHandles: boolean;

  // Aspect ratio constraint (null = free, number = width/height ratio)
  aspectRatio?: number | null;

  // Drag anchor override. When the crop is APPLIED, `cropParams` carries a
  // full-frame rect (handle positions over the cropped content) while the REAL
  // crop rect lives here — a drag must anchor on the real rect so the crop
  // "regains its last position" when the display flips back to the full frame.
  anchorCropParams?: { x: number; y: number; width: number; height: number };

  // Canvas element ref for coordinate calculations
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'center';

const MIN_SIZE_PX = 20;

/**
 * Interactive crop handles component.
 * Renders draggable handles (4 corners + 4 edges + center move) for resizing
 * and moving the crop region. Edge handles are ALWAYS present — with a locked
 * aspect ratio they resize the rect keeping the ratio (opposite edge fixed,
 * perpendicular axis scaled around its center), matching corner behaviour.
 *
 * Drag math is anchored on the crop PARAMS captured at mousedown, converted to
 * pixels against the CURRENT geometry on every move. This matters for the
 * apply-on-release lifecycle: grabbing a handle on an applied crop flips the
 * displayed content from cropped back to full-frame mid-interaction (fit-rect
 * and scale change under the drag) — a pixel-rect snapshot would go stale, the
 * normalized anchor cannot.
 */
export function InteractiveCropHandles({
  imageWidth,
  imageHeight,
  cropParams,
  onCropChange,
  onDragStart,
  onDragEnd,
  viewport,
  canvasDisplayWidth,
  canvasDisplayHeight,
  contentWidth,
  contentHeight,
  showHandles,
  aspectRatio = null,
  anchorCropParams,
  canvasRef
}: InteractiveCropHandlesProps) {
  // Content base for image scaling (fit-rect); the box stays canvasDisplay* (viewport).
  const contentW = contentWidth ?? canvasDisplayWidth;
  const contentH = contentHeight ?? canvasDisplayHeight;
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<HandleType | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  // Normalized crop params snapshot at mousedown — the drag anchor.
  const [anchorParams, setAnchorParams] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);

  // Current image placement in canvas pixels.
  const getImageBox = useCallback(() => {
    const scaledW = contentW * viewport.zoom;
    const scaledH = contentH * viewport.zoom;
    const left = (canvasDisplayWidth - scaledW) / 2 + viewport.panX;
    const top = (canvasDisplayHeight - scaledH) / 2 + viewport.panY;
    return { left, top, right: left + scaledW, bottom: top + scaledH, scaledW, scaledH };
  }, [viewport, canvasDisplayWidth, canvasDisplayHeight, contentW, contentH]);

  // Calculate crop region in canvas pixel coordinates
  const getCropRect = useCallback(() => {
    const img = getImageBox();
    const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = cropParams;

    const cropLeft = img.left + cropX * img.scaledW;
    const cropTop = img.top + cropY * img.scaledH;
    const cropRight = cropLeft + cropWidth * img.scaledW;
    const cropBottom = cropTop + cropHeight * img.scaledH;

    return {
      left: cropLeft,
      top: cropTop,
      right: cropRight,
      bottom: cropBottom,
      width: cropRight - cropLeft,
      height: cropBottom - cropTop,
    };
  }, [cropParams, getImageBox]);

  // Handle mouse down on handles
  const handleMouseDown = useCallback((e: React.MouseEvent, handle: HandleType) => {
    e.preventDefault();
    e.stopPropagation();

    if (!canvasRef.current) return;

    const anchor = anchorCropParams ?? cropParams;
    setAnchorParams({
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
    });
    setIsDragging(true);
    setDragHandle(handle);
    // CLIENT coordinates, deliberately NOT canvas-relative: the canvas box
    // RESIZES mid-drag when grabbing a handle on an applied crop flips the
    // display back to the full frame — a canvas-relative origin would shift
    // with the box and corrupt the delta (live-diagnosed: a -10px pull became
    // a +190px resize). Client-space deltas are frame-independent; the anchor
    // rect is recomputed against current geometry every move.
    setDragStart({ x: e.clientX, y: e.clientY });

    // Notify parent that drag started (to prevent canvas panning; the parent
    // may also suspend an applied crop, flipping the display to full-frame).
    onDragStart?.();
  }, [canvasRef, cropParams, anchorCropParams, onDragStart]);

  // Handle mouse move
  useEffect(() => {
    if (!isDragging || !dragHandle || !canvasRef.current || !anchorParams) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      // Deltas in client space (see handleMouseDown) — immune to the canvas
      // box resizing when the cropped→full-frame flip lands mid-drag.
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      const img = getImageBox();
      if (img.scaledW <= 0 || img.scaledH <= 0) return;

      // Anchor rect in CURRENT pixel space (recomputed every move — geometry
      // may have flipped cropped→full-frame since mousedown).
      const a = {
        left: img.left + anchorParams.x * img.scaledW,
        top: img.top + anchorParams.y * img.scaledH,
        right: img.left + (anchorParams.x + anchorParams.width) * img.scaledW,
        bottom: img.top + (anchorParams.y + anchorParams.height) * img.scaledH,
      };

      let newLeft = a.left;
      let newTop = a.top;
      let newRight = a.right;
      let newBottom = a.bottom;

      switch (dragHandle) {
        case 'nw': newLeft = a.left + deltaX; newTop = a.top + deltaY; break;
        case 'ne': newRight = a.right + deltaX; newTop = a.top + deltaY; break;
        case 'sw': newLeft = a.left + deltaX; newBottom = a.bottom + deltaY; break;
        case 'se': newRight = a.right + deltaX; newBottom = a.bottom + deltaY; break;
        case 'n': newTop = a.top + deltaY; break;
        case 's': newBottom = a.bottom + deltaY; break;
        case 'w': newLeft = a.left + deltaX; break;
        case 'e': newRight = a.right + deltaX; break;
        case 'center':
          newLeft = a.left + deltaX; newTop = a.top + deltaY;
          newRight = a.right + deltaX; newBottom = a.bottom + deltaY;
          break;
      }

      if (dragHandle === 'center') {
        // Move: clamp by translation, size unchanged.
        const w = newRight - newLeft;
        const h = newBottom - newTop;
        newLeft = Math.min(Math.max(newLeft, img.left), img.right - w);
        newTop = Math.min(Math.max(newTop, img.top), img.bottom - h);
        newRight = newLeft + w;
        newBottom = newTop + h;
      } else if (aspectRatio === null) {
        // Free resize: clamp each moved edge into the image, then min size.
        newLeft = Math.min(Math.max(newLeft, img.left), newRight - MIN_SIZE_PX);
        newRight = Math.max(Math.min(newRight, img.right), newLeft + MIN_SIZE_PX);
        newTop = Math.min(Math.max(newTop, img.top), newBottom - MIN_SIZE_PX);
        newBottom = Math.max(Math.min(newBottom, img.bottom), newTop + MIN_SIZE_PX);
      } else {
        // Ratio-locked resize. Each handle has a fixed anchor; the other axis
        // follows the ratio. Bounds are enforced by shrinking toward the
        // anchor (uniform), never by breaking the ratio.
        let w = Math.max(MIN_SIZE_PX, newRight - newLeft);
        let h = Math.max(MIN_SIZE_PX, newBottom - newTop);
        const cx = (a.left + a.right) / 2;
        const cy = (a.top + a.bottom) / 2;

        // Width drives e/w; height drives n/s; corners follow the DOMINANT
        // axis (cover semantics — the old fit-inside rule made a purely
        // horizontal corner drag a no-op under a locked ratio).
        if (dragHandle === 'n' || dragHandle === 's') {
          w = h * aspectRatio;
        } else if (dragHandle === 'e' || dragHandle === 'w') {
          h = w / aspectRatio;
        } else {
          w = Math.max(w, h * aspectRatio);
          h = w / aspectRatio;
        }

        // Available space from the fixed anchor, per handle.
        let availW: number;
        let availH: number;
        switch (dragHandle) {
          case 'nw': availW = a.right - img.left; availH = a.bottom - img.top; break;
          case 'ne': availW = img.right - a.left; availH = a.bottom - img.top; break;
          case 'sw': availW = a.right - img.left; availH = img.bottom - a.top; break;
          case 'se': availW = img.right - a.left; availH = img.bottom - a.top; break;
          case 'e': availW = img.right - a.left; availH = 2 * Math.min(cy - img.top, img.bottom - cy); break;
          case 'w': availW = a.right - img.left; availH = 2 * Math.min(cy - img.top, img.bottom - cy); break;
          case 'n': availW = 2 * Math.min(cx - img.left, img.right - cx); availH = a.bottom - img.top; break;
          default: availW = 2 * Math.min(cx - img.left, img.right - cx); availH = img.bottom - a.top; break; // 's'
        }
        const maxW = Math.max(1, Math.min(availW, availH * aspectRatio));
        if (w > maxW) { w = maxW; h = w / aspectRatio; }

        // Reposition from the fixed anchor.
        switch (dragHandle) {
          case 'nw': newRight = a.right; newBottom = a.bottom; newLeft = a.right - w; newTop = a.bottom - h; break;
          case 'ne': newLeft = a.left; newBottom = a.bottom; newRight = a.left + w; newTop = a.bottom - h; break;
          case 'sw': newRight = a.right; newTop = a.top; newLeft = a.right - w; newBottom = a.top + h; break;
          case 'se': newLeft = a.left; newTop = a.top; newRight = a.left + w; newBottom = a.top + h; break;
          case 'e': newLeft = a.left; newRight = a.left + w; newTop = cy - h / 2; newBottom = cy + h / 2; break;
          case 'w': newRight = a.right; newLeft = a.right - w; newTop = cy - h / 2; newBottom = cy + h / 2; break;
          case 'n': newBottom = a.bottom; newTop = a.bottom - h; newLeft = cx - w / 2; newRight = cx + w / 2; break;
          case 's': newTop = a.top; newBottom = a.top + h; newLeft = cx - w / 2; newRight = cx + w / 2; break;
        }
        // Centered-axis drags can still poke out when the center sits off-middle;
        // translate back inside (size already fits by the avail computation).
        const finalW = newRight - newLeft;
        const finalH = newBottom - newTop;
        newLeft = Math.min(Math.max(newLeft, img.left), img.right - finalW);
        newTop = Math.min(Math.max(newTop, img.top), img.bottom - finalH);
        newRight = newLeft + finalW;
        newBottom = newTop + finalH;
      }

      onCropChange({
        x: (newLeft - img.left) / img.scaledW,
        y: (newTop - img.top) / img.scaledH,
        width: (newRight - newLeft) / img.scaledW,
        height: (newBottom - newTop) / img.scaledH,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragHandle(null);
      setAnchorParams(null);
      // Notify parent that drag ended (the parent applies the crop here).
      onDragEnd?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragHandle, dragStart, anchorParams, getImageBox, onCropChange, aspectRatio, canvasRef, onDragEnd]);

  if (!showHandles || imageWidth === 0 || imageHeight === 0) {
    return null;
  }

  const cropRect = getCropRect();
  const handleSize = 12;
  const handleOffset = handleSize / 2;

  // Keep every handle fully INSIDE the canvas box. A handle centered on a rect
  // edge overhangs the box by half its size; when the canvas box coincides with
  // the photo region (maximized fit, zoomed-in), that overhang lands in an
  // overflow-hidden ancestor and the handle's outer half stops being
  // hit-testable — live-diagnosed via elementFromPoint returning the region
  // container at the handle center. Clamping shifts edge handles inward by at
  // most half a handle; interior rects are unaffected.
  const clampX = (x: number) => Math.min(Math.max(x, 0), Math.max(0, canvasDisplayWidth - handleSize));
  const clampY = (y: number) => Math.min(Math.max(y, 0), Math.max(0, canvasDisplayHeight - handleSize));

  // Corner handles
  const handles: { type: HandleType; x: number; y: number; cursor: string }[] = [
    { type: 'nw', x: clampX(cropRect.left - handleOffset), y: clampY(cropRect.top - handleOffset), cursor: 'nw-resize' },
    { type: 'ne', x: clampX(cropRect.right - handleOffset), y: clampY(cropRect.top - handleOffset), cursor: 'ne-resize' },
    { type: 'sw', x: clampX(cropRect.left - handleOffset), y: clampY(cropRect.bottom - handleOffset), cursor: 'sw-resize' },
    { type: 'se', x: clampX(cropRect.right - handleOffset), y: clampY(cropRect.bottom - handleOffset), cursor: 'se-resize' },
  ];

  // Edge handles (midpoints) — always present; ratio-locked drags keep the ratio.
  const edgeHandles: { type: HandleType; x: number; y: number; cursor: string }[] = [
    { type: 'n', x: clampX((cropRect.left + cropRect.right) / 2 - handleOffset), y: clampY(cropRect.top - handleOffset), cursor: 'n-resize' },
    { type: 's', x: clampX((cropRect.left + cropRect.right) / 2 - handleOffset), y: clampY(cropRect.bottom - handleOffset), cursor: 's-resize' },
    { type: 'w', x: clampX(cropRect.left - handleOffset), y: clampY((cropRect.top + cropRect.bottom) / 2 - handleOffset), cursor: 'w-resize' },
    { type: 'e', x: clampX(cropRect.right - handleOffset), y: clampY((cropRect.top + cropRect.bottom) / 2 - handleOffset), cursor: 'e-resize' },
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
        data-testid="crop-handle-center"
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
          data-testid={`crop-handle-${handle.type}`}
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
          data-testid={`crop-handle-${handle.type}`}
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
