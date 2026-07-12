import { logger } from '../utils/Logger';

export interface RefinementSettings {
  featherRadius: number;
  smooth: number;
  contrast: number;
  edgeDetection: {
    enabled: boolean;
    threshold: number;
    radius: number;
  };
  choke: number; // Expand/contract mask
  denoise: number;
}

export interface EdgeDetectionResult {
  edges: Float32Array;
  gradient: Float32Array;
  strength: number;
}

export class MaskRefinementService {
  private static instance: MaskRefinementService;

  private constructor() {}

  static getInstance(): MaskRefinementService {
    if (!MaskRefinementService.instance) {
      MaskRefinementService.instance = new MaskRefinementService();
    }
    return MaskRefinementService.instance;
  }

  /**
   * Refine mask with multiple operations
   */
  refineMask(
    maskData: Float32Array,
    width: number,
    height: number,
    settings: RefinementSettings
  ): Float32Array {
    const startTime = performance.now();
    let result = new Float32Array(maskData);

    // Apply operations in order
    if (settings.denoise > 0) {
      result = new Float32Array(this.denoiseMask(result, width, height, settings.denoise));
    }

    if (settings.choke !== 0) {
      result = new Float32Array(this.chokeMask(result, width, height, settings.choke));
    }

    if (settings.smooth > 0) {
      result = new Float32Array(this.smoothMask(result, width, height, settings.smooth));
    }

    if (settings.contrast !== 0) {
      result = new Float32Array(this.adjustMaskContrast(result, settings.contrast));
    }

    if (settings.featherRadius > 0) {
      result = new Float32Array(this.featherMask(result, width, height, settings.featherRadius));
    }

    if (settings.edgeDetection.enabled) {
      result = new Float32Array(this.refineWithEdgeDetection(result, width, height, settings.edgeDetection));
    }

    const processingTime = performance.now() - startTime;
    logger.debug(`Refined mask in ${processingTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Feather mask edges
   */
  featherMask(
    maskData: Float32Array,
    width: number,
    height: number,
    radius: number
  ): Float32Array {
    if (radius <= 0) return maskData;

    const kernelSize = Math.ceil(radius * 2) * 2 + 1;
    const kernel = this.createGaussianKernel(kernelSize, radius);

    return this.applyConvolution(maskData, width, height, kernel, kernelSize);
  }

  /**
   * Smooth mask
   */
  smoothMask(
    maskData: Float32Array,
    width: number,
    height: number,
    strength: number
  ): Float32Array {
    if (strength <= 0) return maskData;

    // Use bilateral filter for edge-preserving smoothing
    const result = new Float32Array(maskData.length);
    const spatialSigma = strength * 2;
    const intensitySigma = 0.1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIndex = y * width + x;
        const centerValue = maskData[centerIndex];

        let weightSum = 0;
        let valueSum = 0;

        const radius = Math.ceil(spatialSigma * 2);

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;

            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const neighborIndex = ny * width + nx;
              const neighborValue = maskData[neighborIndex];

              const spatialDistance = Math.sqrt(dx * dx + dy * dy);
              const intensityDistance = Math.abs(centerValue - neighborValue);

              const spatialWeight = Math.exp(-(spatialDistance * spatialDistance) / (2 * spatialSigma * spatialSigma));
              const intensityWeight = Math.exp(-(intensityDistance * intensityDistance) / (2 * intensitySigma * intensitySigma));

              const weight = spatialWeight * intensityWeight;

              weightSum += weight;
              valueSum += neighborValue * weight;
            }
          }
        }

        result[centerIndex] = weightSum > 0 ? valueSum / weightSum : centerValue;
      }
    }

    return result;
  }

  /**
   * Adjust mask contrast
   */
  adjustMaskContrast(maskData: Float32Array, contrast: number): Float32Array {
    if (contrast === 0) return maskData;

    const result = new Float32Array(maskData.length);
    const factor = Math.pow(2, contrast);

    for (let i = 0; i < maskData.length; i++) {
      const value = maskData[i];

      // Apply contrast around midpoint
      const adjusted = 0.5 + (value - 0.5) * factor;
      result[i] = Math.max(0, Math.min(1, adjusted));
    }

    return result;
  }

  /**
   * Choke/expand mask
   */
  chokeMask(
    maskData: Float32Array,
    width: number,
    height: number,
    amount: number
  ): Float32Array {
    if (amount === 0) return maskData;

    const result = new Float32Array(maskData);
    const iterations = Math.abs(amount);
    const isExpand = amount > 0;

    for (let iter = 0; iter < iterations; iter++) {
      const temp = new Float32Array(result);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = y * width + x;

          // Get 3x3 neighborhood
          const neighbors = [
            temp[(y - 1) * width + (x - 1)], temp[(y - 1) * width + x], temp[(y - 1) * width + (x + 1)],
            temp[y * width + (x - 1)],       temp[y * width + x],       temp[y * width + (x + 1)],
            temp[(y + 1) * width + (x - 1)], temp[(y + 1) * width + x], temp[(y + 1) * width + (x + 1)]
          ];

          if (isExpand) {
            // Dilation - take maximum
            result[index] = Math.max(...neighbors);
          } else {
            // Erosion - take minimum
            result[index] = Math.min(...neighbors);
          }
        }
      }
    }

    return result;
  }

  /**
   * Denoise mask
   */
  denoiseMask(
    maskData: Float32Array,
    width: number,
    height: number,
    strength: number
  ): Float32Array {
    if (strength <= 0) return maskData;

    // Use median filter for noise reduction
    const result = new Float32Array(maskData.length);
    const radius = Math.ceil(strength);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const neighborhood: number[] = [];

        // Collect neighborhood values
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = Math.max(0, Math.min(height - 1, y + dy));
            const nx = Math.max(0, Math.min(width - 1, x + dx));
            neighborhood.push(maskData[ny * width + nx]);
          }
        }

        // Find median
        neighborhood.sort((a, b) => a - b);
        const median = neighborhood[Math.floor(neighborhood.length / 2)];

        result[index] = median;
      }
    }

    return result;
  }

  /**
   * Refine mask using edge detection
   */
  refineWithEdgeDetection(
    maskData: Float32Array,
    width: number,
    height: number,
    edgeSettings: { threshold: number; radius: number }
  ): Float32Array {
    // Detect edges in the mask
    const edges = this.detectEdges(maskData, width, height);

    // Use edges to refine mask boundaries
    const result = new Float32Array(maskData.length);

    for (let i = 0; i < maskData.length; i++) {
      const maskValue = maskData[i];
      const edgeValue = edges[i];

      if (edgeValue > edgeSettings.threshold) {
        // Near an edge - apply refinement
        const refinement = this.calculateEdgeRefinement(
          i, maskData, edges, width, height, edgeSettings.radius
        );
        result[i] = maskValue * refinement;
      } else {
        result[i] = maskValue;
      }
    }

    return result;
  }

  /**
   * Detect edges using Sobel operator
   */
  detectEdges(maskData: Float32Array, width: number, height: number): Float32Array {
    const edges = new Float32Array(maskData.length);

    // Sobel kernels
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;

        let gx = 0, gy = 0;

        // Apply Sobel kernels
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pixelIndex = (y + ky) * width + (x + kx);
            const kernelIndex = (ky + 1) * 3 + (kx + 1);

            gx += maskData[pixelIndex] * sobelX[kernelIndex];
            gy += maskData[pixelIndex] * sobelY[kernelIndex];
          }
        }

        // Calculate edge magnitude
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[index] = Math.min(1, magnitude);
      }
    }

    return edges;
  }

  /**
   * Calculate edge refinement
   */
  private calculateEdgeRefinement(
    index: number,
    _maskData: Float32Array,
    edges: Float32Array,
    width: number,
    height: number,
    radius: number
  ): number {
    const x = index % width;
    const y = Math.floor(index / width);

    let totalWeight = 0;
    let weightedSum = 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborIndex = ny * width + nx;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const weight = Math.exp(-distance / radius);

          totalWeight += weight;
          weightedSum += edges[neighborIndex] * weight;
        }
      }
    }

    const averageEdge = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return 1 - averageEdge * 0.5; // Reduce mask strength near strong edges
  }

  /**
   * Create Gaussian kernel
   */
  private createGaussianKernel(size: number, sigma: number): Float32Array {
    const kernel = new Float32Array(size * size);
    const center = Math.floor(size / 2);
    let sum = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        kernel[y * size + x] = value;
        sum += value;
      }
    }

    // Normalize
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= sum;
    }

    return kernel;
  }

  /**
   * Apply convolution to mask
   */
  private applyConvolution(
    maskData: Float32Array,
    width: number,
    height: number,
    kernel: Float32Array,
    kernelSize: number
  ): Float32Array {
    const result = new Float32Array(maskData.length);
    const offset = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const outputIndex = y * width + x;
        let sum = 0;

        for (let ky = 0; ky < kernelSize; ky++) {
          for (let kx = 0; kx < kernelSize; kx++) {
            const inputY = Math.max(0, Math.min(height - 1, y + ky - offset));
            const inputX = Math.max(0, Math.min(width - 1, x + kx - offset));
            const inputIndex = inputY * width + inputX;
            const kernelIndex = ky * kernelSize + kx;

            sum += maskData[inputIndex] * kernel[kernelIndex];
          }
        }

        result[outputIndex] = Math.max(0, Math.min(1, sum));
      }
    }

    return result;
  }

  /**
   * Auto-refine mask based on content
   */
  autoRefineMask(
    maskData: Float32Array,
    imageData: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    // Analyze mask and image to determine optimal refinement
    const edgeStrength = this.analyzeMaskEdges(maskData, width, height);
    const imageComplexity = this.analyzeImageComplexity(imageData, width, height);

    const settings: RefinementSettings = {
      featherRadius: edgeStrength > 0.5 ? 2 : 1,
      smooth: imageComplexity > 0.7 ? 1.5 : 0.5,
      contrast: edgeStrength < 0.3 ? 0.5 : 0,
      edgeDetection: {
        enabled: imageComplexity > 0.6,
        threshold: 0.3,
        radius: 2
      },
      choke: 0,
      denoise: imageComplexity > 0.8 ? 1 : 0
    };

    return this.refineMask(maskData, width, height, settings);
  }

  /**
   * Analyze mask edge characteristics
   */
  private analyzeMaskEdges(maskData: Float32Array, width: number, height: number): number {
    const edges = this.detectEdges(maskData, width, height);
    let totalEdge = 0;

    for (let i = 0; i < edges.length; i++) {
      totalEdge += edges[i];
    }

    return totalEdge / edges.length;
  }

  /**
   * Analyze image complexity
   */
  private analyzeImageComplexity(imageData: Float32Array, width: number, height: number): number {
    let totalVariation = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = (y * width + x) * 4;

        // Calculate local variation
        const neighbors = [
          imageData[((y - 1) * width + x) * 4],     // top
          imageData[((y + 1) * width + x) * 4],     // bottom
          imageData[(y * width + (x - 1)) * 4],     // left
          imageData[(y * width + (x + 1)) * 4]      // right
        ];

        const center = imageData[index];
        let variation = 0;

        neighbors.forEach(neighbor => {
          variation += Math.abs(center - neighbor);
        });

        totalVariation += variation / neighbors.length;
        count++;
      }
    }

    return count > 0 ? totalVariation / count : 0;
  }

  /**
   * Create mask from alpha channel
   */
  createMaskFromAlpha(imageData: Float32Array): Float32Array {
    const maskData = new Float32Array(imageData.length / 4);

    for (let i = 0; i < maskData.length; i++) {
      maskData[i] = imageData[i * 4 + 3]; // Extract alpha channel
    }

    return maskData;
  }

  /**
   * Apply mask to image
   */
  applyMaskToImage(
    imageData: Float32Array,
    maskData: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    const result = new Float32Array(imageData.length);

    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4;
      const maskValue = maskData[i];

      result[pixelIndex] = imageData[pixelIndex];
      result[pixelIndex + 1] = imageData[pixelIndex + 1];
      result[pixelIndex + 2] = imageData[pixelIndex + 2];
      result[pixelIndex + 3] = imageData[pixelIndex + 3] * maskValue;
    }

    return result;
  }

  /**
   * Calculate mask statistics
   */
  calculateMaskStatistics(maskData: Float32Array): {
    coverage: number;
    average: number;
    edges: number;
    smoothness: number;
  } {
    let sum = 0;
    let coverage = 0;
    let edgeCount = 0;
    let totalVariation = 0;

    for (let i = 0; i < maskData.length; i++) {
      const value = maskData[i];
      sum += value;

      if (value > 0.01) {
        coverage++;
      }

      // Calculate local variation for smoothness
      if (i > 0) {
        const variation = Math.abs(value - maskData[i - 1]);
        totalVariation += variation;

        if (variation > 0.1) {
          edgeCount++;
        }
      }
    }

    return {
      coverage: coverage / maskData.length,
      average: sum / maskData.length,
      edges: edgeCount / maskData.length,
      smoothness: 1 - (totalVariation / maskData.length)
    };
  }
}

// Export singleton instance
export const maskRefinementService = MaskRefinementService.getInstance();