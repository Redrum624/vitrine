import { logger } from '../utils/Logger';

export interface LensProfile {
  camera: string;
  lens: string;
  focalLength: number;
  aperture: number;

  // Distortion correction coefficients
  distortionK1: number;
  distortionK2: number;
  distortionK3: number;

  // Vignetting correction
  vignettingA: number;
  vignettingB: number;
  vignettingC: number;

  // Chromatic aberration correction
  caRedScale: number;
  caBlueScale: number;

  // Optical center
  centerX: number;
  centerY: number;
}

export interface LensCorrections {
  distortion: boolean;
  vignetting: boolean;
  chromaticAberration: boolean;
  autoDetect: boolean;
}

export interface LensDetectionResult {
  camera?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  confidence: number;
}

/**
 * Professional Lens Profile Service
 * Provides automatic lens detection and correction application
 */
export class LensProfileService {
  private static instance: LensProfileService;
  private lensProfiles: Map<string, LensProfile[]> = new Map();

  static getInstance(): LensProfileService {
    if (!LensProfileService.instance) {
      LensProfileService.instance = new LensProfileService();
    }
    return LensProfileService.instance;
  }

  constructor() {
    this.initializeLensProfiles();
  }

  /**
   * Initialize built-in lens profiles for common camera/lens combinations
   */
  private initializeLensProfiles(): void {
    // Canon EOS R5 profiles
    this.addLensProfile({
      camera: 'Canon',
      lens: 'RF 24-70mm f/2.8L IS USM',
      focalLength: 24,
      aperture: 2.8,
      distortionK1: -0.0234,
      distortionK2: 0.0003,
      distortionK3: -0.0000012,
      vignettingA: 0.8,
      vignettingB: 0.15,
      vignettingC: 0.05,
      caRedScale: 1.0008,
      caBlueScale: 0.9992,
      centerX: 0.5,
      centerY: 0.5
    });

    this.addLensProfile({
      camera: 'Canon',
      lens: 'RF 24-70mm f/2.8L IS USM',
      focalLength: 70,
      aperture: 2.8,
      distortionK1: 0.0156,
      distortionK2: -0.0002,
      distortionK3: 0.0000008,
      vignettingA: 0.85,
      vignettingB: 0.12,
      vignettingC: 0.03,
      caRedScale: 1.0006,
      caBlueScale: 0.9994,
      centerX: 0.5,
      centerY: 0.5
    });

    this.addLensProfile({
      camera: 'Canon',
      lens: 'RF 85mm f/1.2L USM',
      focalLength: 85,
      aperture: 1.2,
      distortionK1: 0.0087,
      distortionK2: -0.0001,
      distortionK3: 0.0000005,
      vignettingA: 0.72,
      vignettingB: 0.22,
      vignettingC: 0.06,
      caRedScale: 1.0004,
      caBlueScale: 0.9996,
      centerX: 0.5,
      centerY: 0.5
    });

    // Nikon Z7 profiles
    this.addLensProfile({
      camera: 'Nikon',
      lens: 'NIKKOR Z 24-70mm f/2.8 S',
      focalLength: 24,
      aperture: 2.8,
      distortionK1: -0.0287,
      distortionK2: 0.0004,
      distortionK3: -0.0000015,
      vignettingA: 0.78,
      vignettingB: 0.17,
      vignettingC: 0.05,
      caRedScale: 1.0009,
      caBlueScale: 0.9991,
      centerX: 0.5,
      centerY: 0.5
    });

    this.addLensProfile({
      camera: 'Nikon',
      lens: 'NIKKOR Z 85mm f/1.8 S',
      focalLength: 85,
      aperture: 1.8,
      distortionK1: 0.0093,
      distortionK2: -0.0001,
      distortionK3: 0.0000006,
      vignettingA: 0.88,
      vignettingB: 0.09,
      vignettingC: 0.03,
      caRedScale: 1.0003,
      caBlueScale: 0.9997,
      centerX: 0.5,
      centerY: 0.5
    });

    // Sony A7R IV profiles
    this.addLensProfile({
      camera: 'Sony',
      lens: 'FE 24-70mm f/2.8 GM',
      focalLength: 24,
      aperture: 2.8,
      distortionK1: -0.0213,
      distortionK2: 0.0002,
      distortionK3: -0.0000008,
      vignettingA: 0.82,
      vignettingB: 0.14,
      vignettingC: 0.04,
      caRedScale: 1.0007,
      caBlueScale: 0.9993,
      centerX: 0.5,
      centerY: 0.5
    });

    this.addLensProfile({
      camera: 'Sony',
      lens: 'FE 85mm f/1.4 GM',
      focalLength: 85,
      aperture: 1.4,
      distortionK1: 0.0076,
      distortionK2: -0.00008,
      distortionK3: 0.0000004,
      vignettingA: 0.76,
      vignettingB: 0.19,
      vignettingC: 0.05,
      caRedScale: 1.0005,
      caBlueScale: 0.9995,
      centerX: 0.5,
      centerY: 0.5
    });

    // Fujifilm X-T4 profiles
    this.addLensProfile({
      camera: 'Fujifilm',
      lens: 'XF 16-55mm f/2.8 R LM WR',
      focalLength: 16,
      aperture: 2.8,
      distortionK1: -0.0345,
      distortionK2: 0.0006,
      distortionK3: -0.000002,
      vignettingA: 0.79,
      vignettingB: 0.16,
      vignettingC: 0.05,
      caRedScale: 1.0011,
      caBlueScale: 0.9989,
      centerX: 0.5,
      centerY: 0.5
    });

    this.addLensProfile({
      camera: 'Fujifilm',
      lens: 'XF 56mm f/1.2 R',
      focalLength: 56,
      aperture: 1.2,
      distortionK1: 0.0065,
      distortionK2: -0.00006,
      distortionK3: 0.0000003,
      vignettingA: 0.74,
      vignettingB: 0.21,
      vignettingC: 0.05,
      caRedScale: 1.0004,
      caBlueScale: 0.9996,
      centerX: 0.5,
      centerY: 0.5
    });

    logger.info(`Initialized ${this.getTotalProfileCount()} lens profiles across ${this.lensProfiles.size} camera systems`);
  }

