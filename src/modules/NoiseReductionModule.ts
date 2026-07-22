import { logger } from '../utils/Logger';
import { AdvancedDenoisingService, DenoiseMethod, DenoiseParams } from '../services/AdvancedDenoisingService';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { nrHToStrength, legacyNrStrengthToH } from '../utils/nrCurve';

/**
 * NoiseReductionModule - Professional noise reduction for the processing pipeline
 *
 * Wraps AdvancedDenoisingService to provide world-class denoising:
 * - BM3D (Block-Matching 3D) - State-of-the-art algorithm
 * - Non-Local Means - Excellent texture preservation
 * - Wavelet-based - Multi-scale frequency denoising
 * - Hybrid - Combines multiple methods
 * - Auto - Intelligent algorithm selection
 *
 * Rivals professional software like DxO PRIME and Topaz DeNoise AI
 */

export interface NoiseReductionParams {
  enabled: boolean;           // Enable/disable noise reduction
  strength: number;           // 0-100, denoising strength
  method: DenoiseMethod;      // Algorithm selection
  preserveDetail: number;     // 0-100, detail preservation
  chromaStrength: number;     // 0-100, color noise reduction strength
  lumaStrength: number;       // 0-100, luminance noise reduction strength
  [key: string]: unknown;     // Index signature for Record compatibility
}

export interface NoiseReductionContext {
  width: number;
  height: number;
  channels: number;
  /** Export pass (ProcessingContext.isExport): skip the diagnostics-only PSNR/avg-change metric
   *  loops — two full-buffer O(n) sweeps of pure logging that are measurable at export resolution.
   *  Pixel output is identical either way. */
  isExport?: boolean;
}

export class NoiseReductionModule {
  private params: NoiseReductionParams = {
    enabled: false,
    strength: 50,
    method: 'auto',
    preserveDetail: 70,
    chromaStrength: 50,
    lumaStrength: 50
  };

  private denoisingService: AdvancedDenoisingService;

  constructor() {
    this.denoisingService = new AdvancedDenoisingService();
    logger.info('NoiseReductionModule initialized');
  }

  getId(): string {
    return 'noise-reduction';
  }

  getName(): string {
    return 'Noise Reduction';
  }

  getParams(): NoiseReductionParams {
    return { ...this.params };
  }

  setParams(params: Partial<NoiseReductionParams>): void {
    this.params = { ...this.params, ...this.validateParams(params) };
    logger.debug(`NoiseReduction params updated:`, this.params);
  }

  resetParams(): void {
    this.params = {
      enabled: false,
      strength: 50,
      method: 'auto',
      preserveDetail: 70,
      chromaStrength: 50,
      lumaStrength: 50
    };
    logger.debug('NoiseReduction params reset to defaults');
  }

  /**
   * Validate and clamp parameters to valid ranges
   */
  private validateParams(params: Partial<NoiseReductionParams>): Partial<NoiseReductionParams> {
    const validated: Partial<NoiseReductionParams> = {};

    // Validate boolean
    if (params.enabled !== undefined) {
      validated.enabled = Boolean(params.enabled);
    }

    // Validate method
    if (params.method !== undefined) {
      const validMethods: DenoiseMethod[] = ['auto', 'bm3d', 'nlmeans', 'wavelet', 'hybrid'];
      validated.method = validMethods.includes(params.method) ? params.method : 'auto';
    }

    // Validate numeric parameters (0-100 range)
    const numericParams: Array<keyof NoiseReductionParams> = [
      'strength',
      'preserveDetail',
      'chromaStrength',
      'lumaStrength'
    ];

    numericParams.forEach(key => {
      if (params[key] !== undefined) {
        const value = params[key] as number;
        validated[key] = Math.max(0, Math.min(100, value));
      }
    });

    return validated;
  }

