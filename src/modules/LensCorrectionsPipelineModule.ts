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
      },
      blur: {
        enabled: false,
        radius: 0
      },
      filmGrain: {
        enabled: false,
        amount: 0,
        size: 1
      }
    }
  };

  // Active whenever ANY section is enabled. (The previous gate also required a
  // top-level `enabled` flag that nothing ever set, so the whole module silently
  // never ran in the live pipeline — this derives enablement from the sections.)
  //
  // Null-safety (round-10 H1 belt-and-suspenders): this getter is read OUTSIDE
  // process()'s try (the process gate and the pipeline's isModuleActive), so a
  // partial `lensCorrectionsParams` — reachable only through a bug upstream, since
  // imported presets are shape-validated at the import trust boundary — used to
  // THROW here. Fail safe instead: warn loudly and report the module disabled.
  // Deliberately NOT a structural merge in setParameters: a merge would silently
  // accept half-formed params as valid state and mask the upstream bug; the warn
  // + disabled floor keeps the bug observable without crashing the pipeline.
  get isEnabled(): boolean {
    const p = this.params.lensCorrectionsParams;
    if (!p || !p.vignetting || !p.distortion || !p.chromaticAberration ||
        !p.profile || !p.blur || !p.filmGrain) {
      logger.warn(
        'LensCorrections: lensCorrectionsParams is missing sections (partial setParameters upstream?) — treating module as disabled'
      );
      return false;
    }
    return (
      p.vignetting.enabled ||
      p.distortion.enabled ||
      p.chromaticAberration.enabled ||
      p.profile.enabled ||
      p.blur.enabled ||
      p.filmGrain.enabled
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
        },
        blur: {
          enabled: false,
          radius: 0
        },
        filmGrain: {
          enabled: false,
          amount: 0,
          size: 1
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

  resetBlur(): void {
    lensCorrectionsModule.resetBlur();
    this.params.lensCorrectionsParams.blur = lensCorrectionsModule.getParams().blur;
  }

  resetFilmGrain(): void {
    lensCorrectionsModule.resetFilmGrain();
    this.params.lensCorrectionsParams.filmGrain = lensCorrectionsModule.getParams().filmGrain;
  }

  // Get the underlying lens corrections module
  getLensCorrectionsModule() {
    return lensCorrectionsModule;
  }

  // Get current parameters (required by pipeline). `enabled` is derived from the
  // sections so the pipeline's identity check skips the module only when every
  // section is off (and runs it as soon as one is enabled).
  getParams(): Record<string, unknown> {
    return {
      ...this.params,
      enabled: this.isEnabled,
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