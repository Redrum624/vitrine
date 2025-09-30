import { PipelineModule, ProcessingContext } from '../services/ImageProcessingPipeline';
import {
  lensCorrectionsModule,
  LensCorrectionsParams
} from './LensCorrectionsModule';
import { logger } from '../utils/Logger';

export interface LensCorrectionsPipelineParams {
  enabled: boolean;
  lensCorrectionsParams: LensCorrectionsParams;
}

export class LensCorrectionsPipelineModule implements PipelineModule {
  id = 'lenscorrections';
  name = 'Lens Corrections';

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  private params: LensCorrectionsPipelineParams = {
    enabled: false,
    lensCorrectionsParams: {
      vignetting: {
        enabled: false,
        amount: 0,
        midpoint: 1.0,
        roundness: 0,
        feather: 50
      },
      distortion: {
        enabled: false,
        barrel: 0,
        perspective: {
          horizontal: 0,
          vertical: 0
        },
        scale: 1.0
      },
      chromaticAberration: {
        enabled: false,
        redCyan: 0,
        blueMagenta: 0,
        purple: {
          amount: 0,
          hue: 300,
          range: 10
        },
        green: {
          amount: 0,
          hue: 60,
          range: 10
        }
      },
      profile: {
        enabled: false,
        autoDetect: true,
        profileName: '',
        strength: 100
      }
    }
  };

  get isEnabled(): boolean {
    const { lensCorrectionsParams } = this.params;
    return this.params.enabled && (
      lensCorrectionsParams.vignetting.enabled ||
      lensCorrectionsParams.distortion.enabled ||
      lensCorrectionsParams.chromaticAberration.enabled ||
      lensCorrectionsParams.profile.enabled
    );
  }

  enable(): void {
    this.params.enabled = true;
    logger.info('Lens corrections module enabled');
  }

  disable(): void {
    this.params.enabled = false;
    logger.info('Lens corrections module disabled');
  }

  getParameters(): LensCorrectionsPipelineParams {
    return { ...this.params };
  }

  setParameters(params: Partial<LensCorrectionsPipelineParams>): void {
    this.params = { ...this.params, ...params };

    // Sync parameters with the lens corrections module
    if (params.lensCorrectionsParams) {
      lensCorrectionsModule.setParams(params.lensCorrectionsParams);
    }

    logger.debug('Lens corrections parameters updated');
  }

  process(imageData: Float32Array, context: ProcessingContext): Float32Array {
    if (!this.isEnabled) {
      return imageData;
    }

    const startTime = performance.now();

    try {
      // Sync parameters to ensure module is up to date
      lensCorrectionsModule.setParams(this.params.lensCorrectionsParams);

      // Process image through lens corrections
      const result = lensCorrectionsModule.processImage(imageData, context.width, context.height);

      const processingTime = performance.now() - startTime;
      logger.debug(`Lens corrections processed in ${processingTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      const processingTime = performance.now() - startTime;
      logger.error(`Lens corrections processing failed after ${processingTime.toFixed(2)}ms:`, error);
      return imageData; // Return original on error
    }
  }

  reset(): void {
    this.params = {
      enabled: false,
      lensCorrectionsParams: {
        vignetting: {
          enabled: false,
          amount: 0,
          midpoint: 1.0,
          roundness: 0,
          feather: 50
        },
        distortion: {
          enabled: false,
          barrel: 0,
          perspective: {
            horizontal: 0,
            vertical: 0
          },
          scale: 1.0
        },
        chromaticAberration: {
          enabled: false,
          redCyan: 0,
          blueMagenta: 0,
          purple: {
            amount: 0,
            hue: 300,
            range: 10
          },
          green: {
            amount: 0,
            hue: 60,
            range: 10
          }
        },
        profile: {
          enabled: false,
          autoDetect: true,
          profileName: '',
          strength: 100
        }
      }
    };

    lensCorrectionsModule.resetAll();
    logger.info('Lens corrections module reset');
  }

  // Lens Corrections specific methods
  updateVignettingParams(vignetting: Partial<LensCorrectionsParams['vignetting']>): void {
    this.params.lensCorrectionsParams.vignetting = {
      ...this.params.lensCorrectionsParams.vignetting,
      ...vignetting
    };
    lensCorrectionsModule.updateVignettingParams(vignetting);
  }

  updateDistortionParams(distortion: Partial<LensCorrectionsParams['distortion']>): void {
    this.params.lensCorrectionsParams.distortion = {
      ...this.params.lensCorrectionsParams.distortion,
      ...distortion
    };
    lensCorrectionsModule.updateDistortionParams(distortion);
  }

  updateChromaticAberrationParams(ca: Partial<LensCorrectionsParams['chromaticAberration']>): void {
    this.params.lensCorrectionsParams.chromaticAberration = {
      ...this.params.lensCorrectionsParams.chromaticAberration,
      ...ca
    };
    lensCorrectionsModule.updateChromaticAberrationParams(ca);
  }

  updateProfileParams(profile: Partial<LensCorrectionsParams['profile']>): void {
    this.params.lensCorrectionsParams.profile = {
      ...this.params.lensCorrectionsParams.profile,
      ...profile
    };
  }

  // Auto-detection methods
  autoDetectVignetting(imageData: Float32Array, width: number, height: number): void {
    lensCorrectionsModule.autoDetectVignetting(imageData, width, height);

    // Sync back the detected parameters
    const detectedParams = lensCorrectionsModule.getParams();
    this.params.lensCorrectionsParams.vignetting = detectedParams.vignetting;

    if (!this.params.enabled && detectedParams.vignetting.enabled) {
      this.enable();
    }
  }

  // Reset specific sections
  resetVignetting(): void {
    lensCorrectionsModule.resetVignetting();
    this.params.lensCorrectionsParams.vignetting = lensCorrectionsModule.getParams().vignetting;
  }

  resetDistortion(): void {
    lensCorrectionsModule.resetDistortion();
    this.params.lensCorrectionsParams.distortion = lensCorrectionsModule.getParams().distortion;
  }

  resetChromaticAberration(): void {
    lensCorrectionsModule.resetChromaticAberration();
    this.params.lensCorrectionsParams.chromaticAberration = lensCorrectionsModule.getParams().chromaticAberration;
  }

  // Get the underlying lens corrections module
  getLensCorrectionsModule() {
    return lensCorrectionsModule;
  }

  // Get current parameters (required by pipeline)
  getParams(): Record<string, unknown> {
    return {
      ...this.params,
      lensCorrections: lensCorrectionsModule.getParams()
    };
  }

  // Get module statistics
  getStats() {
    const moduleStats = lensCorrectionsModule.getStats();

    return {
      ...moduleStats,
      enabled: this.params.enabled,
      moduleEnabled: this.isEnabled,
      vignettingEnabled: this.params.lensCorrectionsParams.vignetting.enabled,
      distortionEnabled: this.params.lensCorrectionsParams.distortion.enabled,
      chromaticAberrationEnabled: this.params.lensCorrectionsParams.chromaticAberration.enabled,
      profileEnabled: this.params.lensCorrectionsParams.profile.enabled
    };
  }
}

// Export singleton instance
export const lensCorrectionsPipelineModule = new LensCorrectionsPipelineModule();