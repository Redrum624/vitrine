/**
 * Calibrated export file-size estimator.
 *
 * The constants below are EMPIRICAL, measured against the app's real encode
 * path — sharp 0.34.5 invoked with the exact options electron/imageWriter.cjs
 * uses (JPEG: mozjpeg, progressive:false; PNG: compressionLevel 6; TIFF:
 * bigtiff, RGBA kept; WebP: lossless:false). The previous (pre-calibration)
 * model guessed (JPEG 3*(q/100)*0.5 = 1.35 B/px at q90) and overestimated 2-12x.
 *
 * The lossy curves (JPEG / WebP / TIFF-jpeg) are calibrated from TWO
 * references and use the per-point MIDPOINT — the same discipline the 16-bit
 * lossless constants below already use:
 *   - SMOOTH (2026-07-10): a real 20MP photograph (P9190037.JPG, downscaled
 *     to 2828x2121 = 6.0MP RGBA) — an already-JPEG source, comparatively low
 *     noise.
 *   - DETAILED (2026-07-10, review fix): a genuinely detailed, NON-already-
 *     JPEG reference — P9190023.ORF (Olympus PEN-F, ISO 800 f/1.8 1/60,
 *     indoor/low-light: fur + fine texture) decoded to raw sensor RGB with
 *     the VENDORED dcraw_emu using the app's own default decode flags (DCB
 *     demosaic + blend highlights: `-q 4 -H 2 -w -o 1 -6 -g 2.4 12.92`, see
 *     electron/rawDecoder.cjs), at full resolution (5200x3904 = 20.3MP, not
 *     downscaled).
 * The smooth reference is a single-generation re-encode of an ALREADY-JPEG
 * image, so residual block-quantization structure inflates its low/mid-quality
 * bytes/pixel; the RAW-decoded detailed reference has no such artifact but
 * carries genuine sensor noise that only dominates as the quantizer approaches
 * lossless (q95-100), where it runs noticeably heavier than the smooth
 * reference. The midpoint balances both failure modes instead of trusting
 * either alone.
 *
 * Measured bytes/pixel table (smooth | detailed | midpoint):
 *
 *   JPEG (mozjpeg):  q60 0.0383|0.0195|0.0289   q75 0.0565|0.0352|0.0459
 *                    q85 0.0830|0.0668|0.0749   q90 0.1118|0.1066|0.1092
 *                    q95 0.1654|0.1942|0.1798   q100 0.4445|0.5850|0.5148
 *   WebP:            q75 0.0400|0.0174|0.0287   q90 0.0946|0.1091|0.1019
 *                    q100 0.2448|0.3253|0.2850
 *   TIFF jpeg:       q60 0.0383|0.0195|0.0289   q75 0.0562|0.0341|0.0451
 *                    q90 0.2715|0.3615|0.3165   q95 0.4164|0.5743|0.4954
 *                    q100 1.1398|1.3805|1.2601
 *
 *   PNG (level 6):       8-bit 2.0380
 *                        16-bit 1.3211 (8-bit-source edit) .. 4.1092 (RAW-like
 *                        low-byte entropy) -> constant uses the midpoint 2.72
 *   WebP lossless:       0.9064
 *   TIFF none:           8-bit 4.0001 | 16-bit 8.0001 (exact: RGBA x bytes/sample)
 *   TIFF lzw:            8-bit 1.5419 | 16-bit 4.2521..5.7114 -> midpoint 4.98
 *   TIFF zip (deflate):  8-bit 1.4482 | 16-bit 2.7372..5.2280 -> midpoint 3.98
 *
 * The 16-bit lossless ranges exist because a 16-bit export of an 8-bit-source
 * image (global edits only) carries almost no low-byte entropy, while a
 * RAW-source float pipeline fills the low bytes with real sensor/demosaic
 * detail; the estimator cannot know the source, so it uses the midpoint.
 *
 * Note: the UI's TIFF "zip" maps to sharp's 'deflate' compression name.
 */

