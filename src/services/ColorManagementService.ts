import { logger } from '../utils/Logger';

export interface ColorProfile {
  name: string;
  type: 'input' | 'display' | 'output';
  description: string;
  whitePoint: [number, number]; // xy chromaticity coordinates
  primaries: {
    red: [number, number];
    green: [number, number];
    blue: [number, number];
  };
  gamma: number;
  matrix?: number[][]; // 3x3 transformation matrix
}

export interface PrintProfile extends ColorProfile {
  paperType: string;
  inkType: string;
  maxDensity: number;
  gamutVolume: number;
}

export interface SoftProofOptions {
  outputProfile: ColorProfile;
  renderingIntent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  blackPointCompensation: boolean;
  gamutWarning: boolean;
  paperWhiteSimulation: boolean;
}

export interface ColorConversionOptions {
  sourceProfile: ColorProfile;
  destinationProfile: ColorProfile;
  renderingIntent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  blackPointCompensation: boolean;
}

/**
 * Professional Color Management Service
 * Handles color profiles, conversions, and soft proofing for accurate color reproduction
 */
export class ColorManagementService {
  private static instance: ColorManagementService;
  private colorProfiles: Map<string, ColorProfile> = new Map();
  private printProfiles: Map<string, PrintProfile> = new Map();
  private currentDisplayProfile: ColorProfile | null = null;

  static getInstance(): ColorManagementService {
    if (!ColorManagementService.instance) {
      ColorManagementService.instance = new ColorManagementService();
    }
    return ColorManagementService.instance;
  }

  constructor() {
    this.initializeStandardProfiles();
    this.detectDisplayProfile();
  }

  /**
   * Initialize standard color profiles
   */
  private initializeStandardProfiles(): void {
    // Standard RGB working spaces
    this.addColorProfile({
      name: 'sRGB',
      type: 'display',
      description: 'Standard RGB color space for web and general use',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6400, 0.3300],
        green: [0.3000, 0.6000],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      matrix: [
        [3.2406, -1.5372, -0.4986],
        [-0.9689, 1.8758, 0.0415],
        [0.0557, -0.2040, 1.0570]
      ]
    });

