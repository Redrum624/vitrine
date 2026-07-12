import { logger } from '../utils/Logger';

export interface NoiseReductionOptions {
  algorithm: 'bilateral' | 'wavelet' | 'nlm' | 'adaptive';
  strength: number; // 0-100
  detail: number; // 0-100 - detail preservation
  chromaStrength?: number; // 0-100 - chroma noise reduction
  luminanceStrength?: number; // 0-100 - luma noise reduction
  edgeThreshold?: number; // 0-1 - edge detection sensitivity
  iterations?: number; // 1-5 - number of passes
}

export interface NoiseProfile {
  camera: string;
  model: string;
  iso: number;
  redNoise: number;
  greenNoise: number;
  blueNoise: number;
  chrominanceNoise: number;
  luminanceNoise: number;
}

export interface WaveletCoefficients {
  ll: Float32Array; // Low-Low (approximation)
  lh: Float32Array; // Low-High (horizontal detail)
  hl: Float32Array; // High-Low (vertical detail)
  hh: Float32Array; // High-High (diagonal detail)
}

/**
 * Professional Noise Reduction Service
 * Implements advanced denoising algorithms including wavelet-based methods
 */
export class NoiseReductionService {
  private static instance: NoiseReductionService;
  private noiseProfiles: Map<string, NoiseProfile> = new Map();

  static getInstance(): NoiseReductionService {
    if (!NoiseReductionService.instance) {
      NoiseReductionService.instance = new NoiseReductionService();
    }
    return NoiseReductionService.instance;
  }

  constructor() {
    this.initializeNoiseProfiles();
  }

  /**
   * Initialize built-in noise profiles for common cameras and ISO levels
   */
  private initializeNoiseProfiles(): void {
    // Canon noise profiles
    this.addNoiseProfile({
      camera: 'Canon',
      model: 'EOS R5',
      iso: 100,
      redNoise: 0.001,
      greenNoise: 0.0008,
      blueNoise: 0.0012,
      chrominanceNoise: 0.0005,
      luminanceNoise: 0.0008
    });

    this.addNoiseProfile({
      camera: 'Canon',
      model: 'EOS R5',
      iso: 800,
      redNoise: 0.008,
      greenNoise: 0.006,
      blueNoise: 0.010,
      chrominanceNoise: 0.004,
      luminanceNoise: 0.007
    });

    this.addNoiseProfile({
      camera: 'Canon',
      model: 'EOS R5',
      iso: 3200,
      redNoise: 0.025,
      greenNoise: 0.020,
      blueNoise: 0.030,
      chrominanceNoise: 0.015,
      luminanceNoise: 0.022
    });

    // Nikon noise profiles
    this.addNoiseProfile({
      camera: 'Nikon',
      model: 'Z7',
      iso: 100,
      redNoise: 0.0008,
      greenNoise: 0.0006,
      blueNoise: 0.0010,
      chrominanceNoise: 0.0004,
      luminanceNoise: 0.0007
    });

    this.addNoiseProfile({
      camera: 'Nikon',
      model: 'Z7',
      iso: 1600,
      redNoise: 0.015,
      greenNoise: 0.012,
      blueNoise: 0.018,
      chrominanceNoise: 0.008,
      luminanceNoise: 0.013
    });

    // Sony noise profiles
    this.addNoiseProfile({
      camera: 'Sony',
      model: 'A7R IV',
      iso: 100,
      redNoise: 0.0009,
      greenNoise: 0.0007,
      blueNoise: 0.0011,
      chrominanceNoise: 0.0005,
      luminanceNoise: 0.0008
    });

    logger.info(`Initialized ${this.noiseProfiles.size} noise profiles`);
  }

  /**
   * Add noise profile to database
   */
  addNoiseProfile(profile: NoiseProfile): void {
    const key = `${profile.camera}_${profile.model}_${profile.iso}`;
    this.noiseProfiles.set(key, profile);
  }

  /**
   * Get noise profile for camera and ISO
   */
  getNoiseProfile(camera: string, model: string, iso: number): NoiseProfile | null {
    const key = `${camera}_${model}_${iso}`;
    const profile = this.noiseProfiles.get(key);

    if (!profile) {
      // Try to find closest ISO match
      return this.findClosestISOProfile(camera, model, iso);
    }

    return profile;
  }