export interface ExportSizeEstimateInput {
  format: 'jpeg' | 'png' | 'tiff' | 'webp';
  /** 1-100 for JPEG/WebP/TIFF-JPEG. Defaults to the writer's default (90). */
  quality?: number;
  /** Bits per channel. Defaults to 8. */
  bitDepth?: 8 | 16;
  /** TIFF compression. Defaults to the writer's default ('lzw'). */
  compression?: 'none' | 'lzw' | 'zip' | 'jpeg';
  /** WebP lossless mode. */
  lossless?: boolean;
}

/** [quality, midpoint bytes/pixel] — ascending, all measured grid points (no
 *  invented low-end anchor; interpolateCurve flat-clamps below the first
 *  point instead, since quality never goes below 1 anyway). */
type CurvePoint = readonly [number, number];

const JPEG_BPP: readonly CurvePoint[] = [
  [60, 0.0289], [75, 0.0459], [85, 0.0749], [90, 0.1092], [95, 0.1798], [100, 0.5148],
];

const WEBP_BPP: readonly CurvePoint[] = [
  [75, 0.0287], [90, 0.1019], [100, 0.2850],
];

const TIFF_JPEG_BPP: readonly CurvePoint[] = [
  [60, 0.0289], [75, 0.0451], [90, 0.3165], [95, 0.4954], [100, 1.2601],
];

const WEBP_LOSSLESS_BPP = 0.9064;
const PNG_BPP = { 8: 2.0380, 16: 2.72 } as const;
const TIFF_LZW_BPP = { 8: 1.5419, 16: 4.98 } as const;
const TIFF_ZIP_BPP = { 8: 1.4482, 16: 3.98 } as const;

/**
 * Piecewise-linear interpolation through the measured curve. Flat-clamps at
 * both ends (below the lowest / above the highest measured grid point)
 * rather than extrapolating past real data.
 */
function interpolateCurve(points: readonly CurvePoint[], quality: number): number {
  const q = Math.min(100, Math.max(0, quality));
  if (q <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (q <= points[i][0]) {
      const [q0, b0] = points[i - 1];
      const [q1, b1] = points[i];
      return b0 + ((q - q0) / (q1 - q0)) * (b1 - b0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Estimated encoded bytes per pixel for the given export settings.
 * Empirical for photographic content (see the calibration table above).
 */
export function estimateBytesPerPixel(input: ExportSizeEstimateInput): number {
  // Clamp to the UI slider range (1-100) so out-of-range values behave like
  // their nearest legal quality instead of sliding down the q0 anchor.
  const quality = Math.min(100, Math.max(1, input.quality ?? 90));
  const bitDepth = input.bitDepth === 16 ? 16 : 8;

  switch (input.format) {
    case 'jpeg':
      return interpolateCurve(JPEG_BPP, quality);
    case 'webp':
      return input.lossless ? WEBP_LOSSLESS_BPP : interpolateCurve(WEBP_BPP, quality);
    case 'png':
      return PNG_BPP[bitDepth];
    case 'tiff':
      switch (input.compression ?? 'lzw') {
        case 'none':
          // Exact: the writer keeps the opaque alpha, so RGBA x bytes/sample.
          return 4 * (bitDepth / 8);
        case 'zip':
          return TIFF_ZIP_BPP[bitDepth];
        case 'jpeg':
          // JPEG-in-TIFF is 8-bit by nature; bit depth does not apply.
          return interpolateCurve(TIFF_JPEG_BPP, quality);
        case 'lzw':
        default:
          return TIFF_LZW_BPP[bitDepth];
      }
    default:
      return 4;
  }
}

/** Estimated file size in bytes for `pixels` output pixels. */
export function estimateExportSizeBytes(pixels: number, input: ExportSizeEstimateInput): number {
  return pixels * estimateBytesPerPixel(input);
}
