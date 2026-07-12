import { logger } from '../utils/Logger';

export interface CameraProfile {
  id: string;
  make: string;
  model: string;
  colorMatrix1: number[]; // 3x3 matrix for standard illuminant A
  colorMatrix2: number[]; // 3x3 matrix for standard illuminant D65
  whiteBalance: {
    asShot: number[];
    daylight: number[];
    tungsten: number[];
    fluorescent: number[];
    flash: number[];
    cloudy: number[];
    shade: number[];
  };
  toneCurve?: {
    red: number[][];
    green: number[][];
    blue: number[][];
  };
  vignettingCorrection?: {
    amount: number;
    midpoint: number;
    roundness: number;
  };
  distortionCorrection?: {
    k1: number; // Radial distortion coefficient
    k2: number;
    k3: number;
  };
  noiseProfile?: {
    iso100: { red: number; green: number; blue: number };
    iso400: { red: number; green: number; blue: number };
    iso1600: { red: number; green: number; blue: number };
  };
  metadata: {
    version: string;
    created: string;
    author: string;
    description: string;
  };
}

/**
 * Camera Profile Service for professional color management and camera-specific corrections
 */
export class CameraProfileService {
  private static instance: CameraProfileService;
  private profiles = new Map<string, CameraProfile>();

  static getInstance(): CameraProfileService {
    if (!CameraProfileService.instance) {
      CameraProfileService.instance = new CameraProfileService();
    }
    return CameraProfileService.instance;
  }

  constructor() {
    this.initializeBuiltInProfiles();
  }

  /**
   * Initialize built-in camera profiles for major manufacturers
   */
  private initializeBuiltInProfiles(): void {
    // Canon profiles
    this.addProfile(this.createCanonProfile('Canon', 'EOS R5', {
      colorMatrix1: [
        1.6961, -0.4682, -0.2279,
        -0.4985, 1.4040, 0.0945,
        -0.0945, 0.1719, 0.9226
      ],
      colorMatrix2: [
        1.5109, -0.3959, -0.1150,
        -0.5343, 1.4180, 0.1163,
        -0.1163, 0.2656, 0.8507
      ]
    }));

    this.addProfile(this.createCanonProfile('Canon', 'EOS 5D Mark IV', {
      colorMatrix1: [
        1.5573, -0.4258, -0.1315,
        -0.5054, 1.4138, 0.0916,
        -0.0916, 0.1895, 0.9021
      ],
      colorMatrix2: [
        1.4180, -0.3635, -0.0545,
        -0.5199, 1.3964, 0.1235,
        -0.1235, 0.2812, 0.8423
      ]
    }));

    // Nikon profiles
    this.addProfile(this.createNikonProfile('Nikon', 'D850', {
      colorMatrix1: [
        2.0413, -0.8201, -0.2208,
        -0.4524, 1.3014, 0.1510,
        -0.0652, 0.2585, 0.8067
      ],
      colorMatrix2: [
        1.7056, -0.6116, -0.0940,
        -0.4524, 1.2721, 0.1803,
        -0.0940, 0.3125, 0.7815
      ]
    }));

    this.addProfile(this.createNikonProfile('Nikon', 'Z7', {
      colorMatrix1: [
        1.8795, -0.7065, -0.1730,
        -0.4285, 1.2890, 0.1395,
        -0.0584, 0.2539, 0.8045
      ],
      colorMatrix2: [
        1.6345, -0.5234, -0.1111,
        -0.4492, 1.2578, 0.1914,
        -0.0781, 0.2969, 0.7812
      ]
    }));

    // Sony profiles
    this.addProfile(this.createSonyProfile('Sony', 'A7R IV', {
      colorMatrix1: [
        1.9913, -0.7398, -0.2515,
        -0.4656, 1.3477, 0.1179,
        -0.0723, 0.2773, 0.7950
      ],
      colorMatrix2: [
        1.7578, -0.6055, -0.1523,
        -0.4844, 1.3164, 0.1680,
        -0.0859, 0.3125, 0.7734
      ]
    }));

    // Fujifilm profiles
    this.addProfile(this.createFujifilmProfile('Fujifilm', 'X-T4', {
      colorMatrix1: [
        1.4652, -0.2949, -0.1703,
        -0.4297, 1.2383, 0.1914,
        -0.0781, 0.2344, 0.8437
      ],
      colorMatrix2: [
        1.3438, -0.2344, -0.1094,
        -0.4570, 1.2148, 0.2422,
        -0.1016, 0.2734, 0.8282
      ]
    }));

    logger.info(`Initialized ${this.profiles.size} built-in camera profiles`);
  }

