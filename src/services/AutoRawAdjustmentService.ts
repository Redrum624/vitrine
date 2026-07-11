import { logger } from '../utils/Logger';
import { rawImageService, RawImageData, RawMetadata } from './RawImageService';
import { ImageProcessingPipeline } from './ImageProcessingPipeline';
import { ExposureModule } from '../modules/ExposureModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ShadowsHighlightsPipelineModule } from '../modules/ShadowsHighlightsPipelineModule';
// Define parameter interfaces since they're not exported
interface ExposureParams {
  exposure?: number;
  blackpoint?: number;
  mode?: 'manual' | 'automatic';
}

interface WhiteBalanceParams {
  temperature?: number;
  tint?: number;
  illuminant?: 'D50' | 'D55' | 'D65' | 'A' | 'E';
}

interface BasicAdjustmentsParams {
  contrast?: number;
  brightness?: number;
  saturation?: number;
  vibrance?: number;
  clarity?: number;
  dehaze?: number;
}

interface ShadowsHighlightsParams {
  shadows?: number;
  highlights?: number;
  whitepoint?: number;
  blackpoint?: number;
  radius?: number;
  compress?: number;
}

export interface AutoAdjustmentParams {
  exposure: Partial<ExposureParams>;
  whiteBalance: Partial<WhiteBalanceParams>;
  basicAdjustments: Partial<BasicAdjustmentsParams>;
  shadowsHighlights: Partial<ShadowsHighlightsParams>;
}

export interface RAWDetectionResult {
  isRAW: boolean;
  confidence: number;
  recommendedParams: AutoAdjustmentParams;
  metadata?: RawMetadata;
  reasoning: string[];
}

export class AutoRawAdjustmentService {
  private static instance: AutoRawAdjustmentService;

  static getInstance(): AutoRawAdjustmentService {
    if (!AutoRawAdjustmentService.instance) {
      AutoRawAdjustmentService.instance = new AutoRawAdjustmentService();
    }
    return AutoRawAdjustmentService.instance;
  }

  /**
   * Detect if an image is RAW and automatically apply appropriate parameters with GPU acceleration
   */
  async detectAndApplyRAWAdjustments(
    filePath: string,
    pipeline: ImageProcessingPipeline,
    // Threaded from ImageService.loadImage's `interactive` flag: batch-originated opens pass false so
    // the analysis decode below does not write-through to (and churn) the disk base-cache LRU.
    interactive: boolean = true,
  ): Promise<RAWDetectionResult> {
    try {
      logger.info(`Auto-detecting RAW parameters: ${filePath}`);

      // Check if file is RAW by extension
      const isRAWFile = rawImageService.isRawFile(filePath);

      if (!isRAWFile) {
        return {
          isRAW: false,
          confidence: 0.0,
          recommendedParams: this.getDefaultParams(),
          reasoning: ['File extension indicates non-RAW format']
        };
      }

      // Load RAW image to analyze metadata
      const rawData = await rawImageService.loadRawImageWithHistogram(filePath, {
        generateHistogram: true,
        bins: 256,
        bitDepth: 16
      }, interactive);

      // Analyze image content and metadata
      const analysis = this.analyzeRAWImage(rawData);

      // Generate auto-adjustment parameters
      const recommendedParams = this.generateAutoAdjustments(rawData, analysis);

      // Apply the parameters to the pipeline
      this.applyParametersToPipeline(recommendedParams, pipeline);

      logger.info(`RAW auto-adjustments applied for ${filePath}:`, {
        camera: `${rawData.metadata.make} ${rawData.metadata.model}`,
        iso: rawData.metadata.iso,
        resolution: `${rawData.width}x${rawData.height}`,
        adjustments: analysis.reasoning
      });

      return {
        isRAW: true,
        confidence: analysis.confidence,
        recommendedParams,
        metadata: rawData.metadata,
        reasoning: analysis.reasoning
      };

    } catch (error) {
      logger.error('Failed to detect and apply RAW adjustments:', error);
      return {
        isRAW: false,
        confidence: 0.0,
        recommendedParams: this.getDefaultParams(),
        reasoning: ['Error analyzing image file']
      };
    }
  }