  /**
   * Auto-adjust noise reduction based on image analysis
   * Analyzes the image and sets optimal parameters
   */
  autoAdjust(imageData: Float32Array, context: NoiseReductionContext): NoiseReductionParams {
    logger.info('Auto-adjusting noise reduction parameters...');

    // Estimate noise level
    const noiseLevel = this.estimateNoiseLevel(imageData, context.width, context.height);

    // Calculate optimal parameters based on noise level
    let strength: number;
    let preserveDetail: number;
    let method: DenoiseMethod;

    // v1.36.0 C1/F1: the bucket strengths below were tuned against the LEGACY strength→h curve
    // (h = 0.015 + s·0.12). The slider curve was recalibrated (nrCurve.ts), so each bucket now
    // targets the SAME EFFECTIVE h through the new curve. The old moderate/high/very-high
    // strengths (50/70/85 → h 0.075/0.099/0.117) sit above the new curve's deliberate ceiling
    // (h(100) = 0.047 ≈ old 27 — everything beyond smeared detail), so they clamp to 100.
    const strengthForLegacy = (legacyStrength: number): number =>
      nrHToStrength(legacyNrStrengthToH(legacyStrength));

    if (noiseLevel < 0.01) {
      // Low noise - minimal denoising
      strength = strengthForLegacy(20);
      preserveDetail = 90;
      method = 'wavelet';
      logger.info('Low noise detected - minimal denoising');
    } else if (noiseLevel < 0.03) {
      // Moderate noise
      strength = strengthForLegacy(50);
      preserveDetail = 75;
      method = 'nlmeans';
      logger.info('Moderate noise detected - balanced denoising');
    } else if (noiseLevel < 0.06) {
      // High noise
      strength = strengthForLegacy(70);
      preserveDetail = 60;
      method = 'bm3d';
      logger.info('High noise detected - aggressive denoising');
    } else {
      // Very high noise - use hybrid approach
      strength = strengthForLegacy(85);
      preserveDetail = 50;
      method = 'hybrid';
      logger.info('Very high noise detected - hybrid denoising');
    }

    const autoParams: NoiseReductionParams = {
      enabled: true,
      strength,
      method,
      preserveDetail,
      chromaStrength: strength * 0.8, // Color noise typically needs less aggressive denoising
      lumaStrength: strength
    };

    this.params = { ...autoParams };
    logger.info('Auto noise reduction parameters:', autoParams);

    return { ...autoParams };
  }

  /**
   * Estimate noise level in image using MAD (Median Absolute Deviation)
   * Returns normalized noise estimate (0-1 scale)
   */
  private estimateNoiseLevel(imageData: Float32Array, width: number, height: number): number {
    // Sample a subset of pixels for performance
    const sampleSize = Math.min(10000, width * height);
    const step = Math.max(1, Math.floor((width * height) / sampleSize));

    const differences: number[] = [];

    // Calculate local differences (simplified noise estimation)
    for (let y = 1; y < height - 1; y += step) {
      for (let x = 1; x < width - 1; x += step) {
        const idx = (y * width + x) * 4;

        // Calculate difference from neighbors (luminance)
        const current = 0.299 * imageData[idx] + 0.587 * imageData[idx + 1] + 0.114 * imageData[idx + 2];

        const rightIdx = (y * width + (x + 1)) * 4;
        const right = 0.299 * imageData[rightIdx] + 0.587 * imageData[rightIdx + 1] + 0.114 * imageData[rightIdx + 2];

        const downIdx = ((y + 1) * width + x) * 4;
        const down = 0.299 * imageData[downIdx] + 0.587 * imageData[downIdx + 1] + 0.114 * imageData[downIdx + 2];

        differences.push(Math.abs(current - right));
        differences.push(Math.abs(current - down));
      }
    }

    // Calculate MAD (Median Absolute Deviation)
    differences.sort((a, b) => a - b);
    const median = differences[Math.floor(differences.length / 2)];

    // MAD-based noise estimate
    const noiseEstimate = median / 0.6745; // Standard conversion factor

    logger.debug(`Estimated noise level: ${(noiseEstimate * 100).toFixed(2)}%`);

    return noiseEstimate;
  }