  /**
   * Add a camera profile to the database
   */
  addProfile(profile: CameraProfile): void {
    const key = this.generateProfileKey(profile.make, profile.model);
    this.profiles.set(key, profile);
    logger.debug(`Added camera profile: ${profile.make} ${profile.model}`);
  }

  /**
   * Get camera profile by make and model
   */
  getProfile(make: string, model: string): CameraProfile | null {
    const key = this.generateProfileKey(make, model);
    return this.profiles.get(key) || null;
  }

  /**
   * Apply camera-specific white balance
   */
  applyCameraWhiteBalance(
    imageData: Float32Array,
    profile: CameraProfile,
    whiteBalanceType: keyof CameraProfile['whiteBalance']
  ): Float32Array {
    const wbMultipliers = profile.whiteBalance[whiteBalanceType];
    if (!wbMultipliers || wbMultipliers.length < 3) {
      logger.warn('Invalid white balance multipliers');
      return imageData;
    }

    const output = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      output[i] = Math.max(0, Math.min(1, imageData[i] * wbMultipliers[0]));
      output[i + 1] = Math.max(0, Math.min(1, imageData[i + 1] * wbMultipliers[1]));
      output[i + 2] = Math.max(0, Math.min(1, imageData[i + 2] * wbMultipliers[2]));
      output[i + 3] = imageData[i + 3];
    }

