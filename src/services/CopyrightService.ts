import { logger } from '../utils/Logger';

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
        (result as any)[key] = processedValue;
      } else {
        (result as any)[key] = value;
      }
    }

    return result;
  }

  /**
   * Extract metadata from image file (simulated - would use exifr or similar in production)
   */
  async extractMetadata(filePath: string): Promise<{ iptc: IPTCMetadata; xmp: XMPMetadata } | null> {
    try {
      logger.debug(`Extracting metadata from: ${filePath}`);

      // In a real implementation, this would use a library like exifr, piexifjs, or node-exif
      // For now, we'll return a basic structure

      const basicMetadata = {
        iptc: {
          dateCreated: new Date(),
          digitalCreationDate: new Date()
        } as IPTCMetadata,
        xmp: {
          format: this.getFormatFromPath(filePath)
        } as XMPMetadata
      };

      logger.debug('Metadata extracted successfully');
      return basicMetadata;

    } catch (error) {
      logger.error('Failed to extract metadata:', error);
      return null;
    }
  }

  /**
   * Embed metadata into image (simulated)
   */
  async embedMetadata(
    filePath: string,
    iptcData: IPTCMetadata,
    xmpData: XMPMetadata
  ): Promise<boolean> {
    try {
      logger.info(`Embedding metadata into: ${filePath}`);

      // In a real implementation, this would use a library to write IPTC/XMP data
      // For now, we'll simulate the process

      const metadataSize = JSON.stringify({ iptc: iptcData, xmp: xmpData }).length;

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));

      logger.info(`Metadata embedded successfully (${metadataSize} bytes)`);
      return true;

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
            (result as any)[key] = value;
          }
        }
      }
    }

    return result;
  }
}

// Export singleton instance
export const copyrightService = CopyrightService.getInstance();