  /**
   * Add lens profile to database
   */
  addLensProfile(profile: LensProfile): void {
    const key = `${profile.camera}_${profile.lens}`;

    if (!this.lensProfiles.has(key)) {
      this.lensProfiles.set(key, []);
    }

    this.lensProfiles.get(key)!.push(profile);

    // Sort by focal length for easier lookup
    this.lensProfiles.get(key)!.sort((a, b) => a.focalLength - b.focalLength);
  }

  /**
   * Detect lens from EXIF metadata
   */
  detectLens(metadata: Record<string, unknown>): LensDetectionResult {
    const camera = this.extractCameraInfo(metadata);
    const lens = this.extractLensInfo(metadata);
    const focalLength = this.extractFocalLength(metadata);
    const aperture = this.extractAperture(metadata);

    let confidence = 0;

    if (camera) confidence += 0.3;
    if (lens) confidence += 0.4;
    if (focalLength) confidence += 0.2;
    if (aperture) confidence += 0.1;

    return {
      camera,
      lens,
      focalLength,
      aperture,
      confidence
    };
  }

  /**
   * Get lens profile for specific camera, lens, and settings
   */
  getLensProfile(camera: string, lens: string, focalLength?: number, aperture?: number): LensProfile | null {
    const key = `${camera}_${lens}`;
    const profiles = this.lensProfiles.get(key);

    if (!profiles || profiles.length === 0) {
      return null;
    }

    // If no specific focal length requested, return first profile
    if (!focalLength) {
      return profiles[0];
    }

    // Find exact match first
    const exactMatch = profiles.find(p =>
      p.focalLength === focalLength &&
      (aperture === undefined || Math.abs(p.aperture - aperture) < 0.1)
    );

    if (exactMatch) {
      return exactMatch;
    }

    // Find closest focal length match
    let closest = profiles[0];
    let minDistance = Math.abs(closest.focalLength - focalLength);

    for (const profile of profiles) {
      const distance = Math.abs(profile.focalLength - focalLength);
      if (distance < minDistance) {
        minDistance = distance;
        closest = profile;
      }
    }

    return closest;
  }

