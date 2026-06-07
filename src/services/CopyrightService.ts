import { logger } from '../utils/Logger';
import { isElectron, EmbeddableMetadata } from '../types/electron';

/**
 * Minimal structural shape of an exifreader tag. exifreader decodes string tags
 * into `.description`; XMP tags carry `.value` (string | child tags | object).
 * We only read the two fields the mapper needs, so a narrow local type avoids a
 * hard dependency on exifreader's full declaration here.
 */
interface ExifReaderTag {
  description?: unknown;
  value?: unknown;
}

type ExifReaderTagMap = Record<string, ExifReaderTag | ExifReaderTag[] | undefined>;

/** The single bridge method extractMetadata depends on. */
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
 * Return a shallow copy of `obj` with all keys whose value is undefined removed,
 * so consumers (summary/validation) only see populated fields.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

// IPTC Core Schema fields
export interface IPTCMetadata {
  // Creator Information
  creator?: string;
  creatorJobTitle?: string;
  creatorAddress?: string;
  creatorCity?: string;
  creatorState?: string;
  creatorPostalCode?: string;
  creatorCountry?: string;
  creatorPhone?: string;
  creatorEmail?: string;
  creatorWebsite?: string;

  // Image Information
  title?: string;
  description?: string;
  keywords?: string[];
  category?: string;
  urgency?: number; // 1-8

  // Copyright Information
  copyrightNotice?: string;
  copyrightStatus?: 'copyrighted' | 'public-domain' | 'unknown';
  rightsUsageTerms?: string;
  webStatement?: string;

  // Location Information
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  location?: string;
  sublocation?: string;

  // Date Information
  dateCreated?: Date;
  digitalCreationDate?: Date;

  // Technical Information
  captionWriter?: string;
  credit?: string;
  source?: string;
  headline?: string;
  instructions?: string;

  // Custom fields
  customFields?: Record<string, string>;
}

// XMP Dublin Core Schema
export interface XMPMetadata {
  title?: string;
  description?: string;
  creator?: string[];
  subject?: string[];
  rights?: string;
  format?: string;
  identifier?: string;
  language?: string;
  relation?: string;
  coverage?: string;

  // Custom XMP fields
  customNamespaces?: Record<string, Record<string, string>>;
}

export interface CopyrightTemplate {
  id: string;
  name: string;
  description: string;
  metadata: IPTCMetadata;
  category: 'personal' | 'commercial' | 'stock' | 'editorial' | 'custom';
}

export interface CopyrightPreset {
  id: string;
  name: string;
  description: string;
  iptc: Partial<IPTCMetadata>;
  xmp: Partial<XMPMetadata>;
}

export class CopyrightService {
  private static instance: CopyrightService;
  private templates: CopyrightTemplate[] = [];
  private presets: CopyrightPreset[] = [];

  private constructor() {
    this.initializeTemplates();
    this.initializePresets();
  }

  static getInstance(): CopyrightService {
    if (!CopyrightService.instance) {
      CopyrightService.instance = new CopyrightService();
    }
    return CopyrightService.instance;
  }

  private initializeTemplates() {
    this.templates = [
      {
        id: 'personal-photography',
        name: 'Personal Photography',
        description: 'Standard template for personal photography work',
        category: 'personal',
        metadata: {
          copyrightStatus: 'copyrighted',
          copyrightNotice: '© [Year] [Your Name]. All rights reserved.',
          rightsUsageTerms: 'Contact photographer for usage rights',
          creator: 'Your Name',
          creatorJobTitle: 'Photographer',
          keywords: ['photography', 'personal'],
          category: 'Personal'
        }
      },
      {
        id: 'commercial-photography',
        name: 'Commercial Photography',
        description: 'Template for commercial and client work',
        category: 'commercial',
        metadata: {
          copyrightStatus: 'copyrighted',
          copyrightNotice: '© [Year] [Your Name/Studio]. All rights reserved.',
          rightsUsageTerms: 'Commercial use requires license agreement',
          creator: 'Your Studio Name',
          creatorJobTitle: 'Commercial Photographer',
          keywords: ['commercial', 'photography', 'professional'],
          category: 'Commercial',
          credit: 'Your Studio Name'
        }
      },
      {
        id: 'stock-photography',
        name: 'Stock Photography',
        description: 'Template optimized for stock photography',
        category: 'stock',
        metadata: {
          copyrightStatus: 'copyrighted',
          copyrightNotice: '© [Year] [Your Name]. Licensed for stock use.',
          rightsUsageTerms: 'Royalty-free license available',
          creator: 'Your Name',
          creatorJobTitle: 'Stock Photographer',
          keywords: ['stock', 'commercial', 'license'],
          category: 'Stock'
        }
      },
      {
        id: 'editorial-photography',
        name: 'Editorial Photography',
        description: 'Template for editorial and news photography',
        category: 'editorial',
        metadata: {
          copyrightStatus: 'copyrighted',
          copyrightNotice: '© [Year] [Your Name]. Editorial use only.',
          rightsUsageTerms: 'Editorial use only - no commercial use',
          creator: 'Your Name',
          creatorJobTitle: 'Editorial Photographer',
          keywords: ['editorial', 'news', 'journalism'],
          category: 'Editorial',
          urgency: 5
        }
      }
    ];
  }

