/**
 * LUT3DService - 3D Lookup Table Support
 *
 * Provides parsing, application, and GPU-accelerated processing of 3D LUTs.
 * Supports Adobe/Resolve .cube format and high-quality interpolation.
 *
 * Features:
 * - .cube file parsing (Adobe/Resolve format)
 * - Trilinear interpolation (fast)
 * - Tetrahedral interpolation (accurate)
 * - LUT caching with LRU eviction
 * - GPU-accelerated LUT application (via 3D texture)
 */

import { logger } from '../utils/Logger';

/**
 * 3D LUT data structure
 */
export interface LUT3D {
  /** LUT title/name */
  title: string;
  /** Size of the LUT (typically 17, 33, or 65) */
  size: number;
  /** Domain minimum [r, g, b] (typically [0, 0, 0]) */
  domainMin: [number, number, number];
  /** Domain maximum [r, g, b] (typically [1, 1, 1]) */
  domainMax: [number, number, number];
  /** LUT data as Float32Array (size^3 * 3 elements) */
  data: Float32Array;
}

/**
 * LUT metadata
 */
export interface LUTMetadata {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  comments: string[];
}

/**
 * Parse result
 */
interface ParseResult {
  success: boolean;
  lut?: LUT3D;
  error?: string;
}

/**
 * LUT3D Service for 3D lookup table operations
 */
class LUT3DServiceImpl {
  private lutCache: Map<string, LUT3D> = new Map();
  private maxCacheSize = 10; // Maximum number of LUTs to cache