  /**
   * Apply lens corrections to image data
   */
  async applyLensCorrections(
    imageData: Float32Array,
    width: number,
    height: number,
    profile: LensProfile,
    corrections: LensCorrections
  ): Promise<Float32Array> {
    const startTime = performance.now();
    logger.info('Applying lens corrections', {
      lens: `${profile.camera} ${profile.lens}`,
      focalLength: profile.focalLength,
      corrections: Object.entries(corrections).filter(([_, enabled]) => enabled).map(([type]) => type)
    });

    let result = new Float32Array(imageData.length);
    result.set(imageData);

    // Apply corrections in order of visual importance
    if (corrections.distortion) {
      const distortionResult = await this.correctDistortion(result, width, height, profile);
      result = new Float32Array(distortionResult);
    }

    if (corrections.vignetting) {
      const vignettingResult = await this.correctVignetting(result, width, height, profile);
      result = new Float32Array(vignettingResult);
    }

    if (corrections.chromaticAberration) {
      const caResult = await this.correctChromaticAberration(result, width, height, profile);
      result = new Float32Array(caResult);
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Lens corrections completed in ${processingTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Correct barrel/pincushion distortion
   */
  private async correctDistortion(
    imageData: Float32Array,
    width: number,
    height: number,
    profile: LensProfile
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData.length);
    const centerX = width * profile.centerX;
    const centerY = height * profile.centerY;
    const maxRadius = Math.sqrt((width * width + height * height) / 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIdx = (y * width + x) * 4;

        // Calculate normalized coordinates from center
        const dx = (x - centerX) / maxRadius;
        const dy = (y - centerY) / maxRadius;
        const r2 = dx * dx + dy * dy;
        const r4 = r2 * r2;
        const r6 = r4 * r2;

        // Apply distortion correction formula
        const factor = 1 + profile.distortionK1 * r2 + profile.distortionK2 * r4 + profile.distortionK3 * r6;

        // Calculate source coordinates
        const srcX = centerX + dx * maxRadius / factor;
        const srcY = centerY + dy * maxRadius / factor;

        // Bilinear interpolation
        if (srcX >= 0 && srcX < width - 1 && srcY >= 0 && srcY < height - 1) {
          const x1 = Math.floor(srcX);
          const y1 = Math.floor(srcY);
          const x2 = x1 + 1;
          const y2 = y1 + 1;

          const fx = srcX - x1;
          const fy = srcY - y1;

          for (let c = 0; c < 4; c++) {
            const tl = imageData[(y1 * width + x1) * 4 + c];
            const tr = imageData[(y1 * width + x2) * 4 + c];
            const bl = imageData[(y2 * width + x1) * 4 + c];
            const br = imageData[(y2 * width + x2) * 4 + c];

            const top = tl + (tr - tl) * fx;
            const bottom = bl + (br - bl) * fx;
            result[destIdx + c] = top + (bottom - top) * fy;
          }
        } else {
          // Fill with black for out-of-bounds
          result[destIdx] = 0;
          result[destIdx + 1] = 0;
          result[destIdx + 2] = 0;
          result[destIdx + 3] = imageData[destIdx + 3]; // Preserve alpha
        }
      }
    }

    return result;
  }

  /**
   * Correct vignetting (darkening at edges)
   */
  private async correctVignetting(
    imageData: Float32Array,
    width: number,
    height: number,
    profile: LensProfile
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData);
    const centerX = width * profile.centerX;
    const centerY = height * profile.centerY;
    const maxRadius = Math.sqrt((width * width + height * height) / 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Calculate distance from center
        const dx = (x - centerX) / maxRadius;
        const dy = (y - centerY) / maxRadius;
        const r2 = dx * dx + dy * dy;

        // Calculate vignetting correction factor
        const vignettingFactor = profile.vignettingA + profile.vignettingB * r2 + profile.vignettingC * r2 * r2;
        const correctionFactor = 1 / Math.max(0.1, vignettingFactor); // Prevent division by zero

        // Apply to RGB channels only
        for (let c = 0; c < 3; c++) {
          result[idx + c] = Math.min(1, imageData[idx + c] * correctionFactor);
        }
        // Alpha unchanged
        result[idx + 3] = imageData[idx + 3];
      }
    }

