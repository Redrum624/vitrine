/**
 * Pan bounds for the zoomed canvas.
 *
 * The zoomed image is drawn scaled by `zoom` INSIDE the canvas element's own
 * box and clipped by it (see Canvas redraw: scaledWidth = canvas.width * zoom,
 * positioned at (canvas.width - scaledWidth)/2 + panX). The pan viewport is
 * therefore the CANVAS box itself — not the surrounding photo-region container.
 * Clamping against the container locked horizontal panning for any photo that
 * is height-constrained in the letterbox (portrait/4:3 in the wide region):
 * the displayed width never exceeded the region width, so maxPanX computed 0
 * while vertical panning worked only because the fitted height ≈ region height.
 *
 * Bounds are in the same coordinate space as the canvas dimensions passed in
 * (use canvas.width/height — internal pixels — to match where panX/panY are
 * consumed by the draw).
 */
export function computePanBounds(
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
): { maxPanX: number; maxPanY: number } {
  if (zoom <= 1 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { maxPanX: 0, maxPanY: 0 };
  }
  return {
    maxPanX: (canvasWidth * zoom - canvasWidth) / 2,
    maxPanY: (canvasHeight * zoom - canvasHeight) / 2,
  };
}

/** Clamp a pan offset to the symmetric bound. */
export function clampPan(value: number, maxPan: number): number {
  return Math.max(-maxPan, Math.min(maxPan, value));
}
