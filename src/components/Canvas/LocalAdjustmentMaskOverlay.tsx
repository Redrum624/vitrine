import React, { useRef, useState, useEffect, useCallback } from 'react';
import { MaskGeometry } from '../../modules/LocalAdjustmentsModule';

interface Props {
  viewport: { zoom: number; panX: number; panY: number };
  // Content (fit-rect) base the image scales by (viewport-canvas model, Task R5):
  // content = contentWidth × zoom, centered in the canvas element (viewport) box.
  // Defaults to the canvas element's own size (⇒ pre-R5 behaviour).
  contentWidth?: number;
  contentHeight?: number;
  layerType: 'radial_gradient' | 'linear_gradient';
  geometry: MaskGeometry;
  onGeometryChange: (geom: MaskGeometry) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDeselect?: () => void;
}

type RadialMode = 'create' | 'move' | 'resize' | 'rotate';
type LinearMode = 'create' | 'move' | 'rotate';

/**
 * Drag overlay for Local Adjustments masks. Radial: grab the centre to move, the
 * edge ring to resize, the top handle to rotate. Linear (graduated filter): a line
 * through the centre with the effect on one side — drag the line to move, the blue
 * handle/arrow to rotate. Coordinate mapping mirrors the crop overlay (image drawn
 * inside the overlay box at box*zoom, centred + panned).
 */
