import { logger } from '../utils/Logger';
import { ExportOptions, exportService, ExportResult } from './ExportService';
import { imageService } from './ImageService';
import { WatermarkSettings } from './WatermarkService';
import { IPTCMetadata } from './CopyrightService';

export interface OutputImage {
  id: string;
  originalPath: string;
  name: string;
  addedDate: Date;
  tags: string[];
  notes?: string;
  exportSettings?: ExportOptions;
  watermarkSettings?: WatermarkSettings;
  metadata?: IPTCMetadata;
  thumbnail?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  lastExported?: Date;
  exportPath?: string;
  fileSize?: number;
}

export interface OutputCollection {
  id: string;
  name: string;
  description: string;
  category: 'client' | 'portfolio' | 'stock' | 'personal' | 'project' | 'custom';
  createdDate: Date;
  modifiedDate: Date;
  images: OutputImage[];

  // Collection settings
  defaultExportSettings: ExportOptions;
  defaultWatermarkSettings?: WatermarkSettings;
  defaultMetadata?: Partial<IPTCMetadata>;

  // Organization
  tags: string[];
  clientInfo?: {
    name: string;
    email?: string;
    project?: string;
    deadline?: Date;
  };

  // Export tracking
  totalExports: number;
  lastExportDate?: Date;
  exportHistory: ExportRecord[];

  // Sharing
  isPublic: boolean;
  shareUrl?: string;
  password?: string;
}

export interface ExportRecord {
  id: string;
  date: Date;
  imageCount: number;
  format: string;
  destination: string;
  totalSize: number;
  duration: number;
  success: boolean;
  error?: string;
  /**
   * Non-fatal disclosures about the export. Collection export currently writes
   * UNEDITED source pixels (no editor adjustment pipeline is replayed per
   * image), so a warning is recorded here to keep the success path honest.
   */
  warnings?: string[];
}

export interface CollectionTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultSettings: {
    exportOptions: Partial<ExportOptions>;
    watermarkSettings?: Partial<WatermarkSettings>;
    metadata?: Partial<IPTCMetadata>;
  };
}

export interface CollectionStats {
  totalCollections: number;
  totalImages: number;
  collectionsByCategory: Record<string, number>;
  recentActivity: {
    date: Date;
    action: string;
    collection: string;
    details: string;
  }[];
  storageUsed: number;
  popularFormats: { format: string; count: number }[];
}

export class OutputCollectionService {
  private static instance: OutputCollectionService;
  private collections: Map<string, OutputCollection> = new Map();
  private templates: CollectionTemplate[] = [];
  private activityLog: CollectionStats['recentActivity'] = [];

  private readonly STORAGE_KEY = 'photo_editor_output_collections';
  private readonly VERSION = '1.0.0';

  private constructor() {
    this.initializeTemplates();
    this.loadCollections();
  }

  static getInstance(): OutputCollectionService {
    if (!OutputCollectionService.instance) {
      OutputCollectionService.instance = new OutputCollectionService();
    }
    return OutputCollectionService.instance;
  }

