/**
 * ICCProfileService - ICC Profile File Parsing and Application
 *
 * Parses ICC v2/v4 profile files (.icc, .icm) and extracts color
 * transformation data for accurate color management.
 *
 * Features:
 * - Parse ICC v2 and v4 profile headers
 * - Extract matrix-based profiles (RGB profiles)
 * - Extract TRC (Tone Response Curves)
 * - Support for parametric curves
 * - Apply profile transforms to image data
 *
 * Reference: ICC.1:2022 specification
 */

import { logger } from '../utils/Logger';

/**
 * ICC Profile header structure
 */
export interface ICCHeader {
  profileSize: number;
  cmmType: string;
  version: string;
  deviceClass: string;
  colorSpace: string;
  pcs: string; // Profile Connection Space
  dateTime: Date;
  signature: string;
  platform: string;
  flags: number;
  manufacturer: string;
  model: string;
  attributes: number;
  renderingIntent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
  illuminant: [number, number, number];
  creator: string;
  profileId: string;
}

/**
 * Tag entry in ICC profile
 */
interface TagEntry {
  signature: string;
  offset: number;
  size: number;
}

/**
 * Parametric curve types (ICC v4)
 */
type ParametricCurveType = 0 | 1 | 2 | 3 | 4;

/**
 * Tone Response Curve data
 */
export interface TRCData {
  type: 'gamma' | 'table' | 'parametric';
  gamma?: number;
  table?: number[];
  parametric?: {
    type: ParametricCurveType;
    params: number[];
  };
}

/**
 * Matrix profile data (3x3 matrix + TRC)
 */
export interface MatrixProfile {
  redMatrix: [number, number, number];
  greenMatrix: [number, number, number];
  blueMatrix: [number, number, number];
  redTRC: TRCData;
  greenTRC: TRCData;
  blueTRC: TRCData;
}

/**
 * Parsed ICC Profile
 */
export interface ICCProfile {
  header: ICCHeader;
  tags: Map<string, TagEntry>;
  matrixProfile?: MatrixProfile;
  rawData: ArrayBuffer;
}

/**
 * ICC Profile parsing result
 */
export interface ParseResult {
  success: boolean;
  profile?: ICCProfile;
  error?: string;
}

// Tag signatures
const TAG_SIGNATURES = {
  rXYZ: 'rXYZ', // Red matrix column
  gXYZ: 'gXYZ', // Green matrix column
  bXYZ: 'bXYZ', // Blue matrix column
  rTRC: 'rTRC', // Red TRC
  gTRC: 'gTRC', // Green TRC
  bTRC: 'bTRC', // Blue TRC
  wtpt: 'wtpt', // Media white point
  cprt: 'cprt', // Copyright
  desc: 'desc', // Profile description
  chad: 'chad', // Chromatic adaptation matrix
} as const;

/**
 * ICC Profile Service Implementation
 */
class ICCProfileServiceImpl {
  private profileCache: Map<string, ICCProfile> = new Map();

