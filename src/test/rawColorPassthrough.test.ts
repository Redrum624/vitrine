/**
 * TDD: Camera colour stage must be an identity on the LibRaw path.
 *
 * LibRaw (via dcraw_emu -o 1) already emits colour-managed sRGB pixels.
 * Applying a second 3×3 camera colour matrix on top of those pixels is wrong
 * (double transform). This test asserts that finishRawProcessing — the
 * function called on the LibRaw WASM fallback path — does NOT alter pixel
 * colours.
 *
 * RED  (before fix): finishRawProcessing calls cameraProfileService.applyCameraProfile
 *                    which multiplies a 3×3 matrix, substantially shifting pixel values.
 * GREEN (after fix): the matrix call is removed; output data equals input data
 *                    within floating-point epsilon.
 */

import { RawImageService } from '../services/RawImageService';
import type { ProcessedRawData } from '../services/LibRawService';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal ProcessedRawData stub for a Canon EOS R5.
 * The Canon R5 has a hardcoded profile in CameraProfileService, so the
 * matrix-apply branch definitely executes when the bug is present.
 */
function makeCanonR5Result(width = 2, height = 1): ProcessedRawData {
  return {
    imageData: new Uint8Array(0), // not consumed by finishRawProcessing
    width,
    height,
    channels: 4,
    processingTime: 0,
    metadata: {
      make: 'Canon',
      model: 'EOS R5',
      width,
      height,
      iso: 100,
      aperture: 2.8,
      shutter: 0.01,
      focal_length: 50,
      timestamp: 0,
      colors: 3,
      color_desc: 'RGBE',
      filters: 0,
      white_balance: { camera_wb: [1, 1, 1, 0], daylight_wb: [1, 1, 1, 0] },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Type helper for accessing the private method
// ──────────────────────────────────────────────────────────────────────────────

type FinishRawProcessingFn = (
  result: ProcessedRawData,
  floatData: Float32Array,
  filePath: string
) => { data: Float32Array };

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('rawColorPassthrough — camera-colour stage must be identity on LibRaw path', () => {
  // Fresh instance per suite so singleton state doesn't contaminate the test.
  const service = new RawImageService();

  // Access the private method via bracket notation — the standard Jest/ts-jest
  // pattern for testing private implementation details without public API changes.
  const finishRawProcessing = (
    (service as unknown as Record<string, FinishRawProcessingFn>)['finishRawProcessing']
  ).bind(service);

  it('preserves pixel colours exactly (no 3×3 matrix multiply) on the LibRaw WASM path', () => {
    // Mixed, non-neutral pixels. The Canon R5 D65 colour matrix would
    // substantially alter these if the bug is present:
    //   R: 0.20 → ~0.012  (shifted by -0.188)
    //   G: 0.50 → ~0.695  (shifted by +0.195)
    // Any toBeCloseTo(x, 5) assertion on the ORIGINAL value would therefore fail
    // before the fix and pass after it.
    const inputData = new Float32Array([
      0.20, 0.50, 0.80, 1.0,   // pixel 0 — warm mid-shadow
      0.90, 0.30, 0.60, 1.0,   // pixel 1 — saturated reddish
    ]);

    const result = finishRawProcessing(
      makeCanonR5Result(2, 1),
      inputData.slice() as Float32Array, // copy so we can compare against original
      '/test/Canon_EOS_R5.cr3'
    );

    // Every channel must pass through unchanged (identity for colour).
    for (let i = 0; i < inputData.length; i += 4) {
      expect(result.data[i    ]).toBeCloseTo(inputData[i    ], 5); // R
      expect(result.data[i + 1]).toBeCloseTo(inputData[i + 1], 5); // G
      expect(result.data[i + 2]).toBeCloseTo(inputData[i + 2], 5); // B
      expect(result.data[i + 3]).toBeCloseTo(inputData[i + 3], 5); // A (unchanged in all cases)
    }
  });
});