  /**
   * Apply noise reduction using specified algorithm
   */
  async applyNoiseReduction(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    const startTime = performance.now();
    logger.info(`Applying ${options.algorithm} noise reduction`, {
      strength: options.strength,
      detail: options.detail,
      size: `${width}x${height}`
    });

    let result: Float32Array;

    switch (options.algorithm) {
      case 'wavelet':
        result = await this.applyWaveletDenoising(imageData, width, height, options);
        break;
      case 'bilateral':
        result = await this.applyBilateralFilter(imageData, width, height, options);
        break;
      case 'nlm':
        result = await this.applyNonLocalMeans(imageData, width, height, options);
        break;
      case 'adaptive':
        result = await this.applyAdaptiveDenoising(imageData, width, height, options);
        break;
      default:
        throw new Error(`Unsupported noise reduction algorithm: ${options.algorithm}`);
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Noise reduction completed in ${processingTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Wavelet-based denoising using Daubechies wavelets
   */
  private async applyWaveletDenoising(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData.length);

    // Process each channel separately
    for (let channel = 0; channel < 3; channel++) {
      const channelData = this.extractChannel(imageData, width, height, channel);

      // Apply wavelet decomposition (3 levels)
      const waveletLevels = 3;
      let currentLevel = channelData;
      let currentWidth = width;
      let currentHeight = height;
      const coefficients: WaveletCoefficients[] = [];

      // Decomposition
      for (let level = 0; level < waveletLevels; level++) {
        const decomp = this.waveletDecompose(currentLevel, currentWidth, currentHeight);
        coefficients.push(decomp);

        // Continue with LL coefficients for next level
        currentLevel = decomp.ll;
        currentWidth = Math.floor(currentWidth / 2);
        currentHeight = Math.floor(currentHeight / 2);
      }

      // Apply soft thresholding to detail coefficients
      const threshold = this.calculateThreshold(options.strength, options.detail);

      for (const coeff of coefficients) {
        this.applySoftThresholding(coeff.lh, threshold * 0.8); // Horizontal details
        this.applySoftThresholding(coeff.hl, threshold * 0.8); // Vertical details
        this.applySoftThresholding(coeff.hh, threshold); // Diagonal details (most noise)
      }

      // Reconstruction
      let reconstructed = coefficients[coefficients.length - 1].ll;
      let reconWidth = currentWidth;
      let reconHeight = currentHeight;

      for (let level = coefficients.length - 1; level >= 0; level--) {
        reconstructed = this.waveletReconstruct(
          coefficients[level],
          reconWidth,
          reconHeight
        );
        reconWidth *= 2;
        reconHeight *= 2;
      }

      // Insert processed channel back into result
      this.insertChannel(result, reconstructed, width, height, channel);
    }

    // Copy alpha channel unchanged
    for (let i = 3; i < imageData.length; i += 4) {
      result[i] = imageData[i];
    }

    return result;
  }

  /**
   * Bilateral filter for edge-preserving smoothing
   */
  private async applyBilateralFilter(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData.length);
    const kernelRadius = 5;
    const spatialSigma = options.strength / 10;
    const intensitySigma = options.detail / 100;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) { // RGB channels
          let weightSum = 0;
          let valueSum = 0;
          const centerValue = imageData[centerIdx + c];

          for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
            for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
              const ny = Math.max(0, Math.min(height - 1, y + ky));
              const nx = Math.max(0, Math.min(width - 1, x + kx));
              const neighIdx = (ny * width + nx) * 4 + c;
              const neighValue = imageData[neighIdx];

              // Spatial weight
              const spatialDist = kx * kx + ky * ky;
              const spatialWeight = Math.exp(-spatialDist / (2 * spatialSigma * spatialSigma));

              // Intensity weight
              const intensityDist = Math.abs(centerValue - neighValue);
              const intensityWeight = Math.exp(-intensityDist / (2 * intensitySigma * intensitySigma));

              const weight = spatialWeight * intensityWeight;
              weightSum += weight;
              valueSum += neighValue * weight;
            }
          }

