import { logger } from '../utils/Logger';
import { imageProcessingPipeline } from './ImageProcessingPipeline';
import { imageService } from './ImageService';
import { notificationService } from './NotificationService';
import { sanitizeImportedPreset } from './presetShapeValidation';
import { formatSkippedNames } from '../components/Dialogs/formatSkippedNames';
import type { LocalAdjustmentsPipelineModule } from '../modules/LocalAdjustmentsPipelineModule';
import type { LocalAdjustmentLayer, LocalAdjustmentParams, MaskGeometry } from '../modules/LocalAdjustmentsModule';

/**
 * A local-adjustment layer serialized into a preset. Mirrors EditPersistenceService's
 * per-image SerializedLayer: geometry is normalized 0..1 so it is resolution-independent
 * and rebuilds into a pixel mask at process time. The painted Float32 mask itself is NOT
 * stored — which is why brush layers (whose mask is painted, not geometry-derived) are
 * excluded from presets (see captureCurrentSettings / hasUnportableBrushLayers).
 */
export interface PresetLocalAdjustmentLayer {
  name: string;
  type: LocalAdjustmentLayer['type'];
  enabled: boolean;
  opacity: number;
  geometry?: MaskGeometry;
  basicAdj?: Record<string, number>;
  parameters?: Record<string, unknown>;
}

interface ModuleInterface {
  // Every real PipelineModule (see ImageProcessingPipeline.ts) exposes `isEnabled` as a
  // property (a public field or getter) — never a callable. `isEnabled?: boolean` was
  // previously typed as a method (`isEnabled?(): boolean`), so `moduleInterface.isEnabled?.()`
  // only "worked" for modules with NO isEnabled field at all (exposure/temperature/basicadj,
  // where the optional call short-circuited); modules that DO carry the field as a boolean
  // (tonecurve/colorbalance/shadowshighlights/highlightrecovery) threw "is not a function",
  // silently dropping their capture (caught by the per-module try/catch below). Fixed here.
  isEnabled?: boolean;
  getParameters?(): Record<string, unknown>;
  getParams?(): Record<string, unknown>;
  setParameters?(params: Record<string, unknown>): void;
  setParams?(params: Record<string, unknown>): void;
}

export interface AdjustmentPreset {
  id: string;
  name: string;
  description: string;
  author?: string;
  category: 'portrait' | 'landscape' | 'street' | 'bw' | 'vintage' | 'cinematic' | 'custom';
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  thumbnail?: string; // Base64 encoded thumbnail
  settings: PresetSettings;
  metadata: {
    version: string;
    compatibility: string[];
    imageCount?: number; // How many images this preset was applied to
    rating?: number; // User rating 1-5
  };
}

export interface PresetSettings {
  // Lens Corrections
  lensCorrections?: {
    enabled: boolean;
    vignetting: {
      enabled: boolean;
      amount: number;
      midpoint: number;
      roundness: number;
      feather: number;
    };
    distortion: {
      enabled: boolean;
      barrel: number;
      perspective: { horizontal: number; vertical: number };
      scale: number;
    };
    chromaticAberration: {
      enabled: boolean;
      redCyan: number;
      blueMagenta: number;
      purple: { amount: number; hue: number; range: number };
      green: { amount: number; hue: number; range: number };
    };
  };

  // Exposure
  exposure?: {
    enabled: boolean;
    mode: string;
    black: number;
    exposure: number;
    deflicker_percentile: number;
    compensate_exposure_bias: boolean;
  };

  // White Balance
  whiteBalance?: {
    enabled: boolean;
    temperature: number;
    tint: number;
    preset: string;
  };

  // Basic Adjustments
  basicAdjustments?: {
    enabled: boolean;
    black_point: number;
    exposure: number;
    contrast: number;
    brightness: number;
    saturation: number;
    vibrance: number;
  };