  /**
   * Analyze RAW image content and metadata
   */
  private analyzeRAWImage(rawData: RawImageData): {
    confidence: number;
    needsExposureAdjustment: boolean;
    needsWhiteBalanceAdjustment: boolean;
    needsShadowRecovery: boolean;
    needsHighlightRecovery: boolean;
    estimatedNoiseLevel: number;
    reasoning: string[];
  } {
    const reasoning: string[] = [];
    const confidence = 1.0;

    // Analyze histogram for exposure issues
    let needsExposureAdjustment = false;
    let needsShadowRecovery = false;
    let needsHighlightRecovery = false;

    if (rawData.histogram) {
      const { histogram } = rawData;

      // Check for underexposure (heavy left skew)
      const shadowPixels = histogram.red.slice(0, 25).reduce((a, b) => a + b, 0);
      const totalPixels = histogram.red.reduce((a, b) => a + b, 0);
      const shadowRatio = shadowPixels / totalPixels;

      if (shadowRatio > 0.3) {
        needsExposureAdjustment = true;
        needsShadowRecovery = true;
        reasoning.push('High shadow content detected - applying shadow recovery');
      }

      // Check for overexposure (heavy right skew)
      const highlightPixels = histogram.red.slice(-25).reduce((a, b) => a + b, 0);
      const highlightRatio = highlightPixels / totalPixels;

      if (highlightRatio > 0.1) {
        needsHighlightRecovery = true;
        reasoning.push('Highlight clipping detected - applying highlight recovery');
      }

      // Check for proper exposure distribution
      const midtonePixels = histogram.red.slice(64, 192).reduce((a, b) => a + b, 0);
      const midtoneRatio = midtonePixels / totalPixels;

      if (midtoneRatio < 0.4) {
        needsExposureAdjustment = true;
        reasoning.push('Low midtone content - adjusting exposure');
      }
    }

    // Analyze metadata for camera-specific adjustments
    let needsWhiteBalanceAdjustment = false;
    if (rawData.metadata.make && rawData.metadata.model) {
      // Camera-specific logic
      const make = rawData.metadata.make.toLowerCase();

      if (make.includes('canon')) {
        reasoning.push('Canon camera detected - applying Canon-specific tone curve');
      } else if (make.includes('nikon')) {
        reasoning.push('Nikon camera detected - applying Nikon-specific color profile');
      } else if (make.includes('sony')) {
        reasoning.push('Sony camera detected - applying Sony-specific white balance');
        needsWhiteBalanceAdjustment = true;
      } else if (make.includes('fujifilm')) {
        reasoning.push('Fujifilm camera detected - applying film simulation adjustments');
      }
    }

    // Estimate noise level based on ISO
    let estimatedNoiseLevel = 0;
    if (rawData.metadata.iso) {
      const iso = rawData.metadata.iso;
      if (iso >= 3200) {
        estimatedNoiseLevel = 0.8;
        reasoning.push(`High ISO (${iso}) detected - applying noise reduction`);
      } else if (iso >= 1600) {
        estimatedNoiseLevel = 0.5;
        reasoning.push(`Medium ISO (${iso}) detected - applying moderate noise reduction`);
      } else if (iso >= 800) {
        estimatedNoiseLevel = 0.3;
        reasoning.push(`Elevated ISO (${iso}) detected - applying light noise reduction`);
      }
    }

    return {
      confidence,
      needsExposureAdjustment,
      needsWhiteBalanceAdjustment,
      needsShadowRecovery,
      needsHighlightRecovery,
      estimatedNoiseLevel,
      reasoning
    };
  }

