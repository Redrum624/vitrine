import type {
  ExposureParams,
  ProcessingContext,
  ModuleMetadata
} from '../types/darktable';
import { ModuleGroup, ModuleFlags } from '../types/darktable';

// Helper functions from darktable exposure.c (for future use)
// const exposure2white = (x: number): number => Math.pow(2, -x);
// const white2exposure = (x: number): number => -Math.log2(Math.max(1e-20, x));

export class ExposureModule {
  public readonly metadata: ModuleMetadata = {
    id: 'exposure',
    name: 'Exposure',
    description: 'Exposure and black level adjustments',
    group: ModuleGroup.BASIC,
    version: 6,
    flags: ModuleFlags.SUPPORTS_BLENDING | ModuleFlags.ALLOW_TILING
  };

  getId(): string {
    return this.metadata.id;
  }

  getName(): string {
    return this.metadata.name;
  }

  public readonly defaultParams: ExposureParams = {
    mode: 'manual',
    black: 0.0,
    exposure: 0.0,
    deflicker_percentile: 50.0,
    deflicker_target_level: -4.0,
    compensate_exposure_bias: false
  };

  private currentParams: ExposureParams = { ...this.defaultParams };

  getCurrentParams(): ExposureParams {
    return { ...this.currentParams };
  }

  // Pipeline-compatible method
  getParams(): Record<string, unknown> {
    return { ...this.currentParams };
  }

  setCurrentParams(params: Partial<ExposureParams>): void {
    this.currentParams = { ...this.currentParams, ...this.validateParams(params) };
  }

  resetParams(): void {
    this.currentParams = { ...this.defaultParams };
  }

  public getParamConstraints(): Record<keyof ExposureParams, {
    min: number;
    max: number;
    default: number;
    step?: number;
    unit?: string;
  }> {
    return {
      mode: { min: 0, max: 1, default: 0 },
      black: { min: -1.0, max: 1.0, default: 0.0, step: 0.01 },
      exposure: { min: -1.0, max: 1.0, default: 0.0, step: 0.1, unit: 'EV' },
      deflicker_percentile: { min: 0.0, max: 100.0, default: 50.0, step: 1.0, unit: '%' },
      deflicker_target_level: { min: -18.0, max: 18.0, default: -4.0, step: 0.1, unit: 'EV' },
      compensate_exposure_bias: { min: 0, max: 1, default: 0 }
    };
  }

  public validateParams(params: Partial<ExposureParams>): ExposureParams {
    const constraints = this.getParamConstraints();
    const validated: ExposureParams = { ...this.defaultParams };

    // Validate mode
    if (params.mode !== undefined) {
      validated.mode = params.mode === 'automatic' ? 'automatic' : 'manual';
    }

    // Validate numeric parameters
    Object.keys(constraints).forEach(key => {
      if (key === 'mode' || key === 'compensate_exposure_bias') return;

      const paramKey = key as keyof ExposureParams;
      if (params[paramKey] !== undefined) {
        const value = params[paramKey] as number;
        const constraint = constraints[paramKey];
        validated[paramKey] = Math.max(
          constraint.min,
          Math.min(constraint.max, value)
        ) as number;
      }
    });

    // Validate boolean
    if (params.compensate_exposure_bias !== undefined) {
      validated.compensate_exposure_bias = Boolean(params.compensate_exposure_bias);
    }

    return validated;
  }

  // Compatible process method for pipeline
  process(input: Float32Array, context: { width: number; height: number; channels: number }): Float32Array {
    const processingContext: ProcessingContext = {
      width: context.width,
      height: context.height,
      channels: context.channels,
      data: input,
      roi: { x: 0, y: 0, width: context.width, height: context.height }
    };

    const result = this.processWithContext(processingContext, this.currentParams);
    return result.data as Float32Array;
  }

  // Original darktable-style process method
  public processWithContext(input: ProcessingContext, params: ExposureParams): ProcessingContext {
    // Create output context
    const output: ProcessingContext = {
      width: input.width,
      height: input.height,
      channels: input.channels,
      data: new Float32Array(input.data),
      roi: input.roi
    };

    // Calculate exposure and black level adjustments
    const exposureMultiplier = Math.pow(2, params.exposure);
    const blackLevel = params.black;

    // Process each pixel
    const pixelCount = input.width * input.height;
    const data = output.data as Float32Array;

    for (let i = 0; i < pixelCount; i++) {
      const pixelIndex = i * input.channels;

      // Process RGB channels (skip alpha if present)
      for (let c = 0; c < Math.min(3, input.channels); c++) {
        const channelIndex = pixelIndex + c;
        let value = data[channelIndex];

        // Apply black level correction first
        value = Math.max(0, value - blackLevel);

        // Apply exposure adjustment
        value = value * exposureMultiplier;

        // Clamp to valid range [0, 1] for display
        data[channelIndex] = Math.max(0, Math.min(1, value));
      }
    }

    return output;
  }

  // Automatic deflicker processing (simplified version)
  private processDeflicker(
    input: ProcessingContext,
    percentile: number,
    targetLevel: number
  ): number {
    // This is a simplified implementation
    // In the real darktable, this analyzes the histogram to determine optimal exposure

    const data = input.data as Float32Array;
    const pixelCount = input.width * input.height;
    const luminanceValues: number[] = [];

    // Calculate luminance for each pixel
    for (let i = 0; i < pixelCount; i++) {
      const pixelIndex = i * input.channels;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      // Simple luminance calculation (sRGB weights)
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      luminanceValues.push(luminance);
    }

    // Sort luminance values to find percentile
    luminanceValues.sort((a, b) => a - b);
    const percentileIndex = Math.floor((percentile / 100) * luminanceValues.length);
    const percentileValue = luminanceValues[percentileIndex];

    // Calculate required exposure adjustment to reach target level
    if (percentileValue > 0) {
      const targetValue = Math.pow(2, targetLevel);
      const requiredExposure = Math.log2(targetValue / percentileValue);
      return Math.max(-18, Math.min(18, requiredExposure));
    }

    return 0;
  }

  public processWithAutoDeflicker(
    input: ProcessingContext,
    params: ExposureParams
  ): { output: ProcessingContext; computedExposure: number } {
    const finalParams = { ...params };
    let computedExposure = 0;

    if (params.mode === 'automatic') {
      // Calculate automatic exposure adjustment
      computedExposure = this.processDeflicker(
        input,
        params.deflicker_percentile,
        params.deflicker_target_level
      );
      finalParams.exposure = computedExposure;
    }

    const output = this.processWithContext(input, finalParams);

    return {
      output,
      computedExposure
    };
  }

  // Auto exposure adjustment method for UI
  autoExposure(): ExposureParams {
    // Simple auto exposure - adjust exposure to brighten mid-tones
    const autoExposureValue = 0.5; // Start with slight positive exposure
    const autoBlackLevel = 0.01; // Lift shadows slightly

    return {
      ...this.currentParams,
      exposure: autoExposureValue,
      black: autoBlackLevel,
      mode: 'manual'
    };
  }
}