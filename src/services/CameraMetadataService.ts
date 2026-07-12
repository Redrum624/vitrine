import { logger } from '../utils/Logger';
import { isElectron } from '../types/electron';
import { RAW_EXTENSIONS } from '../utils/rawExtensions';

/** Minimal source shape for camera-info lookup — only the file path is needed,
 *  so both ImageFile and ImageFileInfo (and any `{ path }`) are accepted. */
interface CameraInfoSource {
  path: string;
}

/**
 * Minimal structural shape of an exifreader tag. exifreader decodes EXIF string
 * tags into `.description` and numeric tags into `.value` (the readable text is
 * also exposed on `.description`). We only read those two fields, so a narrow
 * local type avoids a hard dependency on exifreader's full declaration.
 */
interface ExifReaderTag {
  description?: unknown;
  value?: unknown;
}

type ExifReaderTagMap = Record<string, ExifReaderTag | ExifReaderTag[] | undefined>;

/** Flat camera EXIF returned by the main-process RAW parser (read-raw-metadata IPC). */
interface RawExifMetadata {
  make?: string;
  model?: string;
  iso?: number;
  exposureTime?: number; // seconds
  aperture?: number; // f-number
  focalLength?: number; // mm
  dateTime?: string; // 'YYYY:MM:DD HH:MM:SS'
  lens?: string;
}

/** The bridge methods this service depends on. */
interface ElectronMetadataApi {
  readImageMetadata?: (filePath: string) => Promise<{
    exif?: ExifReaderTagMap;
    iptc?: ExifReaderTagMap;
    xmp?: ExifReaderTagMap;
    icc?: unknown;
    thumbnail?: unknown;
  }>;
  /** RAW-only: camera EXIF parsed from the file's TIFF/EXIF IFDs in the main
   *  process (exifreader cannot parse proprietary RAW containers). */
  readRawMetadata?: (filePath: string) => Promise<RawExifMetadata | null>;
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
  /** Display-ready shutter speed, e.g. "1/500 s" or "2 s". */
  shutter?: string;
  /** Aperture f-number, e.g. 1.8 (render as f/1.8). */
  aperture?: number;
  /** Focal length in millimetres, e.g. 17 (render as 17 mm). */
  focalLength?: number;
  /** Capture timestamp in EXIF colon format, e.g. "2025:02:06 20:27:48". */
  dateTime?: string;
}

