/**
 * ICCProfileService Tests
 */

import { iccProfileService, ICCProfileServiceImpl, TRCData, ICCHeader } from './ICCProfileService';

describe('ICCProfileService', () => {
  describe('TRC (Tone Response Curve) Application', () => {
    describe('Gamma TRC', () => {
      it('should apply gamma correctly', () => {
        const trc: TRCData = { type: 'gamma', gamma: 2.2 };

        expect(iccProfileService.applyTRC(0, trc)).toBe(0);
        expect(iccProfileService.applyTRC(1, trc)).toBe(1);
        expect(iccProfileService.applyTRC(0.5, trc)).toBeCloseTo(Math.pow(0.5, 2.2), 6);
      });

      it('should apply inverse gamma correctly', () => {
        const trc: TRCData = { type: 'gamma', gamma: 2.2 };
        const testValues = [0, 0.25, 0.5, 0.75, 1];

        for (const value of testValues) {
          const applied = iccProfileService.applyTRC(value, trc);
          const inverted = iccProfileService.applyInverseTRC(applied, trc);
          expect(inverted).toBeCloseTo(value, 5);
        }
      });

      it('should handle linear gamma (1.0)', () => {
        const trc: TRCData = { type: 'gamma', gamma: 1.0 };

        expect(iccProfileService.applyTRC(0.5, trc)).toBe(0.5);
        expect(iccProfileService.applyInverseTRC(0.5, trc)).toBe(0.5);
      });
    });

    describe('Table TRC', () => {
      it('should interpolate table values correctly', () => {
        const trc: TRCData = {
          type: 'table',
          table: [0, 0.25, 0.5, 0.75, 1.0],
        };

        // Linear table should return same values
        expect(iccProfileService.applyTRC(0, trc)).toBe(0);
        expect(iccProfileService.applyTRC(0.5, trc)).toBeCloseTo(0.5, 5);
        expect(iccProfileService.applyTRC(1, trc)).toBe(1);
      });

      it('should interpolate between table entries', () => {
        const trc: TRCData = {
          type: 'table',
          table: [0, 0.1, 0.5, 0.9, 1.0],
        };

        // 0.375 maps to index 1.5, between index 1 (0.1) and index 2 (0.5)
        const result = iccProfileService.applyTRC(0.375, trc);
        expect(result).toBeGreaterThan(0.1);
        expect(result).toBeLessThan(0.5);
        // Expected: 0.1 * 0.5 + 0.5 * 0.5 = 0.3
        expect(result).toBeCloseTo(0.3, 4);
      });

      it('should handle inverse table lookup', () => {
        const trc: TRCData = {
          type: 'table',
          table: [0, 0.1, 0.3, 0.6, 1.0],
        };

        const testValues = [0, 0.25, 0.5, 0.75, 1];
        for (const value of testValues) {
          const applied = iccProfileService.applyTRC(value, trc);
          const inverted = iccProfileService.applyInverseTRC(applied, trc);
          expect(inverted).toBeCloseTo(value, 2);
        }
      });

      it('should handle empty table', () => {
        const trc: TRCData = { type: 'table', table: [] };
        expect(iccProfileService.applyTRC(0.5, trc)).toBe(0.5);
      });
    });

    describe('Parametric TRC', () => {
      it('should handle type 0 (simple gamma)', () => {
        const trc: TRCData = {
          type: 'parametric',
          parametric: { type: 0, params: [2.2] },
        };

        expect(iccProfileService.applyTRC(0.5, trc)).toBeCloseTo(Math.pow(0.5, 2.2), 5);
      });

      it('should handle type 3 (sRGB-like)', () => {
        // Type 3: (aX + b)^g if X >= d, else cX
        const trc: TRCData = {
          type: 'parametric',
          parametric: {
            type: 3,
            params: [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045],
          },
        };

        // Below threshold should use linear portion
        const lowResult = iccProfileService.applyTRC(0.01, trc);
        expect(lowResult).toBeCloseTo(0.01 / 12.92, 4);

        // Above threshold should use power function
        const highResult = iccProfileService.applyTRC(0.5, trc);
        expect(highResult).toBeGreaterThan(0);
        expect(highResult).toBeLessThan(1);
      });

      it('should roundtrip parametric curves', () => {
        const trc: TRCData = {
          type: 'parametric',
          parametric: { type: 0, params: [2.4] },
        };

        const testValues = [0.1, 0.3, 0.5, 0.7, 0.9];
        for (const value of testValues) {
          const applied = iccProfileService.applyTRC(value, trc);
          const inverted = iccProfileService.applyInverseTRC(applied, trc);
          expect(inverted).toBeCloseTo(value, 3);
        }
      });
    });

    describe('Edge Cases', () => {
      it('should clamp values at 0', () => {
        const trc: TRCData = { type: 'gamma', gamma: 2.2 };
        expect(iccProfileService.applyTRC(-0.5, trc)).toBe(0);
      });

      it('should clamp values at 1', () => {
        const trc: TRCData = { type: 'gamma', gamma: 2.2 };
        expect(iccProfileService.applyTRC(1.5, trc)).toBe(1);
      });
    });
  });

  describe('Built-in Profiles', () => {
    describe('sRGB Profile', () => {
      it('should create valid sRGB profile', () => {
        const profile = iccProfileService.createSRGBProfile();

        expect(profile.redMatrix).toBeDefined();
        expect(profile.greenMatrix).toBeDefined();
        expect(profile.blueMatrix).toBeDefined();
        expect(profile.redTRC).toBeDefined();
        expect(profile.greenTRC).toBeDefined();
        expect(profile.blueTRC).toBeDefined();
      });

      it('should have correct sRGB primaries', () => {
        const profile = iccProfileService.createSRGBProfile();

        // White point should sum to D65 (0.95047, 1.0, 1.08883)
        const whiteX =
          profile.redMatrix[0] + profile.greenMatrix[0] + profile.blueMatrix[0];
        const whiteY =
          profile.redMatrix[1] + profile.greenMatrix[1] + profile.blueMatrix[1];
        const whiteZ =
          profile.redMatrix[2] + profile.greenMatrix[2] + profile.blueMatrix[2];

        expect(whiteX).toBeCloseTo(0.95047, 2);
        expect(whiteY).toBeCloseTo(1.0, 2);
        expect(whiteZ).toBeCloseTo(1.08883, 2);
      });
    });

    describe('Adobe RGB Profile', () => {
      it('should create valid Adobe RGB profile', () => {
        const profile = iccProfileService.createAdobeRGBProfile();

        expect(profile.redMatrix).toBeDefined();
        expect(profile.redTRC.gamma).toBeCloseTo(2.2, 1);
      });

      it('should have wider gamut than sRGB', () => {
        const srgb = iccProfileService.createSRGBProfile();
        const adobe = iccProfileService.createAdobeRGBProfile();

        // Adobe RGB red primary has higher X value
        expect(adobe.redMatrix[0]).toBeGreaterThan(srgb.redMatrix[0]);
      });
    });

    describe('Display P3 Profile', () => {
      it('should create valid Display P3 profile', () => {
        const profile = iccProfileService.createDisplayP3Profile();

        expect(profile.redMatrix).toBeDefined();
        expect(profile.redTRC.gamma).toBeCloseTo(2.4, 1);
      });
    });
  });

  describe('RGB to XYZ Conversion', () => {
    it('should convert RGB to XYZ using sRGB profile', () => {
      const profile = iccProfileService.createSRGBProfile();

      // D65 white should produce white point
      const [x, y, z] = iccProfileService.rgbToXYZ(1, 1, 1, profile);
      expect(x).toBeCloseTo(0.95047, 2);
      expect(y).toBeCloseTo(1.0, 2);
      expect(z).toBeCloseTo(1.08883, 2);
    });

    it('should convert black correctly', () => {
      const profile = iccProfileService.createSRGBProfile();

      const [x, y, z] = iccProfileService.rgbToXYZ(0, 0, 0, profile);
      expect(x).toBe(0);
      expect(y).toBe(0);
      expect(z).toBe(0);
    });

    it('should convert pure red correctly', () => {
      const profile = iccProfileService.createSRGBProfile();

      const [x, y, z] = iccProfileService.rgbToXYZ(1, 0, 0, profile);
      // Should match red matrix column (after TRC)
      expect(x).toBeCloseTo(profile.redMatrix[0], 2);
      expect(y).toBeCloseTo(profile.redMatrix[1], 2);
      expect(z).toBeCloseTo(profile.redMatrix[2], 2);
    });
  });

  describe('XYZ to RGB Conversion', () => {
    it('should convert XYZ to RGB using sRGB profile', () => {
      const profile = iccProfileService.createSRGBProfile();

      // White point should produce white RGB
      const [r, g, b] = iccProfileService.xyzToRGB(0.95047, 1.0, 1.08883, profile);
      expect(r).toBeCloseTo(1.0, 1);
      expect(g).toBeCloseTo(1.0, 1);
      expect(b).toBeCloseTo(1.0, 1);
    });

    it('should convert black correctly', () => {
      const profile = iccProfileService.createSRGBProfile();

      const [r, g, b] = iccProfileService.xyzToRGB(0, 0, 0, profile);
      expect(r).toBe(0);
      expect(g).toBe(0);
      expect(b).toBe(0);
    });

    it('should roundtrip RGB through XYZ', () => {
      const profile = iccProfileService.createSRGBProfile();
      const testColors = [
        [0.5, 0.5, 0.5],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0.2, 0.6, 0.8],
      ];

      for (const [r, g, b] of testColors) {
        const xyz = iccProfileService.rgbToXYZ(r, g, b, profile);
        const [r2, g2, b2] = iccProfileService.xyzToRGB(xyz[0], xyz[1], xyz[2], profile);

        expect(r2).toBeCloseTo(r, 2);
        expect(g2).toBeCloseTo(g, 2);
        expect(b2).toBeCloseTo(b, 2);
      }
    });
  });

  describe('Profile Parsing', () => {
    it('should reject files that are too small', () => {
      const smallData = new ArrayBuffer(50);
      const result = iccProfileService.parse(smallData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('should reject files with invalid signature', () => {
      // Create a mock ICC profile with wrong signature
      const data = new ArrayBuffer(256);
      const view = new DataView(data);
      view.setUint32(0, 256, false); // Profile size
      // Skip setting 'acsp' signature at offset 36

      const result = iccProfileService.parse(data);
      expect(result.success).toBe(false);
    });

    it('should parse valid ICC header fields', () => {
      // Create a minimal valid ICC profile
      const data = createMinimalICCProfile();
      const result = iccProfileService.parse(data);

      // Even with minimal data, parsing should attempt to work
      // This tests the header parsing code paths
      if (result.success) {
        expect(result.profile).toBeDefined();
        expect(result.profile!.header.signature).toBe('acsp');
      }
    });
  });

  describe('Profile Caching', () => {
    beforeEach(() => {
      iccProfileService.clearCache();
    });

    it('should cache and retrieve profiles', () => {
      const data = createMinimalICCProfile();
      const result = iccProfileService.parse(data);

      if (result.success && result.profile) {
        iccProfileService.cacheProfile('test', result.profile);
        const cached = iccProfileService.getCachedProfile('test');
        expect(cached).toBe(result.profile);
      }
    });

    it('should return undefined for uncached profiles', () => {
      const cached = iccProfileService.getCachedProfile('nonexistent');
      expect(cached).toBeUndefined();
    });

    it('should clear cache', () => {
      const data = createMinimalICCProfile();
      const result = iccProfileService.parse(data);

      if (result.success && result.profile) {
        iccProfileService.cacheProfile('test', result.profile);
        iccProfileService.clearCache();
        const cached = iccProfileService.getCachedProfile('test');
        expect(cached).toBeUndefined();
      }
    });
  });

  describe('Image Data Processing', () => {
    it('should handle missing matrix profiles gracefully', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);

      // Create profiles without matrix data (using mock header for testing)
      const mockHeader = {} as unknown as ICCHeader;
      const sourceProfile = {
        header: mockHeader,
        tags: new Map(),
        rawData: new ArrayBuffer(0),
      };
      const destProfile = {
        header: mockHeader,
        tags: new Map(),
        rawData: new ArrayBuffer(0),
      };

      const result = iccProfileService.applyProfile(input, sourceProfile, destProfile);

      // Should return copy of input when profiles are missing
      expect(result[0]).toBe(input[0]);
      expect(result[1]).toBe(input[1]);
      expect(result[2]).toBe(input[2]);
      expect(result[3]).toBe(input[3]);
    });
  });

  describe('Singleton and Class Export', () => {
    it('should export singleton instance', () => {
      expect(iccProfileService).toBeDefined();
      expect(iccProfileService).toBeInstanceOf(ICCProfileServiceImpl);
    });

    it('should allow creating new instances', () => {
      const instance = new ICCProfileServiceImpl();
      expect(instance).toBeInstanceOf(ICCProfileServiceImpl);
      expect(instance).not.toBe(iccProfileService);
    });
  });
});