  /**
   * Process image through noise reduction pipeline
   * Main processing method called by ImageProcessingPipeline
   */
  process(input: Float32Array, context: NoiseReductionContext): Float32Array {
    const startTime = performance.now();

    // If disabled, return input unchanged
    if (!this.params.enabled) {
      logger.debug('NoiseReduction is disabled, passing through');
      return new Float32Array(input);
    }

    const { width, height } = context;
    logger.info(`NoiseReduction processing: ${width}x${height}, method: ${this.params.method}, strength: ${this.params.strength}`);

    // GPU fast-path: a fast WebGL2 Non-Local-Means denoise (sub-second even on
    // RAW), replacing the slow CPU BM3D/NLMeans. Falls back to the CPU service when
    // WebGL2 is unavailable. RGBA only. Output length is VALIDATED — a wrong-size
    // buffer flowing downstream corrupts the whole pipeline (v1.32.0 export bug).
    if (input.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
      const gpu = webGLImageProcessor.denoise(input, width, height, this.params.strength);
      if (gpu && gpu.length === input.length) {
        logger.info(`NoiseReduction (GPU NLM) completed in ${(performance.now() - startTime).toFixed(2)}ms`);
        if (!context.isExport) this.logQualityMetrics(input, gpu);
        return gpu;
      }
      // Full-resolution exports exceed the single-pass GPU size cap (the pass
      // throws → null). Denoise in GPU TILES instead — the SAME NLM kernel the
      // preview uses, so the export matches the preview's look. The NLM search
      // window is local (~10px), so a modest apron eliminates tile seams.
      const tiled = this.denoiseTiledGPU(input, width, height, this.params.strength);
      if (tiled && tiled.length === input.length) {
        logger.info(`NoiseReduction (GPU NLM, tiled) completed in ${(performance.now() - startTime).toFixed(2)}ms`);
        if (!context.isExport) this.logQualityMetrics(input, tiled);
        return tiled;
      }
    }

    // CPU service: real (verified) methods are O(n·window²·patch²) and only
    // sane below ~1MP. Above that, the old auto-selection routed into a
    // PLACEHOLDER wavelet implementation that returned a quarter-resolution
    // buffer and shredded every NR export (v1.32.0 root cause) — now the
    // large-image CPU case is an honest, logged no-op instead.
    if (width * height > 1_000_000) {
      logger.warn(`NoiseReduction: ${width}x${height} too large for CPU denoise and no GPU available — passing through unchanged`);
      return new Float32Array(input);
    }

    try {
      // Prepare parameters for AdvancedDenoisingService
      const denoiseParams: Partial<DenoiseParams> = {
        strength: this.params.strength,
        method: this.params.method,
        preserveDetail: this.params.preserveDetail,
        chromaStrength: this.params.chromaStrength,
        lumaStrength: this.params.lumaStrength
      };

      // Process through advanced denoising service (synchronous)
      const output = this.denoisingService.denoiseSync(
        input,
        width,
        height,
        denoiseParams
      );

      const elapsed = performance.now() - startTime;
      logger.info(`NoiseReduction completed in ${elapsed.toFixed(2)}ms`);

      // Log quality metrics (diagnostics only — skipped on export passes)
      if (!context.isExport) this.logQualityMetrics(input, output);

      if (output.length !== input.length) {
        // Never let a wrong-size buffer continue down the pipeline.
        logger.error(`NoiseReduction: CPU service returned ${output.length} floats for a ${input.length}-float input — discarding`);
        return new Float32Array(input);
      }
      return output;

    } catch (error) {
      logger.error('NoiseReduction processing failed:', error);
      // On error, return original image
      return new Float32Array(input);
    }
  }

