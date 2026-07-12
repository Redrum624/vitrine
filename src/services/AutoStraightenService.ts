/**
 * Auto-Straighten Service
 *
 * Automatically detects and corrects image rotation using:
 * - Canny edge detection
 * - Hough line transform
 * - Horizon/vertical line detection
 * - Intelligent angle calculation
 */

import { logger } from '../utils/Logger';

export interface StraightenResult {
  angle: number;           // Rotation angle in degrees (-45 to +45)
  confidence: number;      // 0-1, how confident we are in the result
  method: 'horizon' | 'vertical' | 'gradient' | 'failed';
  lines?: HoughLine[];     // Detected lines (for debugging)
}

export interface HoughLine {
  rho: number;            // Distance from origin
  theta: number;          // Angle in radians
  strength: number;       // Line strength (vote count)
  angle: number;          // Angle in degrees
}

export interface EdgeDetectionParams {
  lowThreshold: number;   // Canny low threshold
  highThreshold: number;  // Canny high threshold
  kernelSize: number;     // Sobel kernel size
}

export class AutoStraightenService {
  private static instance: AutoStraightenService;

  private constructor() {
    logger.info('AutoStraightenService initialized');
  }

  static getInstance(): AutoStraightenService {
    if (!AutoStraightenService.instance) {
      AutoStraightenService.instance = new AutoStraightenService();
    }
    return AutoStraightenService.instance;
  }

  /**
   * Main auto-straighten function
   * Detects rotation and returns correction angle
   */
  async detectRotation(
    imageData: Float32Array,
    width: number,
    height: number
  ): Promise<StraightenResult> {
    const startTime = performance.now();

    try {
      // Convert to grayscale for edge detection
      const gray = this.toGrayscale(imageData, width, height);

      // Detect edges using Canny
      const edges = this.cannyEdgeDetection(gray, width, height, {
        lowThreshold: 0.05,
        highThreshold: 0.15,
        kernelSize: 3
      });

      // Detect lines using Hough transform
      const lines = this.houghLineDetection(edges, width, height);

      // Find horizon or vertical lines
      const horizonAngle = this.findHorizonAngle(lines);
      const verticalAngle = this.findVerticalAngle(lines);

      // Determine best angle
      let angle = 0;
      let confidence = 0;
      let method: StraightenResult['method'] = 'failed';

      if (horizonAngle.confidence > verticalAngle.confidence) {
        angle = horizonAngle.angle;
        confidence = horizonAngle.confidence;
        method = 'horizon';
      } else if (verticalAngle.confidence > 0.3) {
        angle = verticalAngle.angle;
        confidence = verticalAngle.confidence;
        method = 'vertical';
      }

      // Fallback to gradient method if confidence is low
      if (confidence < 0.3) {
        const gradientResult = this.gradientBasedRotation(gray, width, height);
        if (gradientResult.confidence > confidence) {
          angle = gradientResult.angle;
          confidence = gradientResult.confidence;
          method = 'gradient';
        }
      }

      const elapsed = performance.now() - startTime;
      logger.info(`Auto-straighten: ${method}, angle=${angle.toFixed(2)}°, confidence=${confidence.toFixed(2)}, time=${elapsed.toFixed(1)}ms`);

      return {
        angle,
        confidence,
        method,
        lines: method !== 'failed' ? lines : undefined
      };

    } catch (error) {
      logger.error('Auto-straighten failed:', error);
      return {
        angle: 0,
        confidence: 0,
        method: 'failed'
      };
    }
  }

  /**
   * Convert to grayscale
   */
  private toGrayscale(imageData: Float32Array, width: number, height: number): Float32Array {
    const gray = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      // Rec. 709 luminance
      gray[i] = 0.2126 * imageData[idx] + 0.7152 * imageData[idx + 1] + 0.0722 * imageData[idx + 2];
    }

