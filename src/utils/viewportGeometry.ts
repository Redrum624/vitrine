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

/** The displayed image rectangle (top-left + size, CSS px) inside the canvas element box. */
export interface ContentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The content (displayed image) rectangle within a canvas box, for overlays that already
 * hold the box size + the fit-rect (content-at-zoom-1) base and the current zoom/pan — the
 * grid, rulers, crop and mask overlays. This is the SAME offset/content formula
 * {@link computeViewportGeometry} bakes into `offsetX`/`offsetY`/`contentW`/`contentH`
 * (`offset = (box − content) / 2 + pan`), factored out so every overlay maps image space to
 * screen space through one shared model instead of re-deriving it. Pass the box that
 * geometry already produced (`geom.viewportW`) as `boxW`/`boxH` and an in-bounds pan and the
 * result is identical to the geometry's own offset/content.
 */
export function overlayContentRect(
  contentBaseW: number,
  contentBaseH: number,
  boxW: number,
  boxH: number,
  zoom: number,
  panX: number,
  panY: number,
): ContentRect {
  const w = contentBaseW * zoom;
  const h = contentBaseH * zoom;
  return {
    x: (boxW - w) / 2 + panX,
    y: (boxH - h) / 2 + panY,
    w,
    h,
  };
}

/**
 * Map a normalized image-space anchor (0..1 across the image, so 0,0 = top-left corner and
 * 0.5,0.5 = center) to its screen position inside the canvas box, given the content rect
 * from {@link overlayContentRect}. Overlays anchor grid lines / ruler ticks to the image
 * this way so they track it under pan/zoom instead of staying pinned to the viewport box.
 */
export function imageAnchorToOverlay(
  rect: ContentRect,
  nx: number,
  ny: number,
): { x: number; y: number } {
  return {
    x: rect.x + nx * rect.w,
    y: rect.y + ny * rect.h,
  };
}