  /**
   * Tiled GPU NLM denoise for images above the single-pass GPU size cap
   * (full-resolution exports). Tiles carry an APRON of neighbour pixels sized
   * well past the NLM kernel's reach, so interior seams are exact; the apron is
   * cropped off when stitching. Returns null if any tile fails (caller falls
   * back). `tileSize` is parameterized for tests.
   */
  denoiseTiledGPU(
    input: Float32Array,
    width: number,
    height: number,
    strength: number,
    tileSize = 2048,
    apron = 16,
  ): Float32Array | null {
    const out = new Float32Array(input.length);
    for (let ty = 0; ty < height; ty += tileSize) {
      for (let tx = 0; tx < width; tx += tileSize) {
        const tw = Math.min(tileSize, width - tx);
        const th = Math.min(tileSize, height - ty);
        // Padded tile bounds (clamped to the image).
        const px0 = Math.max(0, tx - apron);
        const py0 = Math.max(0, ty - apron);
        const px1 = Math.min(width, tx + tw + apron);
        const py1 = Math.min(height, ty + th + apron);
        const pw = px1 - px0;
        const ph = py1 - py0;

        const tile = new Float32Array(pw * ph * 4);
        for (let y = 0; y < ph; y++) {
          const srcOff = ((py0 + y) * width + px0) * 4;
          tile.set(input.subarray(srcOff, srcOff + pw * 4), y * pw * 4);
        }

        const denoised = webGLImageProcessor.denoise(tile, pw, ph, strength);
        if (!denoised || denoised.length !== tile.length) {
          logger.warn(`NoiseReduction: tiled GPU denoise failed at tile (${tx},${ty})`);
          return null;
        }

        // Copy the UNPADDED interior back.
        const ix = tx - px0;
        const iy = ty - py0;
        for (let y = 0; y < th; y++) {
          const srcOff = ((iy + y) * pw + ix) * 4;
          const dstOff = ((ty + y) * width + tx) * 4;
          out.set(denoised.subarray(srcOff, srcOff + tw * 4), dstOff);
        }
      }
    }
    return out;
  }

  /**
   * Log quality metrics for monitoring
   */
  private logQualityMetrics(
    input: Float32Array,
    output: Float32Array
  ): void {
    // Calculate PSNR (Peak Signal-to-Noise Ratio)
    let mse = 0;

    for (let i = 0; i < input.length; i++) {
      const diff = input[i] - output[i];
      mse += diff * diff;
    }

    mse /= input.length;
    const psnr = mse > 0 ? 10 * Math.log10(1.0 / mse) : Infinity;

    // Calculate average change
    let totalChange = 0;
    for (let i = 0; i < input.length; i++) {
      totalChange += Math.abs(input[i] - output[i]);
    }
    const avgChange = totalChange / input.length;

    logger.debug(`Quality metrics - PSNR: ${psnr.toFixed(2)} dB, Avg change: ${(avgChange * 100).toFixed(4)}%`);
  }

  /**
   * Get parameter constraints for UI
   */
  getParamConstraints(): Record<string, {
    min: number;
    max: number;
    default: number;
    step?: number;
    unit?: string;
  }> {
    return {
      strength: { min: 0, max: 100, default: 50, step: 1, unit: '%' },
      preserveDetail: { min: 0, max: 100, default: 70, step: 1, unit: '%' },
      chromaStrength: { min: 0, max: 100, default: 50, step: 1, unit: '%' },
      lumaStrength: { min: 0, max: 100, default: 50, step: 1, unit: '%' }
    };
  }

  /**
   * Get current statistics about denoising performance
   */
  getStats(): {
    cacheHits: number;
    cacheMisses: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
  } {
    return this.denoisingService.getStats();
  }

  /**
   * Clear denoising cache
   */
  clearCache(): void {
    this.denoisingService.clearCache();
    logger.info('NoiseReduction cache cleared');
  }
}