    return gray;
  }

  /**
   * Canny edge detection
   */
  private cannyEdgeDetection(
    gray: Float32Array,
    width: number,
    height: number,
    params: EdgeDetectionParams
  ): Float32Array {
    // 1. Gaussian blur (noise reduction)
    const blurred = this.gaussianBlur(gray, width, height, 1.4);

    // 2. Sobel operator (gradient magnitude and direction)
    const { magnitude, direction } = this.sobelOperator(blurred, width, height);

    // 3. Non-maximum suppression
    const suppressed = this.nonMaximumSuppression(magnitude, direction, width, height);

    // 4. Double threshold and edge tracking
    const edges = this.doubleThreshold(suppressed, width, height, params.lowThreshold, params.highThreshold);

    return edges;
  }

  /**
   * Gaussian blur
   */
  private gaussianBlur(data: Float32Array, width: number, height: number, sigma: number): Float32Array {
    const kernel = this.createGaussianKernel(sigma);
    const kernelSize = kernel.length;
    const halfSize = Math.floor(kernelSize / 2);

    const output = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;

        for (let ky = 0; ky < kernelSize; ky++) {
          for (let kx = 0; kx < kernelSize; kx++) {
            const px = x + kx - halfSize;
            const py = y + ky - halfSize;

            if (px >= 0 && px < width && py >= 0 && py < height) {
              const weight = kernel[ky * kernelSize + kx];
              sum += data[py * width + px] * weight;
              weightSum += weight;
            }
          }
        }

        output[y * width + x] = sum / weightSum;
      }
    }

    return output;
  }

  /**
   * Create Gaussian kernel
   */
  private createGaussianKernel(sigma: number): Float32Array {
    const size = Math.ceil(sigma * 3) * 2 + 1;
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
   * Sobel operator for gradient calculation
   */
  private sobelOperator(
    data: Float32Array,
    width: number,
    height: number
  ): { magnitude: Float32Array; direction: Float32Array } {
    const magnitude = new Float32Array(width * height);
    const direction = new Float32Array(width * height);

    // Sobel kernels
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0;
        let gy = 0;

        // Apply Sobel kernels
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = (y + ky) * width + (x + kx);
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            const value = data[idx];

            gx += value * sobelX[kernelIdx];
            gy += value * sobelY[kernelIdx];
          }
        }

        const idx = y * width + x;
        magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
        direction[idx] = Math.atan2(gy, gx);
      }
    }

    return { magnitude, direction };
  }

  /**
   * Non-maximum suppression
   */
  private nonMaximumSuppression(
    magnitude: Float32Array,
    direction: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    const output = new Float32Array(width * height);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const angle = direction[idx];
        const mag = magnitude[idx];

        // Determine neighbor direction
        let dx = 0, dy = 0;
        const angleNorm = ((angle * 180 / Math.PI) + 180) % 180;

        if (angleNorm < 22.5 || angleNorm >= 157.5) {
          dx = 1; dy = 0;  // Horizontal
        } else if (angleNorm < 67.5) {
          dx = 1; dy = -1; // Diagonal /
        } else if (angleNorm < 112.5) {
          dx = 0; dy = 1;  // Vertical
        } else {
          dx = 1; dy = 1;  // Diagonal \
        }

        const idx1 = (y + dy) * width + (x + dx);
        const idx2 = (y - dy) * width + (x - dx);

        // Suppress if not local maximum
        if (mag >= magnitude[idx1] && mag >= magnitude[idx2]) {
          output[idx] = mag;
        }
      }
    }

    return output;
  }

  /**
   * Double threshold for edge tracking
   */
  private doubleThreshold(
    magnitude: Float32Array,
    width: number,
    height: number,
    lowThreshold: number,
    highThreshold: number
  ): Float32Array {
    const output = new Float32Array(width * height);

    // Normalize magnitude to 0-1
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i++) {
      if (magnitude[i] > maxMag) maxMag = magnitude[i];
    }

    for (let i = 0; i < magnitude.length; i++) {
      const normalizedMag = magnitude[i] / maxMag;

      if (normalizedMag >= highThreshold) {
        output[i] = 1.0;  // Strong edge
      } else if (normalizedMag >= lowThreshold) {
        output[i] = 0.5;  // Weak edge
      }
    }

    // Edge tracking by hysteresis (connect weak edges to strong edges)
    // Simplified version - full implementation would use BFS/DFS
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (output[idx] === 0.5) {
          // Check if connected to strong edge
          let hasStrongNeighbor = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (output[(y + dy) * width + (x + dx)] === 1.0) {
                hasStrongNeighbor = true;
                break;
              }
            }
            if (hasStrongNeighbor) break;
          }

          output[idx] = hasStrongNeighbor ? 1.0 : 0.0;
        }
      }
    }

    return output;
  }

  /**
   * Hough line detection
   */
  private houghLineDetection(
    edges: Float32Array,
    width: number,
    height: number
  ): HoughLine[] {
    // Hough space parameters
    const thetaResolution = Math.PI / 180;  // 1 degree
    const numThetas = 180;
    const diagonal = Math.sqrt(width * width + height * height);
    const rhoResolution = 1;
    const numRhos = Math.ceil(diagonal / rhoResolution) * 2;

    // Accumulator array
    const accumulator = new Float32Array(numThetas * numRhos);

    // Vote for lines
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] > 0.5) {
          // This is an edge pixel - vote for all possible lines through it
          for (let thetaIdx = 0; thetaIdx < numThetas; thetaIdx++) {
            const theta = thetaIdx * thetaResolution;
            const rho = x * Math.cos(theta) + y * Math.sin(theta);
            const rhoIdx = Math.floor(rho / rhoResolution) + Math.floor(numRhos / 2);

            if (rhoIdx >= 0 && rhoIdx < numRhos) {
              accumulator[thetaIdx * numRhos + rhoIdx]++;
            }
          }
        }
      }
    }

    // Find peaks in accumulator (top lines)
    const lines: HoughLine[] = [];
    const threshold = Math.max(...accumulator) * 0.5;  // 50% of max votes

    for (let thetaIdx = 0; thetaIdx < numThetas; thetaIdx++) {
      for (let rhoIdx = 0; rhoIdx < numRhos; rhoIdx++) {
        const strength = accumulator[thetaIdx * numRhos + rhoIdx];

        if (strength > threshold) {
          const theta = thetaIdx * thetaResolution;
          const rho = (rhoIdx - Math.floor(numRhos / 2)) * rhoResolution;
          const angle = (theta * 180 / Math.PI) - 90;  // Convert to degrees

          lines.push({ rho, theta, strength, angle });
        }
      }
    }

    // Sort by strength
    lines.sort((a, b) => b.strength - a.strength);

    // Return top 20 lines
    return lines.slice(0, 20);
  }

  /**
   * Find horizon angle from detected lines
   */
  private findHorizonAngle(lines: HoughLine[]): { angle: number; confidence: number } {
    // Filter for near-horizontal lines (-10° to +10°)
    const horizontalLines = lines.filter(line => {
      const absAngle = Math.abs(line.angle);
      return absAngle < 10;
    });

    if (horizontalLines.length === 0) {
      return { angle: 0, confidence: 0 };
    }

    // Weighted average of angles
    let sumAngle = 0;
    let sumWeight = 0;

    for (const line of horizontalLines) {
      sumAngle += line.angle * line.strength;
      sumWeight += line.strength;
    }

    const angle = -sumAngle / sumWeight;  // Negative to correct rotation
    const confidence = Math.min(1, horizontalLines.length / 5);  // More lines = more confident

    return { angle, confidence };
  }

  /**
   * Find vertical angle from detected lines
   */
  private findVerticalAngle(lines: HoughLine[]): { angle: number; confidence: number } {
    // Filter for near-vertical lines (80° to 100° or -100° to -80°)
    const verticalLines = lines.filter(line => {
      const absAngle = Math.abs(line.angle);
      return absAngle > 80 && absAngle < 100;
    });

    if (verticalLines.length === 0) {
      return { angle: 0, confidence: 0 };
    }

    // Weighted average
    let sumAngle = 0;
    let sumWeight = 0;

    for (const line of verticalLines) {
      // Convert vertical angles to rotation angle
      const rotAngle = line.angle > 0 ? 90 - line.angle : -90 - line.angle;
      sumAngle += rotAngle * line.strength;
      sumWeight += line.strength;
    }

    const angle = -sumAngle / sumWeight;
    const confidence = Math.min(1, verticalLines.length / 5);

    return { angle, confidence };
  }

  /**
   * Gradient-based rotation detection (fallback method)
   */
  private gradientBasedRotation(
    gray: Float32Array,
    width: number,
    height: number
  ): { angle: number; confidence: number } {
    // Calculate dominant gradient direction
    const { direction } = this.sobelOperator(gray, width, height);

    // Histogram of gradient directions
    const histogram = new Float32Array(180);

    for (let i = 0; i < direction.length; i++) {
      const angle = ((direction[i] * 180 / Math.PI) + 180) % 180;
      const bin = Math.floor(angle);
      histogram[bin]++;
    }

    // Find dominant direction
    let maxBin = 0;
    let maxCount = 0;

    for (let i = 0; i < 180; i++) {
      if (histogram[i] > maxCount) {
        maxCount = histogram[i];
        maxBin = i;
      }
    }

    // Convert to rotation angle
    const angle = maxBin > 90 ? maxBin - 90 : maxBin;
    const confidence = 0.3;  // Low confidence for gradient method

    return { angle: -angle, confidence };
  }
}

export const autoStraightenService = AutoStraightenService.getInstance();
