import { computePanBounds, clampPan } from './panBounds';

/**
 * Viewport-canvas geometry (Task R5) — the single source of truth shared by the CPU
 * sizing/draw path (Canvas.tsx), the GPU present path (GpuPreviewPipeline), the pan
 * clamps and every overlay (crop handles, crop/rotation grid, masks, before/after).
 *
 * The canvas element used to stay pinned at the fitted-image rect, so zooming IN
 * clipped the scaled image at that rect. In the viewport model the canvas box GROWS
 * with the zoom up to the photo-region bounds and the image pans within it:
 *
 *   content  = fit × zoom                          (the displayed image, CSS px)
 *   viewport = clamp(content, fit, container)       (the canvas element box)
 *   offset   = (viewport − content) / 2 + clampedPan  (content top-left in the box)
 *
 * At zoom ≤ 1, content ≤ fit ⇒ viewport = fit and the math collapses to the previous
 * behaviour exactly (pixel-identical): the smaller content is centered in the fit box
 * with no pan.
 *
 * All values are in whatever unit the fit/container inputs use (CSS px in the app).
 * Renderers scale `offset`/`content` into their own buffer pixels.
 */
export interface ViewportGeometry {
  /** Canvas element box (CSS px). */
  viewportW: number;
  viewportH: number;
  /** Displayed image size = fit × zoom (CSS px). */
  contentW: number;
  contentH: number;
  /** Symmetric pan bounds (CSS px). */
  maxPanX: number;
  maxPanY: number;
  /** Pan after clamping to the bounds (CSS px). */
  panX: number;
  panY: number;
  /** Content top-left within the viewport box, pan applied (CSS px). */
  offsetX: number;
  offsetY: number;
}

export function computeViewportGeometry(
  fitW: number,
  fitH: number,
  containerW: number,
  containerH: number,
  zoom: number,
  panX: number,
  panY: number,
): ViewportGeometry {
  const contentW = fitW * zoom;
  const contentH = fitH * zoom;

  // Grow with the content but never below the fit-rect (keeps zoom ≤ 1 identical) and
  // never above the container (the photo region). max(fit, container) guards the
  // degenerate case where the fit somehow exceeds the container.
  const viewportW = Math.min(Math.max(contentW, fitW), Math.max(fitW, containerW));
  const viewportH = Math.min(Math.max(contentH, fitH), Math.max(fitH, containerH));

  const { maxPanX, maxPanY } = computePanBounds(contentW, contentH, viewportW, viewportH);
  const cpanX = clampPan(panX, maxPanX);
  const cpanY = clampPan(panY, maxPanY);

  return {
    viewportW,
    viewportH,
    contentW,
    contentH,
    maxPanX,
    maxPanY,
    panX: cpanX,
    panY: cpanY,
    offsetX: (viewportW - contentW) / 2 + cpanX,
    offsetY: (viewportH - contentH) / 2 + cpanY,
  };
}
