import { logger } from '../utils/Logger';
import { smoothStep, rgbToHsl, hslToRgb } from './utils/ColorUtils';
import { webGLImageProcessor } from '../services/WebGLImageProcessor';
import { applyGaussianBlur, applyFilmGrain } from '../utils/ImageFilters';

export interface LensCorrectionsParams {
  // Vignetting correction
  vignetting: {
    enabled: boolean;
    amount: number;        // -100 to 100, default: 0
    midpoint: number;      // 0.1 to 2.0, default: 1.0
    roundness: number;     // -100 to 100, default: 0
    feather: number;       // 0 to 100, default: 50
  };

  // Distortion correction
  distortion: {
    enabled: boolean;
    barrel: number;        // -100 to 100, default: 0 (negative = barrel, positive = pincushion)
    perspective: {
      horizontal: number;  // -45 to 45, default: 0
      vertical: number;    // -45 to 45, default: 0
    };
    scale: number;         // 0.5 to 2.0, default: 1.0
  };

  // Chromatic aberration correction
  chromaticAberration: {
    enabled: boolean;
    redCyan: number;       // -100 to 100, default: 0
    blueMagenta: number;   // -100 to 100, default: 0
    purple: {
      amount: number;      // 0 to 100, default: 0
      hue: number;         // 0 to 360, default: 300
      range: number;       // 1 to 100, default: 10
    };
    green: {
      amount: number;      // 0 to 100, default: 0
      hue: number;         // 0 to 360, default: 60
      range: number;       // 1 to 100, default: 10
    };
  };

  // Profile-based correction
  profile: {
    enabled: boolean;
    autoDetect: boolean;
    profileName: string;   // Lens profile name if available
    strength: number;      // 0 to 100, default: 100
  };

  // Creative blur (non-destructive Gaussian). Relocated from the old Filter menu.
  blur: {
    enabled: boolean;
    radius: number;        // 0 to 20 px, default: 0
  };

  // Film grain (non-destructive, deterministic). Relocated from the old Filter menu.
  filmGrain: {
    enabled: boolean;
    amount: number;        // 0 to 100, default: 0
    size: number;          // 1 to 4 (1 = fine), default: 1
  };

  // Index signature for Record compatibility
  [key: string]: unknown;
}

export interface LensProfile {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  focalLengthMin: number;
  focalLengthMax: number;
  apertureMin: number;
  apertureMax: number;
  distortionCorrection: number[];
  vignettingCorrection: number[];
  chromaticAberrationCorrection: number[];
}

export class LensCorrectionsModule {
  id = 'lenscorrections';
  name = 'Lens Corrections';

  private params: LensCorrectionsParams = {
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
  };