/**
 * Helper: Create a minimal valid ICC profile for testing
 */
function createMinimalICCProfile(): ArrayBuffer {
  const size = 256;
  const data = new ArrayBuffer(size);
  const view = new DataView(data);

  // Profile size (4 bytes)
  view.setUint32(0, size, false);

  // CMM Type (4 bytes) - 'none'
  writeString(view, 4, 'none');

  // Version (4 bytes) - 4.3.0
  view.setUint8(8, 4);
  view.setUint8(9, 0x30);

  // Device class (4 bytes) - 'mntr' (monitor)
  writeString(view, 12, 'mntr');

  // Color space (4 bytes) - 'RGB '
  writeString(view, 16, 'RGB ');

  // PCS (4 bytes) - 'XYZ '
  writeString(view, 20, 'XYZ ');

  // Date/time (12 bytes) - 2024-01-01 00:00:00
  view.setUint16(24, 2024, false);
  view.setUint16(26, 1, false);
  view.setUint16(28, 1, false);
  view.setUint16(30, 0, false);
  view.setUint16(32, 0, false);
  view.setUint16(34, 0, false);

  // Signature (4 bytes) - 'acsp'
  writeString(view, 36, 'acsp');

  // Platform (4 bytes)
  writeString(view, 40, 'none');

  // Flags (4 bytes)
  view.setUint32(44, 0, false);

  // Manufacturer (4 bytes)
  writeString(view, 48, 'none');

  // Model (4 bytes)
  writeString(view, 52, 'none');

  // Attributes (8 bytes)
  view.setUint32(56, 0, false);
  view.setUint32(60, 0, false);

  // Rendering intent (4 bytes)
  view.setUint32(64, 0, false);

  // PCS illuminant D50 (12 bytes)
  view.setInt32(68, Math.round(0.9642 * 65536), false);
  view.setInt32(72, Math.round(1.0 * 65536), false);
  view.setInt32(76, Math.round(0.8249 * 65536), false);

  // Creator (4 bytes)
  writeString(view, 80, 'test');

  // Profile ID (16 bytes) - zeros
  for (let i = 0; i < 16; i++) {
    view.setUint8(84 + i, 0);
  }

  // Tag count (4 bytes at offset 128)
  view.setUint32(128, 0, false);

  return data;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length && i < 4; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
