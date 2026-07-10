/**
 * Pan bounds for the viewport-canvas model (Task R5).
 *
 * The zoomed image ("content", size = fit-rect × zoom) is drawn centered inside a
 * "viewport" box (the canvas element, which grows from the fit-rect up to the photo
 * region as you zoom in) and pans within it. The maximum pan in an axis is half the
 * overhang of the content beyond the viewport; when the content is not larger than
 * the viewport in that axis (e.g. a portrait zoomed but still narrower than the wide
 * region, or any axis at zoom ≤ fit) the bound is 0 — the content is fully visible
 * and stays centered.
 *
 * All four inputs share ONE coordinate space (CSS px in the model; the CPU/GPU
 * renderers convert to their own buffer px). Content already includes the zoom
 * factor — pass `fitW*zoom`, not `fitW`.
 */
export function computePanBounds(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { maxPanX: number; maxPanY: number } {
  return {
    maxPanX: Math.max(0, (contentWidth - viewportWidth) / 2),
    maxPanY: Math.max(0, (contentHeight - viewportHeight) / 2),
  };
}

/** Clamp a pan offset to the symmetric bound. */
export function clampPan(value: number, maxPan: number): number {
  return Math.max(-maxPan, Math.min(maxPan, value));
}