  private initializePresets() {
    this.presets = [
      {
        id: 'minimal-copyright',
        name: 'Minimal Copyright',
        description: 'Basic copyright information only',
        iptc: {
          copyrightNotice: '© 2024 Your Name',
          copyrightStatus: 'copyrighted',
          creator: 'Your Name'
        },
        xmp: {
          rights: '© 2024 Your Name',
          creator: ['Your Name']
        }
      },
      {
        id: 'full-professional',
        name: 'Full Professional',
        description: 'Complete professional metadata set',
        iptc: {
          creator: 'Your Name',
          creatorJobTitle: 'Professional Photographer',
          creatorEmail: 'your.email@example.com',
          creatorWebsite: 'https://yourwebsite.com',
          copyrightNotice: '© 2024 Your Name. All rights reserved.',
          copyrightStatus: 'copyrighted',
          rightsUsageTerms: 'Contact photographer for licensing terms',
          webStatement: 'https://yourwebsite.com/copyright',
          credit: 'Your Name Photography',
          source: 'Your Studio'
        },
        xmp: {
          rights: '© 2024 Your Name. All rights reserved.',
          creator: ['Your Name'],
          format: 'image/jpeg'
        }
      },
      {
        id: 'creative-commons',
        name: 'Creative Commons',
        description: 'Creative Commons licensing preset',
        iptc: {
          copyrightNotice: '© 2024 Your Name. Licensed under CC BY-SA 4.0',
          copyrightStatus: 'copyrighted',
          rightsUsageTerms: 'Creative Commons Attribution-ShareAlike 4.0 International',
          webStatement: 'https://creativecommons.org/licenses/by-sa/4.0/'
        },
        xmp: {
          rights: 'Licensed under Creative Commons Attribution-ShareAlike 4.0',
          relation: 'https://creativecommons.org/licenses/by-sa/4.0/'
        }
      }
    ];
  }

  /**
   * Get all copyright templates
   */
  getTemplates(): CopyrightTemplate[] {
    return [...this.templates];
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: string): CopyrightTemplate[] {
    return this.templates.filter(template => template.category === category);
  }

  /**
   * Get all copyright presets
   */
  getPresets(): CopyrightPreset[] {
    return [...this.presets];
  }

  /**
   * Add custom template
   */
  addTemplate(template: Omit<CopyrightTemplate, 'id'>): string {
    const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTemplate: CopyrightTemplate = {
      ...template,
      id,
      category: 'custom'
    };
    this.templates.push(newTemplate);
    logger.info('Added custom copyright template:', newTemplate.name);
    return id;
  }