    return result;
  }

  /**
   * Correct chromatic aberration (color fringing)
   */
  private async correctChromaticAberration(
    imageData: Float32Array,
    width: number,
    height: number,
    profile: LensProfile
  ): Promise<Float32Array> {
    const result = new Float32Array(imageData);
    const centerX = width * profile.centerX;
    const centerY = height * profile.centerY;

    // Correct red and blue channels separately
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destIdx = (y * width + x) * 4;

        // Red channel correction
        const redX = centerX + (x - centerX) * profile.caRedScale;
        const redY = centerY + (y - centerY) * profile.caRedScale;

        if (redX >= 0 && redX < width - 1 && redY >= 0 && redY < height - 1) {
          result[destIdx] = this.interpolatePixel(imageData, width, height, redX, redY, 0);
        } else {
          result[destIdx] = imageData[destIdx];
        }

        // Green channel unchanged (reference)
        result[destIdx + 1] = imageData[destIdx + 1];

        // Blue channel correction
        const blueX = centerX + (x - centerX) * profile.caBlueScale;
        const blueY = centerY + (y - centerY) * profile.caBlueScale;

        if (blueX >= 0 && blueX < width - 1 && blueY >= 0 && blueY < height - 1) {
          result[destIdx + 2] = this.interpolatePixel(imageData, width, height, blueX, blueY, 2);
        } else {
          result[destIdx + 2] = imageData[destIdx + 2];
        }

        // Alpha unchanged
        result[destIdx + 3] = imageData[destIdx + 3];
      }
    }

    return result;
  }

  /**
   * Bilinear interpolation for pixel values
   */
  private interpolatePixel(
    imageData: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    channel: number
  ): number {
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(width - 1, x1 + 1);
    const y2 = Math.min(height - 1, y1 + 1);

    const fx = x - x1;
    const fy = y - y1;

    const tl = imageData[(y1 * width + x1) * 4 + channel];
    const tr = imageData[(y1 * width + x2) * 4 + channel];
    const bl = imageData[(y2 * width + x1) * 4 + channel];
    const br = imageData[(y2 * width + x2) * 4 + channel];

    const top = tl + (tr - tl) * fx;
    const bottom = bl + (br - bl) * fx;
    return top + (bottom - top) * fy;
  }

  /**
   * Extract camera information from EXIF metadata
   */
  private extractCameraInfo(metadata: Record<string, unknown>): string | undefined {
    // Try various EXIF fields for camera make
    const make = metadata.make || metadata.Make || metadata.cameraMake;
    if (make) {
      // Normalize camera names
      const normalized = make.toString().trim();
      if (normalized.toLowerCase().includes('canon')) return 'Canon';
      if (normalized.toLowerCase().includes('nikon')) return 'Nikon';
      if (normalized.toLowerCase().includes('sony')) return 'Sony';
      if (normalized.toLowerCase().includes('fuji')) return 'Fujifilm';
      return normalized;
    }
    return undefined;
  }

  /**
   * Extract lens information from EXIF metadata
   */
  private extractLensInfo(metadata: Record<string, unknown>): string | undefined {
    const lensModel = metadata.lensModel || metadata.LensModel || metadata.lens;
    return lensModel ? String(lensModel) : undefined;
  }

  /**
   * Extract focal length from EXIF metadata
   */
  private extractFocalLength(metadata: Record<string, unknown>): number | undefined {
    const focal = metadata.focalLength || metadata.FocalLength;
    return focal ? parseFloat(focal.toString()) : undefined;
  }

  /**
   * Extract aperture from EXIF metadata
   */
  private extractAperture(metadata: Record<string, unknown>): number | undefined {
    const aperture = metadata.fNumber || metadata.FNumber || metadata.aperture;
    return aperture ? parseFloat(aperture.toString()) : undefined;
  }

  /**
   * Get all available lens profiles for a camera
   */
  getLensProfilesForCamera(camera: string): { lens: string; profiles: LensProfile[] }[] {
    const result: { lens: string; profiles: LensProfile[] }[] = [];

    for (const [, profiles] of this.lensProfiles) {
      if (profiles.length > 0 && profiles[0].camera === camera) {
        const lensName = profiles[0].lens;
        result.push({ lens: lensName, profiles });
      }
    }

    return result.sort((a, b) => a.lens.localeCompare(b.lens));
  }

  /**
   * Get all supported cameras
   */
  getSupportedCameras(): string[] {
    const cameras = new Set<string>();
    for (const profiles of this.lensProfiles.values()) {
      if (profiles.length > 0) {
        cameras.add(profiles[0].camera);
      }
    }
    return Array.from(cameras).sort();
  }

  /**
   * Get total number of lens profiles
   */
  private getTotalProfileCount(): number {
    let total = 0;
    for (const profiles of this.lensProfiles.values()) {
      total += profiles.length;
    }
    return total;
  }

  /**
   * Estimate lens distortion from image content
   */
  estimateDistortionFromImage(
    imageData: Float32Array,
    width: number,
    height: number
  ): { k1: number; k2: number; confidence: number } {
    // Simplified distortion estimation using line detection
    // In production, this would use more sophisticated computer vision

    // Detect straight lines near edges
    const edgeLines = this.detectStraightLines(imageData, width, height);

    if (edgeLines.length < 3) {
      return { k1: 0, k2: 0, confidence: 0 };
    }

    // Measure curvature of detected lines
    let totalCurvature = 0;
    let validLines = 0;

    for (const line of edgeLines) {
      const curvature = this.measureLineCurvature(line);
      if (Math.abs(curvature) > 0.001) { // Only count significant curvature
        totalCurvature += curvature;
        validLines++;
      }
    }

    if (validLines === 0) {
      return { k1: 0, k2: 0, confidence: 0 };
    }

    const avgCurvature = totalCurvature / validLines;
    const k1 = -avgCurvature * 0.1; // Simplified mapping
    const confidence = Math.min(1, validLines / 5); // More lines = higher confidence

    return { k1, k2: k1 * k1 * 0.1, confidence };
  }

  /**
   * Detect straight lines in image (simplified implementation)
   */
  private detectStraightLines(imageData: Float32Array, width: number, height: number): number[][] {
    // Simplified line detection - in production would use Hough transform
    const lines: number[][] = [];
    const threshold = 0.3;

    // Check horizontal lines
    for (let y = height * 0.1; y < height * 0.9; y += 20) {
      const line: number[] = [];
      for (let x = 0; x < width; x++) {
        const idx = (Math.floor(y) * width + x) * 4;
        const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
        line.push(brightness);
      }

      if (this.isLikelyStructuralLine(line, threshold)) {
        lines.push(line);
      }
    }

    // Check vertical lines
    for (let x = width * 0.1; x < width * 0.9; x += 20) {
      const line: number[] = [];
      for (let y = 0; y < height; y++) {
        const idx = (y * width + Math.floor(x)) * 4;
        const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
        line.push(brightness);
      }

      if (this.isLikelyStructuralLine(line, threshold)) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Check if a line contains structural elements (edges, contrasts)
   */
  private isLikelyStructuralLine(line: number[], threshold: number): boolean {
    let edgeCount = 0;
    for (let i = 1; i < line.length; i++) {
      if (Math.abs(line[i] - line[i-1]) > threshold) {
        edgeCount++;
      }
    }
    return edgeCount > 2 && edgeCount < line.length * 0.3; // Has edges but not too noisy
  }

  /**
   * Measure curvature of a detected line
   */
  private measureLineCurvature(line: number[]): number {
    if (line.length < 5) return 0;

    // Find the strongest edge in the line
    let maxEdgePos = 0;
    let maxEdgeStrength = 0;

    for (let i = 1; i < line.length - 1; i++) {
      const edgeStrength = Math.abs(line[i+1] - line[i-1]);
      if (edgeStrength > maxEdgeStrength) {
        maxEdgeStrength = edgeStrength;
        maxEdgePos = i;
      }
    }

    // Measure deviation from straight line at the edge position
    const start = line[0];
    const end = line[line.length - 1];
    const expectedValue = start + (end - start) * (maxEdgePos / (line.length - 1));
    const actualValue = line[maxEdgePos];

    return (actualValue - expectedValue) / line.length;
  }
}

export const lensProfileService = LensProfileService.getInstance();