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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Distance from point P to segment AB, in the same units as the inputs. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

type RadialMode = 'create' | 'move' | 'resize';
type LinearMode = 'create' | 'move' | 'moveStart' | 'moveEnd';

/**
 * Drag overlay for Local Adjustments masks. Drag empty space to (re)place a mask;
 * grab the centre/edge of a radial region to move/resize it, or an endpoint of a
 * linear gradient to move it. Coordinate mapping mirrors the crop overlay (image
 * drawn inside the canvas at offsetWidth*zoom, centred + panned).
 */
export function LocalAdjustmentMaskOverlay({
  canvasRef, viewport, layerType, geometry, onGeometryChange, onDragStart, onDragEnd,
}: Props) {
  const draggingRef = useRef(false);
  const [liveGeom, setLiveGeom] = useState<MaskGeometry>(geometry);
  const [cursor, setCursor] = useState<string>('crosshair');

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

  // overlay-local pixel position of a client point
  const toLocal = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { px: clientX - r.left, py: clientY - r.top };
  };
  const toNorm = (clientX: number, clientY: number) => {
    const m = metrics(); const l = toLocal(clientX, clientY);
    if (!m || !l) return null;
    return { nx: (l.px - m.imgX) / m.scaledW, ny: (l.py - m.imgY) / m.scaledH };
  };

  // Decide what the press is grabbing.
  const hitTest = (px: number, py: number, m: NonNullable<ReturnType<typeof metrics>>): RadialMode | LinearMode => {
    const g = liveGeom;
    const sx = (n: number) => m.imgX + n * m.scaledW;
    const sy = (n: number) => m.imgY + n * m.scaledH;
    const TOL = 14;
    if (layerType === 'radial_gradient') {
      const cxp = sx(g.centerX), cyp = sy(g.centerY);
      if (Math.hypot(px - cxp, py - cyp) <= TOL) return 'move';
      const dx = (px - cxp) / (g.radiusX * m.scaledW || 1);
      const dy = (py - cyp) / (g.radiusY * m.scaledH || 1);
      const d = Math.hypot(dx, dy);
      if (d >= 0.82 && d <= 1.2) return 'resize';
      if (d < 0.82) return 'move';
      return 'create';
    }
    const x1 = sx(g.startX), y1 = sy(g.startY), x2 = sx(g.endX), y2 = sy(g.endY);
    if (Math.hypot(px - x1, py - y1) <= TOL) return 'moveStart';
    if (Math.hypot(px - x2, py - y2) <= TOL) return 'moveEnd';
    if (distToSeg(px, py, x1, y1, x2, y2) <= TOL) return 'move';
    return 'create';
  };

  const handleDown = useCallback((e: React.MouseEvent) => {
    const m = metrics(); const l = toLocal(e.clientX, e.clientY); const p = toNorm(e.clientX, e.clientY);
    if (!m || !l || !p) return;
    e.preventDefault();
    e.stopPropagation();
    const mode = hitTest(l.px, l.py, m);
    const start = { nx: clamp01(p.nx), ny: clamp01(p.ny) };
    const startGeom = { ...liveGeom };
    draggingRef.current = true;
    onDragStart?.();

    const move = (ev: MouseEvent) => {
      const cur = toNorm(ev.clientX, ev.clientY);
      if (!cur) return;
      const cx = clamp01(cur.nx), cy = clamp01(cur.ny);
      const dnx = cur.nx - start.nx, dny = cur.ny - start.ny;
      let next: MaskGeometry;
      if (layerType === 'radial_gradient') {
        if (mode === 'move') {
          next = { ...startGeom, centerX: clamp01(startGeom.centerX + dnx), centerY: clamp01(startGeom.centerY + dny) };
        } else if (mode === 'resize') {
          next = { ...startGeom, radiusX: Math.max(0.04, Math.abs(cx - startGeom.centerX)), radiusY: Math.max(0.04, Math.abs(cy - startGeom.centerY)) };
        } else {
          next = { ...startGeom, type: 'radial', centerX: start.nx, centerY: start.ny, radiusX: Math.max(0.04, Math.abs(cx - start.nx)), radiusY: Math.max(0.04, Math.abs(cy - start.ny)) };
        }
      } else {
        if (mode === 'moveStart') {
          next = { ...startGeom, startX: cx, startY: cy };
        } else if (mode === 'moveEnd') {
          next = { ...startGeom, endX: cx, endY: cy };
        } else if (mode === 'move') {
          next = { ...startGeom, startX: clamp01(startGeom.startX + dnx), startY: clamp01(startGeom.startY + dny), endX: clamp01(startGeom.endX + dnx), endY: clamp01(startGeom.endY + dny) };
        } else {
          next = { ...startGeom, type: 'linear', startX: start.nx, startY: start.ny, endX: cx, endY: cy };
        }
      }
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
  }, [liveGeom, layerType, onGeometryChange, onDragStart, onDragEnd, viewport]);

  // Cursor hint on hover (move vs resize vs crosshair).
  const handleHover = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    const m = metrics(); const l = toLocal(e.clientX, e.clientY);
    if (!m || !l) return;
    const mode = hitTest(l.px, l.py, m);
    setCursor(mode === 'create' ? 'crosshair' : mode === 'resize' ? 'nwse-resize' : 'move');
  };

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
          <circle cx={cx + rx} cy={cy} r={4} fill="rgba(255,255,255,0.8)" />
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
    <div className="absolute inset-0" style={{ cursor, zIndex: 20 }} onMouseDown={handleDown} onMouseMove={handleHover}>
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        {outline}
      </svg>
    </div>
  );
}