          result[centerIdx + c] = weightSum > 0 ? valueSum / weightSum : centerValue;
        }

        result[centerIdx + 3] = imageData[centerIdx + 3]; // Alpha
      }
    }

    return result;
  }

  /**
   * Non-Local Means denoising
   */
  private async applyNonLocalMeans(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData.length);
    const patchSize = 7;
    const searchWindow = 21;
    const h = options.strength / 10; // Filtering parameter

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) {
          let weightSum = 0;
          let valueSum = 0;

          // Search in neighborhood
          const halfSearch = Math.floor(searchWindow / 2);
          for (let sy = Math.max(0, y - halfSearch); sy <= Math.min(height - 1, y + halfSearch); sy++) {
            for (let sx = Math.max(0, x - halfSearch); sx <= Math.min(width - 1, x + halfSearch); sx++) {
              const searchIdx = (sy * width + sx) * 4 + c;

              // Compare patches
              const patchDistance = this.computePatchDistance(
                imageData, width, height, x, y, sx, sy, patchSize, c
              );

              const weight = Math.exp(-Math.max(patchDistance - 2 * h * h, 0) / (h * h));
              weightSum += weight;
              valueSum += imageData[searchIdx] * weight;
            }
          }

          result[centerIdx + c] = weightSum > 0 ? valueSum / weightSum : imageData[centerIdx + c];
        }

        result[centerIdx + 3] = imageData[centerIdx + 3]; // Alpha
      }
    }

    return result;
  }

  /**
   * Adaptive denoising based on local statistics
   */
  private async applyAdaptiveDenoising(
    imageData: Float32Array,
    width: number,
    height: number,
    options: NoiseReductionOptions
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData.length);
    const windowSize = 5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIdx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) {
          // Compute local statistics
          const localStats = this.computeLocalStatistics(imageData, width, height, x, y, windowSize, c);

          // Adaptive filtering based on local variance
          const varianceThreshold = 0.01;
          const centerValue = imageData[centerIdx + c];

          if (localStats.variance < varianceThreshold) {
            // Smooth region - apply strong denoising
            result[centerIdx + c] = localStats.mean;
          } else {
            // Textured region - preserve details
            const alpha = Math.min(options.detail / 100, localStats.variance);
            result[centerIdx + c] = alpha * centerValue + (1 - alpha) * localStats.mean;
          }
        }

        result[centerIdx + 3] = imageData[centerIdx + 3]; // Alpha
      }
    }

    return result;
  }

  /**
   * Helper methods for wavelet processing
   */
  private waveletDecompose(data: Float32Array, width: number, height: number): WaveletCoefficients {
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);

    const ll = new Float32Array(halfWidth * halfHeight);
    const lh = new Float32Array(halfWidth * halfHeight);
    const hl = new Float32Array(halfWidth * halfHeight);
    const hh = new Float32Array(halfWidth * halfHeight);

    // Daubechies-4 wavelet coefficients
    const h = [0.6830127, 1.1830127, 0.3169873, -0.1830127];
    const g = [h[3], -h[2], h[1], -h[0]]; // High-pass filter

    // Row-wise filtering and downsampling
    const tempData = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < halfWidth; x++) {
        let lowSum = 0, highSum = 0;
        for (let k = 0; k < 4; k++) {
          const srcX = Math.min(width - 1, Math.max(0, 2 * x + k));
          const srcIdx = y * width + srcX;
          lowSum += h[k] * data[srcIdx];
          highSum += g[k] * data[srcIdx];
        }
        tempData[y * width + x] = lowSum;
        tempData[y * width + x + halfWidth] = highSum;
      }
    }

    // Column-wise filtering and downsampling
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < halfHeight; y++) {
        let lowSum = 0, highSum = 0;
        for (let k = 0; k < 4; k++) {
          const srcY = Math.min(height - 1, Math.max(0, 2 * y + k));
          const srcIdx = srcY * width + x;
          lowSum += h[k] * tempData[srcIdx];
          highSum += g[k] * tempData[srcIdx];
        }

        const outIdx = y * halfWidth + (x % halfWidth);
        if (x < halfWidth) {
          ll[outIdx] = lowSum;
          hl[outIdx] = highSum;
        } else {
          lh[outIdx] = lowSum;
          hh[outIdx] = highSum;
        }
      }
    }

    return { ll, lh, hl, hh };
  }

  private waveletReconstruct(
    coeffs: WaveletCoefficients,
    width: number,
    height: number
  ): Float32Array {
    // Simplified reconstruction - in production would use proper inverse wavelet transform
    const result = new Float32Array(width * height * 4);

    // Combine coefficients back (simplified)
    for (let i = 0; i < coeffs.ll.length; i++) {
      const y = Math.floor(i / width);
      const x = i % width;

      if (y < height && x < width) {
        result[i] = coeffs.ll[i] + coeffs.lh[i] * 0.5 + coeffs.hl[i] * 0.5 + coeffs.hh[i] * 0.3;
      }
    }

    return result;
  }

  private applySoftThresholding(coeffs: Float32Array, threshold: number): void {
    for (let i = 0; i < coeffs.length; i++) {
      const value = coeffs[i];
      const absValue = Math.abs(value);

      if (absValue <= threshold) {
        coeffs[i] = 0;
      } else {
        coeffs[i] = Math.sign(value) * (absValue - threshold);
      }
    }
  }

  private calculateThreshold(strength: number, detail: number): number {
    // Adaptive threshold based on strength and detail preservation
    const baseThreshold = strength / 1000;
    const detailFactor = 1 - (detail / 100);
    return baseThreshold * (1 + detailFactor);
  }

  private extractChannel(data: Float32Array, width: number, height: number, channel: number): Float32Array {
    const channelData = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      channelData[i] = data[i * 4 + channel];
    }
    return channelData;
  }

  private insertChannel(
    dest: Float32Array,
    src: Float32Array,
    width: number,
    height: number,
    channel: number
  ): void {
    for (let i = 0; i < width * height; i++) {
      dest[i * 4 + channel] = src[i];
    }
  }

  private computePatchDistance(
    data: Float32Array,
    width: number,
    height: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    patchSize: number,
    channel: number
  ): number {
    let distance = 0;
    let count = 0;
    const halfPatch = Math.floor(patchSize / 2);

    for (let dy = -halfPatch; dy <= halfPatch; dy++) {
      for (let dx = -halfPatch; dx <= halfPatch; dx++) {
        const py1 = Math.max(0, Math.min(height - 1, y1 + dy));
        const px1 = Math.max(0, Math.min(width - 1, x1 + dx));
        const py2 = Math.max(0, Math.min(height - 1, y2 + dy));
        const px2 = Math.max(0, Math.min(width - 1, x2 + dx));

        const val1 = data[(py1 * width + px1) * 4 + channel];
        const val2 = data[(py2 * width + px2) * 4 + channel];

        const diff = val1 - val2;
        distance += diff * diff;
        count++;
      }
    }

    return count > 0 ? distance / count : 0;
  }

  private computeLocalStatistics(
    data: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    windowSize: number,
    channel: number
  ): { mean: number; variance: number } {
    let sum = 0;
    let sumSquared = 0;
    let count = 0;
    const halfWindow = Math.floor(windowSize / 2);

    for (let dy = -halfWindow; dy <= halfWindow; dy++) {
      for (let dx = -halfWindow; dx <= halfWindow; dx++) {
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        const nx = Math.max(0, Math.min(width - 1, x + dx));
        const value = data[(ny * width + nx) * 4 + channel];

        sum += value;
        sumSquared += value * value;
        count++;
      }
    }

    const mean = sum / count;
    const variance = (sumSquared / count) - (mean * mean);

    return { mean, variance };
  }

  private findClosestISOProfile(camera: string, model: string, targetISO: number): NoiseProfile | null {
    let closestProfile: NoiseProfile | null = null;
    let minDistance = Infinity;

    for (const profile of this.noiseProfiles.values()) {
      if (profile.camera === camera && profile.model === model) {
        const distance = Math.abs(Math.log2(profile.iso) - Math.log2(targetISO));
        if (distance < minDistance) {
          minDistance = distance;
          closestProfile = profile;
        }
      }
    }

    return closestProfile;
  }

  /**
   * Get all available noise profiles
   */
  getAllNoiseProfiles(): NoiseProfile[] {
    return Array.from(this.noiseProfiles.values());
  }

  /**
   * Estimate noise level in image
   */
  estimateNoiseLevel(imageData: Float32Array, width: number, height: number): {
    luminanceNoise: number;
    chrominanceNoise: number;
    channelNoise: { red: number; green: number; blue: number };
  } {
    // Use Laplacian method for noise estimation
    const laplacianKernel = [0, -1, 0, -1, 4, -1, 0, -1, 0];

    let redVariance = 0;
    let greenVariance = 0;
    let blueVariance = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let laplacian = 0;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const neighIdx = ((y + ky) * width + (x + kx)) * 4 + c;
              const kernelIdx = (ky + 1) * 3 + (kx + 1);
              laplacian += imageData[neighIdx] * laplacianKernel[kernelIdx];
            }
          }

          const variance = laplacian * laplacian;
          if (c === 0) redVariance += variance;
          else if (c === 1) greenVariance += variance;
          else blueVariance += variance;
        }

        count++;
      }
    }

    const redNoise = Math.sqrt(redVariance / count) * Math.sqrt(Math.PI / 2);
    const greenNoise = Math.sqrt(greenVariance / count) * Math.sqrt(Math.PI / 2);
    const blueNoise = Math.sqrt(blueVariance / count) * Math.sqrt(Math.PI / 2);

    const luminanceNoise = 0.299 * redNoise + 0.587 * greenNoise + 0.114 * blueNoise;
    const chrominanceNoise = Math.sqrt((redNoise * redNoise + blueNoise * blueNoise) / 2);

    return {
      luminanceNoise,
      chrominanceNoise,
      channelNoise: { red: redNoise, green: greenNoise, blue: blueNoise }
    };
  }
}

export const noiseReductionService = NoiseReductionService.getInstance();