export function LocalAdjustmentMaskOverlay({
  viewport, contentWidth, contentHeight, layerType, geometry, onGeometryChange, onDragStart, onDragEnd, onDeselect,
}: Props) {
  // Box + pointer origin come from THIS overlay's own root element, not the 2D
  // <canvas>: in GPU render mode that canvas is display:none (offsetWidth/rect = 0),
  // which collapsed every mask to the top-left corner. The root is `absolute inset-0`
  // of the wrapper sized exactly to the viewport box, so it's correct in both modes.
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [liveGeom, setLiveGeom] = useState<MaskGeometry>(geometry);
  const [cursor, setCursor] = useState<string>('crosshair');

  useEffect(() => { if (!draggingRef.current) setLiveGeom(geometry); }, [geometry]);

  // Always-current geometry for the drag handler, so handleDown can stay stable
  // (not recreated on every setLiveGeom) and avoid re-render churn mid-drag.
  const liveGeomRef = useRef(liveGeom);
  useEffect(() => { liveGeomRef.current = liveGeom; }, [liveGeom]);

  const metrics = () => {
    const root = rootRef.current;
    if (!root) return null;
    // Box = the overlay/viewport element. Content scales by the fit-rect (contentWidth),
    // centered in the box + pan — matching the CPU/GPU draw (viewport-canvas model, R5).
    const boxW = root.offsetWidth;
    const boxH = root.offsetHeight;
    const scaledW = (contentWidth ?? boxW) * viewport.zoom;
    const scaledH = (contentHeight ?? boxH) * viewport.zoom;
    const imgX = (boxW - scaledW) / 2 + viewport.panX;
    const imgY = (boxH - scaledH) / 2 + viewport.panY;
    return { scaledW, scaledH, imgX, imgY };
  };

  // overlay-local pixel position of a client point
  const toLocal = (clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    return { px: clientX - r.left, py: clientY - r.top };
  };
  const toNorm = (clientX: number, clientY: number) => {
    const m = metrics(); const l = toLocal(clientX, clientY);
    if (!m || !l) return null;
    return { nx: (l.px - m.imgX) / m.scaledW, ny: (l.py - m.imgY) / m.scaledH };
  };

  // Decide what the press is grabbing.
  const hitTest = (px: number, py: number, m: NonNullable<ReturnType<typeof metrics>>): RadialMode | LinearMode => {
    const g = liveGeomRef.current;
    const sx = (n: number) => m.imgX + n * m.scaledW;
    const sy = (n: number) => m.imgY + n * m.scaledH;
    const TOL = 14;
    if (layerType === 'radial_gradient') {
      const cxp = sx(g.centerX), cyp = sy(g.centerY);
      const rot = g.rotation || 0;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      // Rotation handle sits above the ellipse's local top.
      const ryGap = g.radiusY * m.scaledH + 18;
      if (Math.hypot(px - (cxp + ryGap * sinR), py - (cyp - ryGap * cosR)) <= TOL) return 'rotate';
      if (Math.hypot(px - cxp, py - cyp) <= TOL) return 'move';
      // Rotate the offset into the ellipse's local frame for the resize-ring test.
      const ox = px - cxp, oy = py - cyp;
      const lx = (ox * cosR + oy * sinR) / (g.radiusX * m.scaledW || 1);
      const ly = (-ox * sinR + oy * cosR) / (g.radiusY * m.scaledH || 1);
      const d = Math.hypot(lx, ly);
      if (d >= 0.82 && d <= 1.2) return 'resize';
      if (d < 0.82) return 'move';
      return 'create';
    }
    // linear: a line through the centre at angle `rotation`; effect on the perpendicular +side.
    const cxp = sx(g.centerX), cyp = sy(g.centerY);
    const rot = g.rotation || 0;
    const perpX = -Math.sin(rot), perpY = Math.cos(rot);
    const handleD = 34;
    if (Math.hypot(px - (cxp + perpX * handleD), py - (cyp + perpY * handleD)) <= TOL) return 'rotate';
    if (Math.abs((px - cxp) * perpX + (py - cyp) * perpY) <= TOL) return 'move'; // near the line
    if (Math.hypot(px - cxp, py - cyp) <= TOL) return 'move';
    return 'create';
  };

  const handleDown = useCallback((e: React.MouseEvent) => {
    const m = metrics(); const l = toLocal(e.clientX, e.clientY); const p = toNorm(e.clientX, e.clientY);
    if (!m || !l || !p) return;
    e.preventDefault();
    e.stopPropagation();
    const mode = hitTest(l.px, l.py, m);
    // Clicking off the mask (not on a handle) deselects + hides it.
    if (mode === 'create') { onDeselect?.(); return; }
    // No clamping: masks may extend outside the image (still within the canvas).
    const start = { nx: p.nx, ny: p.ny };
    const startGeom = { ...liveGeomRef.current };
    draggingRef.current = true;
    onDragStart?.();
    let latest = startGeom;

    const move = (ev: MouseEvent) => {
      const cur = toNorm(ev.clientX, ev.clientY);
      if (!cur) return;
      const cx = cur.nx, cy = cur.ny;
      const dnx = cur.nx - start.nx, dny = cur.ny - start.ny;
      let next: MaskGeometry;
      if (layerType === 'radial_gradient') {
        if (mode === 'move') {
          next = { ...startGeom, centerX: startGeom.centerX + dnx, centerY: startGeom.centerY + dny };
        } else if (mode === 'rotate' || mode === 'resize') {
          // Rotate/resize need pixel-space maths (aspect-correct).
          const mm = metrics(); const ll = toLocal(ev.clientX, ev.clientY);
          if (mm && ll) {
            const cxp = mm.imgX + startGeom.centerX * mm.scaledW;
            const cyp = mm.imgY + startGeom.centerY * mm.scaledH;
            if (mode === 'rotate') {
              next = { ...startGeom, rotation: Math.atan2(ll.px - cxp, -(ll.py - cyp)) };
            } else {
              const rot = startGeom.rotation || 0, ox = ll.px - cxp, oy = ll.py - cyp;
              const rxp = Math.abs(ox * Math.cos(rot) + oy * Math.sin(rot));
              const ryp = Math.abs(-ox * Math.sin(rot) + oy * Math.cos(rot));
              next = { ...startGeom, radiusX: Math.max(0.04, rxp / mm.scaledW), radiusY: Math.max(0.04, ryp / mm.scaledH) };
            }
          } else next = startGeom;
        } else {
          next = { ...startGeom, type: 'radial', centerX: start.nx, centerY: start.ny, radiusX: Math.max(0.04, Math.abs(cx - start.nx)), radiusY: Math.max(0.04, Math.abs(cy - start.ny)) };
        }
      } else {
        if (mode === 'move') {
          next = { ...startGeom, centerX: startGeom.centerX + dnx, centerY: startGeom.centerY + dny };
        } else if (mode === 'rotate') {
          const mm = metrics(); const ll = toLocal(ev.clientX, ev.clientY);
          if (mm && ll) {
            const cxp = mm.imgX + startGeom.centerX * mm.scaledW;
            const cyp = mm.imgY + startGeom.centerY * mm.scaledH;
            // effect side points toward the cursor
            next = { ...startGeom, rotation: Math.atan2(-(ll.px - cxp), ll.py - cyp) };
          } else next = startGeom;
        } else {
          // create: drop the line at the press point; drag points the effect at the cursor
          const mm = metrics(); const ll = toLocal(ev.clientX, ev.clientY);
          let rotation = startGeom.rotation || 0;
          if (mm && ll) {
            const cxp = mm.imgX + start.nx * mm.scaledW, cyp = mm.imgY + start.ny * mm.scaledH;
            const ddx = ll.px - cxp, ddy = ll.py - cyp;
            if (Math.hypot(ddx, ddy) > 6) rotation = Math.atan2(-ddx, ddy);
          }
          next = { ...startGeom, type: 'linear', centerX: start.nx, centerY: start.ny, rotation };
        }
      }
      latest = next;
      setLiveGeom(next); // instant outline; the (heavier) mask reprocess is committed on mouseup
    };
    const up = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onGeometryChange(latest); // commit + reprocess once, so dragging stays smooth
      onDragEnd?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [layerType, onGeometryChange, onDragStart, onDragEnd, onDeselect, viewport]);

  // Cursor hint on hover (move vs resize vs crosshair).
  const handleHover = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    const m = metrics(); const l = toLocal(e.clientX, e.clientY);
    if (!m || !l) return;
    const mode = hitTest(l.px, l.py, m);
    setCursor(mode === 'create' ? 'crosshair' : mode === 'rotate' ? 'grab' : mode === 'resize' ? 'nwse-resize' : 'move');
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
      const rotDeg = ((liveGeom.rotation || 0) * 180) / Math.PI;
      outline = (
        // Everything in the ellipse's local frame, rotated as a group about the centre.
        <g transform={`rotate(${rotDeg} ${cx} ${cy})`}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
          <ellipse cx={cx} cy={cy} rx={rx * inner} ry={ry * inner} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="4 3" />
          <circle cx={cx} cy={cy} r={4} fill="rgba(255,255,255,0.9)" />
          <circle cx={cx + rx} cy={cy} r={4} fill="rgba(255,255,255,0.8)" />
          {/* rotation handle (above the local top) */}
          <line x1={cx} y1={cy - ry} x2={cx} y2={cy - ry - 18} stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
          <circle cx={cx} cy={cy - ry - 18} r={4} fill="rgba(120,200,255,0.95)" />
        </g>
      );
    } else {
      const cxp = sx(liveGeom.centerX), cyp = sy(liveGeom.centerY);
      const rot = liveGeom.rotation || 0;
      const dirX = Math.cos(rot), dirY = Math.sin(rot);
      const perpX = -Math.sin(rot), perpY = Math.cos(rot);
      const L = 2 * (m.scaledW + m.scaledH);
      const lx1 = cxp - dirX * L, ly1 = cyp - dirY * L, lx2 = cxp + dirX * L, ly2 = cyp + dirY * L;
      const handleD = 34;
      const hx = cxp + perpX * handleD, hy = cyp + perpY * handleD;
      outline = (
        <>
          <defs>
            <clipPath id="la-grad-clip">
              <rect x={m.imgX} y={m.imgY} width={m.scaledW} height={m.scaledH} />
            </clipPath>
          </defs>
          {/* the line + effect-side indicators, clipped to the image (full width, no overflow) */}
          <g clipPath="url(#la-grad-clip)">
            <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
            <line x1={lx1 + perpX * 16} y1={ly1 + perpY * 16} x2={lx2 + perpX * 16} y2={ly2 + perpY * 16} stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="5 4" />
            <line x1={lx1 + perpX * 30} y1={ly1 + perpY * 30} x2={lx2 + perpX * 30} y2={ly2 + perpY * 30} stroke="rgba(255,255,255,0.16)" strokeWidth={1} strokeDasharray="5 4" />
          </g>
          {/* centre dot + arrow/handle pointing to the effect side (drag to rotate) */}
          <line x1={cxp} y1={cyp} x2={hx} y2={hy} stroke="rgba(120,200,255,0.9)" strokeWidth={1.5} />
          <circle cx={cxp} cy={cyp} r={4} fill="rgba(255,255,255,0.95)" />
          <circle cx={hx} cy={hy} r={5} fill="rgba(120,200,255,0.95)" />
        </>
      );
    }
  }

  return (
    <div ref={rootRef} className="absolute inset-0" style={{ cursor, zIndex: 20 }} onMouseDown={handleDown} onMouseMove={handleHover}>
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        {outline}
      </svg>
    </div>
  );
}