  // Tone Curve
  toneCurve?: {
    enabled: boolean;
    curves: {
      master: Array<{ x: number; y: number }>;
      red: Array<{ x: number; y: number }>;
      green: Array<{ x: number; y: number }>;
      blue: Array<{ x: number; y: number }>;
    };
    exposureFusion: number;
    exposureStops: number;
    colorPreservation: number;
  };

  // Color Balance
  colorBalance?: {
    enabled: boolean;
    shadows: { cyan_red: number; magenta_green: number; yellow_blue: number };
    midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
    highlights: { cyan_red: number; magenta_green: number; yellow_blue: number };
    preserveLuminosity: boolean;
    globalSaturation: number;
    globalVibrance: number;
    contrastBoost: number;
  };

  // Shadows & Highlights
  shadowsHighlights?: {
    enabled: boolean;
    shadows: number;
    highlights: number;
    shadowsRadius: number;
    highlightsRadius: number;
    shadowsColorTransfer: number;
    highlightsColorTransfer: number;
    whitePoint: number;
    blackPoint: number;
    compressHighlights: number;
    compressShadows: number;
  };

  // Local Adjustments (radial/gradient mask layers). Brush layers are excluded because
  // their painted mask isn't portable. A `layers` array present → apply rebuilds them;
  // legacy presets carry only `layerCount` (no `layers`) and apply as a no-op for LA.
  localAdjustments?: {
    enabled: boolean;
    layerCount?: number;
    layers?: PresetLocalAdjustmentLayer[];
  };

  // Highlight Recovery (M1 pointwise highlight reconstruction — round-8 review LOW, adjudicated
  // INCLUDE for round 9: it is a look-defining param, not bake-coupled, and harmless on non-RAW
  // (default strength 0 = provable identity; a non-zero strength just runs the pointwise pass).
  // Absent on a legacy preset → apply leaves the target's current HR untouched, like every other
  // module here. Enhance/NR stay excluded (established, bake-coupled — not captured/applied).
  highlightRecovery?: {
    enabled: boolean;
    strength: number;
  };

  // Index signature for Record compatibility
  [key: string]: unknown;
}

export class PresetService {
  private presets: Map<string, AdjustmentPreset> = new Map();
  private readonly STORAGE_KEY = 'photo_editor_presets';
  private readonly VERSION = '1.0.0';

