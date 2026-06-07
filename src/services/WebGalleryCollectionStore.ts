import { logger } from '../utils/Logger';
import { GalleryImage } from './WebGalleryService';

/**
 * A Web Gallery image-collection (id + name + images), persisted to disk so the
 * user's collections survive an app restart. Mirrors the house localStorage
 * convention used by PresetService (versioned `{version, ...}` JSON wrapper in
 * try/catch). Image base64 blobs are NOT persisted (see saveCollections) to
 * stay under the ~5MB localStorage quota; only lightweight metadata is stored.
 */
export interface ImageCollection {
  id: string;
  name: string;
  images: GalleryImage[];
  createdAt: Date;
}

const STORAGE_KEY = 'photo_editor_gallery_collections';
const VERSION = '1.0.0';

// The heavy base64 fields that must never reach localStorage.
const HEAVY_FIELDS: (keyof GalleryImage)[] = ['thumbnailData', 'previewData', 'fullSizeData'];

/**
 * Strip the heavy base64 image blobs from a GalleryImage, keeping only metadata.
 */
function stripImageBlobs(image: GalleryImage): GalleryImage {
  const meta: GalleryImage = { ...image };
  for (const field of HEAVY_FIELDS) {
    delete meta[field];
  }
  return meta;
}

/**
 * Revive a single collection coming back from JSON.parse: createdAt and each
 * image's captureDate are live Date objects in memory but ISO strings on disk.
 */
function reviveCollection(raw: ImageCollection): ImageCollection {
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
    images: (raw.images || []).map((img) => ({
      ...img,
      captureDate: img.captureDate ? new Date(img.captureDate) : undefined
    }))
  };
}

class WebGalleryCollectionStore {
  /**
   * Load persisted gallery collections. Returns an empty array on any failure
   * (missing key, malformed JSON, quota) so the caller degrades gracefully.
   */
  loadCollections(): ImageCollection[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];

      const data = JSON.parse(stored);
      const collections: ImageCollection[] = (data.collections || []).map(reviveCollection);
      logger.info(`Loaded ${collections.length} gallery collections from storage`);
      return collections;
    } catch (error) {
      logger.error('Failed to load gallery collections from storage:', error);
      return [];
    }
  }

  /**
   * Persist gallery collections. Heavy base64 blobs are stripped before write to
   * keep the payload metadata-only and well under the localStorage quota.
   */
  saveCollections(collections: ImageCollection[]): void {
    try {
      const data = {
        version: VERSION,
        collections: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          createdAt: collection.createdAt,
          images: collection.images.map(stripImageBlobs)
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to save gallery collections to storage:', error);
    }
  }
}

export const webGalleryCollectionStore = new WebGalleryCollectionStore();
