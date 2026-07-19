/**
 * Preview quality ratchet math — computeRequiredPreviewCap contract:
 *  - fit view (zoom 1, no crop) stays at the 1024 baseline
 *  - zoom multiplies the requirement; crop divides by its fraction
 *  - results quantize UP to 256px steps, never exceed MAX_PREVIEW_CAP or the
 *    source's native long edge, and never drop below the baseline
 */
import { computeRequiredPreviewCap, BASE_PREVIEW_CAP, MAX_PREVIEW_CAP } from '../utils/previewQuality';

const native = 6000;

describe('computeRequiredPreviewCap', () => {
  test('fit view with no crop stays at the baseline', () => {
    expect(computeRequiredPreviewCap({ zoom: 1, cropFraction: 1, nativeLongEdge: native }))
      .toBe(BASE_PREVIEW_CAP);
  });

  test('zoom-out never lowers below the baseline', () => {
    expect(computeRequiredPreviewCap({ zoom: 0.4, cropFraction: 1, nativeLongEdge: native }))
      .toBe(BASE_PREVIEW_CAP);
  });

  test('zoom 2 doubles the requirement', () => {
    expect(computeRequiredPreviewCap({ zoom: 2, cropFraction: 1, nativeLongEdge: native })).toBe(2048);
  });

  test('fractional zoom quantizes up in 256px steps', () => {
    // 1024 * 1.3 = 1331.2 -> 1536
    expect(computeRequiredPreviewCap({ zoom: 1.3, cropFraction: 1, nativeLongEdge: native })).toBe(1536);
  });

  test('a half-size crop doubles the requirement at fit view', () => {
    expect(computeRequiredPreviewCap({ zoom: 1, cropFraction: 0.5, nativeLongEdge: native })).toBe(2048);
  });

  test('zoom and crop compound', () => {
    expect(computeRequiredPreviewCap({ zoom: 2, cropFraction: 0.5, nativeLongEdge: native })).toBe(4096);
  });

  test('never exceeds MAX_PREVIEW_CAP', () => {
    expect(computeRequiredPreviewCap({ zoom: 8, cropFraction: 0.1, nativeLongEdge: 100000 }))
      .toBe(MAX_PREVIEW_CAP);
  });

  test('never exceeds the native long edge', () => {
    expect(computeRequiredPreviewCap({ zoom: 3, cropFraction: 1, nativeLongEdge: 1800 })).toBe(1800);
  });

  test('small native sources stay at the baseline', () => {
    expect(computeRequiredPreviewCap({ zoom: 4, cropFraction: 1, nativeLongEdge: 800 }))
      .toBe(BASE_PREVIEW_CAP);
  });

  test('degenerate crop fractions are floored (no runaway caps)', () => {
    expect(computeRequiredPreviewCap({ zoom: 1, cropFraction: 0.0001, nativeLongEdge: native }))
      .toBeLessThanOrEqual(MAX_PREVIEW_CAP);
  });

  test('unknown native size falls back to the hard ceiling', () => {
    expect(computeRequiredPreviewCap({ zoom: 6, cropFraction: 1, nativeLongEdge: 0 }))
      .toBe(MAX_PREVIEW_CAP);
  });
});