  /**
   * Estimate a conservative dehaze amount (0.0..0.4) from the luminance histogram.
   *
   * Haze scatters light into the shadows, lifting the black floor: a hazy image
   * has almost no pixels in the deepest luminance bins and its tonal range is
   * compressed. We detect that lifted floor and map it to a gentle dehaze value.
   * Returns 0.0 when there is no histogram or no haze signal (the safe default),
   * and never exceeds 0.4 per the Algorithm Tuning rule (stay conservative).
   */
  private estimateHazeAmount(rawData: RawImageData): number {
    const histogram = rawData.histogram;
    if (!histogram || !histogram.luminance || histogram.luminance.length === 0) {
      return 0.0;
    }

    const lum = histogram.luminance;
    const bins = lum.length;
    const totalPixels = lum.reduce((a, b) => a + b, 0);
    if (totalPixels <= 0) {
      return 0.0;
    }

    // Deep-shadow bins (lowest ~6% of the range). In a non-hazy image a meaningful
    // fraction of pixels lands here; haze pushes this fraction toward zero.
    const shadowCutoff = Math.max(1, Math.floor(bins * 0.06));
    let deepShadowPixels = 0;
    for (let i = 0; i < shadowCutoff; i++) {
      deepShadowPixels += lum[i];
    }
    const deepShadowRatio = deepShadowPixels / totalPixels;

    // Only treat as hazy when the deep shadows are nearly empty (lifted floor).
    // 0.5% threshold avoids triggering on images that simply have no dark content.
    const hazeSignal = 0.005 - deepShadowRatio;
    if (hazeSignal <= 0) {
      return 0.0;
    }

    // Map the (tiny) signal to a conservative dehaze strength, capped at 0.4.
    const dehaze = Math.min(0.4, (hazeSignal / 0.005) * 0.4);
    return dehaze;
  }

  /**
   * Generate automatic adjustment parameters based on analysis
   * Uses wider parameter ranges to take advantage of RAW's extended dynamic range
   */
  private generateAutoAdjustments(
    rawData: RawImageData,
    analysis: ReturnType<typeof this.analyzeRAWImage>
  ): AutoAdjustmentParams {
    const params: AutoAdjustmentParams = this.getDefaultParams();

    // RAW files have much more dynamic range - use aggressive exposure adjustments
    if (analysis.needsExposureAdjustment && rawData.histogram) {
      const exposureAnalysis = rawImageService.analyzeImageExposure(
        rawData.data,
        rawData.width,
        rawData.height
      );

      // RAW files can handle ±2-3 stops of exposure adjustment easily
      params.exposure = {
        exposure: Math.max(-2.0, Math.min(2.0, exposureAnalysis.exposureAdjustment * 1.5)), // Wider exposure range
        blackpoint: Math.max(-0.3, exposureAnalysis.exposureAdjustment * -0.5), // More aggressive black point
        mode: 'manual' as const
      };
    }

    // White balance adjustments - RAW allows much wider temperature range
    if (analysis.needsWhiteBalanceAdjustment || !rawData.metadata.whiteBalance) {
      const make = rawData.metadata.make?.toLowerCase() || '';

      // RAW files can handle temperature range of 2000-20000K easily
      if (make.includes('sony')) {
        params.whiteBalance = {
          temperature: 5500,
          tint: 0.0,
          illuminant: 'D55' as const
        };
      } else if (make.includes('canon')) {
        params.whiteBalance = {
          temperature: 5200,
          tint: 0.2, // More aggressive tint adjustment for RAW
          illuminant: 'D55' as const
        };
      } else if (make.includes('nikon')) {
        params.whiteBalance = {
          temperature: 5600,
          tint: -0.2, // More aggressive tint adjustment for RAW
          illuminant: 'D55' as const
        };
      } else {
        params.whiteBalance = {
          temperature: 5500,
          tint: 0.0,
          illuminant: 'D55' as const
        };
      }
    }

    // Basic adjustments - RAW files can handle much more aggressive adjustments
    const iso = rawData.metadata.iso || 100;

    params.basicAdjustments = {
      // RAW files can handle contrast adjustments from -1.0 to +1.0 easily
      contrast: iso > 1600 ? 0.2 : 0.35, // More aggressive contrast for RAW
      brightness: 0.0,
      // RAW saturation can be pushed much further (0.0 to 2.0 range)
      saturation: 1.0,
      // RAW vibrance can be more aggressive (0.0 to 2.0 range)
      vibrance: iso > 800 ? 1.0 : 1.3, // More vibrance for RAW
      // RAW clarity can be pushed much harder (-1.0 to +1.0 range)
      clarity: iso > 1600 ? 0.1 : 0.25, // More clarity for RAW (noise permitting)
      // Dehaze derived from the histogram's dynamic-range compression (see below).
      // Conservative per the Algorithm Tuning rule; 0.0 when no haze signal.
      dehaze: this.estimateHazeAmount(rawData)
    };

    // Shadow/highlight recovery - RAW files excel at this with massive range
    if (analysis.needsShadowRecovery || analysis.needsHighlightRecovery) {
      params.shadowsHighlights = {
        // RAW files can handle shadow recovery up to +100 easily
        shadows: analysis.needsShadowRecovery ? 60 : 0, // More aggressive shadow recovery
        // RAW files can handle highlight recovery down to -100 easily
        highlights: analysis.needsHighlightRecovery ? -50 : 0, // More aggressive highlight recovery
        whitepoint: 100,
        blackpoint: 0,
        radius: 100,
        compress: 50
      };
    }

    return params;
  }

