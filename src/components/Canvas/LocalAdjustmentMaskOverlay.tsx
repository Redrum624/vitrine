import React, { useRef, useState, useEffect, useCallback } from 'react';
import { MaskGeometry } from '../../modules/LocalAdjustmentsModule';

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: { zoom: number; panX: number; panY: number };
  layerType: 'radial_gradient' | 'linear_gradient';
  geometry: MaskGeometry;
  onGeometryChange: (geom: MaskGeometry) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Drag-to-place overlay for Local Adjustments masks. Mirrors the crop-handles
 * coordinate mapping (image drawn inside the canvas at offsetWidth*zoom, centred
 * + panned). Drag from the centre to size a radial (circle/oval) region, or
 * start→end to lay down a linear gradient. Renders an outline that follows the
 * cursor live, and commits geometry via onGeometryChange.
 */
export function LocalAdjustmentMaskOverlay({
  canvasRef, viewport, layerType, geometry, onGeometryChange, onDragStart, onDragEnd,
}: Props) {
  const draggingRef = useRef(false);
  const startRef = useRef<{ nx: number; ny: number } | null>(null);
  const [liveGeom, setLiveGeom] = useState<MaskGeometry>(geometry);

  // Adopt external geometry edits (panel sliders) when not mid-drag.
  useEffect(() => { if (!draggingRef.current) setLiveGeom(geometry); }, [geometry]);

  const metrics = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const scaledW = canvas.offsetWidth * viewport.zoom;
    const scaledH = canvas.offsetHeight * viewport.zoom;
    const imgX = (canvas.offsetWidth - scaledW) / 2 + viewport.panX;
    const imgY = (canvas.offsetHeight - scaledH) / 2 + viewport.panY;
    return { scaledW, scaledH, imgX, imgY };
  };

  const toNorm = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current; const m = metrics();
    if (!canvas || !m) return null;
    const r = canvas.getBoundingClientRect();
    return { nx: (clientX - r.left - m.imgX) / m.scaledW, ny: (clientY - r.top - m.imgY) / m.scaledH };
  };

  const handleDown = useCallback((e: React.MouseEvent) => {
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation(); // don't start canvas panning
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const start = { nx: clamp01(p.nx), ny: clamp01(p.ny) };
    startRef.current = start;
    draggingRef.current = true;
    onDragStart?.();

    const move = (ev: MouseEvent) => {
      const cur = toNorm(ev.clientX, ev.clientY);
      const s = startRef.current;
      if (!cur || !s) return;
      const cx = clamp01(cur.nx), cy = clamp01(cur.ny);
      const next: MaskGeometry = layerType === 'radial_gradient'
        ? { ...geometry, type: 'radial', centerX: s.nx, centerY: s.ny,
            radiusX: Math.max(0.04, Math.abs(cx - s.nx)), radiusY: Math.max(0.04, Math.abs(cy - s.ny)) }
        : { ...geometry, type: 'linear', startX: s.nx, startY: s.ny, endX: cx, endY: cy };
      setLiveGeom(next);
      onGeometryChange(next);
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onDragEnd?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [geometry, layerType, onGeometryChange, onDragStart, onDragEnd, viewport]);

  const m = metrics();
  let outline: React.ReactNode = null;
  if (m) {
    const sx = (n: number) => m.imgX + n * m.scaledW;
    const sy = (n: number) => m.imgY + n * m.scaledH;
    if (layerType === 'radial_gradient') {
      const cx = sx(liveGeom.centerX), cy = sy(liveGeom.centerY);
      const rx = liveGeom.radiusX * m.scaledW, ry = liveGeom.radiusY * m.scaledH;
      const inner = 1 - Math.min(0.95, liveGeom.feather);
      outline = (
        <>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
          <ellipse cx={cx} cy={cy} rx={rx * inner} ry={ry * inner} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="4 3" />
          <circle cx={cx} cy={cy} r={4} fill="rgba(255,255,255,0.9)" />
        </>
      );
    } else {
      const x1 = sx(liveGeom.startX), y1 = sy(liveGeom.startY);
      const x2 = sx(liveGeom.endX), y2 = sy(liveGeom.endY);
      outline = (
        <>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
          <circle cx={x1} cy={y1} r={4} fill="rgba(255,255,255,0.45)" />
          <circle cx={x2} cy={y2} r={5} fill="rgba(255,255,255,0.95)" />
        </>
      );
    }
  }

  return (
    <div className="absolute inset-0" style={{ cursor: 'crosshair', zIndex: 20 }} onMouseDown={handleDown}>
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        {outline}
      </svg>
    </div>
  );
}