  private readonly builtinPresets: AdjustmentPreset[] = [
    {
      id: 'portrait_soft',
      name: 'Portrait Soft',
      description: 'Gentle portrait enhancement with soft shadows and warm tones',
      category: 'portrait',
      tags: ['portrait', 'soft', 'warm'],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      settings: {
        exposure: {
          enabled: true,
          mode: 'manual',
          black: 0.02,
          exposure: 0.3,
          deflicker_percentile: 50,
          compensate_exposure_bias: false
        },
        whiteBalance: {
          enabled: true,
          temperature: 100,
          tint: 5,
          preset: 'custom'
        },
        basicAdjustments: {
          enabled: true,
          black_point: 0.01,
          exposure: 0.2,
          contrast: 0.15,
          brightness: 0.1,
          saturation: 0.1,
          vibrance: 0.2
        },
        shadowsHighlights: {
          enabled: true,
          shadows: 20,
          highlights: -10,
          shadowsRadius: 60,
          highlightsRadius: 40,
          shadowsColorTransfer: 15,
          highlightsColorTransfer: 10,
          whitePoint: 0,
          blackPoint: 0,
          compressHighlights: 0,
          compressShadows: 0
        }
      },
      metadata: {
        version: '1.0.0',
        compatibility: ['1.0.0'],
        rating: 5
      }
    },
    {
      id: 'landscape_dramatic',
      name: 'Landscape Dramatic',
      description: 'High contrast landscape with enhanced sky and vibrant colors',
      category: 'landscape',
      tags: ['landscape', 'dramatic', 'high-contrast'],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      settings: {
        basicAdjustments: {
          enabled: true,
          black_point: 0.03,
          exposure: -0.1,
          contrast: 0.4,
          brightness: 0.05,
          saturation: 0.3,
          vibrance: 0.4
        },
        toneCurve: {
          enabled: true,
          curves: {
            master: [
              { x: 0, y: 0.05 },
              { x: 0.25, y: 0.2 },
              { x: 0.75, y: 0.85 },
              { x: 1, y: 0.98 }
            ],
            red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
          },
          exposureFusion: 2,
          exposureStops: 1.5,
          colorPreservation: 0.8
        },
        shadowsHighlights: {
          enabled: true,
          shadows: 30,
          highlights: -25,
          shadowsRadius: 80,
          highlightsRadius: 60,
          shadowsColorTransfer: 20,
          highlightsColorTransfer: 15,
          whitePoint: 0,
          blackPoint: 0,
          compressHighlights: 10,
          compressShadows: 5
        }
      },
      metadata: {
        version: '1.0.0',
        compatibility: ['1.0.0'],
        rating: 5
      }
    },
    {
      id: 'bw_classic',
      name: 'Black & White Classic',
      description: 'Timeless black and white with rich tones and contrast',
      category: 'bw',
      tags: ['black-white', 'classic', 'monochrome'],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      settings: {
        basicAdjustments: {
          enabled: true,
          black_point: 0.02,
          exposure: 0.1,
          contrast: 0.3,
          brightness: 0.05,
          saturation: -1.0,
          vibrance: 0
        },
        toneCurve: {
          enabled: true,
          curves: {
            master: [
              { x: 0, y: 0 },
              { x: 0.2, y: 0.15 },
              { x: 0.8, y: 0.9 },
              { x: 1, y: 1 }
            ],
            red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
          },
          exposureFusion: 0,
          exposureStops: 1.0,
          colorPreservation: 0
        },
        shadowsHighlights: {
          enabled: true,
          shadows: 15,
          highlights: -15,
          shadowsRadius: 50,
          highlightsRadius: 50,
          shadowsColorTransfer: 0,
          highlightsColorTransfer: 0,
          whitePoint: 0,
          blackPoint: 0,
          compressHighlights: 0,
          compressShadows: 0
        }
      },
      metadata: {
        version: '1.0.0',
        compatibility: ['1.0.0'],
        rating: 4
      }
    },
    {
      id: 'vintage_warm',
      name: 'Vintage Warm',
      description: 'Warm vintage look with lifted blacks and golden tones',
      category: 'vintage',
      tags: ['vintage', 'warm', 'film'],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      settings: {
        whiteBalance: {
          enabled: true,
          temperature: 200,
          tint: 10,
          preset: 'custom'
        },
        basicAdjustments: {
          enabled: true,
          black_point: -0.05,
          exposure: 0.15,
          contrast: 0.1,
          brightness: 0.1,
          saturation: 0.2,
          vibrance: 0.1
        },
        toneCurve: {
          enabled: true,
          curves: {
            master: [
              { x: 0, y: 0.1 },
              { x: 0.5, y: 0.55 },
              { x: 1, y: 0.95 }
            ],
            red: [
              { x: 0, y: 0.05 },
              { x: 1, y: 1 }
            ],
            green: [{ x: 0, y: 0 }, { x: 1, y: 0.98 }],
            blue: [
              { x: 0, y: 0 },
              { x: 1, y: 0.9 }
            ]
          },
          exposureFusion: 1,
          exposureStops: 1.2,
          colorPreservation: 0.6
        },
        colorBalance: {
          enabled: true,
          // Values divided by 3 to compensate the 0.1 -> 0.3 damping change in
          // ColorBalanceModule (value * weight * 0.3): same pixel output as before.
          shadows: { cyan_red: 5 / 3, magenta_green: 0, yellow_blue: 10 / 3 },
          midtones: { cyan_red: 0, magenta_green: -5 / 3, yellow_blue: 5 },
          highlights: { cyan_red: -5 / 3, magenta_green: 0, yellow_blue: 5 / 3 },
          preserveLuminosity: true,
          globalSaturation: 0.1,
          globalVibrance: 0.15,
          contrastBoost: 0.1
        }
      },
      metadata: {
        version: '1.0.0',
        compatibility: ['1.0.0'],
        rating: 4
      }
    },
    {
      id: 'cinematic_teal_orange',
      name: 'Cinematic Teal & Orange',
      description: 'Modern cinematic look with teal shadows and orange highlights',
      category: 'cinematic',
      tags: ['cinematic', 'teal', 'orange', 'modern'],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      settings: {
        basicAdjustments: {
          enabled: true,
          black_point: 0.01,
          exposure: 0.05,
          contrast: 0.25,
          brightness: 0.03,
          saturation: 0.15,
          vibrance: 0.25
        },
        colorBalance: {
          enabled: true,
          // Values divided by 3 to compensate the 0.1 -> 0.3 damping change in
          // ColorBalanceModule (value * weight * 0.3): same pixel output as before.
          shadows: { cyan_red: 5, magenta_green: -5 / 3, yellow_blue: -10 / 3 },
          midtones: { cyan_red: 5 / 3, magenta_green: 0, yellow_blue: 0 },
          highlights: { cyan_red: -10 / 3, magenta_green: -5 / 3, yellow_blue: 20 / 3 },
          preserveLuminosity: true,
          globalSaturation: 0.2,
          globalVibrance: 0.2,
          contrastBoost: 0.15
        },
        toneCurve: {
          enabled: true,
          curves: {
            master: [
              { x: 0, y: 0.02 },
              { x: 0.3, y: 0.25 },
              { x: 0.7, y: 0.8 },
              { x: 1, y: 0.98 }
            ],
            red: [
              { x: 0, y: 0 },
              { x: 0.7, y: 0.75 },
              { x: 1, y: 1 }
            ],
            green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            blue: [
              { x: 0, y: 0.1 },
              { x: 0.3, y: 0.35 },
              { x: 1, y: 0.95 }
            ]
          },
          exposureFusion: 1.5,
          exposureStops: 1.3,
          colorPreservation: 0.5
        }
      },
      metadata: {
        version: '1.0.0',
        compatibility: ['1.0.0'],
        rating: 5
      }
    }
  ];