  /**
   * Apply parameters to the processing pipeline
   */
  private applyParametersToPipeline(
    params: AutoAdjustmentParams,
    pipeline: ImageProcessingPipeline
  ): void {
    try {
      // Apply exposure parameters
      const exposureModule = pipeline.getModule<ExposureModule>('exposure');
      if (exposureModule && Object.keys(params.exposure).length > 0) {
        // Apply parameters using module's setParameters method
        const exposureParams: Partial<import('../types/darktable').ExposureParams> = {};
        if (params.exposure.exposure !== undefined) {
          exposureParams.exposure = params.exposure.exposure;
        }
        if (params.exposure.blackpoint !== undefined) {
          exposureParams.black = params.exposure.blackpoint;
        }
        if (params.exposure.mode !== undefined) {
          exposureParams.mode = params.exposure.mode === 'automatic' ? 'automatic' : 'manual';
        }
        exposureModule.setCurrentParams(exposureParams);
        pipeline.setModuleEnabled('exposure', true);
        logger.debug('Applied auto exposure parameters:', params.exposure);
      }

      // Apply white balance parameters
      const whiteBalanceModule = pipeline.getModule<WhiteBalanceModule>('temperature');
      if (whiteBalanceModule && Object.keys(params.whiteBalance).length > 0) {
        const wbParams: Partial<import('../types/index').WhiteBalanceParams> = {};
        if (params.whiteBalance.temperature !== undefined) {
          wbParams.temperature = params.whiteBalance.temperature;
        }
        if (params.whiteBalance.tint !== undefined) {
          wbParams.tint = params.whiteBalance.tint;
        }
        whiteBalanceModule.setParams(wbParams);
        pipeline.setModuleEnabled('temperature', true);
        logger.debug('Applied auto white balance parameters:', params.whiteBalance);
      }

      // Apply basic adjustments parameters
      const basicModule = pipeline.getModule<BasicAdjustmentsModule>('basicadj');
      if (basicModule && Object.keys(params.basicAdjustments).length > 0) {
        const basicParams: Partial<import('../types/index').BasicAdjustmentsParams> = {};
        if (params.basicAdjustments.contrast !== undefined) {
          basicParams.contrast = params.basicAdjustments.contrast;
        }
        if (params.basicAdjustments.brightness !== undefined) {
          basicParams.brightness = params.basicAdjustments.brightness;
        }
        if (params.basicAdjustments.saturation !== undefined) {
          basicParams.saturation = params.basicAdjustments.saturation;
        }
        if (params.basicAdjustments.vibrance !== undefined) {
          basicParams.vibrance = params.basicAdjustments.vibrance;
        }
        if (params.basicAdjustments.clarity !== undefined) {
          basicParams.clarity = params.basicAdjustments.clarity;
        }
        if (params.basicAdjustments.dehaze !== undefined) {
          basicParams.dehaze = params.basicAdjustments.dehaze;
        }
        basicModule.setParams(basicParams);
        pipeline.setModuleEnabled('basicadj', true);
        logger.debug('Applied auto basic adjustment parameters:', params.basicAdjustments);
      }

      // Apply shadows/highlights parameters
      const shadowsModule = pipeline.getModule<ShadowsHighlightsPipelineModule>('shadowshighlights');
      if (shadowsModule && Object.keys(params.shadowsHighlights).length > 0) {
        const shadowsParams: Partial<import('../types/index').ShadowsHighlightsParams> = {};
        if (params.shadowsHighlights.shadows !== undefined) {
          shadowsParams.shadows = params.shadowsHighlights.shadows;
        }
        if (params.shadowsHighlights.highlights !== undefined) {
          shadowsParams.highlights = params.shadowsHighlights.highlights;
        }
        if (params.shadowsHighlights.whitepoint !== undefined) {
          shadowsParams.whitepoint = params.shadowsHighlights.whitepoint;
        }
        if (params.shadowsHighlights.blackpoint !== undefined) {
          shadowsParams.blackpoint = params.shadowsHighlights.blackpoint;
        }
        if (params.shadowsHighlights.radius !== undefined) {
          shadowsParams.radius = params.shadowsHighlights.radius;
        }
        if (params.shadowsHighlights.compress !== undefined) {
          shadowsParams.compress = params.shadowsHighlights.compress;
        }
        shadowsModule.setParams(shadowsParams);
        pipeline.setModuleEnabled('shadowshighlights', true);
        logger.debug('Applied auto shadows/highlights parameters:', params.shadowsHighlights);
      }

    } catch (error) {
      logger.error('Failed to apply auto-adjustment parameters to pipeline:', error);
    }
  }