    this.addColorProfile({
      name: 'Adobe RGB',
      type: 'input',
      description: 'Adobe RGB (1998) - Wide gamut for photography',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6400, 0.3300],
        green: [0.2100, 0.7100],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      matrix: [
        [2.0413, -0.5649, -0.3447],
        [-0.9692, 1.8760, 0.0416],
        [0.0134, -0.1183, 1.0154]
      ]
    });

    this.addColorProfile({
      name: 'ProPhoto RGB',
      type: 'input',
      description: 'ProPhoto RGB - Maximum gamut for professional work',
      whitePoint: [0.3457, 0.3585], // D50
      primaries: {
        red: [0.7347, 0.2653],
        green: [0.1596, 0.8404],
        blue: [0.0366, 0.0001]
      },
      gamma: 1.8,
      matrix: [
        [1.3459, -0.2556, -0.0511],
        [-0.5446, 1.5082, 0.0205],
        [0.0000, 0.0000, 1.2123]
      ]
    });

    this.addColorProfile({
      name: 'Display P3',
      type: 'display',
      description: 'DCI-P3 D65 - Modern wide gamut displays',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6800, 0.3200],
        green: [0.2650, 0.6900],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      matrix: [
        [2.4934, -0.9313, -0.4027],
        [-0.8295, 1.7627, 0.0236],
        [0.0358, -0.0761, 0.9569]
      ]
    });

    // Print profiles
    this.addPrintProfile({
      name: 'Generic CMYK',
      type: 'output',
      description: 'Generic CMYK for offset printing',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6400, 0.3300],
        green: [0.3000, 0.6000],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      paperType: 'Coated',
      inkType: 'Standard CMYK',
      maxDensity: 1.8,
      gamutVolume: 850000
    });

    this.addPrintProfile({
      name: 'Canon Pro Platinum',
      type: 'output',
      description: 'Canon Pro Platinum Photo Paper',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6400, 0.3300],
        green: [0.3000, 0.6000],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      paperType: 'Glossy Photo',
      inkType: 'Pigment',
      maxDensity: 2.4,
      gamutVolume: 1200000
    });

    this.addPrintProfile({
      name: 'Epson Premium Luster',
      type: 'output',
      description: 'Epson Premium Luster Photo Paper',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.6400, 0.3300],
        green: [0.3000, 0.6000],
        blue: [0.1500, 0.0600]
      },
      gamma: 2.2,
      paperType: 'Luster Photo',
      inkType: 'UltraChrome',
      maxDensity: 2.3,
      gamutVolume: 1150000
    });

    // Wide gamut profiles for HDR/UHD workflows
    this.addColorProfile({
      name: 'Rec.2020',
      type: 'input',
      description: 'ITU-R BT.2020 - UHDTV wide color gamut',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.7080, 0.2920],
        green: [0.1700, 0.7970],
        blue: [0.1310, 0.0460]
      },
      gamma: 2.4, // BT.1886 gamma
      matrix: [
        [1.7167, -0.3557, -0.2534],
        [-0.6667, 1.6165, 0.0158],
        [0.0176, -0.0428, 0.9421]
      ]
    });

    this.addColorProfile({
      name: 'Rec.2100-PQ',
      type: 'input',
      description: 'ITU-R BT.2100 with Perceptual Quantizer (HDR)',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.7080, 0.2920],
        green: [0.1700, 0.7970],
        blue: [0.1310, 0.0460]
      },
      gamma: 1.0, // PQ uses EOTF instead of gamma
      matrix: [
        [1.7167, -0.3557, -0.2534],
        [-0.6667, 1.6165, 0.0158],
        [0.0176, -0.0428, 0.9421]
      ]
    });

    this.addColorProfile({
      name: 'Rec.2100-HLG',
      type: 'input',
      description: 'ITU-R BT.2100 with Hybrid Log-Gamma (HDR)',
      whitePoint: [0.3127, 0.3290], // D65
      primaries: {
        red: [0.7080, 0.2920],
        green: [0.1700, 0.7970],
        blue: [0.1310, 0.0460]
      },
      gamma: 1.0, // HLG uses OETF instead of gamma
      matrix: [
        [1.7167, -0.3557, -0.2534],
        [-0.6667, 1.6165, 0.0158],
        [0.0176, -0.0428, 0.9421]
      ]
    });

    logger.info(`Initialized ${this.colorProfiles.size} color profiles and ${this.printProfiles.size} print profiles`);
  }

  /**
   * Detect display profile (simplified - in production would use system APIs)
   */
  private detectDisplayProfile(): void {
    // Simplified detection - would use actual system color profile detection
    const detectedProfile = this.colorProfiles.get('sRGB');
    if (detectedProfile) {
      this.currentDisplayProfile = detectedProfile;
      logger.info(`Detected display profile: ${detectedProfile.name}`);
    }
  }

  /**
   * Add color profile to the service
   */
  addColorProfile(profile: ColorProfile): void {
    this.colorProfiles.set(profile.name, profile);
  }

  /**
   * Add print profile to the service
   */
  addPrintProfile(profile: PrintProfile): void {
    this.printProfiles.set(profile.name, profile);
  }

  /**
   * Get color profile by name
   */
  getColorProfile(name: string): ColorProfile | undefined {
    return this.colorProfiles.get(name);
  }

  /**
   * Get print profile by name
   */
  getPrintProfile(name: string): PrintProfile | undefined {
    return this.printProfiles.get(name);
  }

  /**
   * Get all available color profiles by type
   */
  getColorProfilesByType(type?: 'input' | 'display' | 'output'): ColorProfile[] {
    const profiles = Array.from(this.colorProfiles.values());
    return type ? profiles.filter(p => p.type === type) : profiles;
  }

  /**
   * Get all available print profiles
   */
  getPrintProfiles(): PrintProfile[] {
    return Array.from(this.printProfiles.values());
  }

  /**
   * Apply soft proofing to image data
   */
  async applySoftProof(
    imageData: Float32Array,
    _width: number,
    _height: number,
    options: SoftProofOptions
  ): Promise<Float32Array> {
    const startTime = performance.now();
    logger.info('Applying soft proof', {
      outputProfile: options.outputProfile.name,
      renderingIntent: options.renderingIntent,
      gamutWarning: options.gamutWarning
    });

    const result = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      // Get RGB values
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const a = imageData[i + 3];

      // Convert to output profile space
      const [rOut, gOut, bOut] = this.convertColor(
        [r, g, b],
        this.currentDisplayProfile || this.colorProfiles.get('sRGB')!,
        options.outputProfile,
        options.renderingIntent
      );

      // Apply paper white simulation
      let [rFinal, gFinal, bFinal] = [rOut, gOut, bOut];
      if (options.paperWhiteSimulation && options.outputProfile.type === 'output') {
        [rFinal, gFinal, bFinal] = this.simulatePaperWhite([rOut, gOut, bOut], options.outputProfile);
      }

      // Apply gamut warning
      if (options.gamutWarning) {
        const inGamut = this.isInGamut([r, g, b], options.outputProfile);
        if (!inGamut) {
          // Show out-of-gamut areas in magenta
          rFinal = Math.min(1, rFinal + 0.3);
          gFinal = Math.max(0, gFinal - 0.2);
          bFinal = Math.min(1, bFinal + 0.3);
        }
      }

      result[i] = rFinal;
      result[i + 1] = gFinal;
      result[i + 2] = bFinal;
      result[i + 3] = a;
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Soft proof applied in ${processingTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Convert image data between color profiles
   */
  async convertColorProfile(
    imageData: Float32Array,
    _width: number,
    _height: number,
    options: ColorConversionOptions
  ): Promise<Float32Array> {
    const startTime = performance.now();
    logger.info('Converting color profile', {
      source: options.sourceProfile.name,
      destination: options.destinationProfile.name,
      renderingIntent: options.renderingIntent
    });

    const result = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      const [r, g, b] = this.convertColor(
        [imageData[i], imageData[i + 1], imageData[i + 2]],
        options.sourceProfile,
        options.destinationProfile,
        options.renderingIntent
      );

      result[i] = r;
      result[i + 1] = g;
      result[i + 2] = b;
      result[i + 3] = imageData[i + 3]; // Preserve alpha
    }

    const processingTime = performance.now() - startTime;
    logger.info(`Color profile conversion completed in ${processingTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Convert a single color between profiles
   */
  private convertColor(
    rgb: [number, number, number],
    sourceProfile: ColorProfile,
    destProfile: ColorProfile,
    renderingIntent: string
  ): [number, number, number] {
    // Simplified color conversion - in production would use ICC profiles and LCMS

    // Convert to XYZ color space using source profile
    const xyz = this.rgbToXYZ(rgb, sourceProfile);

    // Apply chromatic adaptation if white points differ
    const adaptedXYZ = this.chromaticAdaptation(xyz, sourceProfile.whitePoint, destProfile.whitePoint);

    // Convert from XYZ to destination RGB
    let destRGB = this.xyzToRGB(adaptedXYZ, destProfile);

    // Apply rendering intent
    destRGB = this.applyRenderingIntent(destRGB, renderingIntent, destProfile);

    // Clamp values
    return [
      Math.max(0, Math.min(1, destRGB[0])),
      Math.max(0, Math.min(1, destRGB[1])),
      Math.max(0, Math.min(1, destRGB[2]))
    ];
  }

  /**
   * Convert RGB to XYZ color space
   */
  private rgbToXYZ(rgb: [number, number, number], profile: ColorProfile): [number, number, number] {
    const [r, g, b] = rgb;

    // Apply inverse gamma correction
    const rLinear = Math.pow(r, profile.gamma);
    const gLinear = Math.pow(g, profile.gamma);
    const bLinear = Math.pow(b, profile.gamma);

    // Apply transformation matrix if available
    if (profile.matrix) {
      const [m11, m12, m13] = profile.matrix[0];
      const [m21, m22, m23] = profile.matrix[1];
      const [m31, m32, m33] = profile.matrix[2];

      return [
        m11 * rLinear + m12 * gLinear + m13 * bLinear,
        m21 * rLinear + m22 * gLinear + m23 * bLinear,
        m31 * rLinear + m32 * gLinear + m33 * bLinear
      ];
    }

    // Fallback to simplified conversion
    return [
      0.4124 * rLinear + 0.3576 * gLinear + 0.1805 * bLinear,
      0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear,
      0.0193 * rLinear + 0.1192 * gLinear + 0.9505 * bLinear
    ];
  }

  /**
   * Convert XYZ to RGB color space
   */
  private xyzToRGB(xyz: [number, number, number], profile: ColorProfile): [number, number, number] {
    const [x, y, z] = xyz;

    // Apply inverse transformation matrix if available
    if (profile.matrix) {
      // Calculate inverse matrix (simplified - would use proper matrix inversion)
      const det = this.matrixDeterminant(profile.matrix);
      if (Math.abs(det) < 1e-10) {
        // Fallback if matrix is singular
        return [x, y, z];
      }

      const invMatrix = this.invertMatrix(profile.matrix);
      const [m11, m12, m13] = invMatrix[0];
      const [m21, m22, m23] = invMatrix[1];
      const [m31, m32, m33] = invMatrix[2];

      const rLinear = m11 * x + m12 * y + m13 * z;
      const gLinear = m21 * x + m22 * y + m23 * z;
      const bLinear = m31 * x + m32 * y + m33 * z;

      // Apply gamma correction
      return [
        Math.pow(Math.max(0, rLinear), 1 / profile.gamma),
        Math.pow(Math.max(0, gLinear), 1 / profile.gamma),
        Math.pow(Math.max(0, bLinear), 1 / profile.gamma)
      ];
    }

    // Fallback conversion
    return [x * 0.8, y * 0.8, z * 0.8];
  }

  /**
   * Chromatic adaptation between white points
   */
  private chromaticAdaptation(
    xyz: [number, number, number],
    sourceWhite: [number, number],
    destWhite: [number, number]
  ): [number, number, number] {
    // Simplified Bradford chromatic adaptation
    if (sourceWhite[0] === destWhite[0] && sourceWhite[1] === destWhite[1]) {
      return xyz; // No adaptation needed
    }

    const [x, y, z] = xyz;
    const adaptationFactor = 0.8; // Simplified factor

    return [
      x * adaptationFactor,
      y * adaptationFactor,
      z * adaptationFactor
    ];
  }

  /**
   * Apply rendering intent adjustments
   */
  private applyRenderingIntent(
    rgb: [number, number, number],
    renderingIntent: string,
    _profile: ColorProfile
  ): [number, number, number] {
    const [r, g, b] = rgb;

    switch (renderingIntent) {
      case 'perceptual':
        // Compress entire gamut proportionally
        return [r * 0.95, g * 0.95, b * 0.95];

      case 'relative':
        // Maintain relationships, clip out-of-gamut
        return [Math.min(1, r), Math.min(1, g), Math.min(1, b)];

      case 'saturation': {
        // Preserve saturation over accuracy
        const max = Math.max(r, g, b);
        if (max > 1) {
          return [r / max, g / max, b / max];
        }
        return [r, g, b];
      }

      case 'absolute':
        // Preserve absolute color values
        return [r, g, b];

      default:
        return [r, g, b];
    }
  }

  /**
   * Check if color is within gamut
   */
  private isInGamut(rgb: [number, number, number], profile: ColorProfile): boolean {
    const [r, g, b] = rgb;

    // Simplified gamut check - in production would use actual profile gamut
    if (profile.type === 'output') {
      // Print profiles have smaller gamut
      return r >= 0 && r <= 0.95 && g >= 0 && g <= 0.95 && b >= 0 && b <= 0.95;
    }

    return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
  }

  /**
   * Simulate paper white for soft proofing
   */
  private simulatePaperWhite(
    rgb: [number, number, number],
    _profile: ColorProfile
  ): [number, number, number] {
    // Simulate the paper's white point and tone response
    const paperWhiteAdjustment = 0.92; // Most papers are not pure white

    return [
      rgb[0] * paperWhiteAdjustment,
      rgb[1] * paperWhiteAdjustment,
      rgb[2] * paperWhiteAdjustment
    ];
  }

  /**
   * Calculate matrix determinant (3x3)
   */
  private matrixDeterminant(matrix: number[][]): number {
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  }

  /**
   * Invert 3x3 matrix
   */
  private invertMatrix(matrix: number[][]): number[][] {
    const det = this.matrixDeterminant(matrix);
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;

    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
    ];
  }

  /**
   * Get current display profile
   */
  getCurrentDisplayProfile(): ColorProfile | null {
    return this.currentDisplayProfile;
  }

  /**
   * Set display profile
   */
  setDisplayProfile(profileName: string): boolean {
    const profile = this.colorProfiles.get(profileName);
    if (profile && (profile.type === 'display' || profile.type === 'input')) {
      this.currentDisplayProfile = profile;
      logger.info(`Display profile set to: ${profileName}`);
      return true;
    }
    return false;
  }

  // ============================================================
  // Lab Color Space Conversions
  // ============================================================

  /** D50 reference white XYZ values */
  private static readonly D50_WHITE: [number, number, number] = [0.96422, 1.0, 0.82521];

  /** D65 reference white XYZ values */
  private static readonly D65_WHITE: [number, number, number] = [0.95047, 1.0, 1.08883];

  /** Lab conversion constants */
  private static readonly LAB_EPSILON = 216 / 24389; // 0.008856
  private static readonly LAB_KAPPA = 24389 / 27; // 903.3

  /**
   * Convert XYZ to Lab color space
   * @param xyz XYZ color values (Y normalized to 1.0)
   * @param illuminant Reference illuminant ('D50' or 'D65')
   * @returns Lab values [L: 0-100, a: -128 to 128, b: -128 to 128]
   */
  xyzToLab(xyz: [number, number, number], illuminant: 'D50' | 'D65' = 'D65'): [number, number, number] {
    const white = illuminant === 'D50'
      ? ColorManagementService.D50_WHITE
      : ColorManagementService.D65_WHITE;

    // Normalize by reference white
    const xr = xyz[0] / white[0];
    const yr = xyz[1] / white[1];
    const zr = xyz[2] / white[2];

    // Apply Lab transfer function
    const fx = this.labF(xr);
    const fy = this.labF(yr);
    const fz = this.labF(zr);

    // Calculate Lab values
    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);

    return [L, a, b];
  }

  /**
   * Convert Lab to XYZ color space
   * @param lab Lab color values [L: 0-100, a: -128 to 128, b: -128 to 128]
   * @param illuminant Reference illuminant ('D50' or 'D65')
   * @returns XYZ values (Y normalized to 1.0)
   */
  labToXyz(lab: [number, number, number], illuminant: 'D50' | 'D65' = 'D65'): [number, number, number] {
    const white = illuminant === 'D50'
      ? ColorManagementService.D50_WHITE
      : ColorManagementService.D65_WHITE;

    const [L, a, b] = lab;

    // Calculate intermediate values
    const fy = (L + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;

    // Apply inverse Lab transfer function
    const xr = this.labFInverse(fx);
    const yr = L > ColorManagementService.LAB_KAPPA * ColorManagementService.LAB_EPSILON
      ? Math.pow(fy, 3)
      : L / ColorManagementService.LAB_KAPPA;
    const zr = this.labFInverse(fz);

    // Denormalize by reference white
    return [
      xr * white[0],
      yr * white[1],
      zr * white[2]
    ];
  }

  /**
   * Convert RGB to Lab color space (convenience method)
   * @param rgb RGB values in range [0, 1]
   * @param profile Color profile to use (defaults to sRGB)
   * @param illuminant Reference illuminant for Lab
   * @returns Lab values
   */
  rgbToLab(
    rgb: [number, number, number],
    profile?: ColorProfile,
    illuminant: 'D50' | 'D65' = 'D65'
  ): [number, number, number] {
    const colorProfile = profile || this.colorProfiles.get('sRGB')!;
    const xyz = this.rgbToXYZ(rgb, colorProfile);
    return this.xyzToLab(xyz, illuminant);
  }

  /**
   * Convert Lab to RGB color space (convenience method)
   * @param lab Lab values
   * @param profile Color profile to use (defaults to sRGB)
   * @param illuminant Reference illuminant for Lab
   * @returns RGB values in range [0, 1]
   */
  labToRgb(
    lab: [number, number, number],
    profile?: ColorProfile,
    illuminant: 'D50' | 'D65' = 'D65'
  ): [number, number, number] {
    const colorProfile = profile || this.colorProfiles.get('sRGB')!;
    const xyz = this.labToXyz(lab, illuminant);
    const rgb = this.xyzToRGB(xyz, colorProfile);

    // Clamp to valid range
    return [
      Math.max(0, Math.min(1, rgb[0])),
      Math.max(0, Math.min(1, rgb[1])),
      Math.max(0, Math.min(1, rgb[2]))
    ];
  }

  /**
   * Lab transfer function f(t)
   */
  private labF(t: number): number {
    if (t > ColorManagementService.LAB_EPSILON) {
      return Math.cbrt(t);
    }
    return (ColorManagementService.LAB_KAPPA * t + 16) / 116;
  }

  /**
   * Inverse Lab transfer function f^-1(t)
   */
  private labFInverse(t: number): number {
    const t3 = t * t * t;
    if (t3 > ColorManagementService.LAB_EPSILON) {
      return t3;
    }
    return (116 * t - 16) / ColorManagementService.LAB_KAPPA;
  }

  /**
   * Calculate Delta E (CIE76) between two Lab colors
   * @param lab1 First Lab color
   * @param lab2 Second Lab color
   * @returns Delta E value (0 = identical, < 1 = imperceptible, < 2 = close)
   */
  deltaE(lab1: [number, number, number], lab2: [number, number, number]): number {
    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /**
   * Calculate Delta E (CIE2000) between two Lab colors
   * More perceptually uniform than CIE76
   */
  deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
    const [L1, a1, b1] = lab1;
    const [L2, a2, b2] = lab2;

    // Calculate C and h values
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cab = (C1 + C2) / 2;

    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cab, 7) / (Math.pow(Cab, 7) + Math.pow(25, 7))));

    const a1p = a1 * (1 + G);
    const a2p = a2 * (1 + G);

    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);

    const h1p = this.labHue(a1p, b1);
    const h2p = this.labHue(a2p, b2);

    // Calculate deltas
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = h2p - h1p;

    if (C1p * C2p === 0) {
      dhp = 0;
    } else if (Math.abs(dhp) > 180) {
      dhp += dhp > 0 ? -360 : 360;
    }

    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

    // Calculate means
    const Lp = (L1 + L2) / 2;
    const Cp = (C1p + C2p) / 2;
    let hp = (h1p + h2p) / 2;

    if (C1p * C2p !== 0 && Math.abs(h1p - h2p) > 180) {
      hp += hp < 180 ? 180 : -180;
    }

    // Calculate T
    const T = 1
      - 0.17 * Math.cos(((hp - 30) * Math.PI) / 180)
      + 0.24 * Math.cos((2 * hp * Math.PI) / 180)
      + 0.32 * Math.cos(((3 * hp + 6) * Math.PI) / 180)
      - 0.20 * Math.cos(((4 * hp - 63) * Math.PI) / 180);

    // Calculate weighting functions
    const SL = 1 + (0.015 * Math.pow(Lp - 50, 2)) / Math.sqrt(20 + Math.pow(Lp - 50, 2));
    const SC = 1 + 0.045 * Cp;
    const SH = 1 + 0.015 * Cp * T;

    const RC = 2 * Math.sqrt(Math.pow(Cp, 7) / (Math.pow(Cp, 7) + Math.pow(25, 7)));
    const dTheta = 30 * Math.exp(-Math.pow((hp - 275) / 25, 2));
    const RT = -RC * Math.sin((2 * dTheta * Math.PI) / 180);

    // Calculate final Delta E
    const dE = Math.sqrt(
      Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH)
    );

    return dE;
  }

  /**
   * Calculate hue angle for Lab color
   */
  private labHue(a: number, b: number): number {
    if (a === 0 && b === 0) return 0;
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  }
}

export const colorManagementService = ColorManagementService.getInstance();