  constructor() {
    this.loadPresets();
    this.initializeBuiltinPresets();
  }

  // Load presets from storage
  private loadPresets(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        for (const preset of data.presets || []) {
          this.presets.set(preset.id, preset);
        }
        logger.info(`Loaded ${this.presets.size} presets from storage`);
      }
    } catch (error) {
      logger.error('Failed to load presets from storage:', error);
    }
  }

  // Initialize built-in presets if they don't exist
  private initializeBuiltinPresets(): void {
    let addedCount = 0;
    for (const preset of this.builtinPresets) {
      if (!this.presets.has(preset.id)) {
        this.presets.set(preset.id, preset);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      this.savePresets();
      logger.info(`Added ${addedCount} built-in presets`);
    }
  }

  // Save presets to storage
  private savePresets(): void {
    try {
      const data = {
        version: this.VERSION,
        presets: Array.from(this.presets.values())
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to save presets to storage:', error);
    }
  }

  // Create a new preset from current pipeline settings
  createPresetFromCurrent(name: string, description: string, category: AdjustmentPreset['category'], tags: string[] = []): string {
    const presetId = `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Capture current pipeline settings
      const settings = this.captureCurrentSettings();

      const preset: AdjustmentPreset = {
        id: presetId,
        name,
        description,
        category,
        tags,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        settings,
        metadata: {
          version: this.VERSION,
          compatibility: [this.VERSION],
          imageCount: 0,
          rating: 0
        }
      };

      this.presets.set(presetId, preset);
      this.savePresets();

      logger.info(`Created preset: ${name} (${presetId})`);
      return presetId;

    } catch (error) {
      logger.error('Failed to create preset:', error);
      throw new Error(`Failed to create preset: ${error}`);
    }
  }

  // Apply a preset to the current pipeline
  applyPreset(presetId: string): boolean {
    const preset = this.presets.get(presetId);
    if (!preset) {
      logger.error(`Preset not found: ${presetId}`);
      return false;
    }

    try {
      logger.info(`Applying preset: ${preset.name} (${presetId})`);

      // Apply settings to each module
      this.applySettingsToPipeline(preset.settings);

      // Update usage statistics
      preset.metadata.imageCount = (preset.metadata.imageCount || 0) + 1;
      preset.modifiedAt = new Date().toISOString();
      this.savePresets();

      logger.info(`Successfully applied preset: ${preset.name}`);
      return true;

    } catch (error) {
      logger.error(`Failed to apply preset ${presetId}:`, error);
      return false;
    }
  }

  // Update an existing preset
  updatePreset(presetId: string, updates: Partial<AdjustmentPreset>): boolean {
    const preset = this.presets.get(presetId);
    if (!preset) {
      logger.error(`Preset not found: ${presetId}`);
      return false;
    }

    // Don't allow updating built-in presets
    if (this.builtinPresets.find(p => p.id === presetId)) {
      logger.warn(`Cannot update built-in preset: ${presetId}`);
      return false;
    }

    try {
      const updatedPreset = {
        ...preset,
        ...updates,
        id: presetId, // Ensure ID can't be changed
        modifiedAt: new Date().toISOString()
      };

      this.presets.set(presetId, updatedPreset);
      this.savePresets();

      logger.info(`Updated preset: ${updatedPreset.name} (${presetId})`);
      return true;

    } catch (error) {
      logger.error(`Failed to update preset ${presetId}:`, error);
      return false;
    }
  }

  // Delete a preset
  deletePreset(presetId: string): boolean {
    const preset = this.presets.get(presetId);
    if (!preset) {
      logger.error(`Preset not found: ${presetId}`);
      return false;
    }

    // Don't allow deleting built-in presets
    if (this.builtinPresets.find(p => p.id === presetId)) {
      logger.warn(`Cannot delete built-in preset: ${presetId}`);
      return false;
    }

    this.presets.delete(presetId);
    this.savePresets();

    logger.info(`Deleted preset: ${preset.name} (${presetId})`);
    return true;
  }

  // Get all presets
  getAllPresets(): AdjustmentPreset[] {
    return Array.from(this.presets.values()).sort((a, b) => {
      // Built-in presets first, then by name
      const aBuiltin = this.builtinPresets.find(p => p.id === a.id);
      const bBuiltin = this.builtinPresets.find(p => p.id === b.id);

      if (aBuiltin && !bBuiltin) return -1;
      if (!aBuiltin && bBuiltin) return 1;

      return a.name.localeCompare(b.name);
    });
  }

  // Get presets by category
  getPresetsByCategory(category: AdjustmentPreset['category']): AdjustmentPreset[] {
    return Array.from(this.presets.values())
      .filter(preset => preset.category === category)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Search presets
  searchPresets(query: string): AdjustmentPreset[] {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.presets.values())
      .filter(preset =>
        preset.name.toLowerCase().includes(lowercaseQuery) ||
        preset.description.toLowerCase().includes(lowercaseQuery) ||
        preset.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Get preset by ID
  getPreset(presetId: string): AdjustmentPreset | undefined {
    return this.presets.get(presetId);
  }

  // Export presets to file
  exportPresets(presetIds: string[] = []): string {
    const presetsToExport = presetIds.length > 0
      ? presetIds.map(id => this.presets.get(id)).filter(Boolean) as AdjustmentPreset[]
      : Array.from(this.presets.values());

    const exportData = {
      version: this.VERSION,
      exportedAt: new Date().toISOString(),
      presets: presetsToExport
    };

    return JSON.stringify(exportData, null, 2);
  }

  // Import presets from file. This is the TRUST BOUNDARY for user-supplied preset JSON
  // (round-10 H1): app-created presets always capture complete settings blocks, so
  // imports are the only route for malformed shapes into the store. Every preset runs
  // through sanitizeImportedPreset — known-invalid settings blocks are DROPPED (block,
  // not preset) with a per-preset warning; presets that can't be salvaged are skipped.
  // Both outcomes surface a notification listing preset names (multi-export toast idiom).
  importPresets(jsonData: string): { imported: number; skipped: number; errors: string[]; warnings: string[] } {
    const result = { imported: 0, skipped: 0, errors: [] as string[], warnings: [] as string[] };
    const skippedNames: string[] = [];
    const droppedFrom: string[] = [];

    try {
      const data = JSON.parse(jsonData);

      if (!data || !Array.isArray(data.presets)) {
        throw new Error('Invalid preset file format');
      }

      for (const raw of data.presets) {
        const sanitized = sanitizeImportedPreset(raw);
        if (!sanitized.ok) {
          result.errors.push(`Invalid preset structure (${sanitized.name}): ${sanitized.reason}`);
          skippedNames.push(sanitized.name);
          continue;
        }

        const preset = sanitized.preset;

        // Check if preset already exists
        if (this.presets.has(preset.id)) {
          result.skipped++;
          continue;
        }

        if (sanitized.droppedBlocks.length > 0) {
          result.warnings.push(
            `${preset.name}: dropped invalid settings block(s): ${sanitized.droppedBlocks.join(', ')}`
          );
          droppedFrom.push(`${preset.name} (${sanitized.droppedBlocks.join(', ')})`);
        }

        // Add imported timestamp
        preset.modifiedAt = new Date().toISOString();

        this.presets.set(preset.id, preset);
        result.imported++;
      }

      if (result.imported > 0) {
        this.savePresets();
        logger.info(`Imported ${result.imported} presets`);
      }

      if (skippedNames.length > 0) {
        notificationService.warning(
          'Presets skipped on import',
          `${skippedNames.length} malformed preset${skippedNames.length !== 1 ? 's were' : ' was'} skipped: ${formatSkippedNames(skippedNames)}`
        );
      }
      if (droppedFrom.length > 0) {
        notificationService.warning(
          'Preset import',
          `Invalid settings were dropped from: ${formatSkippedNames(droppedFrom)}`
        );
      }

    } catch (error) {
      result.errors.push(`Failed to parse preset file: ${error}`);
      notificationService.error('Preset import failed', 'The file is not a valid preset export.');
    }

    return result;
  }

  // Capture current pipeline settings
  private captureCurrentSettings(): PresetSettings {
    const settings: PresetSettings = {};

    try {
      const modules = imageProcessingPipeline.getModules();

      // Capture each module's settings
      for (const [moduleId, module] of modules) {
        try {
          let moduleSettings: Record<string, unknown> | null = null;
          const moduleInterface = module as ModuleInterface;

          if ('getParameters' in module && typeof moduleInterface.getParameters === 'function') {
            moduleSettings = moduleInterface.getParameters();
          } else if ('getParams' in module && typeof moduleInterface.getParams === 'function') {
            moduleSettings = moduleInterface.getParams();
          }

          if (moduleSettings) {
            switch (moduleId) {
              case 'lenscorrections':
                settings.lensCorrections = {
                  enabled: moduleInterface.isEnabled ?? false,
                  ...((moduleSettings as Record<string, unknown>).lensCorrectionsParams as Record<string, unknown> || {})
                } as typeof settings.lensCorrections;
                break;
              case 'exposure':
                settings.exposure = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.exposure;
                break;
              case 'temperature':
                settings.whiteBalance = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.whiteBalance;
                break;
              case 'basicadj':
                settings.basicAdjustments = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.basicAdjustments;
                break;
              case 'tonecurve':
                settings.toneCurve = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.toneCurve;
                break;
              case 'colorbalance':
                settings.colorBalance = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.colorBalance;
                break;
              case 'shadowshighlights':
                settings.shadowsHighlights = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.shadowsHighlights;
                break;
              case 'highlightrecovery':
                settings.highlightRecovery = {
                  enabled: moduleInterface.isEnabled ?? true,
                  ...moduleSettings
                } as typeof settings.highlightRecovery;
                break;
              case 'localadjustments': {
                const la = module as unknown as LocalAdjustmentsPipelineModule;
                const laParams = la.getParameters();
                // Brush layers carry a painted mask (no geometry) that isn't portable
                // across images, so only geometry-driven radial/linear layers are captured.
                const portable = (laParams.layers || []).filter((l) => l.type !== 'brush');
                settings.localAdjustments = {
                  enabled: !!laParams.enabled,
                  layerCount: portable.length,
                  layers: portable.map((l) => ({
                    name: l.name,
                    type: l.type,
                    enabled: l.enabled,
                    opacity: l.opacity,
                    geometry: l.geometry,
                    basicAdj: l.basicAdj as Record<string, number> | undefined,
                    parameters: l.parameters as Record<string, unknown> | undefined,
                  })),
                };
                break;
              }
            }
          }
        } catch (error) {
          logger.warn(`Failed to capture settings for module ${moduleId}:`, error);
        }
      }

      return settings;

    } catch (error) {
      logger.error('Failed to capture current pipeline settings:', error);
      throw error;
    }
  }

  // Apply settings to pipeline
  private applySettingsToPipeline(settings: PresetSettings): void {
    const modules = imageProcessingPipeline.getModules();

    // Apply settings to each module
    for (const [moduleId, module] of modules) {
      try {
        let moduleSettings: Record<string, unknown> | null = null;

        switch (moduleId) {
          case 'lenscorrections':
            moduleSettings = settings.lensCorrections as Record<string, unknown> | null;
            break;
          case 'exposure':
            moduleSettings = settings.exposure as Record<string, unknown> | null;
            break;
          case 'temperature':
            moduleSettings = settings.whiteBalance as Record<string, unknown> | null;
            break;
          case 'basicadj':
            moduleSettings = settings.basicAdjustments as Record<string, unknown> | null;
            break;
          case 'tonecurve':
            moduleSettings = settings.toneCurve as Record<string, unknown> | null;
            break;
          case 'colorbalance':
            moduleSettings = settings.colorBalance as Record<string, unknown> | null;
            break;
          case 'highlightrecovery':
            moduleSettings = settings.highlightRecovery as Record<string, unknown> | null;
            break;
          case 'shadowshighlights':
            moduleSettings = settings.shadowsHighlights as Record<string, unknown> | null;
            break;
          case 'localadjustments':
            this.applyLocalAdjustments(module as unknown as LocalAdjustmentsPipelineModule, settings.localAdjustments);
            continue;
        }

        if (moduleSettings) {
          // Enable/disable module
          if ('enabled' in moduleSettings) {
            imageProcessingPipeline.setModuleEnabled(moduleId, Boolean(moduleSettings.enabled));
          }

          // Apply parameters
          let params: Record<string, unknown> = { ...moduleSettings };
          delete params.enabled; // Remove enabled flag from params

          // lenscorrections captures its sub-effects (vignetting/distortion/…) spread at the TOP
          // level, but its setParameters expects them nested under `lensCorrectionsParams`. Re-nest
          // so the apply actually round-trips (without this the setter sees no lensCorrectionsParams
          // key and never calls the inner module — params captured but silently never applied).
          if (moduleId === 'lenscorrections') {
            params = { lensCorrectionsParams: params };
          }

          const moduleInterface = module as ModuleInterface;
          if ('setParameters' in module && typeof moduleInterface.setParameters === 'function') {
            moduleInterface.setParameters(params);
          } else if ('setParams' in module && typeof moduleInterface.setParams === 'function') {
            moduleInterface.setParams(params);
          }
        }

      } catch (error) {
        logger.warn(`Failed to apply settings to module ${moduleId}:`, error);
      }
    }
  }

  /**
   * Restore a preset's local-adjustment layers onto the pipeline LA module, mirroring
   * EditPersistenceService.restore (clear → createLayer → geometry/params/opacity/toggle
   * → enable/disable → invalidate). Only acts when the preset actually carries ≥1 layer:
   * legacy presets (only `layerCount`, no `layers`) and presets with no LA data leave the
   * current image's local adjustments untouched — exactly like every other module is
   * skipped when its settings are absent. Geometry is normalized 0..1; masks self-heal to
   * the real resolution on the next processImage pass, so the dims here are a seed only.
   */
  private applyLocalAdjustments(
    la: LocalAdjustmentsPipelineModule,
    laSettings: PresetSettings['localAdjustments']
  ): void {
    const layers = laSettings?.layers;
    if (!Array.isArray(layers) || layers.length === 0) return;

    // Take ownership of LA: clear the current layers, then rebuild from the preset.
    for (const l of [...la.getParameters().layers]) la.removeLayer(l.id);

    const { width, height } = this.getCurrentDimensions();
    for (const sl of layers) {
      if (!sl || sl.type === 'brush') continue; // brush masks aren't portable
      const id = la.createLayer(sl.type, sl.name, width, height);
      if (sl.geometry) la.setLayerGeometry(id, sl.geometry, width, height);
      if (sl.parameters) la.updateLayerParameters(id, sl.parameters as Partial<LocalAdjustmentParams>);
      if (sl.basicAdj) la.updateLayerBasicAdj(id, sl.basicAdj);
      if (typeof sl.opacity === 'number') la.updateLayerOpacity(id, sl.opacity);
      la.toggleLayer(id, sl.enabled);
    }
    if (laSettings?.enabled) la.enable(); else la.disable();
    imageProcessingPipeline.invalidateModuleCache('localadjustments');
  }

  /** Current image dimensions used to seed rebuilt masks; falls back to 1×1 when no image
   *  is loaded (normalized geometry means the mask rebuilds correctly at process time). */
  private getCurrentDimensions(): { width: number; height: number } {
    const img = imageService.getCurrentImage();
    if (img && img.width > 0 && img.height > 0) return { width: img.width, height: img.height };
    return { width: 1, height: 1 };
  }

  /**
   * True when the current pipeline's local-adjustment state contains brush-mask layers.
   * Their painted masks aren't stored in presets, so the Create-Preset UI surfaces a note
   * that they'll be excluded (an explicit exclusion, not a silent drop).
   */
  hasUnportableBrushLayers(): boolean {
    try {
      const la = imageProcessingPipeline.getModule<LocalAdjustmentsPipelineModule>('localadjustments');
      return !!la?.getParameters().layers?.some((l) => l.type === 'brush');
    } catch {
      return false;
    }
  }

  // Get usage statistics
  getStatistics(): {
    totalPresets: number;
    customPresets: number;
    builtinPresets: number;
    categoryCounts: Record<string, number>;
    mostUsed: AdjustmentPreset[];
    topRated: AdjustmentPreset[];
  } {
    const allPresets = Array.from(this.presets.values());
    const customPresets = allPresets.filter(p => !this.builtinPresets.find(bp => bp.id === p.id));

    const categoryCounts: Record<string, number> = {};
    allPresets.forEach(preset => {
      categoryCounts[preset.category] = (categoryCounts[preset.category] || 0) + 1;
    });

    const mostUsed = allPresets
      .filter(p => p.metadata.imageCount && p.metadata.imageCount > 0)
      .sort((a, b) => (b.metadata.imageCount || 0) - (a.metadata.imageCount || 0))
      .slice(0, 5);

    const topRated = allPresets
      .filter(p => p.metadata.rating && p.metadata.rating > 0)
      .sort((a, b) => (b.metadata.rating || 0) - (a.metadata.rating || 0))
      .slice(0, 5);

    return {
      totalPresets: allPresets.length,
      customPresets: customPresets.length,
      builtinPresets: this.builtinPresets.length,
      categoryCounts,
      mostUsed,
      topRated
    };
  }

  // Rate a preset
  ratePreset(presetId: string, rating: number): boolean {
    const preset = this.presets.get(presetId);
    if (!preset) return false;

    preset.metadata.rating = Math.max(1, Math.min(5, Math.round(rating)));
    preset.modifiedAt = new Date().toISOString();
    this.savePresets();

    return true;
  }
}

// Export singleton
export const presetService = new PresetService();