  private initializeTemplates() {
    this.templates = [
      {
        id: 'client-delivery',
        name: 'Client Delivery',
        description: 'Professional client delivery collection',
        category: 'client',
        defaultSettings: {
          exportOptions: {
            format: 'jpeg',
            quality: 95,
            colorSpace: 'srgb',
            bitDepth: 8,
            resizeMode: 'fit',
            maintainAspectRatio: true,
            preserveMetadata: true,
            outputSharpening: {
              enabled: true,
              amount: 75,
              radius: 1.0,
              threshold: 4,
              media: 'screen'
            }
          },
          watermarkSettings: {
            enabled: true,
            type: 'text',
            text: '© Your Studio',
            position: 'bottom-right',
            opacity: 0.6,
            scale: 1,
            offsetX: -20,
            offsetY: -20,
            blendMode: 'source-over',
            rotation: 0,
            padding: 10
          },
          metadata: {
            copyrightNotice: '© Your Studio. All rights reserved.',
            copyrightStatus: 'copyrighted',
            creator: 'Your Studio',
            rightsUsageTerms: 'Licensed for client use only'
          }
        }
      },
      {
        id: 'portfolio-web',
        name: 'Portfolio Web',
        description: 'Web-optimized portfolio collection',
        category: 'portfolio',
        defaultSettings: {
          exportOptions: {
            format: 'jpeg',
            quality: 85,
            width: 2048,
            height: 1365,
            colorSpace: 'srgb',
            bitDepth: 8,
            resizeMode: 'fit',
            maintainAspectRatio: true,
            preserveMetadata: false,
            outputSharpening: {
              enabled: true,
              amount: 80,
              radius: 0.8,
              threshold: 2,
              media: 'web'
            }
          },
          watermarkSettings: {
            enabled: true,
            type: 'text',
            text: 'yourname.com',
            position: 'bottom-center',
            opacity: 0.4,
            scale: 0.8,
            offsetX: 0,
            offsetY: -15,
            blendMode: 'soft-light',
            rotation: 0,
            padding: 5
          }
        }
      },
      {
        id: 'stock-submission',
        name: 'Stock Submission',
        description: 'Stock photography submission collection',
        category: 'stock',
        defaultSettings: {
          exportOptions: {
            format: 'jpeg',
            quality: 100,
            colorSpace: 'srgb',
            bitDepth: 8,
            resizeMode: 'fit',
            maintainAspectRatio: true,
            preserveMetadata: true,
            outputSharpening: {
              enabled: true,
              amount: 85,
              radius: 1.2,
              threshold: 0,
              media: 'print'
            }
          },
          metadata: {
            copyrightStatus: 'copyrighted',
            category: 'Stock',
            keywords: ['stock', 'commercial', 'royalty-free']
          }
        }
      },
      {
        id: 'print-collection',
        name: 'Print Collection',
        description: 'High-quality print collection',
        category: 'project',
        defaultSettings: {
          exportOptions: {
            format: 'tiff',
            compression: 'lzw',
            colorSpace: 'adobergb',
            bitDepth: 16,
            resizeMode: 'fit',
            maintainAspectRatio: true,
            preserveMetadata: true,
            outputSharpening: {
              enabled: true,
              amount: 90,
              radius: 1.5,
              threshold: 2,
              media: 'print'
            }
          }
        }
      },
      {
        id: 'social-media',
        name: 'Social Media',
        description: 'Social media optimized collection',
        category: 'personal',
        defaultSettings: {
          exportOptions: {
            format: 'jpeg',
            quality: 80,
            width: 1080,
            height: 1080,
            colorSpace: 'srgb',
            bitDepth: 8,
            resizeMode: 'crop',
            maintainAspectRatio: false,
            preserveMetadata: false,
            outputSharpening: {
              enabled: true,
              amount: 70,
              radius: 0.6,
              threshold: 3,
              media: 'web'
            }
          },
          watermarkSettings: {
            enabled: true,
            type: 'text',
            text: '@yourhandle',
            position: 'bottom-left',
            opacity: 0.8,
            scale: 0.7,
            offsetX: 15,
            offsetY: -15,
            blendMode: 'source-over',
            rotation: 0,
            padding: 0
          }
        }
      }
    ];
  }