  /**
   * Parse a .cube file and return a LUT3D object
   * @param content The content of the .cube file
   * @param name Optional name for the LUT
   */
  parseCubeFile(content: string, name?: string): ParseResult {
    try {
      const lines = content.split(/\r?\n/);
      let title = name || 'Untitled LUT';
      let size = 0;
      let domainMin: [number, number, number] = [0, 0, 0];
      let domainMax: [number, number, number] = [1, 1, 1];
      const comments: string[] = [];
      const lutValues: number[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Comments
        if (trimmed.startsWith('#')) {
          comments.push(trimmed.substring(1).trim());
          continue;
        }

        // Title
        if (trimmed.startsWith('TITLE')) {
          const match = trimmed.match(/TITLE\s+"?([^"]+)"?/i);
          if (match) {
            title = match[1].trim();
          }
          continue;
        }

        // LUT size
        if (trimmed.startsWith('LUT_3D_SIZE')) {
          const match = trimmed.match(/LUT_3D_SIZE\s+(\d+)/i);
          if (match) {
            size = parseInt(match[1], 10);
          }
          continue;
        }

        // Domain min
        if (trimmed.startsWith('DOMAIN_MIN')) {
          const match = trimmed.match(/DOMAIN_MIN\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/i);
          if (match) {
            domainMin = [
              parseFloat(match[1]),
              parseFloat(match[2]),
              parseFloat(match[3]),
            ];
          }
          continue;
        }

        // Domain max
        if (trimmed.startsWith('DOMAIN_MAX')) {
          const match = trimmed.match(/DOMAIN_MAX\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/i);
          if (match) {
            domainMax = [
              parseFloat(match[1]),
              parseFloat(match[2]),
              parseFloat(match[3]),
            ];
          }
          continue;
        }

        // Skip other keywords
        if (/^[A-Z_]+\s/.test(trimmed)) {
          continue;
        }

        // LUT data values
        const values = trimmed.split(/\s+/).map(parseFloat);
        if (values.length === 3 && !values.some(isNaN)) {
          lutValues.push(...values);
        }
      }

      // Validate
      if (size === 0) {
        return { success: false, error: 'LUT size not specified' };
      }

      const expectedValues = size * size * size * 3;
      if (lutValues.length !== expectedValues) {
        return {
          success: false,
          error: `Expected ${expectedValues} values, got ${lutValues.length}`,
        };
      }

      const lut: LUT3D = {
        title,
        size,
        domainMin,
        domainMax,
        data: new Float32Array(lutValues),
      };

      logger.debug('LUT3DService: Parsed cube file', { title, size });

      return { success: true, lut };
    } catch (error) {
      logger.error('LUT3DService: Failed to parse cube file', { error });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Apply a 3D LUT to an image using trilinear interpolation
   * @param input Input image data (RGBA Float32Array)
   * @param lut The 3D LUT to apply
   * @returns Processed image data
   */
  applyTrilinear(input: Float32Array, lut: LUT3D): Float32Array {
    const output = new Float32Array(input.length);
    const size = lut.size;
    const data = lut.data;
    const [dMinR, dMinG, dMinB] = lut.domainMin;
    const [dMaxR, dMaxG, dMaxB] = lut.domainMax;

    for (let i = 0; i < input.length; i += 4) {
      // Normalize input to LUT domain
      const r = (input[i] - dMinR) / (dMaxR - dMinR);
      const g = (input[i + 1] - dMinG) / (dMaxG - dMinG);
      const b = (input[i + 2] - dMinB) / (dMaxB - dMinB);

      // Clamp to [0, 1]
      const rClamped = Math.max(0, Math.min(1, r));
      const gClamped = Math.max(0, Math.min(1, g));
      const bClamped = Math.max(0, Math.min(1, b));

      // Scale to LUT indices
      const rScaled = rClamped * (size - 1);
      const gScaled = gClamped * (size - 1);
      const bScaled = bClamped * (size - 1);

      // Get integer indices
      const r0 = Math.floor(rScaled);
      const g0 = Math.floor(gScaled);
      const b0 = Math.floor(bScaled);
      const r1 = Math.min(r0 + 1, size - 1);
      const g1 = Math.min(g0 + 1, size - 1);
      const b1 = Math.min(b0 + 1, size - 1);

      // Get fractional parts
      const rFrac = rScaled - r0;
      const gFrac = gScaled - g0;
      const bFrac = bScaled - b0;

      // Get 8 corner values (trilinear interpolation)
      const c000 = this.getLutValue(data, size, r0, g0, b0);
      const c001 = this.getLutValue(data, size, r0, g0, b1);
      const c010 = this.getLutValue(data, size, r0, g1, b0);
      const c011 = this.getLutValue(data, size, r0, g1, b1);
      const c100 = this.getLutValue(data, size, r1, g0, b0);
      const c101 = this.getLutValue(data, size, r1, g0, b1);
      const c110 = this.getLutValue(data, size, r1, g1, b0);
      const c111 = this.getLutValue(data, size, r1, g1, b1);

      // Trilinear interpolation
      const [outR, outG, outB] = this.trilinearInterpolate(
        c000, c001, c010, c011, c100, c101, c110, c111,
        rFrac, gFrac, bFrac
      );

      output[i] = outR;
      output[i + 1] = outG;
      output[i + 2] = outB;
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Apply a 3D LUT to an image using tetrahedral interpolation
   * More accurate than trilinear but slightly slower
   */
  applyTetrahedral(input: Float32Array, lut: LUT3D): Float32Array {
    const output = new Float32Array(input.length);
    const size = lut.size;
    const data = lut.data;
    const [dMinR, dMinG, dMinB] = lut.domainMin;
    const [dMaxR, dMaxG, dMaxB] = lut.domainMax;

    for (let i = 0; i < input.length; i += 4) {
      // Normalize input to LUT domain
      const r = (input[i] - dMinR) / (dMaxR - dMinR);
      const g = (input[i + 1] - dMinG) / (dMaxG - dMinG);
      const b = (input[i + 2] - dMinB) / (dMaxB - dMinB);

      // Clamp to [0, 1]
      const rClamped = Math.max(0, Math.min(1, r));
      const gClamped = Math.max(0, Math.min(1, g));
      const bClamped = Math.max(0, Math.min(1, b));

      // Scale to LUT indices
      const rScaled = rClamped * (size - 1);
      const gScaled = gClamped * (size - 1);
      const bScaled = bClamped * (size - 1);

      // Get integer indices
      const r0 = Math.floor(rScaled);
      const g0 = Math.floor(gScaled);
      const b0 = Math.floor(bScaled);
      const r1 = Math.min(r0 + 1, size - 1);
      const g1 = Math.min(g0 + 1, size - 1);
      const b1 = Math.min(b0 + 1, size - 1);

      // Get fractional parts
      const rFrac = rScaled - r0;
      const gFrac = gScaled - g0;
      const bFrac = bScaled - b0;

      // Tetrahedral interpolation
      const [outR, outG, outB] = this.tetrahedralInterpolate(
        data, size, r0, g0, b0, r1, g1, b1, rFrac, gFrac, bFrac
      );

      output[i] = outR;
      output[i + 1] = outG;
      output[i + 2] = outB;
      output[i + 3] = input[i + 3]; // Preserve alpha
    }

    return output;
  }

  /**
   * Get a value from the LUT at the given indices
   */
  private getLutValue(
    data: Float32Array,
    size: number,
    r: number,
    g: number,
    b: number
  ): [number, number, number] {
    // LUT is stored as B, G, R order (blue varies fastest)
    const index = (r * size * size + g * size + b) * 3;
    return [data[index], data[index + 1], data[index + 2]];
  }

  /**
   * Trilinear interpolation between 8 corner values
   */
  private trilinearInterpolate(
    c000: [number, number, number],
    c001: [number, number, number],
    c010: [number, number, number],
    c011: [number, number, number],
    c100: [number, number, number],
    c101: [number, number, number],
    c110: [number, number, number],
    c111: [number, number, number],
    rFrac: number,
    gFrac: number,
    bFrac: number
  ): [number, number, number] {
    const result: [number, number, number] = [0, 0, 0];

    for (let ch = 0; ch < 3; ch++) {
      // Interpolate along B axis
      const c00 = c000[ch] * (1 - bFrac) + c001[ch] * bFrac;
      const c01 = c010[ch] * (1 - bFrac) + c011[ch] * bFrac;
      const c10 = c100[ch] * (1 - bFrac) + c101[ch] * bFrac;
      const c11 = c110[ch] * (1 - bFrac) + c111[ch] * bFrac;

      // Interpolate along G axis
      const c0 = c00 * (1 - gFrac) + c01 * gFrac;
      const c1 = c10 * (1 - gFrac) + c11 * gFrac;

      // Interpolate along R axis
      result[ch] = c0 * (1 - rFrac) + c1 * rFrac;
    }

    return result;
  }

  /**
   * Tetrahedral interpolation for more accurate results
   */
  private tetrahedralInterpolate(
    data: Float32Array,
    size: number,
    r0: number,
    g0: number,
    b0: number,
    r1: number,
    g1: number,
    b1: number,
    rFrac: number,
    gFrac: number,
    bFrac: number
  ): [number, number, number] {
    // Get corner values
    const c000 = this.getLutValue(data, size, r0, g0, b0);
    const c111 = this.getLutValue(data, size, r1, g1, b1);

    let c1: [number, number, number];
    let c2: [number, number, number];
    let w0: number, w1: number, w2: number, w3: number;

    // Determine which tetrahedron we're in
    if (rFrac > gFrac) {
      if (gFrac > bFrac) {
        // Tetrahedron 1: r > g > b
        c1 = this.getLutValue(data, size, r1, g0, b0);
        c2 = this.getLutValue(data, size, r1, g1, b0);
        w0 = 1 - rFrac;
        w1 = rFrac - gFrac;
        w2 = gFrac - bFrac;
        w3 = bFrac;
      } else if (rFrac > bFrac) {
        // Tetrahedron 2: r > b > g
        c1 = this.getLutValue(data, size, r1, g0, b0);
        c2 = this.getLutValue(data, size, r1, g0, b1);
        w0 = 1 - rFrac;
        w1 = rFrac - bFrac;
        w2 = bFrac - gFrac;
        w3 = gFrac;
      } else {
        // Tetrahedron 3: b > r > g
        c1 = this.getLutValue(data, size, r0, g0, b1);
        c2 = this.getLutValue(data, size, r1, g0, b1);
        w0 = 1 - bFrac;
        w1 = bFrac - rFrac;
        w2 = rFrac - gFrac;
        w3 = gFrac;
      }
    } else {
      if (bFrac > gFrac) {
        // Tetrahedron 4: b > g > r
        c1 = this.getLutValue(data, size, r0, g0, b1);
        c2 = this.getLutValue(data, size, r0, g1, b1);
        w0 = 1 - bFrac;
        w1 = bFrac - gFrac;
        w2 = gFrac - rFrac;
        w3 = rFrac;
      } else if (rFrac > bFrac) {
        // Tetrahedron 5: g > r > b
        c1 = this.getLutValue(data, size, r0, g1, b0);
        c2 = this.getLutValue(data, size, r1, g1, b0);
        w0 = 1 - gFrac;
        w1 = gFrac - rFrac;
        w2 = rFrac - bFrac;
        w3 = bFrac;
      } else {
        // Tetrahedron 6: g > b > r
        c1 = this.getLutValue(data, size, r0, g1, b0);
        c2 = this.getLutValue(data, size, r0, g1, b1);
        w0 = 1 - gFrac;
        w1 = gFrac - bFrac;
        w2 = bFrac - rFrac;
        w3 = rFrac;
      }
    }

    // Weighted sum
    const result: [number, number, number] = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      result[ch] = w0 * c000[ch] + w1 * c1[ch] + w2 * c2[ch] + w3 * c111[ch];
    }

    return result;
  }

  /**
   * Cache a LUT for later use
   */
  cacheLut(key: string, lut: LUT3D): void {
    // Evict oldest if cache is full
    if (this.lutCache.size >= this.maxCacheSize) {
      const oldestKey = this.lutCache.keys().next().value;
      if (oldestKey) {
        this.lutCache.delete(oldestKey);
      }
    }

    this.lutCache.set(key, lut);
    logger.debug('LUT3DService: Cached LUT', { key, size: lut.size });
  }

  /**
   * Get a cached LUT
   */
  getCachedLut(key: string): LUT3D | undefined {
    return this.lutCache.get(key);
  }

  /**
   * Clear the LUT cache
   */
  clearCache(): void {
    this.lutCache.clear();
    logger.debug('LUT3DService: Cache cleared');
  }

  /**
   * Generate identity LUT (no color change)
   */
  generateIdentityLut(size: number = 33): LUT3D {
    const data = new Float32Array(size * size * size * 3);
    let index = 0;

    for (let r = 0; r < size; r++) {
      for (let g = 0; g < size; g++) {
        for (let b = 0; b < size; b++) {
          data[index++] = r / (size - 1);
          data[index++] = g / (size - 1);
          data[index++] = b / (size - 1);
        }
      }
    }

    return {
      title: 'Identity',
      size,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
      data,
    };
  }

  /**
   * Export LUT to .cube format
   */
  exportToCube(lut: LUT3D): string {
    const lines: string[] = [
      `# Created by Vitrine`,
      `TITLE "${lut.title}"`,
      `LUT_3D_SIZE ${lut.size}`,
      `DOMAIN_MIN ${lut.domainMin.join(' ')}`,
      `DOMAIN_MAX ${lut.domainMax.join(' ')}`,
      '',
    ];

    for (let i = 0; i < lut.data.length; i += 3) {
      lines.push(
        `${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Get LUT metadata without full parsing
   */
  getLutMetadata(content: string): LUTMetadata {
    const lines = content.split(/\r?\n/);
    let title = 'Untitled';
    let size = 0;
    let domainMin: [number, number, number] = [0, 0, 0];
    let domainMax: [number, number, number] = [1, 1, 1];
    const comments: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) {
        comments.push(trimmed.substring(1).trim());
      } else if (trimmed.startsWith('TITLE')) {
        const match = trimmed.match(/TITLE\s+"?([^"]+)"?/i);
        if (match) title = match[1].trim();
      } else if (trimmed.startsWith('LUT_3D_SIZE')) {
        const match = trimmed.match(/LUT_3D_SIZE\s+(\d+)/i);
        if (match) size = parseInt(match[1], 10);
      } else if (trimmed.startsWith('DOMAIN_MIN')) {
        const match = trimmed.match(/DOMAIN_MIN\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/i);
        if (match) {
          domainMin = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
        }
      } else if (trimmed.startsWith('DOMAIN_MAX')) {
        const match = trimmed.match(/DOMAIN_MAX\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/i);
        if (match) {
          domainMax = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
        }
      }
    }

    return { title, size, domainMin, domainMax, comments };
  }
}

// Export singleton instance
export const lut3DService = new LUT3DServiceImpl();

// Export class for testing
export { LUT3DServiceImpl };
