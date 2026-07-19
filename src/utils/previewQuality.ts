/**
 * Preview quality ratchet (v1.29).
 *
 * The editing preview is processed from a downsampled source capped at
 * BASE_PREVIEW_CAP on its long edge — sharp at fit view, but zooming in (or
 * applying a crop, which renders FEWER source pixels into the same screen
 * area) displays upscaled preview pixels. The ratchet raises the cap so the
 * on-screen pixel density returns to the fit-view baseline:
 *
 *   requiredCap = BASE × max(1, zoom) ÷ cropFraction
 *
 * quantized upward to 256 px steps (so continuous zooming doesn't thrash
 * reprocessing) and clamped to [BASE, min(MAX_PREVIEW_CAP, native long edge)].
 * The cap only ever RATCHETS UP per image — Canvas resets it on image open.
 * MAX_PREVIEW_CAP stays within universal GPU texture limits and keeps the CPU
 * fallback path (which handles active crops) at a workable pixel count.
 */

export const BASE_PREVIEW_CAP = 1024;
export const MAX_PREVIEW_CAP = 4096;
const QUANTUM = 256;

export function computeRequiredPreviewCap(args: {
  /** Current viewport zoom (1 = fit). */
  zoom: number;
  /** min(width, height) fraction of the APPLIED crop rect; 1 when no crop. */
  cropFraction: number;
  /** Long edge of the full-resolution source, px. 0/unknown ⇒ no native clamp. */
  nativeLongEdge: number;
}): number {
  const zoom = Math.max(1, args.zoom || 1);
  const frac = Math.min(1, Math.max(args.cropFraction || 1, 0.05));
  const needed = (BASE_PREVIEW_CAP * zoom) / frac;
  const quantized = Math.ceil(needed / QUANTUM) * QUANTUM;
  const nativeClamp = args.nativeLongEdge > 0 ? Math.max(BASE_PREVIEW_CAP, args.nativeLongEdge) : MAX_PREVIEW_CAP;
  return Math.max(BASE_PREVIEW_CAP, Math.min(quantized, MAX_PREVIEW_CAP, nativeClamp));
}