  /**
   * Get default parameters (neutral settings)
   */
  private getDefaultParams(): AutoAdjustmentParams {
    return {
      exposure: {},
      whiteBalance: {},
      basicAdjustments: {},
      shadowsHighlights: {}
    };
  }

  /**
   * Reset all auto-adjustments to default
   */
  resetAutoAdjustments(pipeline: ImageProcessingPipeline): void {
    try {
      const moduleIds = ['exposure', 'temperature', 'basicadj', 'shadowshighlights'];

      moduleIds.forEach(moduleId => {
        const module = pipeline.getModule(moduleId);
        if (module && module.resetParams) {
          module.resetParams();
          logger.debug(`Reset auto-adjustments for module: ${moduleId}`);
        }
      });

      logger.info('All auto-adjustments reset to defaults');
    } catch (error) {
      logger.error('Failed to reset auto-adjustments:', error);
    }
  }

  /**
   * Get camera-specific presets optimized for RAW files with wider dynamic range
   */
  getCameraPresets(make?: string, _model?: string): Partial<AutoAdjustmentParams> {
    if (!make) return {};

    const makeLower = make.toLowerCase();

    // Camera-specific presets with wider ranges for RAW processing
    if (makeLower.includes('canon')) {
      return {
        basicAdjustments: {
          contrast: 0.4, // Canon RAW can handle more contrast
          saturation: 1.3, // Canon colors can be pushed further
          vibrance: 1.1,
          clarity: 0.2 // Canon lenses often benefit from clarity boost
        },
        exposure: {
          exposure: 0.2 // Canon tends to underexpose slightly
        }
      };
    }

    if (makeLower.includes('nikon')) {
      return {
        basicAdjustments: {
          contrast: 0.3, // Nikon RAW handles contrast well
          saturation: 1.2,
          vibrance: 1.3, // Nikon benefits from vibrance boost
          clarity: 0.15
        },
        exposure: {
          exposure: 0.1 // Nikon tends to expose conservatively
        }
      };
    }

    if (makeLower.includes('sony')) {
      return {
        basicAdjustments: {
          contrast: 0.25, // Sony sensors have good DR
          saturation: 1.1, // Sony colors can be conservative
          vibrance: 1.4, // Sony really benefits from vibrance
          clarity: 0.3 // Sony sensors are very sharp
        },
        shadowsHighlights: {
          shadows: 30, // Sony excels at shadow recovery
          highlights: -20
        }
      };
    }

    if (makeLower.includes('fujifilm')) {
      return {
        basicAdjustments: {
          contrast: 0.5, // Fuji film simulations can handle high contrast
          saturation: 1.5, // Fuji colors are meant to be pushed
          vibrance: 1.0, // Fuji already has good color rendition
          clarity: 0.1 // Fuji tends to be softer
        },
        exposure: {
          exposure: 0.3 // Fuji often needs slight exposure boost
        }
      };
    }

    if (makeLower.includes('olympus') || makeLower.includes('panasonic')) {
      return {
        basicAdjustments: {
          contrast: 0.35,
          saturation: 1.25,
          vibrance: 1.2,
          clarity: 0.25 // Micro 4/3 benefits from clarity
        },
        shadowsHighlights: {
          shadows: 25,
          highlights: -15
        }
      };
    }

    if (makeLower.includes('pentax')) {
      return {
        basicAdjustments: {
          contrast: 0.3,
          saturation: 1.4, // Pentax colors can be very vibrant
          vibrance: 1.1,
          clarity: 0.2
        }
      };
    }

    return {};
  }