  /**
   * Load persisted collections from localStorage (house convention, see
   * PresetService.loadPresets). Date fields are revived back into live Date
   * objects so getCollections()'s `.getTime()` sort does not throw.
   */
  private loadCollections() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        logger.debug('No persisted output collections found');
        return;
      }

      const data = JSON.parse(stored);
      for (const raw of data.collections || []) {
        const collection = this.reviveCollection(raw);
        this.collections.set(collection.id, collection);
      }

      if (Array.isArray(data.activityLog)) {
        this.activityLog = data.activityLog.map(
          (entry: CollectionStats['recentActivity'][number]) => ({
            ...entry,
            date: new Date(entry.date)
          })
        );
      }

      logger.info(`Loaded ${this.collections.size} output collections from storage`);
    } catch (error) {
      logger.error('Failed to load output collections from storage:', error);
    }
  }

  /**
   * Persist collections + activity log to localStorage. Wrapped in try/catch so
   * a QuotaExceededError degrades gracefully instead of crashing a mutator.
   */
  private saveCollections() {
    try {
      const data = {
        version: this.VERSION,
        collections: Array.from(this.collections.values()),
        activityLog: this.activityLog
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to save output collections to storage:', error);
    }
  }

  /**
   * Revive a collection parsed from JSON: JSON.parse turns every Date into an
   * ISO string, so each live-Date field (including nested images, export
   * history and client deadline) must be wrapped back into `new Date(...)`.
   */
  private reviveCollection(raw: OutputCollection): OutputCollection {
    return {
      ...raw,
      createdDate: new Date(raw.createdDate),
      modifiedDate: new Date(raw.modifiedDate),
      lastExportDate: raw.lastExportDate ? new Date(raw.lastExportDate) : undefined,
      images: (raw.images || []).map((image) => ({
        ...image,
        addedDate: new Date(image.addedDate),
        lastExported: image.lastExported ? new Date(image.lastExported) : undefined
      })),
      exportHistory: (raw.exportHistory || []).map((record) => ({
        ...record,
        date: new Date(record.date)
      })),
      clientInfo: raw.clientInfo
        ? {
            ...raw.clientInfo,
            deadline: raw.clientInfo.deadline
              ? new Date(raw.clientInfo.deadline)
              : undefined
          }
        : undefined
    };
  }

  /**
   * Create a new collection
   */
  createCollection(
    name: string,
    description: string,
    category: OutputCollection['category'],
    templateId?: string
  ): string {
    const id = `collection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let defaultSettings: ExportOptions = {
      format: 'jpeg',
      quality: 85,
      compression: 'none',
      colorSpace: 'srgb',
      bitDepth: 8,
      resizeMode: 'fit',
      maintainAspectRatio: true,
      preserveMetadata: true,
      includeProcessingHistory: false,
      customMetadata: {},
      outputSharpening: {
        enabled: true,
        amount: 75,
        radius: 1.0,
        threshold: 4,
        media: 'screen'
      }
    };

    let defaultWatermark: WatermarkSettings | undefined;
    let defaultMetadata: Partial<IPTCMetadata> | undefined;

    // Apply template if specified
    if (templateId) {
      const template = this.templates.find(t => t.id === templateId);
      if (template) {
        defaultSettings = { ...defaultSettings, ...template.defaultSettings.exportOptions };
        defaultWatermark = template.defaultSettings.watermarkSettings as WatermarkSettings;
        defaultMetadata = template.defaultSettings.metadata;
      }
    }

    const collection: OutputCollection = {
      id,
      name,
      description,
      category,
      createdDate: new Date(),
      modifiedDate: new Date(),
      images: [],
      defaultExportSettings: defaultSettings,
      defaultWatermarkSettings: defaultWatermark,
      defaultMetadata,
      tags: [],
      totalExports: 0,
      exportHistory: [],
      isPublic: false
    };

    this.collections.set(id, collection);
    this.logActivity('created', name, `New ${category} collection created`);
    this.saveCollections();

    logger.info(`Created collection: ${name} (${id})`);
    return id;
  }

  /**
   * Get all collections
   */
  getCollections(): OutputCollection[] {
    return Array.from(this.collections.values())
      .sort((a, b) => b.modifiedDate.getTime() - a.modifiedDate.getTime());
  }

  /**
   * Get collection by ID
   */
  getCollection(id: string): OutputCollection | null {
    return this.collections.get(id) || null;
  }

  /**
   * Get collections by category
   */
  getCollectionsByCategory(category: string): OutputCollection[] {
    return this.getCollections().filter(c => c.category === category);
  }

  /**
   * Update collection
   */
  updateCollection(id: string, updates: Partial<OutputCollection>): boolean {
    const collection = this.collections.get(id);
    if (!collection) return false;

    const updatedCollection = {
      ...collection,
      ...updates,
      modifiedDate: new Date()
    };

    this.collections.set(id, updatedCollection);
    this.logActivity('updated', collection.name, 'Collection settings updated');
    this.saveCollections();

    logger.info(`Updated collection: ${collection.name}`);
    return true;
  }

  /**
   * Delete collection
   */
  deleteCollection(id: string): boolean {
    const collection = this.collections.get(id);
    if (!collection) return false;

    this.collections.delete(id);
    this.logActivity('deleted', collection.name, 'Collection deleted');
    this.saveCollections();

    logger.info(`Deleted collection: ${collection.name}`);
    return true;
  }

  /**
   * Add image to collection
   */
  addImageToCollection(collectionId: string, imagePath: string, name: string): string | null {
    const collection = this.collections.get(collectionId);
    if (!collection) return null;

    const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const outputImage: OutputImage = {
      id: imageId,
      originalPath: imagePath,
      name,
      addedDate: new Date(),
      tags: [],
      status: 'pending'
    };

    collection.images.push(outputImage);
    collection.modifiedDate = new Date();

    this.logActivity('added_image', collection.name, `Added ${name} to collection`);
    this.saveCollections();
    logger.info(`Added image to collection: ${name} -> ${collection.name}`);

    return imageId;
  }

  /**
   * Remove image from collection
   */
  removeImageFromCollection(collectionId: string, imageId: string): boolean {
    const collection = this.collections.get(collectionId);
    if (!collection) return false;

    const imageIndex = collection.images.findIndex(img => img.id === imageId);
    if (imageIndex === -1) return false;

    const image = collection.images[imageIndex];
    collection.images.splice(imageIndex, 1);
    collection.modifiedDate = new Date();

    this.logActivity('removed_image', collection.name, `Removed ${image.name} from collection`);
    this.saveCollections();
    logger.info(`Removed image from collection: ${image.name} <- ${collection.name}`);

    return true;
  }

  /**
   * Update image in collection
   */
  updateImageInCollection(
    collectionId: string,
    imageId: string,
    updates: Partial<OutputImage>
  ): boolean {
    const collection = this.collections.get(collectionId);
    if (!collection) return false;

    const imageIndex = collection.images.findIndex(img => img.id === imageId);
    if (imageIndex === -1) return false;

    collection.images[imageIndex] = {
      ...collection.images[imageIndex],
      ...updates
    };
    collection.modifiedDate = new Date();
    this.saveCollections();

    return true;
  }

  /**
   * Export collection
   */
  async exportCollection(
    collectionId: string,
    destination: string,
    options?: {
      overrideSettings?: Partial<ExportOptions>;
      selectedImages?: string[];
      callback?: (progress: number, current: string) => void;
    }
  ): Promise<ExportRecord> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }

    const startTime = performance.now();
    const imagesToExport = options?.selectedImages
      ? collection.images.filter(img => options.selectedImages!.includes(img.id))
      : collection.images;

    const exportSettings = {
      ...collection.defaultExportSettings,
      ...options?.overrideSettings,
      outputDirectory: destination
    };

    logger.info(`Starting collection export: ${collection.name} (${imagesToExport.length} images)`);

    let totalSize = 0;
    let successCount = 0;
    let lastError: string | undefined;

    try {
      for (let i = 0; i < imagesToExport.length; i++) {
        const image = imagesToExport[i];

        if (options?.callback) {
          options.callback((i / imagesToExport.length) * 100, image.name);
        }

        try {
          // Update image status
          this.updateImageInCollection(collectionId, image.id, { status: 'processing' });

          // Decode the source file to RGBA Float32 pixels (handles RAW via the
          // main-process decoder). decodeForExport runs the same RAW/regular
          // decode as loadImage but with NO editor side effects: it does not set
          // imageService.currentImage, snapshot the original, populate the cache
          // or fire notifyImageLoaded(). This keeps the user's open image on
          // screen and avoids a per-image reprocess/remount during batch export.
          //
          // LIMITATION (cp-2): these are UNEDITED source pixels — the editor's
          // adjustment pipeline (WB/exposure/tone-curve/crop) is NOT applied
          // here because OutputImage carries no per-image pipeline state to
          // replay. The export below resizes/sharpens/watermarks the source as
          // decoded. The honest disclosure is surfaced via the ExportRecord
          // warnings field so a plain "success" does not imply edited output.
          const loaded = await imageService.decodeForExport(image.originalPath);

          // Per-image settings: collection defaults, then per-image overrides.
          // Watermark falls back to the collection default when the image has none.
          const perImageSettings: ExportOptions = {
            ...exportSettings,
            watermark: image.watermarkSettings ?? collection.defaultWatermarkSettings,
            ...(image.exportSettings ?? {})
          };

          const result: ExportResult = await exportService.exportImage(
            loaded.data,
            loaded.width,
            loaded.height,
            perImageSettings,
            image.originalPath
          );

          if (!result.success) {
            throw new Error(result.error || 'Export failed');
          }

          // Update image status and info from the real export result.
          this.updateImageInCollection(collectionId, image.id, {
            status: 'completed',
            lastExported: new Date(),
            exportPath: result.outputPath,
            fileSize: result.outputSize
          });

          successCount++;
          totalSize += result.outputSize ?? 0;

        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          this.updateImageInCollection(collectionId, image.id, { status: 'error' });
          logger.error(`Failed to export image: ${image.name}`, error);
        }
      }

      const duration = performance.now() - startTime;
      const success = successCount === imagesToExport.length;

      // Create export record. Collection export writes source pixels without
      // replaying the editor's adjustment pipeline (no per-image pipeline state
      // is persisted on OutputImage), so disclose that on the record rather than
      // silently implying an edited deliverable.
      const exportRecord: ExportRecord = {
        id: `export-${Date.now()}`,
        date: new Date(),
        imageCount: successCount,
        format: exportSettings.format,
        destination,
        totalSize,
        duration,
        success,
        error: lastError,
        warnings:
          successCount > 0
            ? ['Exported from source — editor adjustments not applied']
            : undefined
      };

      // Update collection
      collection.exportHistory.push(exportRecord);
      collection.totalExports++;
      collection.lastExportDate = new Date();
      collection.modifiedDate = new Date();

      this.logActivity('exported', collection.name,
        `Exported ${successCount}/${imagesToExport.length} images`);
      this.saveCollections();

      logger.info(`Collection export completed: ${successCount}/${imagesToExport.length} images, ${duration.toFixed(2)}ms`);

      return exportRecord;

    } catch (error) {
      logger.error('Collection export failed:', error);
      throw error;
    }
  }

  /**
   * Get collection templates
   */
  getTemplates(): CollectionTemplate[] {
    return [...this.templates];
  }

  /**
   * Get collection statistics
   */
  getStatistics(): CollectionStats {
    const collections = this.getCollections();
    const collectionsByCategory: Record<string, number> = {};
    let totalImages = 0;
    let storageUsed = 0;
    const formatCounts: Record<string, number> = {};

    for (const collection of collections) {
      collectionsByCategory[collection.category] = (collectionsByCategory[collection.category] || 0) + 1;
      totalImages += collection.images.length;

      for (const image of collection.images) {
        if (image.fileSize) {
          storageUsed += image.fileSize;
        }
      }

      // Count formats from export history
      for (const exportRecord of collection.exportHistory) {
        formatCounts[exportRecord.format] = (formatCounts[exportRecord.format] || 0) + exportRecord.imageCount;
      }
    }

    const popularFormats = Object.entries(formatCounts)
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalCollections: collections.length,
      totalImages,
      collectionsByCategory,
      recentActivity: [...this.activityLog].reverse().slice(0, 10),
      storageUsed,
      popularFormats
    };
  }

  /**
   * Search collections
   */
  searchCollections(query: string): OutputCollection[] {
    const lowerQuery = query.toLowerCase();
    return this.getCollections().filter(collection =>
      collection.name.toLowerCase().includes(lowerQuery) ||
      collection.description.toLowerCase().includes(lowerQuery) ||
      collection.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      collection.clientInfo?.name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Duplicate collection
   */
  duplicateCollection(id: string, newName?: string): string | null {
    const original = this.collections.get(id);
    if (!original) return null;

    const duplicateId = this.createCollection(
      newName || `${original.name} (Copy)`,
      original.description,
      original.category
    );

    const duplicate = this.collections.get(duplicateId)!;

    // Copy settings but not images
    duplicate.defaultExportSettings = { ...original.defaultExportSettings };
    duplicate.defaultWatermarkSettings = original.defaultWatermarkSettings ?
      { ...original.defaultWatermarkSettings } : undefined;
    duplicate.defaultMetadata = original.defaultMetadata ?
      { ...original.defaultMetadata } : undefined;
    duplicate.tags = [...original.tags];

    this.logActivity('duplicated', duplicate.name, `Duplicated from ${original.name}`);
    this.saveCollections();

    return duplicateId;
  }

  /**
   * Export collection metadata to JSON
   */
  exportCollectionMetadata(id: string): string | null {
    const collection = this.collections.get(id);
    if (!collection) return null;

    const metadata = {
      collection: {
        name: collection.name,
        description: collection.description,
        category: collection.category,
        tags: collection.tags,
        defaultExportSettings: collection.defaultExportSettings,
        defaultWatermarkSettings: collection.defaultWatermarkSettings,
        defaultMetadata: collection.defaultMetadata
      },
      images: collection.images.map(img => ({
        name: img.name,
        tags: img.tags,
        notes: img.notes,
        addedDate: img.addedDate
      }))
    };

    return JSON.stringify(metadata, null, 2);
  }

  /**
   * Log activity
   */
  private logActivity(action: string, collection: string, details: string) {
    this.activityLog.push({
      date: new Date(),
      action,
      collection,
      details
    });

    // Keep only recent 100 activities
    if (this.activityLog.length > 100) {
      this.activityLog.shift();
    }
  }
}

// Export singleton instance
export const outputCollectionService = OutputCollectionService.getInstance();