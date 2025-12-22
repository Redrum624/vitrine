/**
 * HDRTransferService Tests
 */

import { hdrTransferService, HDRTransferServiceImpl } from './HDRTransferService';

describe('HDRTransferService', () => {
  describe('PQ (ST 2084) Transfer Function', () => {
    it('should encode and decode PQ correctly (roundtrip)', () => {
      const testValues = [0, 0.001, 0.01, 0.1, 0.5, 0.8, 1.0];

      for (const value of testValues) {
        const encoded = hdrTransferService.linearToPQ(value);
        const decoded = hdrTransferService.pqToLinear(encoded);
        expect(decoded).toBeCloseTo(value, 4);
      }
    });

    it('should handle PQ edge cases', () => {
      expect(hdrTransferService.linearToPQ(0)).toBe(0);
      expect(hdrTransferService.linearToPQ(-1)).toBe(0);
      expect(hdrTransferService.linearToPQ(1)).toBe(1);
      expect(hdrTransferService.linearToPQ(2)).toBe(1);

      expect(hdrTransferService.pqToLinear(0)).toBe(0);
      expect(hdrTransferService.pqToLinear(-1)).toBe(0);
      expect(hdrTransferService.pqToLinear(1)).toBe(1);
      expect(hdrTransferService.pqToLinear(2)).toBe(1);
    });

    it('should produce known PQ values', () => {
      // PQ curve allocates more code values to darker regions
      // 0.5 normalized linear encodes to ~0.93 in PQ (most bits for shadows)
      const halfLinear = 0.5;
      const encoded = hdrTransferService.linearToPQ(halfLinear);
      expect(encoded).toBeGreaterThan(0.9);
      expect(encoded).toBeLessThan(0.95);

      // Very dim value (1% of peak) should still have significant code value
      const dimValue = 0.01;
      const dimEncoded = hdrTransferService.linearToPQ(dimValue);
      expect(dimEncoded).toBeGreaterThan(0.4);
    });

    it('should correctly convert nits to PQ normalized', () => {
      expect(hdrTransferService.nitsToPQNormalized(10000)).toBe(1);
      expect(hdrTransferService.nitsToPQNormalized(1000)).toBe(0.1);
      expect(hdrTransferService.nitsToPQNormalized(100)).toBe(0.01);
    });

    it('should correctly convert PQ normalized to nits', () => {
      expect(hdrTransferService.pqNormalizedToNits(1)).toBe(10000);
      expect(hdrTransferService.pqNormalizedToNits(0.1)).toBe(1000);
      expect(hdrTransferService.pqNormalizedToNits(0.01)).toBe(100);
    });
  });

  describe('HLG (ARIB STD-B67) Transfer Function', () => {
    it('should encode and decode HLG correctly (roundtrip)', () => {
      const testValues = [0, 0.01, 0.08, 0.1, 0.5, 0.8, 1.0];

      for (const value of testValues) {
        const encoded = hdrTransferService.linearToHLG(value);
        const decoded = hdrTransferService.hlgToLinear(encoded);
        expect(decoded).toBeCloseTo(value, 4);
      }
    });

    it('should handle HLG edge cases', () => {
      expect(hdrTransferService.linearToHLG(0)).toBe(0);
      expect(hdrTransferService.linearToHLG(-1)).toBe(0);

      expect(hdrTransferService.hlgToLinear(0)).toBe(0);
      expect(hdrTransferService.hlgToLinear(-1)).toBe(0);
    });

    it('should use correct formula for low and high ranges', () => {
      // Below 1/12 uses sqrt formula
      const lowValue = 0.05;
      const lowEncoded = hdrTransferService.linearToHLG(lowValue);
      expect(lowEncoded).toBeCloseTo(Math.sqrt(3 * lowValue), 6);

      // Above 1/12 uses log formula
      const highValue = 0.5;
      const highEncoded = hdrTransferService.linearToHLG(highValue);
      expect(highEncoded).toBeGreaterThan(0.5);
    });

    it('should apply HLG OOTF correctly', () => {
      const linear = 0.5;
      const ootfApplied = hdrTransferService.applyHLGOOTF(linear, 1.2, 1000);
      // OOTF should boost mid-tones
      expect(ootfApplied).toBeGreaterThan(0);
      expect(ootfApplied).toBeLessThanOrEqual(1);
    });
  });

  describe('Image Processing', () => {
    const createTestImage = (): Float32Array => {
      // 2x2 RGBA image with varying values
      return new Float32Array([
        0.0, 0.0, 0.0, 1.0, // Black
        0.5, 0.5, 0.5, 1.0, // Gray
        1.0, 1.0, 1.0, 1.0, // White
        0.2, 0.4, 0.6, 1.0, // Color
      ]);
    };

    describe('PQ Image Processing', () => {
      it('should encode and decode image data with PQ', () => {
        const input = createTestImage();
        const encoded = hdrTransferService.applyPQEncode(input, 1000);
        const decoded = hdrTransferService.applyPQDecode(encoded, 1000);

        for (let i = 0; i < input.length; i++) {
          expect(decoded[i]).toBeCloseTo(input[i], 3);
        }
      });

      it('should preserve alpha channel in PQ processing', () => {
        const input = new Float32Array([0.5, 0.5, 0.5, 0.75]);
        const encoded = hdrTransferService.applyPQEncode(input);
        expect(encoded[3]).toBe(0.75);

        const decoded = hdrTransferService.applyPQDecode(encoded);
        expect(decoded[3]).toBe(0.75);
      });
    });

    describe('HLG Image Processing', () => {
      it('should encode and decode image data with HLG', () => {
        const input = createTestImage();
        const encoded = hdrTransferService.applyHLGEncode(input);
        const decoded = hdrTransferService.applyHLGDecode(encoded, false);

        for (let i = 0; i < input.length; i++) {
          if (i % 4 !== 3) {
            // Skip alpha comparison
            expect(decoded[i]).toBeCloseTo(input[i], 3);
          }
        }
      });

      it('should preserve alpha channel in HLG processing', () => {
        const input = new Float32Array([0.5, 0.5, 0.5, 0.75]);
        const encoded = hdrTransferService.applyHLGEncode(input);
        expect(encoded[3]).toBe(0.75);

        const decoded = hdrTransferService.applyHLGDecode(encoded);
        expect(decoded[3]).toBe(0.75);
      });

      it('should apply OOTF when decoding HLG', () => {
        const input = new Float32Array([0.5, 0.5, 0.5, 1.0]);
        const encoded = hdrTransferService.applyHLGEncode(input);

        const withOOTF = hdrTransferService.applyHLGDecode(encoded, true);
        const withoutOOTF = hdrTransferService.applyHLGDecode(encoded, false);

        // OOTF should modify the output
        expect(withOOTF[0]).not.toEqual(withoutOOTF[0]);
      });
    });
  });

  describe('Tone Mapping', () => {
    it('should tone map to SDR range', () => {
      // Create HDR image with values > 1.0
      const hdrInput = new Float32Array([
        2.0, 2.0, 2.0, 1.0, // Bright HDR
        5.0, 4.0, 3.0, 1.0, // Very bright
        0.5, 0.5, 0.5, 1.0, // SDR range
        10.0, 8.0, 6.0, 1.0, // Extreme HDR
      ]);

      const sdrOutput = hdrTransferService.toneMapToSDR(hdrInput, {
        sourcePeakNits: 1000,
        targetPeakNits: 100,
      });

      // All values should be clamped to 0-1
      for (let i = 0; i < sdrOutput.length; i++) {
        expect(sdrOutput[i]).toBeGreaterThanOrEqual(0);
        expect(sdrOutput[i]).toBeLessThanOrEqual(1);
      }
    });

    it('should preserve relative luminance order', () => {
      // Use values well within the linear region for clear ordering
      // With 100:100 peak ratio, there's no scaling
      const input = new Float32Array([
        0.1, 0.1, 0.1, 1.0,
        0.3, 0.3, 0.3, 1.0,
        0.5, 0.5, 0.5, 1.0,
      ]);

      const output = hdrTransferService.toneMapToSDR(input, {
        sourcePeakNits: 100, // Same as target, no scaling
        targetPeakNits: 100,
        knee: 0.8,
      });

      const getLuminance = (r: number, g: number, b: number) =>
        0.2126 * r + 0.7152 * g + 0.0722 * b;

      const lum1 = getLuminance(output[0], output[1], output[2]);
      const lum2 = getLuminance(output[4], output[5], output[6]);
      const lum3 = getLuminance(output[8], output[9], output[10]);

      // With 1:1 ratio and values below knee, order should be preserved
      expect(lum1).toBeLessThan(lum2);
      expect(lum2).toBeLessThan(lum3);
    });

    it('should handle black pixels in tone mapping', () => {
      const input = new Float32Array([0, 0, 0, 1]);
      const output = hdrTransferService.toneMapToSDR(input);

      expect(output[0]).toBe(0);
      expect(output[1]).toBe(0);
      expect(output[2]).toBe(0);
      expect(output[3]).toBe(1);
    });

    it('should apply Hable filmic tone mapping', () => {
      const input = new Float32Array([
        2.0, 2.0, 2.0, 1.0,
        0.5, 0.5, 0.5, 1.0,
      ]);

      const output = hdrTransferService.toneMapHable(input, 1.0);

      // All values should be in valid range
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeGreaterThanOrEqual(0);
        expect(output[i]).toBeLessThanOrEqual(1);
      }

      // HDR values should be compressed
      expect(output[0]).toBeLessThan(1);
    });

    it('should apply ACES filmic tone mapping', () => {
      const input = new Float32Array([
        2.0, 2.0, 2.0, 1.0,
        0.18, 0.18, 0.18, 1.0, // 18% gray
      ]);

      const output = hdrTransferService.toneMapACES(input);

      // All values should be in valid range
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeGreaterThanOrEqual(0);
        expect(output[i]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('PQ/HLG Conversion', () => {
    it('should convert from PQ to HLG', () => {
      const pqInput = new Float32Array([
        0.5, 0.5, 0.5, 1.0,
        0.7, 0.6, 0.5, 1.0,
      ]);

      const hlgOutput = hdrTransferService.pqToHLG(pqInput, 1000);

      // Output should be in valid HLG range
      for (let i = 0; i < hlgOutput.length; i++) {
        if (i % 4 !== 3) {
          expect(hlgOutput[i]).toBeGreaterThanOrEqual(0);
          expect(hlgOutput[i]).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should convert from HLG to PQ', () => {
      const hlgInput = new Float32Array([
        0.5, 0.5, 0.5, 1.0,
        0.7, 0.6, 0.5, 1.0,
      ]);

      const pqOutput = hdrTransferService.hlgToPQ(hlgInput, 1000);

      // Output should be in valid PQ range
      for (let i = 0; i < pqOutput.length; i++) {
        if (i % 4 !== 3) {
          expect(pqOutput[i]).toBeGreaterThanOrEqual(0);
          expect(pqOutput[i]).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should preserve alpha in PQ/HLG conversion', () => {
      const input = new Float32Array([0.5, 0.5, 0.5, 0.8]);

      const hlg = hdrTransferService.pqToHLG(input);
      // Float32Array has limited precision, use toBeCloseTo
      expect(hlg[3]).toBeCloseTo(0.8, 5);

      const pq = hdrTransferService.hlgToPQ(input);
      expect(pq[3]).toBeCloseTo(0.8, 5);
    });
  });

  describe('HDR Content Analysis', () => {
    it('should analyze HDR content for metadata', () => {
      const input = new Float32Array([
        0.5, 0.5, 0.5, 1.0,
        2.0, 2.0, 2.0, 1.0,
        0.1, 0.1, 0.1, 1.0,
        10.0, 10.0, 10.0, 1.0, // Brightest
      ]);

      const metadata = hdrTransferService.analyzeHDRContent(input);

      expect(metadata.maxCLL).toBeGreaterThan(0);
      expect(metadata.maxFALL).toBeGreaterThan(0);
      expect(metadata.masteringDisplayMaxLuminance).toBeGreaterThan(0);
      expect(metadata.colorPrimaries).toBe('bt2020');
    });

    it('should return reasonable metadata for SDR content', () => {
      const sdrInput = new Float32Array([
        0.5, 0.5, 0.5, 1.0,
        0.8, 0.8, 0.8, 1.0,
      ]);

      const metadata = hdrTransferService.analyzeHDRContent(sdrInput);

      // SDR content should have lower estimated nits
      expect(metadata.maxCLL).toBeLessThan(200);
    });
  });

  describe('GLSL Code Generation', () => {
    it('should generate valid GLSL for PQ encoding', () => {
      const glsl = hdrTransferService.getGLSLPQEncode();

      expect(glsl).toContain('PQ_M1');
      expect(glsl).toContain('PQ_M2');
      expect(glsl).toContain('linearToPQ');
      expect(glsl).toContain('pqToLinear');
      expect(glsl).toContain('vec3');
    });

    it('should generate valid GLSL for HLG encoding', () => {
      const glsl = hdrTransferService.getGLSLHLGEncode();

      expect(glsl).toContain('HLG_A');
      expect(glsl).toContain('HLG_B');
      expect(glsl).toContain('HLG_C');
      expect(glsl).toContain('linearToHLG');
      expect(glsl).toContain('hlgToLinear');
    });
  });

  describe('Constants Export', () => {
    it('should export correct PQ constants', () => {
      const constants = hdrTransferService.getConstants();

      expect(constants.pqPeakLuminance).toBe(10000);
      expect(constants.pqConstants.m1).toBeCloseTo(2610 / 16384, 6);
      expect(constants.pqConstants.m2).toBeCloseTo((2523 / 4096) * 128, 6);
    });

    it('should export correct HLG constants', () => {
      const constants = hdrTransferService.getConstants();

      expect(constants.hlgRefWhite).toBe(203);
      expect(constants.hlgConstants.a).toBeCloseTo(0.17883277, 6);
    });
  });

  describe('Singleton and Class Export', () => {
    it('should export singleton instance', () => {
      expect(hdrTransferService).toBeDefined();
      expect(hdrTransferService).toBeInstanceOf(HDRTransferServiceImpl);
    });

    it('should allow creating new instances', () => {
      const instance = new HDRTransferServiceImpl();
      expect(instance).toBeInstanceOf(HDRTransferServiceImpl);
      expect(instance).not.toBe(hdrTransferService);
    });
  });
});