  /**
   * Parse an ICC profile from an ArrayBuffer
   */
  parse(data: ArrayBuffer): ParseResult {
    try {
      if (data.byteLength < 128) {
        return { success: false, error: 'File too small to be valid ICC profile' };
      }

      const view = new DataView(data);

      // Parse header
      const header = this.parseHeader(view);
      if (!header) {
        return { success: false, error: 'Invalid ICC profile header' };
      }

      // Verify signature
      if (header.signature !== 'acsp') {
        return { success: false, error: `Invalid profile signature: ${header.signature}` };
      }

      // Parse tag table
      const tagCount = view.getUint32(128, false);
      const tags = this.parseTags(view, tagCount);

      // Build profile object
      const profile: ICCProfile = {
        header,
        tags,
        rawData: data,
      };

      // Extract matrix profile if available (RGB profiles)
      if (header.colorSpace === 'RGB ') {
        const matrixProfile = this.extractMatrixProfile(view, tags);
        if (matrixProfile) {
          profile.matrixProfile = matrixProfile;
        }
      }

      logger.debug('ICCProfileService: Parsed profile', {
        version: header.version,
        colorSpace: header.colorSpace,
        deviceClass: header.deviceClass,
        tagCount: tags.size,
      });

      return { success: true, profile };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('ICCProfileService: Parse error', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Parse ICC profile header (128 bytes)
   */
  private parseHeader(view: DataView): ICCHeader | null {
    try {
      const profileSize = view.getUint32(0, false);

      // CMM Type (4 bytes)
      const cmmType = this.readString(view, 4, 4);

      // Version (4 bytes)
      const major = view.getUint8(8);
      const minor = (view.getUint8(9) >> 4) & 0x0f;
      const bugfix = view.getUint8(9) & 0x0f;
      const version = `${major}.${minor}.${bugfix}`;

      // Device class (4 bytes)
      const deviceClass = this.readString(view, 12, 4);

      // Color space (4 bytes)
      const colorSpace = this.readString(view, 16, 4);

      // PCS (4 bytes)
      const pcs = this.readString(view, 20, 4);

      // Date/time (12 bytes)
      const year = view.getUint16(24, false);
      const month = view.getUint16(26, false);
      const day = view.getUint16(28, false);
      const hour = view.getUint16(30, false);
      const minute = view.getUint16(32, false);
      const second = view.getUint16(34, false);
      const dateTime = new Date(year, month - 1, day, hour, minute, second);

      // Signature (4 bytes) - should be 'acsp'
      const signature = this.readString(view, 36, 4);

      // Platform (4 bytes)
      const platform = this.readString(view, 40, 4);

      // Flags (4 bytes)
      const flags = view.getUint32(44, false);

      // Manufacturer (4 bytes)
      const manufacturer = this.readString(view, 48, 4);

      // Model (4 bytes)
      const model = this.readString(view, 52, 4);

      // Attributes (8 bytes)
      const attributes = view.getUint32(56, false);

      // Rendering intent (4 bytes)
      const intentValue = view.getUint32(64, false);
      const renderingIntent = this.parseRenderingIntent(intentValue);

      // PCS illuminant (12 bytes - XYZ)
      const illuminant: [number, number, number] = [
        this.readS15Fixed16(view, 68),
        this.readS15Fixed16(view, 72),
        this.readS15Fixed16(view, 76),
      ];

      // Creator (4 bytes)
      const creator = this.readString(view, 80, 4);

      // Profile ID (16 bytes) - MD5 hash in v4
      const profileId = this.readHex(view, 84, 16);

      return {
        profileSize,
        cmmType,
        version,
        deviceClass,
        colorSpace,
        pcs,
        dateTime,
        signature,
        platform,
        flags,
        manufacturer,
        model,
        attributes,
        renderingIntent,
        illuminant,
        creator,
        profileId,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse tag table
   */
  private parseTags(view: DataView, tagCount: number): Map<string, TagEntry> {
    const tags = new Map<string, TagEntry>();

    for (let i = 0; i < tagCount; i++) {
      const offset = 132 + i * 12;
      const signature = this.readString(view, offset, 4);
      const tagOffset = view.getUint32(offset + 4, false);
      const tagSize = view.getUint32(offset + 8, false);

      tags.set(signature, {
        signature,
        offset: tagOffset,
        size: tagSize,
      });
    }

    return tags;
  }

  /**
   * Extract matrix-based profile (XYZ + TRC tags)
   */
  private extractMatrixProfile(
    view: DataView,
    tags: Map<string, TagEntry>
  ): MatrixProfile | null {
    const rXYZ = tags.get(TAG_SIGNATURES.rXYZ);
    const gXYZ = tags.get(TAG_SIGNATURES.gXYZ);
    const bXYZ = tags.get(TAG_SIGNATURES.bXYZ);
    const rTRC = tags.get(TAG_SIGNATURES.rTRC);
    const gTRC = tags.get(TAG_SIGNATURES.gTRC);
    const bTRC = tags.get(TAG_SIGNATURES.bTRC);

    if (!rXYZ || !gXYZ || !bXYZ || !rTRC || !gTRC || !bTRC) {
      return null;
    }

    try {
      return {
        redMatrix: this.parseXYZTag(view, rXYZ.offset),
        greenMatrix: this.parseXYZTag(view, gXYZ.offset),
        blueMatrix: this.parseXYZTag(view, bXYZ.offset),
        redTRC: this.parseTRCTag(view, rTRC.offset, rTRC.size),
        greenTRC: this.parseTRCTag(view, gTRC.offset, gTRC.size),
        blueTRC: this.parseTRCTag(view, bTRC.offset, bTRC.size),
      };
    } catch (err) {
      logger.warn('ICCProfileService: Failed to extract matrix profile', { error: err });
      return null;
    }
  }

  /**
   * Parse XYZ tag
   */
  private parseXYZTag(view: DataView, offset: number): [number, number, number] {
    // Skip type signature (4 bytes) and reserved (4 bytes)
    return [
      this.readS15Fixed16(view, offset + 8),
      this.readS15Fixed16(view, offset + 12),
      this.readS15Fixed16(view, offset + 16),
    ];
  }

  /**
   * Parse TRC (Tone Response Curve) tag
   */
  private parseTRCTag(view: DataView, offset: number, _size: number): TRCData {
    const typeSignature = this.readString(view, offset, 4);

    if (typeSignature === 'curv') {
      // curveType
      const entryCount = view.getUint32(offset + 8, false);

      if (entryCount === 0) {
        // Linear (gamma 1.0)
        return { type: 'gamma', gamma: 1.0 };
      } else if (entryCount === 1) {
        // Single gamma value (u8Fixed8Number)
        const gamma = view.getUint16(offset + 12, false) / 256;
        return { type: 'gamma', gamma };
      } else {
        // Lookup table
        const table: number[] = [];
        for (let i = 0; i < entryCount; i++) {
          const value = view.getUint16(offset + 12 + i * 2, false) / 65535;
          table.push(value);
        }
        return { type: 'table', table };
      }
    } else if (typeSignature === 'para') {
      // parametricCurveType
      const funcType = view.getUint16(offset + 8, false) as ParametricCurveType;
      const params: number[] = [];

      // Number of parameters depends on function type
      const paramCounts = [1, 3, 4, 5, 7];
      const paramCount = paramCounts[funcType] || 0;

      for (let i = 0; i < paramCount; i++) {
        params.push(this.readS15Fixed16(view, offset + 12 + i * 4));
      }

      return {
        type: 'parametric',
        parametric: { type: funcType, params },
      };
    }

    // Default fallback to gamma 2.2
    return { type: 'gamma', gamma: 2.2 };
  }

  /**
   * Apply TRC to a value
   */
  applyTRC(value: number, trc: TRCData): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;

    switch (trc.type) {
      case 'gamma':
        return Math.pow(value, trc.gamma || 2.2);

      case 'table':
        if (!trc.table || trc.table.length === 0) return value;
        return this.interpolateTable(value, trc.table);

      case 'parametric':
        return this.evaluateParametricCurve(value, trc.parametric!);

      default:
        return value;
    }
  }

  /**
   * Apply inverse TRC to a value
   */
  applyInverseTRC(value: number, trc: TRCData): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;

    switch (trc.type) {
      case 'gamma':
        return Math.pow(value, 1 / (trc.gamma || 2.2));

      case 'table':
        if (!trc.table || trc.table.length === 0) return value;
        return this.inverseInterpolateTable(value, trc.table);

      case 'parametric':
        // For parametric, use numerical inversion
        return this.invertParametricCurve(value, trc.parametric!);

      default:
        return value;
    }
  }

  /**
   * Interpolate in a lookup table
   */
  private interpolateTable(value: number, table: number[]): number {
    const n = table.length - 1;
    const index = value * n;
    const low = Math.floor(index);
    const high = Math.min(low + 1, n);
    const t = index - low;

    return table[low] * (1 - t) + table[high] * t;
  }

  /**
   * Inverse interpolation in lookup table
   */
  private inverseInterpolateTable(value: number, table: number[]): number {
    const n = table.length - 1;

    // Binary search for the value
    let low = 0;
    let high = n;

    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (table[mid] <= value) {
        low = mid;
      } else {
        high = mid;
      }
    }

    // Interpolate between low and high
    const range = table[high] - table[low];
    if (range < 0.0001) return low / n;

    const t = (value - table[low]) / range;
    return (low + t) / n;
  }

  /**
   * Evaluate parametric curve
   */
  private evaluateParametricCurve(
    x: number,
    parametric: { type: ParametricCurveType; params: number[] }
  ): number {
    const { type, params } = parametric;

    switch (type) {
      case 0: {
        // Y = X^g
        const g = params[0];
        return Math.pow(x, g);
      }
      case 1: {
        // Y = (aX + b)^g  if X >= -b/a
        // Y = 0           if X < -b/a
        const [g, a, b] = params;
        const threshold = -b / a;
        return x >= threshold ? Math.pow(a * x + b, g) : 0;
      }
      case 2: {
        // Y = (aX + b)^g + c  if X >= -b/a
        // Y = c               if X < -b/a
        const [g, a, b, c] = params;
        const threshold = -b / a;
        return x >= threshold ? Math.pow(a * x + b, g) + c : c;
      }
      case 3: {
        // Y = (aX + b)^g  if X >= d
        // Y = cX          if X < d
        const [g, a, b, c, d] = params;
        return x >= d ? Math.pow(a * x + b, g) : c * x;
      }
      case 4: {
        // Y = (aX + b)^g + e  if X >= d
        // Y = cX + f          if X < d
        const [g, a, b, c, d, e, f] = params;
        return x >= d ? Math.pow(a * x + b, g) + e : c * x + f;
      }
      default:
        return Math.pow(x, 2.2);
    }
  }

  /**
   * Numerically invert parametric curve using Newton's method
   */
  private invertParametricCurve(
    y: number,
    parametric: { type: ParametricCurveType; params: number[] }
  ): number {
    // Initial guess
    let x = y;

    // Newton's method with bounded iterations
    for (let i = 0; i < 20; i++) {
      const fx = this.evaluateParametricCurve(x, parametric) - y;
      if (Math.abs(fx) < 1e-6) break;

      // Numerical derivative
      const h = 0.0001;
      const dfx =
        (this.evaluateParametricCurve(x + h, parametric) -
          this.evaluateParametricCurve(x - h, parametric)) /
        (2 * h);

      if (Math.abs(dfx) < 1e-10) break;

      x = Math.max(0, Math.min(1, x - fx / dfx));
    }

    return x;
  }

  /**
   * Convert RGB to XYZ using matrix profile
   */
  rgbToXYZ(
    r: number,
    g: number,
    b: number,
    profile: MatrixProfile
  ): [number, number, number] {
    // Apply TRC (linearize)
    const rLin = this.applyTRC(r, profile.redTRC);
    const gLin = this.applyTRC(g, profile.greenTRC);
    const bLin = this.applyTRC(b, profile.blueTRC);

    // Apply matrix
    const x =
      profile.redMatrix[0] * rLin +
      profile.greenMatrix[0] * gLin +
      profile.blueMatrix[0] * bLin;
    const y =
      profile.redMatrix[1] * rLin +
      profile.greenMatrix[1] * gLin +
      profile.blueMatrix[1] * bLin;
    const z =
      profile.redMatrix[2] * rLin +
      profile.greenMatrix[2] * gLin +
      profile.blueMatrix[2] * bLin;

    return [x, y, z];
  }

  /**
   * Convert XYZ to RGB using matrix profile
   */
  xyzToRGB(
    x: number,
    y: number,
    z: number,
    profile: MatrixProfile
  ): [number, number, number] {
    // Invert the matrix
    const matrix = [
      [profile.redMatrix[0], profile.greenMatrix[0], profile.blueMatrix[0]],
      [profile.redMatrix[1], profile.greenMatrix[1], profile.blueMatrix[1]],
      [profile.redMatrix[2], profile.greenMatrix[2], profile.blueMatrix[2]],
    ];

    const invMatrix = this.invertMatrix3x3(matrix);

    // Apply inverse matrix
    const rLin = invMatrix[0][0] * x + invMatrix[0][1] * y + invMatrix[0][2] * z;
    const gLin = invMatrix[1][0] * x + invMatrix[1][1] * y + invMatrix[1][2] * z;
    const bLin = invMatrix[2][0] * x + invMatrix[2][1] * y + invMatrix[2][2] * z;

    // Apply inverse TRC
    const r = this.applyInverseTRC(Math.max(0, rLin), profile.redTRC);
    const g = this.applyInverseTRC(Math.max(0, gLin), profile.greenTRC);
    const b = this.applyInverseTRC(Math.max(0, bLin), profile.blueTRC);

    return [r, g, b];
  }

  /**
   * Invert a 3x3 matrix
   */
  private invertMatrix3x3(m: number[][]): number[][] {
    const det =
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    if (Math.abs(det) < 1e-10) {
      // Return identity if singular
      return [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
    }

    const invDet = 1 / det;

    return [
      [
        (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet,
        (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet,
        (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet,
      ],
      [
        (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet,
        (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet,
        (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet,
      ],
      [
        (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet,
        (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet,
        (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet,
      ],
    ];
  }

  /**
   * Apply ICC profile to image data
   */
  applyProfile(
    input: Float32Array,
    sourceProfile: ICCProfile,
    destProfile: ICCProfile
  ): Float32Array {
    const output = new Float32Array(input.length);

    if (!sourceProfile.matrixProfile || !destProfile.matrixProfile) {
      logger.warn('ICCProfileService: Matrix profiles required for conversion');
      return input.slice();
    }

    for (let i = 0; i < input.length; i += 4) {
      // Source RGB to XYZ
      const [x, y, z] = this.rgbToXYZ(
        input[i],
        input[i + 1],
        input[i + 2],
        sourceProfile.matrixProfile
      );

      // XYZ to destination RGB
      const [r, g, b] = this.xyzToRGB(x, y, z, destProfile.matrixProfile);

      output[i] = Math.max(0, Math.min(1, r));
      output[i + 1] = Math.max(0, Math.min(1, g));
      output[i + 2] = Math.max(0, Math.min(1, b));
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Create a standard sRGB profile
   */
  createSRGBProfile(): MatrixProfile {
    // sRGB primaries in XYZ (D65)
    return {
      redMatrix: [0.4124564, 0.2126729, 0.0193339],
      greenMatrix: [0.3575761, 0.7151522, 0.1191920],
      blueMatrix: [0.1804375, 0.0721750, 0.9503041],
      redTRC: { type: 'gamma', gamma: 2.4 },
      greenTRC: { type: 'gamma', gamma: 2.4 },
      blueTRC: { type: 'gamma', gamma: 2.4 },
    };
  }

  /**
   * Create an Adobe RGB profile
   */
  createAdobeRGBProfile(): MatrixProfile {
    return {
      redMatrix: [0.5767309, 0.2973769, 0.0270343],
      greenMatrix: [0.1855540, 0.6273491, 0.0706872],
      blueMatrix: [0.1881852, 0.0752741, 0.9911085],
      redTRC: { type: 'gamma', gamma: 2.19921875 },
      greenTRC: { type: 'gamma', gamma: 2.19921875 },
      blueTRC: { type: 'gamma', gamma: 2.19921875 },
    };
  }

  /**
   * Create a Display P3 profile
   */
  createDisplayP3Profile(): MatrixProfile {
    return {
      redMatrix: [0.4865709, 0.2289746, 0.0000000],
      greenMatrix: [0.2656677, 0.6917385, 0.0451134],
      blueMatrix: [0.1982173, 0.0792869, 1.0439444],
      redTRC: { type: 'gamma', gamma: 2.4 },
      greenTRC: { type: 'gamma', gamma: 2.4 },
      blueTRC: { type: 'gamma', gamma: 2.4 },
    };
  }

  /**
   * Cache a profile
   */
  cacheProfile(name: string, profile: ICCProfile): void {
    this.profileCache.set(name, profile);
  }

  /**
   * Get cached profile
   */
  getCachedProfile(name: string): ICCProfile | undefined {
    return this.profileCache.get(name);
  }

  /**
   * Clear profile cache
   */
  clearCache(): void {
    this.profileCache.clear();
  }

  // Helper methods for reading binary data

  private readString(view: DataView, offset: number, length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      const byte = view.getUint8(offset + i);
      if (byte >= 32 && byte <= 126) {
        result += String.fromCharCode(byte);
      } else {
        result += ' ';
      }
    }
    return result;
  }

  private readHex(view: DataView, offset: number, length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += view.getUint8(offset + i).toString(16).padStart(2, '0');
    }
    return result;
  }

  private readS15Fixed16(view: DataView, offset: number): number {
    const value = view.getInt32(offset, false);
    return value / 65536;
  }

  private parseRenderingIntent(
    value: number
  ): 'perceptual' | 'relative' | 'saturation' | 'absolute' {
    switch (value) {
      case 0:
        return 'perceptual';
      case 1:
        return 'relative';
      case 2:
        return 'saturation';
      case 3:
        return 'absolute';
      default:
        return 'perceptual';
    }
  }
}

// Export singleton
export const iccProfileService = new ICCProfileServiceImpl();

// Export class for testing
export { ICCProfileServiceImpl };