  getConditionBasedAdjustments(metadata: RawMetadata): Partial<AutoAdjustmentParams> {
    const adjustments: Partial<AutoAdjustmentParams> = {};

    // ISO-based adjustments with wider ranges for RAW
    if (metadata.iso) {
      const iso = metadata.iso;

      if (iso >= 6400) {
        // Very high ISO: aggressive noise management for RAW
        adjustments.basicAdjustments = {
          clarity: -0.3, // RAW can handle more aggressive clarity reduction
          vibrance: 0.7, // More vibrance reduction for high ISO RAW
          contrast: 0.15 // Reduce contrast to minimize noise
        };
        adjustments.shadowsHighlights = {
          shadows: 40, // RAW excels at shadow recovery even at high ISO
          highlights: -30
        };
      } else if (iso >= 3200) {
        // High ISO: moderate noise management
        adjustments.basicAdjustments = {
          clarity: -0.15,
          vibrance: 0.85,
          contrast: 0.2
        };
        adjustments.shadowsHighlights = {
          shadows: 35,
          highlights: -25
        };
      } else if (iso >= 1600) {
        // Medium-high ISO: light adjustments
        adjustments.basicAdjustments = {
          clarity: 0.0,
          vibrance: 1.0,
          contrast: 0.25
        };
        adjustments.shadowsHighlights = {
          shadows: 25,
          highlights: -15
        };
      } else if (iso <= 400) {
        // Low ISO: can push RAW harder for quality
        adjustments.basicAdjustments = {
          clarity: 0.4, // Low ISO RAW can handle aggressive clarity
          vibrance: 1.5, // Push vibrance on clean RAW
          contrast: 0.5, // High contrast for low ISO RAW
          saturation: 1.3
        };
        adjustments.shadowsHighlights = {
          shadows: 50, // Maximum shadow recovery for low ISO
          highlights: -40
        };
      }
    }

    // Aperture-based adjustments for RAW processing
    if (metadata.aperture) {
      const aperture = metadata.aperture;

      if (aperture <= 1.4) {
        // Very wide aperture: RAW can handle aggressive detail enhancement
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          clarity: 0.35, // Push clarity for wide aperture RAW
          contrast: (adjustments.basicAdjustments?.contrast || 0) + 0.1
        };
      } else if (aperture <= 2.8) {
        // Wide aperture: moderate enhancement
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          clarity: 0.25,
          contrast: (adjustments.basicAdjustments?.contrast || 0) + 0.05
        };
      } else if (aperture >= 11.0) {
        // Very narrow aperture: may need diffraction compensation
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          clarity: 0.4, // Compensate for diffraction softening
          contrast: (adjustments.basicAdjustments?.contrast || 0) + 0.15
        };
      } else if (aperture >= 8.0) {
        // Narrow aperture: moderate sharpening
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          clarity: 0.3,
          contrast: (adjustments.basicAdjustments?.contrast || 0) + 0.1
        };
      }
    }

    // Focal length based adjustments for RAW
    if (metadata.focalLength) {
      const focalLength = metadata.focalLength;

      if (focalLength >= 200) {
        // Telephoto: often needs vibration reduction compensation
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          clarity: (adjustments.basicAdjustments?.clarity || 0) + 0.1
        };
      } else if (focalLength <= 24) {
        // Wide angle: may need distortion compensation effects
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          vibrance: Math.max(0.8, (adjustments.basicAdjustments?.vibrance || 1.0) * 1.1) // Boost vibrance for wide landscapes
        };
      }
    }

    // Shutter speed based adjustments for RAW
    if (metadata.shutter) {
      const shutter = metadata.shutter;

      if (shutter >= 1.0) {
        // Long exposure: may need highlight protection
        adjustments.shadowsHighlights = {
          ...adjustments.shadowsHighlights,
          highlights: Math.min(-20, (adjustments.shadowsHighlights?.highlights || 0) - 15)
        };
      } else if (shutter <= 1/500) {
        // Fast shutter: often good for pushing contrast
        adjustments.basicAdjustments = {
          ...adjustments.basicAdjustments,
          contrast: (adjustments.basicAdjustments?.contrast || 0) + 0.1
        };
      }
    }

    return adjustments;
  }
}

export const autoRawAdjustmentService = AutoRawAdjustmentService.getInstance();