  // Process image with lens corrections
  processImage(imageData: Float32Array, width: number, height: number): Float32Array {
    let result = new Float32Array(imageData);

    const startTime = performance.now();
    logger.info(`Processing lens corrections: ${width}x${height}`);

    try {
      // Apply corrections in optimal order
      if (this.params.distortion.enabled) {
        const { barrel, perspective, scale } = this.params.distortion;
        const identity = barrel === 0 && perspective.horizontal === 0 && perspective.vertical === 0 && scale === 1.0;
        // GPU distortion (texelFetch bilinear, matches the CPU) when available; else CPU.
        if (!identity && result.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
          result = new Float32Array(webGLImageProcessor.applyDistortion(
            result, width, height, barrel / 100, scale,
            perspective.horizontal * Math.PI / 180, perspective.vertical * Math.PI / 180));
        } else {
          result = new Float32Array(this.correctDistortion(result, width, height));
        }
      }

      if (this.params.chromaticAberration.enabled) {
        const { redCyan, blueMagenta, purple, green } = this.params.chromaticAberration;
        // GPU lateral CA (R/B radial shift) when available; the niche purple/green
        // fringing stays on the CPU and runs after.
        if ((redCyan !== 0 || blueMagenta !== 0) && result.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
          result = new Float32Array(webGLImageProcessor.applyLateralCA(result, width, height, redCyan, blueMagenta));
          if (purple.amount > 0 || green.amount > 0) this.correctColorFringing(result, width, height, purple, green);
        } else {
          result = new Float32Array(this.correctChromaticAberration(result, width, height));
        }
      }

      if (this.params.vignetting.enabled) {
        const { amount, midpoint, roundness, feather } = this.params.vignetting;
        // GPU vignetting (RGBA) when available + verified; else the CPU pass.
        if (amount !== 0 && result.length === width * height * 4 && webGLImageProcessor.isAvailable()) {
          result = new Float32Array(webGLImageProcessor.applyVignetting(result, width, height, amount / 100, midpoint, roundness / 100, feather / 100));
        } else {
          result = new Float32Array(this.correctVignetting(result, width, height));
        }
      }

      // Creative blur (non-destructive Gaussian). Separable CPU pass, alpha-preserving.
      if (this.params.blur.enabled && this.params.blur.radius > 0) {
        result = new Float32Array(applyGaussianBlur(result, { width, height, channels: 4 }, this.params.blur.radius));
      }

      // Film grain (deterministic — a fixed seed keeps the pattern stable across
      // reprocesses, so the grain doesn't shimmer between preview and export).
      if (this.params.filmGrain.enabled && this.params.filmGrain.amount > 0) {
        result = new Float32Array(applyFilmGrain(result, { width, height, channels: 4 }, this.params.filmGrain.amount / 100, this.params.filmGrain.size));
      }

      const processingTime = performance.now() - startTime;
      logger.info(`Lens corrections completed in ${processingTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      logger.error('Lens corrections processing failed:', error);
      return imageData; // Return original on error
    }
  }

  // Vignetting correction
  private correctVignetting(imageData: Float32Array, width: number, height: number): Float32Array {
    const result = new Float32Array(imageData);
    const { amount, midpoint, roundness, feather } = this.params.vignetting;

    if (amount === 0) return result;

    const centerX = width / 2;
    const centerY = height / 2;

    // Normalize amount
    const correctionStrength = amount / 100.0;
    const featherNorm = feather / 100.0;
    const roundnessNorm = roundness / 100.0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;

        // Calculate distance from center
        const dx = (x - centerX) / centerX;
        const dy = (y - centerY) / centerY;

        // Apply roundness adjustment
        const adjustedDx = dx;
        const adjustedDy = dy * (1.0 + roundnessNorm);

        const distance = Math.sqrt(adjustedDx * adjustedDx + adjustedDy * adjustedDy);
        const normalizedDistance = distance / Math.sqrt(2); // Normalize to corner

        // Calculate vignetting mask
        let vignetteMask = 1.0;
        if (normalizedDistance > 0) {
          const falloffStart = midpoint * 0.5;
          const falloffEnd = midpoint * 1.5;

          if (normalizedDistance > falloffStart) {
            const falloffProgress = Math.min(1.0,
              (normalizedDistance - falloffStart) / (falloffEnd - falloffStart)
            );

            // Apply feathering
            const smoothFalloff = smoothStep(0, 1, falloffProgress);
            const featheredFalloff = falloffProgress * (1.0 - featherNorm) + smoothFalloff * featherNorm;

            vignetteMask = 1.0 - featheredFalloff;
          }
        }

        // Apply vignetting correction
        const correctionFactor = 1.0 + correctionStrength * (1.0 / Math.max(0.1, vignetteMask) - 1.0);

        result[pixelIndex] *= correctionFactor;     // R
        result[pixelIndex + 1] *= correctionFactor; // G
        result[pixelIndex + 2] *= correctionFactor; // B
      }
    }

    logger.debug(`Vignetting correction applied: amount=${amount}`);
    return result;
  }

  // Distortion correction
  private correctDistortion(imageData: Float32Array, width: number, height: number): Float32Array {
    const result = new Float32Array(imageData.length);
    const { barrel, perspective, scale } = this.params.distortion;

    if (barrel === 0 && perspective.horizontal === 0 && perspective.vertical === 0 && scale === 1.0) {
      return imageData.slice();
    }

    const centerX = width / 2;
    const centerY = height / 2;

    // Normalize parameters
    const barrelAmount = barrel / 100.0;
    const perspectiveH = perspective.horizontal * Math.PI / 180;
    const perspectiveV = perspective.vertical * Math.PI / 180;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dstIndex = (y * width + x) * 4;

        // Normalize coordinates to [-1, 1]
        let nx = (x - centerX) / centerX;
        let ny = (y - centerY) / centerY;

        // Apply barrel/pincushion distortion
        if (barrelAmount !== 0) {
          const r = Math.sqrt(nx * nx + ny * ny);
          if (r > 0) {
            const distortionFactor = 1.0 + barrelAmount * r * r;
            nx /= distortionFactor;
            ny /= distortionFactor;
          }
        }

        // Apply perspective correction
        if (perspectiveH !== 0 || perspectiveV !== 0) {
          const z = 1.0;
          const x3d = nx;
          const y3d = ny;
          const z3d = z;

          // Rotation matrices for perspective correction
          const cosH = Math.cos(perspectiveH);
          const sinH = Math.sin(perspectiveH);
          const cosV = Math.cos(perspectiveV);
          const sinV = Math.sin(perspectiveV);

          // Apply rotations
          const x_rot = x3d * cosH - z3d * sinH;
          const z_rot = x3d * sinH + z3d * cosH;
          const y_rot = y3d * cosV - z_rot * sinV;
          const z_final = y3d * sinV + z_rot * cosV;

          // Project back to 2D
          if (z_final > 0.1) {
            nx = x_rot / z_final;
            ny = y_rot / z_final;
          }
        }

        // Apply scale
        nx /= scale;
        ny /= scale;

        // Convert back to pixel coordinates
        const srcX = nx * centerX + centerX;
        const srcY = ny * centerY + centerY;

        // Bilinear interpolation
        if (srcX >= 0 && srcX < width - 1 && srcY >= 0 && srcY < height - 1) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = x0 + 1;
          const y1 = y0 + 1;

          const wx = srcX - x0;
          const wy = srcY - y0;

          const idx00 = (y0 * width + x0) * 4;
          const idx01 = (y0 * width + x1) * 4;
          const idx10 = (y1 * width + x0) * 4;
          const idx11 = (y1 * width + x1) * 4;

          for (let c = 0; c < 4; c++) {
            const p00 = imageData[idx00 + c];
            const p01 = imageData[idx01 + c];
            const p10 = imageData[idx10 + c];
            const p11 = imageData[idx11 + c];

            const p0 = p00 * (1 - wx) + p01 * wx;
            const p1 = p10 * (1 - wx) + p11 * wx;

            result[dstIndex + c] = p0 * (1 - wy) + p1 * wy;
          }
        } else {
          // Out of bounds - use black
          result[dstIndex] = 0;     // R
          result[dstIndex + 1] = 0; // G
          result[dstIndex + 2] = 0; // B
          result[dstIndex + 3] = imageData[dstIndex + 3]; // A
        }
      }
    }

    logger.debug(`Distortion correction applied: barrel=${barrel}, perspective=(${perspective.horizontal}, ${perspective.vertical})`);
    return result;
  }

  // Chromatic aberration correction
  private correctChromaticAberration(imageData: Float32Array, width: number, height: number): Float32Array {
    const result = new Float32Array(imageData);
    const { redCyan, blueMagenta, purple, green } = this.params.chromaticAberration;

    if (redCyan === 0 && blueMagenta === 0 && purple.amount === 0 && green.amount === 0) {
      return result;
    }

    // Lateral chromatic aberration correction
    if (redCyan !== 0 || blueMagenta !== 0) {
      this.correctLateralCA(result, width, height, redCyan, blueMagenta);
    }

    // Purple/green fringing correction
    if (purple.amount > 0 || green.amount > 0) {
      this.correctColorFringing(result, width, height, purple, green);
    }

    logger.debug(`Chromatic aberration correction applied: RC=${redCyan}, BM=${blueMagenta}, purple=${purple.amount}, green=${green.amount}`);
    return result;
  }

  private correctLateralCA(
    imageData: Float32Array,
    width: number,
    height: number,
    redCyan: number,
    blueMagenta: number
  ): void {
    if (redCyan === 0 && blueMagenta === 0) return;

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);

    // Create corrected channels
    const correctedR = new Float32Array(width * height);
    const correctedB = new Float32Array(width * height);

    // Correction factors (small shifts)
    const redShift = redCyan * 0.001; // Very small correction factor
    const blueShift = blueMagenta * 0.001;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = y * width + x;

        // Calculate distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy) / maxRadius;

        // Calculate shifted positions for red and blue channels
        const redScale = 1.0 + redShift * distance * distance;
        const blueScale = 1.0 + blueShift * distance * distance;

        const redX = centerX + dx * redScale;
        const redY = centerY + dy * redScale;
        const blueX = centerX + dx * blueScale;
        const blueY = centerY + dy * blueScale;

        // Sample red channel
        correctedR[pixelIndex] = this.sampleChannel(imageData, width, height, redX, redY, 0);

        // Sample blue channel
        correctedB[pixelIndex] = this.sampleChannel(imageData, width, height, blueX, blueY, 2);
      }
    }

    // Apply corrections
    for (let i = 0; i < width * height; i++) {
      imageData[i * 4] = correctedR[i];       // R
      imageData[i * 4 + 2] = correctedB[i];   // B
    }
  }

  private correctColorFringing(
    imageData: Float32Array,
    _width: number,
    _height: number,
    purple: { amount: number; hue: number; range: number },
    green: { amount: number; hue: number; range: number }
  ): void {
    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Convert to HSL for hue-based correction
      // Note: rgbToHsl returns h in 0-360, s and l in 0-100 range
      const [hRaw, sRaw, lRaw] = rgbToHsl(r, g, b);
      const h = hRaw / 360; // normalize to 0-1 for compatibility
      const s = sRaw / 100;
      const l = lRaw / 100;

      let correctionFactor = 1.0;

      // Purple fringing correction
      if (purple.amount > 0) {
        const purpleDistance = this.hueDistance(h * 360, purple.hue);
        if (purpleDistance <= purple.range) {
          const purpleStrength = 1.0 - (purpleDistance / purple.range);
          correctionFactor *= 1.0 - (purple.amount / 100.0) * purpleStrength;
        }
      }

      // Green fringing correction
      if (green.amount > 0) {
        const greenDistance = this.hueDistance(h * 360, green.hue);
        if (greenDistance <= green.range) {
          const greenStrength = 1.0 - (greenDistance / green.range);
          correctionFactor *= 1.0 - (green.amount / 100.0) * greenStrength;
        }
      }

      // Apply saturation reduction to affected colors
      if (correctionFactor < 1.0) {
        // hslToRgb expects h in 0-360, s and l in 0-100 range
        const [newR, newG, newB] = hslToRgb(h * 360, s * correctionFactor * 100, l * 100);
        imageData[i] = newR;
        imageData[i + 1] = newG;
        imageData[i + 2] = newB;
      }
    }
  }

  // Utility methods
  private sampleChannel(
    imageData: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    channel: number
  ): number {
    if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) {
      return 0; // Out of bounds
    }

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const wx = x - x0;
    const wy = y - y0;

    const idx00 = (y0 * width + x0) * 4 + channel;
    const idx01 = (y0 * width + x1) * 4 + channel;
    const idx10 = (y1 * width + x0) * 4 + channel;
    const idx11 = (y1 * width + x1) * 4 + channel;

    const p00 = imageData[idx00];
    const p01 = imageData[idx01];
    const p10 = imageData[idx10];
    const p11 = imageData[idx11];

    const p0 = p00 * (1 - wx) + p01 * wx;
    const p1 = p10 * (1 - wx) + p11 * wx;

    return p0 * (1 - wy) + p1 * wy;
  }

  private hueDistance(hue1: number, hue2: number): number {
    const diff = Math.abs(hue1 - hue2);
    return Math.min(diff, 360 - diff);
  }

  // Parameter management
  getParams(): LensCorrectionsParams {
    return { ...this.params };
  }

  setParams(params: Partial<LensCorrectionsParams>): void {
    this.params = { ...this.params, ...params };
    logger.debug('Lens corrections parameters updated');
  }

  updateVignettingParams(vignetting: Partial<LensCorrectionsParams['vignetting']>): void {
    this.params.vignetting = { ...this.params.vignetting, ...vignetting };
  }

  updateDistortionParams(distortion: Partial<LensCorrectionsParams['distortion']>): void {
    this.params.distortion = { ...this.params.distortion, ...distortion };
  }

  updateChromaticAberrationParams(ca: Partial<LensCorrectionsParams['chromaticAberration']>): void {
    this.params.chromaticAberration = { ...this.params.chromaticAberration, ...ca };
  }

  // Auto-detection methods
  autoDetectVignetting(imageData: Float32Array, width: number, height: number): void {
    logger.info('Auto-detecting vignetting...');

    const cornerBrightness = this.calculateCornerBrightness(imageData, width, height);
    const centerBrightness = this.calculateCenterBrightness(imageData, width, height);

    const vignettingAmount = (centerBrightness - cornerBrightness) * 100;

    if (vignettingAmount > 5) {
      this.params.vignetting.enabled = true;
      this.params.vignetting.amount = Math.min(50, vignettingAmount);
      logger.info(`Auto-detected vignetting: ${vignettingAmount.toFixed(1)}`);
    }
  }

  private calculateCornerBrightness(imageData: Float32Array, width: number, height: number): number {
    const sampleSize = 50;
    let totalBrightness = 0;
    let sampleCount = 0;

    // Sample corners
    const corners = [
      { x: 0, y: 0 },
      { x: width - sampleSize, y: 0 },
      { x: 0, y: height - sampleSize },
      { x: width - sampleSize, y: height - sampleSize }
    ];

    for (const corner of corners) {
      for (let y = corner.y; y < corner.y + sampleSize; y++) {
        for (let x = corner.x; x < corner.x + sampleSize; x++) {
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
            totalBrightness += brightness;
            sampleCount++;
          }
        }
      }
    }

    return sampleCount > 0 ? totalBrightness / sampleCount : 0;
  }

  private calculateCenterBrightness(imageData: Float32Array, width: number, height: number): number {
    const sampleSize = 100;
    const centerX = Math.floor(width / 2 - sampleSize / 2);
    const centerY = Math.floor(height / 2 - sampleSize / 2);

    let totalBrightness = 0;
    let sampleCount = 0;

    for (let y = centerY; y < centerY + sampleSize; y++) {
      for (let x = centerX; x < centerX + sampleSize; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4;
          const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
          totalBrightness += brightness;
          sampleCount++;
        }
      }
    }

    return sampleCount > 0 ? totalBrightness / sampleCount : 0;
  }

  // Reset methods
  resetVignetting(): void {
    this.params.vignetting = {
      enabled: false,
      amount: 0,
      midpoint: 1.0,
      roundness: 0,
      feather: 50
    };
  }

  resetDistortion(): void {
    this.params.distortion = {
      enabled: false,
      barrel: 0,
      perspective: {
        horizontal: 0,
        vertical: 0
      },
      scale: 1.0
    };
  }

  resetChromaticAberration(): void {
    this.params.chromaticAberration = {
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
    };
  }

  resetBlur(): void {
    this.params.blur = { enabled: false, radius: 0 };
  }

  resetFilmGrain(): void {
    this.params.filmGrain = { enabled: false, amount: 0, size: 1 };
  }

  resetAll(): void {
    this.resetVignetting();
    this.resetDistortion();
    this.resetChromaticAberration();
    this.resetBlur();
    this.resetFilmGrain();
    this.params.profile.enabled = false;
    logger.info('All lens corrections reset');
  }

  // Statistics
  getStats() {
    const enabledCorrections = [];
    if (this.params.vignetting.enabled) enabledCorrections.push('vignetting');
    if (this.params.distortion.enabled) enabledCorrections.push('distortion');
    if (this.params.chromaticAberration.enabled) enabledCorrections.push('chromatic aberration');
    if (this.params.profile.enabled) enabledCorrections.push('profile');
    if (this.params.blur.enabled) enabledCorrections.push('blur');
    if (this.params.filmGrain.enabled) enabledCorrections.push('film grain');

    return {
      enabledCorrections: enabledCorrections.length,
      corrections: enabledCorrections,
      hasVignettingCorrection: this.params.vignetting.enabled && this.params.vignetting.amount !== 0,
      hasDistortionCorrection: this.params.distortion.enabled && this.params.distortion.barrel !== 0,
      hasChromaticAberrationCorrection: this.params.chromaticAberration.enabled &&
        (this.params.chromaticAberration.redCyan !== 0 || this.params.chromaticAberration.blueMagenta !== 0)
    };
  }
}

export const lensCorrectionsModule = new LensCorrectionsModule();