/**
 * Shared accessor for real camera metadata (make / model / ISO / lens / exposure)
 * read from a file's EXIF. Two sources, one shape (CameraInfo):
 *   - RAW files (ORF/CR2/NEF/ARW/DNG/...) → the main-process TIFF/EXIF parser via
 *     the `read-raw-metadata` IPC. exifreader THROWS on proprietary RAW
 *     containers, and the embedded preview JPEG often carries no EXIF, so LibRaw's
 *     own container is the reliable source. This is decoupled from the decode/
 *     base-cache pipeline, so it works identically on a fresh decode or a cache hit.
 *   - Everything else (JPG/PNG/TIFF) → exifreader via the `read-image-metadata` IPC.
 *
 * Replaces the hardcoded camera mocks previously embedded in the RAW and
 * noise-reduction modules and, for Task Q6, backs the filename-chip Info popover.
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
  async getCameraInfo(image: CameraInfoSource | null): Promise<CameraInfo | null> {
    if (!image?.path) return null;

    const cached = this.cache.get(image.path);
    if (cached !== undefined) return cached;

    const info = await this.readCameraInfo(image.path, this.isRawPath(image.path));
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

  private isRawPath(filePath: string): boolean {
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    return RAW_EXTENSIONS.includes(ext);
  }

  private async readCameraInfo(filePath: string, isRaw: boolean): Promise<CameraInfo | null> {
    try {
      if (!isElectron()) {
        logger.debug('Camera metadata requires the desktop app');
        return null;
      }

      // contextIsolation keeps electronAPI off the typed Window in tests/web;
      // access via a cast, matching the existing renderer pattern.
      const api = (window as unknown as { electronAPI?: ElectronMetadataApi }).electronAPI;
      return isRaw ? await this.readRawCameraInfo(api, filePath) : await this.readExifCameraInfo(api, filePath);
    } catch (error) {
      logger.error('Failed to read camera metadata:', error);
      return null;
    }
  }

  /** RAW path: consume the main-process TIFF/EXIF parse (read-raw-metadata IPC). */
  private async readRawCameraInfo(
    api: ElectronMetadataApi | undefined,
    filePath: string,
  ): Promise<CameraInfo | null> {
    if (!api?.readRawMetadata) {
      logger.debug('readRawMetadata bridge unavailable');
      return null;
    }
    const md = await api.readRawMetadata(filePath);
    if (!md) return null;

    const info: CameraInfo = {};
    if (md.make) info.make = md.make;
    if (md.model) info.model = md.model;
    if (typeof md.iso === 'number' && md.iso > 0) info.iso = md.iso;
    if (md.lens) info.lensModel = md.lens;
    if (typeof md.aperture === 'number' && md.aperture > 0) info.aperture = md.aperture;
    if (typeof md.focalLength === 'number' && md.focalLength > 0) info.focalLength = md.focalLength;
    if (md.dateTime) info.dateTime = md.dateTime;
    const shutter = this.formatShutter(md.exposureTime);
    if (shutter !== undefined) info.shutter = shutter;

    return Object.keys(info).length === 0 ? null : info;
  }

  /** Non-RAW path: exifreader via read-image-metadata. */
  private async readExifCameraInfo(
    api: ElectronMetadataApi | undefined,
    filePath: string,
  ): Promise<CameraInfo | null> {
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
    const aperture = this.tagNumber(exif['FNumber'] ?? exif['ApertureValue']);
    const focalLength = this.tagNumber(exif['FocalLength']);
    const dateTime = this.tagStr(exif['DateTimeOriginal'] ?? exif['DateTimeDigitized'] ?? exif['DateTime']);
    const shutter = this.formatShutter(this.exposureSeconds(exif['ExposureTime']));

    const info: CameraInfo = {};
    if (make !== undefined) info.make = make;
    if (model !== undefined) info.model = model;
    if (iso !== undefined) info.iso = iso;
    if (lensModel !== undefined) info.lensModel = lensModel;
    if (aperture !== undefined) info.aperture = aperture;
    if (focalLength !== undefined) info.focalLength = focalLength;
    if (dateTime !== undefined) info.dateTime = dateTime;
    if (shutter !== undefined) info.shutter = shutter;

    // Nothing usable -> null so callers hide their panels (no fake values).
    if (Object.keys(info).length === 0) return null;
    return info;
  }

  /**
   * Format an exposure time (in seconds) into a display string: exposures at or above 0.5s as
   * decimal ("0.8 s", "2 s"), faster exposures as a fraction ("1/500 s"). Returns undefined for a
   * missing/invalid value.
   *
   * Round-9 Q6 LOW fix: the decimal branch used to gate at `seconds >= 1`, so the 0.5-1.0s band
   * fell into the fraction branch and rounded to a MISLEADING "1/1 s" (e.g. 0.77s -> 1/round(1.3)
   * -> "1/1 s", which reads as a 1-second exposure's reciprocal, not "just under a second"). The
   * fraction branch's own denominator rounding is only sensible once 1/seconds is comfortably >
   * 1, i.e. below the 0.5s half-stop.
   */
  private formatShutter(seconds: number | undefined): string | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
    if (seconds >= 0.5) {
      // Trim trailing ".0" from whole seconds while keeping e.g. "1.3 s" / "0.8 s".
      const rounded = Math.round(seconds * 10) / 10;
      return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} s`;
    }
    return `1/${Math.round(1 / seconds)} s`;
  }

  /**
   * Read an EXIF ExposureTime tag as a number of seconds. exifreader exposes it
   * as a rational (`.value` = [num, den]), a plain number, or a "1/500" string
   * on `.description`; handle all three.
   */
  private exposureSeconds(tag: ExifReaderTag | ExifReaderTag[] | undefined): number | undefined {
    if (!tag) return undefined;
    const one = Array.isArray(tag) ? tag[0] : tag;
    if (!one) return undefined;
    const v = one.value;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[1] !== 0) {
      return v[0] / v[1];
    }
    if (typeof one.description === 'string') {
      const m = one.description.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
      if (m) {
        const num = Number(m[1]);
        const den = Number(m[2]);
        if (den) return num / den;
      }
      const n = Number(one.description);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return undefined;
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
   * Read a numeric EXIF tag (e.g. ISOSpeedRatings, FNumber, FocalLength).
   * exifreader exposes the number on `.value` (sometimes a single-element array,
   * sometimes a [num, den] rational) and the readable form on `.description`.
   * Coerce whichever is present.
   */
  private tagNumber(tag: ExifReaderTag | ExifReaderTag[] | undefined): number | undefined {
    if (!tag) return undefined;
    const one = Array.isArray(tag) ? tag[0] : tag;
    if (!one) return undefined;
    let candidate: unknown;
    if (typeof one.value === 'number') {
      candidate = one.value;
    } else if (Array.isArray(one.value)) {
      // [num, den] rational (FNumber/FocalLength) or [n] single-element.
      const arr = one.value as unknown[];
      if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number' && arr[1] !== 0) {
        candidate = (arr[0] as number) / (arr[1] as number);
      } else {
        candidate = arr[0];
      }
    } else {
      candidate = one.value ?? one.description;
    }
    const n = Number(candidate);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
}

export const cameraMetadataService = CameraMetadataService.getInstance();
