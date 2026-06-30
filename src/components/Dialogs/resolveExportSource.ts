import { imageService } from '../../services/ImageService';

export interface ExportSource {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Resolves the pixel buffer and dimensions that an export should process.
 *
 * When a baked upscale is active the authoritative full-res pixels already live
 * in `imageService.getCurrentImage()` at baked dimensions — re-decoding the
 * original file would silently discard the upscale work.  In all other cases
 * the original file is decoded fresh via `loadImageForExport`, preserving the
 * existing non-baked export path byte-for-byte.
 */
export async function resolveExportSource(filePath: string): Promise<ExportSource> {
  if (imageService.isBakedUpscaleActive()) {
    const cur = imageService.getCurrentImage();
    if (cur) return { data: cur.data, width: cur.width, height: cur.height };
  }
  const decoded = await imageService.loadImageForExport(filePath);
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}