    logger.debug(`Applied ${whiteBalanceType} white balance`, { multipliers: wbMultipliers });
    return output;
  }

  /**
   * Apply camera-specific tone curve
   */
  applyCameraToneCurve(
    imageData: Float32Array,
    profile: CameraProfile
  ): Float32Array {
    if (!profile.toneCurve) {
      return imageData;
    }

    const output = new Float32Array(imageData.length);

    for (let i = 0; i < imageData.length; i += 4) {
      output[i] = this.applyCurveToValue(imageData[i], profile.toneCurve.red);
      output[i + 1] = this.applyCurveToValue(imageData[i + 1], profile.toneCurve.green);
      output[i + 2] = this.applyCurveToValue(imageData[i + 2], profile.toneCurve.blue);
      output[i + 3] = imageData[i + 3];
    }

    logger.debug('Applied camera tone curve');
    return output;
  }

  /**
   * Get all available camera profiles
   */
  getAllProfiles(): CameraProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get profiles by manufacturer
   */
  getProfilesByMake(make: string): CameraProfile[] {
    return this.getAllProfiles().filter(profile =>
      profile.make.toLowerCase().includes(make.toLowerCase())
    );
  }

  /**
   * Private helper methods
   */
  private generateProfileKey(make: string, model: string): string {
    return `${make.toLowerCase()}_${model.toLowerCase().replace(/\s+/g, '_')}`;
  }

  private createCanonProfile(make: string, model: string, matrices: { colorMatrix1: number[]; colorMatrix2: number[] }): CameraProfile {
    return {
      id: this.generateProfileKey(make, model),
      make,
      model,
      colorMatrix1: matrices.colorMatrix1,
      colorMatrix2: matrices.colorMatrix2,
      whiteBalance: {
        asShot: [1.0, 1.0, 1.0],
        daylight: [1.0, 0.95, 0.85],
        tungsten: [0.65, 1.0, 1.35],
        fluorescent: [0.85, 1.0, 1.15],
        flash: [1.05, 0.98, 0.88],
        cloudy: [1.15, 0.92, 0.78],
        shade: [1.25, 0.88, 0.72]
      },
      noiseProfile: {
        iso100: { red: 0.001, green: 0.0008, blue: 0.0012 },
        iso400: { red: 0.004, green: 0.0032, blue: 0.0048 },
        iso1600: { red: 0.016, green: 0.0128, blue: 0.0192 }
      },
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        author: 'Vitrine',
        description: `Camera profile for ${make} ${model}`
      }
    };
  }

  private createNikonProfile(make: string, model: string, matrices: { colorMatrix1: number[]; colorMatrix2: number[] }): CameraProfile {
    return {
      id: this.generateProfileKey(make, model),
      make,
      model,
      colorMatrix1: matrices.colorMatrix1,
      colorMatrix2: matrices.colorMatrix2,
      whiteBalance: {
        asShot: [1.0, 1.0, 1.0],
        daylight: [0.98, 0.96, 0.86],
        tungsten: [0.62, 1.0, 1.38],
        fluorescent: [0.82, 1.0, 1.18],
        flash: [1.02, 0.99, 0.89],
        cloudy: [1.12, 0.94, 0.79],
        shade: [1.22, 0.90, 0.74]
      },
      noiseProfile: {
        iso100: { red: 0.0008, green: 0.0006, blue: 0.001 },
        iso400: { red: 0.0032, green: 0.0024, blue: 0.004 },
        iso1600: { red: 0.0128, green: 0.0096, blue: 0.016 }
      },
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        author: 'Vitrine',
        description: `Camera profile for ${make} ${model}`
      }
    };
  }

  private createSonyProfile(make: string, model: string, matrices: { colorMatrix1: number[]; colorMatrix2: number[] }): CameraProfile {
    return {
      id: this.generateProfileKey(make, model),
      make,
      model,
      colorMatrix1: matrices.colorMatrix1,
      colorMatrix2: matrices.colorMatrix2,
      whiteBalance: {
        asShot: [1.0, 1.0, 1.0],
        daylight: [1.02, 0.94, 0.84],
        tungsten: [0.68, 1.0, 1.32],
        fluorescent: [0.88, 1.0, 1.12],
        flash: [1.08, 0.97, 0.87],
        cloudy: [1.18, 0.91, 0.77],
        shade: [1.28, 0.87, 0.71]
      },
      noiseProfile: {
        iso100: { red: 0.0009, green: 0.0007, blue: 0.0011 },
        iso400: { red: 0.0036, green: 0.0028, blue: 0.0044 },
        iso1600: { red: 0.0144, green: 0.0112, blue: 0.0176 }
      },
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        author: 'Vitrine',
        description: `Camera profile for ${make} ${model}`
      }
    };
  }

  private createFujifilmProfile(make: string, model: string, matrices: { colorMatrix1: number[]; colorMatrix2: number[] }): CameraProfile {
    return {
      id: this.generateProfileKey(make, model),
      make,
      model,
      colorMatrix1: matrices.colorMatrix1,
      colorMatrix2: matrices.colorMatrix2,
      whiteBalance: {
        asShot: [1.0, 1.0, 1.0],
        daylight: [0.96, 0.98, 0.88],
        tungsten: [0.60, 1.0, 1.40],
        fluorescent: [0.80, 1.0, 1.20],
        flash: [1.00, 1.00, 0.90],
        cloudy: [1.10, 0.96, 0.80],
        shade: [1.20, 0.92, 0.76]
      },
      noiseProfile: {
        iso100: { red: 0.0007, green: 0.0005, blue: 0.0009 },
        iso400: { red: 0.0028, green: 0.002, blue: 0.0036 },
        iso1600: { red: 0.0112, green: 0.008, blue: 0.0144 }
      },
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        author: 'Vitrine',
        description: `Camera profile for ${make} ${model}`
      }
    };
  }

  private applyCurveToValue(value: number, curve: number[][]): number {
    if (!curve || curve.length < 2) return value;

    // Linear interpolation between curve points
    for (let i = 1; i < curve.length; i++) {
      if (value <= curve[i][0]) {
        const x1 = curve[i - 1][0];
        const y1 = curve[i - 1][1];
        const x2 = curve[i][0];
        const y2 = curve[i][1];

        const t = (value - x1) / (x2 - x1);
        return y1 + t * (y2 - y1);
      }
    }

    return curve[curve.length - 1][1];
  }

}

export const cameraProfileService = CameraProfileService.getInstance();