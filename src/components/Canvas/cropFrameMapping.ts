/**
 * Crop overlay <-> screen mapping through the DISPLAYED frame (v1.40.0 Task 9b).
 *
 * Crop rects are normalised to the expanded (rotated) canvas. The image box on
 * screen shows only the frame `d` the last pass actually rendered
 * (processedImageData.frameRect): the applied crop, the drag-suspension frame
 * (the inscribed wedge-free full frame when an angle is set), or the full frame
 * when crop did not run. Mapping through `d` — instead of assuming the box is
 * the full expanded canvas — keeps the overlay, the handles and the rendered
 * result in agreement in every state, including a STALE frame still on screen
 * while the next pass runs.
 *
 *   screen = box + (r - d.xy) / d.wh * box.wh
 */
import type { NormalizedCropRect } from '../../modules/cropGeometry';

export const FULL_FRAME: NormalizedCropRect = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A frame usable as a divisor (positive size); anything else is the full frame. */
export function resolveFrame(frame: NormalizedCropRect | null | undefined): NormalizedCropRect {
  return frame && frame.width > 0 && frame.height > 0 ? frame : FULL_FRAME;
}

/** Normalised x -> screen x through the displayed frame. */
export function normToScreenX(nx: number, frame: NormalizedCropRect, box: ScreenBox): number {
  return box.left + ((nx - frame.x) / frame.width) * box.width;
}

/** Normalised y -> screen y through the displayed frame. */
export function normToScreenY(ny: number, frame: NormalizedCropRect, box: ScreenBox): number {
  return box.top + ((ny - frame.y) / frame.height) * box.height;
}

/** Normalised rect -> screen rect through the displayed frame. */
export function mapRectToBox(rect: NormalizedCropRect, frame: NormalizedCropRect, box: ScreenBox): ScreenBox {
  const left = normToScreenX(rect.x, frame, box);
  const top = normToScreenY(rect.y, frame, box);
  return {
    left,
    top,
    width: normToScreenX(rect.x + rect.width, frame, box) - left,
    height: normToScreenY(rect.y + rect.height, frame, box) - top,
  };
}

/** Screen rect -> normalised rect (inverse of mapRectToBox). */
export function mapBoxToRect(px: { left: number; top: number; right: number; bottom: number }, frame: NormalizedCropRect, box: ScreenBox): NormalizedCropRect {
  const nx = (sx: number) => frame.x + ((sx - box.left) / box.width) * frame.width;
  const ny = (sy: number) => frame.y + ((sy - box.top) / box.height) * frame.height;
  const x = nx(px.left);
  const y = ny(px.top);
  return { x, y, width: nx(px.right) - x, height: ny(px.bottom) - y };
}