  /**
   * Add custom preset
   */
  addPreset(preset: Omit<CopyrightPreset, 'id'>): string {
    const id = `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newPreset: CopyrightPreset = {
      ...preset,
      id
    };
    this.presets.push(newPreset);
    logger.info('Added custom copyright preset:', newPreset.name);
    return id;
  }

  /**
   * Apply template variables (replace placeholders)
   */
  applyTemplateVariables(
    metadata: IPTCMetadata,
    variables: Record<string, string>
  ): IPTCMetadata {
    const result: IPTCMetadata = {};

    // Default variables
    const defaultVariables = {
      '[Year]': new Date().getFullYear().toString(),
      '[Date]': new Date().toLocaleDateString(),
      '[Your Name]': variables['Your Name'] || 'Your Name',
      '[Your Studio]': variables['Your Studio'] || 'Your Studio',
      '[Your Email]': variables['Your Email'] || 'your.email@example.com',
      '[Your Website]': variables['Your Website'] || 'https://yourwebsite.com',
      ...variables
    };

    // Apply variables to all string fields
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        let processedValue = value;
        for (const [variable, replacement] of Object.entries(defaultVariables)) {
          processedValue = processedValue.replace(new RegExp(variable.replace(/[[\]]/g, '\\$&'), 'g'), replacement);
        }
        (result as Record<string, unknown>)[key] = processedValue;
      } else {
        (result as Record<string, unknown>)[key] = value;
      }
    }

    return result;
  }

  /**
   * Extract IPTC/EXIF/XMP metadata from an image file by reading it through the
   * main-process exifreader IPC (read-image-metadata) and mapping the returned
   * tag shapes onto IPTCMetadata + XMPMetadata. Returns null on any failure or
   * when the desktop bridge is unavailable.
   */
  async extractMetadata(filePath: string): Promise<{ iptc: IPTCMetadata; xmp: XMPMetadata } | null> {
    try {
      logger.debug(`Extracting metadata from: ${filePath}`);

      // contextIsolation keeps electronAPI off the typed Window in tests/web;
      // access via a cast, matching the existing renderer pattern.
      const api = (window as unknown as { electronAPI?: ElectronMetadataApi }).electronAPI;
      if (!api?.readImageMetadata) {
        logger.warn('Metadata extraction requires the desktop app');
        return null;
      }

      const md = await api.readImageMetadata(filePath);
      const exif: ExifReaderTagMap = md?.exif ?? {};
      const iptcTags: ExifReaderTagMap = md?.iptc ?? {};
      const xmpTags: ExifReaderTagMap = md?.xmp ?? {};

      // --- IPTC mapping ----------------------------------------------------
      const keywords = this.tagList(iptcTags['Keywords']);
      const copyrightNotice =
        this.tagStr(iptcTags['Copyright Notice']) ?? this.tagStr(exif['Copyright']);
      const creator =
        this.tagList(iptcTags['By-line'])[0] ?? this.tagStr(exif['Artist']);
      const dateCreated =
        this.iptcDate(iptcTags['Date Created'], iptcTags['Time Created']) ??
        this.exifDate(exif['DateTimeOriginal'] ?? exif['DateTimeDigitized']);

      const iptc: IPTCMetadata = {
        creator,
        creatorJobTitle: this.tagStr(iptcTags['By-line Title']),
        title: this.tagStr(iptcTags['Object Name']),
        description: this.tagStr(iptcTags['Caption/Abstract']),
        keywords: keywords.length > 0 ? keywords : undefined,
        category: this.tagStr(iptcTags['Category']),
        urgency: this.tagNumber(iptcTags['Urgency']),
        copyrightNotice,
        copyrightStatus: copyrightNotice ? 'copyrighted' : 'unknown',
        headline: this.tagStr(iptcTags['Headline']),
        credit: this.tagStr(iptcTags['Credit']),
        source: this.tagStr(iptcTags['Source']),
        instructions: this.tagStr(iptcTags['Special Instructions']),
        captionWriter: this.tagList(iptcTags['Writer/Editor'])[0],
        city: this.tagStr(iptcTags['City']),
        state: this.tagStr(iptcTags['Province/State']),
        country: this.tagStr(iptcTags['Country/Primary Location Name']),
        countryCode: this.tagStr(iptcTags['Country/Primary Location Code']),
        sublocation: this.tagStr(iptcTags['Sub-location']),
        dateCreated,
        digitalCreationDate: this.iptcDate(
          iptcTags['Digital Creation Date'],
          iptcTags['Digital Creation Time']
        )
      };

      // --- XMP mapping -----------------------------------------------------
      // exifreader (expanded) keys XMP tags by their BARE local name with the
      // original casing — NOT the namespace-prefixed form. dc:* tags become
      // {title,description,rights,creator,subject}, photoshop:* -> {Credit,Source},
      // xmpRights:* -> {UsageTerms,WebStatement}. (Verified by a write->read
      // round-trip through imageWriter.buildXmpPacket + sharp.withXmp.)
      const xmp: XMPMetadata = {
        title: this.xmpStr(xmpTags, 'title'),
        description: this.xmpStr(xmpTags, 'description'),
        creator: this.emptyToUndefined(this.xmpList(xmpTags, 'creator')),
        subject: this.emptyToUndefined(this.xmpList(xmpTags, 'subject')),
        rights: this.xmpStr(xmpTags, 'rights'),
        format: this.xmpStr(xmpTags, 'format') ?? this.getFormatFromPath(filePath),
        identifier: this.xmpStr(xmpTags, 'identifier'),
        language: this.xmpStr(xmpTags, 'language'),
        relation: this.xmpStr(xmpTags, 'relation'),
        coverage: this.xmpStr(xmpTags, 'coverage')
      };

      // Cross-fill IPTC rights fields from the XMP rights namespace when absent.
      // xmpRights tags are keyed by their bare local name with original casing.
      iptc.rightsUsageTerms =
        iptc.rightsUsageTerms ?? this.xmpStr(xmpTags, 'UsageTerms');
      iptc.webStatement =
        iptc.webStatement ?? this.xmpStr(xmpTags, 'WebStatement');

      logger.debug('Metadata extracted successfully');
      return {
        iptc: stripUndefined(iptc as unknown as Record<string, unknown>) as unknown as IPTCMetadata,
        xmp: stripUndefined(xmp as unknown as Record<string, unknown>) as unknown as XMPMetadata
      };

    } catch (error) {
      logger.error('Failed to extract metadata:', error);
      return null;
    }
  }

  /**
   * Read a scalar string from an exifreader tag. exifreader decodes EXIF/IPTC
   * string tags into `.description`; fall back to a string `.value`. Empty
   * strings collapse to undefined.
   */
  private tagStr(tag: ExifReaderTag | ExifReaderTag[] | undefined): string | undefined {
    if (!tag) return undefined;
    const one = Array.isArray(tag) ? tag[0] : tag;
    if (!one) return undefined;
    const raw =
      typeof one.description === 'string'
        ? one.description
        : typeof one.value === 'string'
          ? one.value
          : undefined;
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  /**
   * Normalize a repeatable IPTC tag into a string list. exifreader returns such
   * tags as EITHER a single tag object OR an array of tag objects; handle both.
   */
  private tagList(tag: ExifReaderTag | ExifReaderTag[] | undefined): string[] {
    if (tag === undefined) return [];
    const tags = Array.isArray(tag) ? tag : [tag];
    return tags
      .map(t => this.tagStr(t))
      .filter((s): s is string => s !== undefined);
  }

  /**
   * Read a numeric IPTC tag (e.g. Urgency). Values arrive as decoded strings.
   */
  private tagNumber(tag: ExifReaderTag | ExifReaderTag[] | undefined): number | undefined {
    const s = this.tagStr(tag);
    if (s === undefined) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }

  /**
   * Parse an IPTC date ('YYYY-MM-DD') optionally combined with an IPTC time,
   * into a Date. Returns undefined when absent or unparseable.
   */
  private iptcDate(
    dateTag: ExifReaderTag | ExifReaderTag[] | undefined,
    timeTag?: ExifReaderTag | ExifReaderTag[] | undefined
  ): Date | undefined {
    const date = this.tagStr(dateTag);
    if (!date) return undefined;
    const time = this.tagStr(timeTag);
    const iso = time ? `${date}T${time}` : date;
    const parsed = new Date(iso);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * Parse an EXIF datetime ('YYYY:MM:DD HH:MM:SS') into a Date. The date portion
   * uses colon separators, so swap the first two colons for hyphens first.
   */
  private exifDate(tag: ExifReaderTag | ExifReaderTag[] | undefined): Date | undefined {
    const s = this.tagStr(tag);
    if (!s) return undefined;
    const normalized = s.replace(':', '-').replace(':', '-');
    const parsed = new Date(normalized);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * Read a scalar string from an XMP tag. XmpTag.value may be a string, an
   * array of child tags, or a nested object; prefer `.description`, then a
   * string `.value`.
   */
  private xmpStr(tags: ExifReaderTagMap, key: string): string | undefined {
    const raw = tags[key];
    if (!raw) return undefined;
    const tag = Array.isArray(raw) ? raw[0] : raw;
    if (!tag) return undefined;
    if (typeof tag.description === 'string' && tag.description.trim() !== '') {
      return tag.description.trim();
    }
    if (typeof tag.value === 'string') {
      const trimmed = tag.value.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return undefined;
  }

  /**
   * Read a string list from an XMP tag (e.g. dc:creator, dc:subject). The value
   * is typically an array of child XmpTags; map each child's `.value`/`.description`.
   */
  private xmpList(tags: ExifReaderTagMap, key: string): string[] {
    const raw = tags[key];
    if (!raw) return [];
    const tag = Array.isArray(raw) ? raw[0] : raw;
    if (!tag) return [];
    const value = tag.value;
    if (Array.isArray(value)) {
      return value
        .map(child => {
          if (typeof child === 'string') return child.trim();
          if (child && typeof (child as ExifReaderTag).value === 'string') {
            return ((child as ExifReaderTag).value as string).trim();
          }
          if (child && typeof (child as ExifReaderTag).description === 'string') {
            return ((child as ExifReaderTag).description as string).trim();
          }
          return '';
        })
        .filter((s): s is string => s !== '');
    }
    // Single-value fallback.
    const single = this.xmpStr(tags, key);
    return single ? [single] : [];
  }

  /** Collapse an empty array to undefined (so stripUndefined drops the key). */
  private emptyToUndefined<T>(arr: T[]): T[] | undefined {
    return arr.length > 0 ? arr : undefined;
  }

  /**
   * Embed IPTC/XMP/EXIF metadata into an existing image file via the
   * main-process writer (sharp withExif/withXmp). Only available under Electron;
   * in a non-Electron context this is a no-op that returns false.
   */
  async embedMetadata(
    filePath: string,
    iptcData: IPTCMetadata,
    xmpData: XMPMetadata
  ): Promise<boolean> {
    try {
      if (!isElectron() || !window.electronAPI?.writeImageMetadata) {
        logger.warn('Metadata embedding requires the desktop app');
        return false;
      }

      logger.info(`Embedding metadata into: ${filePath}`);

      const payload = this.toEmbeddableMetadata(iptcData, xmpData);
      if (!payload.exif && !payload.xmp) {
        logger.warn('No embeddable metadata fields present; nothing to write');
        return false;
      }

      const success = await window.electronAPI.writeImageMetadata(filePath, payload);

      if (success) {
        logger.info('Metadata embedded successfully');
      }
      return success;

    } catch (error) {
      logger.error('Failed to embed metadata:', error);
      return false;
    }
  }

  /**
   * Generate metadata summary for display
   */
  generateMetadataSummary(iptc: IPTCMetadata, _xmp: XMPMetadata): string {
    const summary: string[] = [];

    if (iptc.copyrightNotice) {
      summary.push(`Copyright: ${iptc.copyrightNotice}`);
    }

    if (iptc.creator) {
      summary.push(`Creator: ${iptc.creator}`);
    }

    if (iptc.title) {
      summary.push(`Title: ${iptc.title}`);
    }

    if (iptc.keywords && iptc.keywords.length > 0) {
      summary.push(`Keywords: ${iptc.keywords.slice(0, 5).join(', ')}${iptc.keywords.length > 5 ? '...' : ''}`);
    }

    if (iptc.location) {
      summary.push(`Location: ${iptc.location}`);
    }

    return summary.join('\n');
  }

  /**
   * Validate metadata completeness
   */
  validateMetadata(iptc: IPTCMetadata): { valid: boolean; warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check required fields for professional use
    if (!iptc.copyrightNotice) {
      errors.push('Copyright notice is required');
    }

    if (!iptc.creator) {
      errors.push('Creator name is required');
    }

    if (!iptc.copyrightStatus) {
      warnings.push('Copyright status should be specified');
    }

    // Check recommended fields
    if (!iptc.rightsUsageTerms) {
      warnings.push('Rights usage terms are recommended');
    }

    if (!iptc.creatorEmail && !iptc.creatorWebsite) {
      warnings.push('Contact information (email or website) is recommended');
    }

    if (!iptc.keywords || iptc.keywords.length === 0) {
      warnings.push('Keywords help with searchability');
    }

    // Check field lengths (IPTC limits)
    if (iptc.title && iptc.title.length > 64) {
      warnings.push('Title should be 64 characters or less');
    }

    if (iptc.description && iptc.description.length > 2000) {
      warnings.push('Description should be 2000 characters or less');
    }

    if (iptc.keywords && iptc.keywords.some(k => k.length > 64)) {
      warnings.push('Keywords should be 64 characters or less each');
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Export metadata to JSON
   */
  exportMetadata(iptc: IPTCMetadata, xmp: XMPMetadata): string {
    return JSON.stringify({ iptc, xmp }, null, 2);
  }

  /**
   * Import metadata from JSON
   */
  importMetadata(json: string): { iptc: IPTCMetadata; xmp: XMPMetadata } {
    try {
      const data = JSON.parse(json);
      return {
        iptc: data.iptc || {},
        xmp: data.xmp || {}
      };
    } catch (error) {
      logger.error('Failed to import metadata:', error);
      throw new Error('Invalid metadata JSON format');
    }
  }

  /**
   * Get file format from path
   */
  private getFormatFromPath(filePath: string): string {
    const extension = filePath.toLowerCase().split('.').pop();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'tiff':
      case 'tif':
        return 'image/tiff';
      case 'webp':
        return 'image/webp';
      case 'dng':
        return 'image/dng';
      case 'cr2':
      case 'cr3':
        return 'image/x-canon-cr2';
      case 'nef':
        return 'image/x-nikon-nef';
      case 'arw':
        return 'image/x-sony-arw';
      default:
        return 'image/unknown';
    }
  }

  /**
   * Generate IPTC/XMP compatible date string
   */
  formatDateForMetadata(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  /**
   * Format a date as an EXIF DateTimeOriginal string: 'YYYY:MM:DD HH:MM:SS'.
   * EXIF uses colon-separated date components, not the ISO hyphen format.
   */
  formatDateForExif(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const y = date.getFullYear();
    const mo = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const mi = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${y}:${mo}:${d} ${h}:${mi}:${s}`;
  }

