import { logger } from '../utils/Logger';
import { isElectron } from '../types/electron';
import type { ImageFile } from '../types';

/**
 * Minimal structural shape of an exifreader tag. exifreader decodes EXIF string
 * tags into `.description` and numeric tags into `.value` (the readable text is
 * also exposed on `.description`). We only read those two fields, so a narrow
 * local type avoids a hard dependency on exifreader's full declaration. This
 * mirrors the same pattern used by CopyrightService.
 */
interface ExifReaderTag {
  description?: unknown;
  value?: unknown;
}

type ExifReaderTagMap = Record<string, ExifReaderTag | ExifReaderTag[] | undefined>;

/** The single bridge method this service depends on. */
interface ElectronMetadataApi {
  readImageMetadata?: (filePath: string) => Promise<{
    exif?: ExifReaderTagMap;
    iptc?: ExifReaderTagMap;
    xmp?: ExifReaderTagMap;
    icc?: unknown;
    thumbnail?: unknown;
  }>;
}

/**
 * Real camera identification sourced from a file's EXIF. Any field may be absent
 * when the source carries no value; callers must handle the null/partial cases
 * rather than substituting fabricated defaults.
 */
export interface CameraInfo {
  make?: string;
  model?: string;
  iso?: number;
  lensModel?: string;
}

/**
 * Shared accessor for real camera metadata (make / model / ISO / lens) read from
 * a file's EXIF via the existing read-image-metadata IPC. Replaces the hardcoded
 * camera mocks previously embedded in the RAW and noise-reduction modules.
 *
 * NOTE: exifreader cannot parse proprietary RAW containers (ORF/CR2/NEF/...),
 * so for RAW files this returns null and the consuming panels simply hide rather
 * than display wrong data. Plumbing real RAW EXIF through LibRaw is a separate
 * follow-up (out of scope here).
 */
export class CameraMetadataService {
  private static instance: CameraMetadataService;

  /** Per-path cache so repeated reads (e.g. two modules) hit the IPC once. */
  private readonly cache = new Map<string, CameraInfo | null>();

  /** Upper bound on cached paths; oldest entries are evicted past this. */
  private static readonly MAX_CACHE_ENTRIES = 256;

  static getInstance(): CameraMetadataService {
    if (!CameraMetadataService.instance) {
      CameraMetadataService.instance = new CameraMetadataService();
    }
    return CameraMetadataService.instance;
  }

  /**
   * Resolve the camera info for an image, or null when nothing usable is found.
   * Results are cached per `image.path`.
   */
  async getCameraInfo(image: ImageFile | null): Promise<CameraInfo | null> {
    if (!image?.path) return null;

    const cached = this.cache.get(image.path);
    if (cached !== undefined) return cached;

    const info = await this.readCameraInfo(image.path);
    this.cache.set(image.path, info);
    // Bound the cache so a long session opening many files can't grow it without
    // limit; evict the oldest entry (a Map preserves insertion order) past the cap.
    if (this.cache.size > CameraMetadataService.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return info;
  }

  /** Clear the cache (e.g. when a file is re-written/overwritten). */
  clearCache(path?: string): void {
    if (path) this.cache.delete(path);
    else this.cache.clear();
  }

  private async readCameraInfo(filePath: string): Promise<CameraInfo | null> {
    try {
      if (!isElectron()) {
        logger.debug('Camera metadata requires the desktop app');
        return null;
      }

      // contextIsolation keeps electronAPI off the typed Window in tests/web;
      // access via a cast, matching the existing renderer pattern.
      const api = (window as unknown as { electronAPI?: ElectronMetadataApi }).electronAPI;
      if (!api?.readImageMetadata) {
        logger.debug('readImageMetadata bridge unavailable');
        return null;
      }

      const md = await api.readImageMetadata(filePath);
      const exif: ExifReaderTagMap = md?.exif ?? {};

      const make = this.tagStr(exif['Make']);
      const model = this.tagStr(exif['Model']);
      const iso = this.tagNumber(exif['ISOSpeedRatings'] ?? exif['ISO'] ?? exif['PhotographicSensitivity']);
      const lensModel = this.tagStr(exif['LensModel']);

      const info: CameraInfo = {};
      if (make !== undefined) info.make = make;
      if (model !== undefined) info.model = model;
      if (iso !== undefined) info.iso = iso;
      if (lensModel !== undefined) info.lensModel = lensModel;

      // Nothing usable -> null so callers hide their panels (no fake values).
      if (Object.keys(info).length === 0) return null;
      return info;
    } catch (error) {
      logger.error('Failed to read camera metadata:', error);
      return null;
    }
  }

  /**
   * Read a scalar string from an exifreader tag. exifreader decodes string tags
   * into `.description`; fall back to a string `.value`, or the first element of
   * an array value. EXIF make/model carry trailing whitespace, so trim; empty
   * strings collapse to undefined.
   */
  private tagStr(tag: ExifReaderTag | ExifReaderTag[] | undefined): string | undefined {
    if (!tag) return undefined;
    const one = Array.isArray(tag) ? tag[0] : tag;
    if (!one) return undefined;
    let raw: string | undefined;
    if (typeof one.description === 'string') {
      raw = one.description;
    } else if (typeof one.value === 'string') {
      raw = one.value;
    } else if (Array.isArray(one.value) && typeof one.value[0] === 'string') {
      raw = one.value[0];
    }
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  /**
   * Read a numeric EXIF tag (e.g. ISOSpeedRatings). exifreader exposes the number
   * on `.value` (sometimes a single-element array) and the readable form on
   * `.description`. Coerce whichever is present.
   */
  private tagNumber(tag: ExifReaderTag | ExifReaderTag[] | undefined): number | undefined {
    if (!tag) return undefined;
    const one = Array.isArray(tag) ? tag[0] : tag;
    if (!one) return undefined;
    const candidate =
      typeof one.value === 'number'
        ? one.value
        : Array.isArray(one.value) && typeof one.value[0] === 'number'
          ? one.value[0]
          : one.value ?? one.description;
    const n = Number(candidate);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}

export const cameraMetadataService = CameraMetadataService.getInstance();