  /**
   * Map the module's IPTC/XMP metadata onto the writer's embeddable shape
   * ({ exif, xmp }) consumed by the main-process image writer.
   *
   * EXIF carries the universally-readable copyright/artist tags (Windows
   * Explorer, most viewers read these). The rest of the IPTC/XMP fields are
   * expressed as XMP namespaces (dc:*, photoshop:*, xmpRights:*), which is the
   * accepted modern equivalent of legacy IPTC-IIM and what this app's own
   * reader consumes back.
   */
  toEmbeddableMetadata(iptc: IPTCMetadata, xmp: XMPMetadata): EmbeddableMetadata {
    const exif: NonNullable<EmbeddableMetadata['exif']> = {};
    if (iptc.copyrightNotice) exif.Copyright = iptc.copyrightNotice;
    if (iptc.creator) exif.Artist = iptc.creator;
    const description = iptc.description ?? xmp.description;
    if (description) exif.ImageDescription = description;
    if (iptc.dateCreated instanceof Date && !isNaN(iptc.dateCreated.getTime())) {
      exif.DateTimeOriginal = this.formatDateForExif(iptc.dateCreated);
    }

    const xmpOut: NonNullable<EmbeddableMetadata['xmp']> = {};
    const rights = iptc.copyrightNotice ?? xmp.rights;
    if (rights) xmpOut.rights = rights;
    // dc:creator is a list; prefer the XMP creator array, fall back to IPTC.
    const creator = xmp.creator && xmp.creator.length > 0
      ? xmp.creator
      : (iptc.creator ? [iptc.creator] : undefined);
    if (creator && creator.length > 0) xmpOut.creator = creator;
    const title = iptc.title ?? xmp.title;
    if (title) xmpOut.title = title;
    if (description) xmpOut.description = description;
    const subject = (xmp.subject && xmp.subject.length > 0) ? xmp.subject : iptc.keywords;
    if (subject && subject.length > 0) xmpOut.subject = subject;
    if (iptc.credit) xmpOut.credit = iptc.credit;
    if (iptc.source) xmpOut.source = iptc.source;
    if (iptc.webStatement) xmpOut.webStatement = iptc.webStatement;
    if (iptc.rightsUsageTerms) xmpOut.usageTerms = iptc.rightsUsageTerms;

    const result: EmbeddableMetadata = {};
    if (Object.keys(exif).length > 0) result.exif = exif;
    if (Object.keys(xmpOut).length > 0) result.xmp = xmpOut;
    return result;
  }

  /**
   * Merge metadata from multiple sources
   */
  mergeMetadata(...metadataObjects: Partial<IPTCMetadata>[]): IPTCMetadata {
    const result: IPTCMetadata = {};

    for (const metadata of metadataObjects) {
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null && value !== '') {
          if (key === 'keywords' && Array.isArray(value)) {
            // Merge keyword arrays
            const existing = result.keywords || [];
            result.keywords = [...new Set([...existing, ...value])];
          } else {
            (result as Record<string, unknown>)[key] = value;
          }
        }
      }
    }

    return result;
  }
}

// Export singleton instance
export const copyrightService = CopyrightService.getInstance();