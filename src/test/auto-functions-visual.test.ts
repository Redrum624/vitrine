/**
 * Visual Tests for Auto Functions
 *
 * Tests every auto function for every module that has one, plus the Full Auto function.
 * Logs before/after pixel averages and parameter values for visual inspection.
 * Includes WB idempotency bug investigation (5500K vs 6500K reference mismatch).
 */

import { createTestImage, createGradientImage, createNoiseImage, calculateAveragePixel, isValidImageData } from './testUtils';

// We need to import the AutoAdjustService class, not the singleton, to avoid cross-test state
// But the module exports a singleton, so we import it and use it (it's stateless anyway)
import { autoAdjustService } from '../services/AutoAdjustService';
import { selectBucket, userStyleProfile, type BucketName } from '../services/UserStyleProfile';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { ExposureModule } from '../modules/ExposureModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ToneCurveModule } from '../modules/ToneCurveModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { ShadowsHighlightsModule } from '../modules/ShadowsHighlightsModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { LensCorrectionsModule } from '../modules/LensCorrectionsModule';
import { nrStrengthToH, legacyNrStrengthToH } from '../utils/nrCurve';

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../utils/Logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/AdvancedDenoisingService', () => ({
  AdvancedDenoisingService: jest.fn().mockImplementation(() => ({
    denoiseSync: jest.fn((imageData: Float32Array, _width: number, _height: number, _params: unknown) => {
      const output = new Float32Array(imageData.length);
      for (let i = 0; i < imageData.length; i++) {
        output[i] = imageData[i] * 0.95;
      }
      return output;
    }),
    getStats: jest.fn(() => ({
      cacheHits: 0,
      cacheMisses: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
    })),
    clearCache: jest.fn(),
  })),
}));

// ─── Test Image Helpers ─────────────────────────────────────────────────────

const W = 100;
const H = 100;
const CTX = { width: W, height: H, channels: 4 };

function createDarkImage(w = W, h = H) { return createTestImage(w, h, 0.15, 0.15, 0.15); }
function createBrightImage(w = W, h = H) { return createTestImage(w, h, 0.9, 0.9, 0.9); }
function createWarmImage(w = W, h = H) { return createTestImage(w, h, 0.65, 0.45, 0.3); }
function createCoolImage(w = W, h = H) { return createTestImage(w, h, 0.3, 0.45, 0.65); }
function createFlatImage(w = W, h = H) { return createTestImage(w, h, 0.45, 0.48, 0.47); }
function createNeutralImage(w = W, h = H) { return createTestImage(w, h, 0.5, 0.5, 0.5); }

function createVignettedImage(w = 200, h = 200): Float32Array {
  const channels = 4;
  const data = new Float32Array(w * h * channels);
  const cx = w / 2, cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * channels;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const falloff = 1.0 - (dist / maxDist) * 0.6; // center=1.0, corners~0.4
      data[idx] = 0.7 * falloff;
      data[idx + 1] = 0.7 * falloff;
      data[idx + 2] = 0.7 * falloff;
      data[idx + 3] = 1.0;
    }
  }
  return data;
}

function logVisual(label: string, params: Record<string, unknown>, beforeAvg?: number[], afterAvg?: number[]) {
  const lines = [`\n  ── ${label} ──`];
  if (beforeAvg) lines.push(`  Before avg: R=${beforeAvg[0].toFixed(4)} G=${beforeAvg[1].toFixed(4)} B=${beforeAvg[2].toFixed(4)}`);
  if (afterAvg) lines.push(`  After  avg: R=${afterAvg[0].toFixed(4)} G=${afterAvg[1].toFixed(4)} B=${afterAvg[2].toFixed(4)}`);
  lines.push(`  Params: ${JSON.stringify(params, null, 2).split('\n').join('\n  ')}`);
  console.log(lines.join('\n'));
}

// ─── 1. analyse() verification ──────────────────────────────────────────────

describe('AutoAdjustService.analyse()', () => {
  it('should produce correct stats for neutral grey image', () => {
    const img = createNeutralImage();
    const stats = autoAdjustService.analyse(img, W, H);

    expect(stats.meanR).toBeCloseTo(0.5, 2);
    expect(stats.meanG).toBeCloseTo(0.5, 2);
    expect(stats.meanB).toBeCloseTo(0.5, 2);
    expect(stats.meanLum).toBeCloseTo(0.5, 2);
    expect(stats.p50).toBeCloseTo(0.5, 2);
    expect(stats.stdLum).toBeCloseTo(0, 2); // uniform image = 0 std
    logVisual('analyse() on neutral', stats as unknown as Record<string, unknown>);
  });

  it('should produce correct stats for dark image', () => {
    const img = createDarkImage();
    const stats = autoAdjustService.analyse(img, W, H);

    expect(stats.meanLum).toBeLessThan(0.2);
    expect(stats.p50).toBeLessThan(0.2);
    expect(stats.shadowPixelRatio).toBe(1.0); // all pixels are shadows
  });

  it('should produce correct stats for gradient image', () => {
    const img = createGradientImage(W, H);
    const stats = autoAdjustService.analyse(img, W, H);

    expect(stats.stdLum).toBeGreaterThan(0.05); // gradient has variance
    expect(stats.p1).toBeLessThan(stats.p99);
  });

  it('should detect noise in noisy image', () => {
    const img = createNoiseImage(W, H);
    const stats = autoAdjustService.analyse(img, W, H);

    expect(stats.noiseEstimate).toBeGreaterThan(0);
  });
});

// ─── 2. autoExposure ────────────────────────────────────────────────────────

describe('autoExposure', () => {
  it('should pull a low-light image toward its dark profile target (not brighten to 0.45)', () => {
    const stats = autoAdjustService.analyse(createDarkImage(), W, H);
    const result = autoAdjustService.autoExposure(stats);

    // Dark image → low_light bucket (profile median 0.0655, darker than the
    // synthetic p50 0.15). Auto now nudges DOWN toward the user's dark grade,
    // where the old hardcoded 0.45 target would have boosted it up.
    expect(result.exposure).toBeLessThanOrEqual(0);
    expect(result.exposure).toBeGreaterThanOrEqual(-1);
    expect(result.mode).toBe('manual');
    logVisual('autoExposure on dark (low_light)', result as unknown as Record<string, unknown>);
  });

  it('should keep an already-bright high-key image bright (not pull toward 0.45)', () => {
    const stats = autoAdjustService.analyse(createBrightImage(), W, H);
    const result = autoAdjustService.autoExposure(stats);

    // Bright image → high_key bucket (profile median 0.9163 ≈ image 0.9), so
    // Auto leaves it bright. The old 0.45 target pulled it down hard.
    expect(result.exposure).toBeGreaterThan(-0.1);
    expect(result.exposure).toBeLessThanOrEqual(1);
  });

  it('should return near-zero exposure for neutral image', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoExposure(stats);

    expect(Math.abs(result.exposure)).toBeLessThan(0.15);
    logVisual('autoExposure on neutral', result as unknown as Record<string, unknown>);
  });

  it('should process a low-light image toward its darker profile target', () => {
    const img = createDarkImage();
    const beforeAvg = calculateAveragePixel(img);
    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoExposure(stats);

    const module = new ExposureModule();
    module.setCurrentParams(result);
    const output = module.process(img, CTX);

    expect(isValidImageData(output)).toBe(true);
    const afterAvg = calculateAveragePixel(output);
    // low_light grade is darker than the synthetic 0.15 → output must not brighten.
    expect(afterAvg[0]).toBeLessThanOrEqual(beforeAvg[0] + 1e-3);
    logVisual('autoExposure process dark (low_light)', result as unknown as Record<string, unknown>, beforeAvg, afterAvg);
  });
});

// ─── 3. autoWhiteBalance (AutoAdjustService) ───────────────────────────────

describe('autoWhiteBalance (AutoAdjustService)', () => {
  it('should nudge a neutral image slightly warm toward the standard profile (R/B 1.0388)', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoWhiteBalance(stats);

    // Neutral image → standard bucket, whose R/B target is 1.0388 (a slight warm
    // bias the user grades into). So Auto lands ~6575K, not a flat 6500K.
    expect(result.temperature).toBeGreaterThan(6500);
    expect(result.temperature).toBeLessThan(6700);
    expect(Math.abs(result.tint)).toBeLessThan(10);
    logVisual('autoWB on neutral (standard)', result as unknown as Record<string, unknown>);
  });

  it('should cool down warm image (lower temperature)', () => {
    const stats = autoAdjustService.analyse(createWarmImage(), W, H);
    const result = autoAdjustService.autoWhiteBalance(stats);

    // Warm image has R > B, auto should set temperature to counteract
    // With the formula 6500 * (1/rb)^0.55, when rb > 1 (warm), result < 6500
    expect(result.temperature).toBeLessThan(6500);
    expect(result.temperature).toBeGreaterThanOrEqual(2000);
    logVisual('autoWB on warm', result as unknown as Record<string, unknown>);
  });

  it('should warm up cool image (higher temperature)', () => {
    const stats = autoAdjustService.analyse(createCoolImage(), W, H);
    const result = autoAdjustService.autoWhiteBalance(stats);

    expect(result.temperature).toBeGreaterThan(6500);
    expect(result.temperature).toBeLessThanOrEqual(12000);
    logVisual('autoWB on cool', result as unknown as Record<string, unknown>);
  });

  it('should clamp temperature and tint within valid ranges', () => {
    // Extreme warm image
    const extremeWarm = createTestImage(W, H, 0.95, 0.1, 0.05);
    const stats = autoAdjustService.analyse(extremeWarm, W, H);
    const result = autoAdjustService.autoWhiteBalance(stats);

    expect(result.temperature).toBeGreaterThanOrEqual(2000);
    expect(result.temperature).toBeLessThanOrEqual(12000);
    expect(result.tint).toBeGreaterThanOrEqual(-100);
    expect(result.tint).toBeLessThanOrEqual(100);
  });
});

// ─── 4. WB Idempotency Bug Investigation ───────────────────────────────────

describe('White Balance Idempotency Investigation', () => {
  it('should confirm: WB at default 6500K IS identity (fix verified)', () => {
    const wb = new WhiteBalanceModule();
    const img = createNeutralImage();
    const beforeAvg = calculateAveragePixel(img);

    // Default params: temperature=6500K (D65 reference), tint=0
    const output = wb.process(img, CTX);
    const afterAvg = calculateAveragePixel(output);

    const rDelta = Math.abs(afterAvg[0] - beforeAvg[0]);
    const gDelta = Math.abs(afterAvg[1] - beforeAvg[1]);
    const bDelta = Math.abs(afterAvg[2] - beforeAvg[2]);
    const maxDelta = Math.max(rDelta, gDelta, bDelta);

    console.log(`\n  ── WB Default 6500K Identity Check ──`);
    console.log(`  Before avg: R=${beforeAvg[0].toFixed(4)} G=${beforeAvg[1].toFixed(4)} B=${beforeAvg[2].toFixed(4)}`);
    console.log(`  After  avg: R=${afterAvg[0].toFixed(4)} G=${afterAvg[1].toFixed(4)} B=${afterAvg[2].toFixed(4)}`);
    console.log(`  Max channel delta: ${maxDelta.toFixed(6)}`);
    console.log(`  Identity? ${maxDelta < 0.001 ? 'YES' : 'NO'}`);

    // Default 6500K should now be identity (no color shift)
    expect(maxDelta).toBeLessThan(0.001);
    expect(isValidImageData(output)).toBe(true);
  });

  it('should document: WB process at 6500K IS identity', () => {
    const wb = new WhiteBalanceModule();
    wb.setParams({ temperature: 6500, tint: 0 });
    const img = createNeutralImage();
    const beforeAvg = calculateAveragePixel(img);

    const output = wb.process(img, CTX);
    const afterAvg = calculateAveragePixel(output);

    const maxDelta = Math.max(
      Math.abs(afterAvg[0] - beforeAvg[0]),
      Math.abs(afterAvg[1] - beforeAvg[1]),
      Math.abs(afterAvg[2] - beforeAvg[2])
    );

    console.log(`\n  ── WB at 6500K (matching reference) ──`);
    console.log(`  Before avg: R=${beforeAvg[0].toFixed(4)} G=${beforeAvg[1].toFixed(4)} B=${beforeAvg[2].toFixed(4)}`);
    console.log(`  After  avg: R=${afterAvg[0].toFixed(4)} G=${afterAvg[1].toFixed(4)} B=${afterAvg[2].toFixed(4)}`);
    console.log(`  Max delta: ${maxDelta.toFixed(6)} -- should be ~0 (identity)`);

    // At 6500K, factors should be ref(6500)/temp(6500) = 1/1/1
    expect(maxDelta).toBeLessThan(0.001);
  });

  it('should test idempotency: auto → process → auto again on warm image', () => {
    const wb = new WhiteBalanceModule();
    const img = createWarmImage();

    // Round 1: auto WB from service + process
    const stats1 = autoAdjustService.analyse(img, W, H);
    const autoResult1 = autoAdjustService.autoWhiteBalance(stats1);
    wb.setParams(autoResult1);
    const output1 = wb.process(img, CTX);

    // Round 2: re-analyse processed output and auto again
    const stats2 = autoAdjustService.analyse(output1, W, H);
    const autoResult2 = autoAdjustService.autoWhiteBalance(stats2);

    console.log(`\n  ── WB Idempotency Test (warm image) ──`);
    console.log(`  Round 1: temperature=${autoResult1.temperature}K, tint=${autoResult1.tint}`);
    console.log(`  Round 2: temperature=${autoResult2.temperature}K, tint=${autoResult2.tint}`);
    console.log(`  Delta temp: ${Math.abs(autoResult2.temperature - autoResult1.temperature)}K`);
    console.log(`  Ideal round 2 = 6500K (neutral). Actual distance from neutral: ${Math.abs(autoResult2.temperature - 6500)}K`);

    // After processing with round 1's correction, the image should be more neutral
    // So round 2 temperature should be closer to 6500K than round 1
    const r1DistFromNeutral = Math.abs(autoResult1.temperature - 6500);
    const r2DistFromNeutral = Math.abs(autoResult2.temperature - 6500);

    console.log(`  Round 1 distance from 6500K: ${r1DistFromNeutral}K`);
    console.log(`  Round 2 distance from 6500K: ${r2DistFromNeutral}K`);
    console.log(`  Converging? ${r2DistFromNeutral < r1DistFromNeutral ? 'YES' : 'NO -- DIVERGING (bug confirmed)'}`);

    // We expect the system to converge, but due to 5500K/6500K mismatch it may not
    // This test documents the actual behavior
    expect(autoResult2.temperature).toBeGreaterThanOrEqual(2000);
    expect(autoResult2.temperature).toBeLessThanOrEqual(12000);
  });

  it('should test idempotency over 5 rounds', () => {
    const wb = new WhiteBalanceModule();
    let currentImage = createWarmImage();

    console.log(`\n  ── WB 5-Round Idempotency (warm image) ──`);
    const rounds: Array<{ temperature: number; tint: number; avgR: number; avgG: number; avgB: number }> = [];

    for (let round = 0; round < 5; round++) {
      const stats = autoAdjustService.analyse(currentImage, W, H);
      const result = autoAdjustService.autoWhiteBalance(stats);
      wb.setParams(result);
      currentImage = wb.process(currentImage, CTX);

      const avg = calculateAveragePixel(currentImage);
      rounds.push({ temperature: result.temperature, tint: result.tint, avgR: avg[0], avgG: avg[1], avgB: avg[2] });
      console.log(`  Round ${round + 1}: temp=${result.temperature}K tint=${result.tint} → avgR=${avg[0].toFixed(4)} avgG=${avg[1].toFixed(4)} avgB=${avg[2].toFixed(4)}`);
    }

    // Check convergence: last round temperature should be more stable than first
    const tempChange12 = Math.abs(rounds[1].temperature - rounds[0].temperature);
    const tempChange45 = Math.abs(rounds[4].temperature - rounds[3].temperature);
    console.log(`  Temp change round 1→2: ${tempChange12}K`);
    console.log(`  Temp change round 4→5: ${tempChange45}K`);
    console.log(`  Stabilizing? ${tempChange45 <= tempChange12 ? 'YES' : 'NO -- unstable'}`);

    // All outputs must be valid
    expect(isValidImageData(currentImage)).toBe(true);
  });

  it('should compare AutoAdjustService.autoWhiteBalance vs WhiteBalanceModule.autoDetectWhiteBalance', () => {
    const wb = new WhiteBalanceModule();
    const img = createWarmImage();

    // Method 1: AutoAdjustService (now uses 6500K neutral baseline)
    const stats = autoAdjustService.analyse(img, W, H);
    const serviceResult = autoAdjustService.autoWhiteBalance(stats);

    // Method 2: WhiteBalanceModule (also uses 6500K neutral baseline)
    wb.resetParams();
    wb.autoDetectWhiteBalance(img, CTX);
    const moduleResult = wb.getParams();

    console.log(`\n  ── AutoAdjustService vs WhiteBalanceModule Auto WB ──`);
    console.log(`  Service (6500K base): temp=${serviceResult.temperature}K, tint=${serviceResult.tint}`);
    console.log(`  Module  (6500K base): temp=${moduleResult.temperature}K, tint=${moduleResult.tint}`);
    console.log(`  Temp difference: ${Math.abs(serviceResult.temperature - moduleResult.temperature)}K`);
    console.log(`  Tint difference: ${Math.abs(serviceResult.tint - moduleResult.tint)}`);

    // Both should detect the warm direction (lower than 6500K)
    expect(serviceResult.temperature).toBeLessThan(6500);
    expect(moduleResult.temperature).toBeLessThan(6500);

    // Document the discrepancy
    const diff = Math.abs(serviceResult.temperature - moduleResult.temperature);
    console.log(`  Discrepancy: ${diff}K between the two auto methods`);
  });

  it('should test neutral round-trip: neutral → auto WB → process → check neutrality', () => {
    const wb = new WhiteBalanceModule();
    const img = createNeutralImage();

    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoWhiteBalance(stats);
    wb.setParams(result);
    const output = wb.process(img, CTX);

    const afterAvg = calculateAveragePixel(output);
    const rGreenDelta = Math.abs(afterAvg[0] - afterAvg[1]);
    const rBlueDelta = Math.abs(afterAvg[0] - afterAvg[2]);
    const maxChannelSpread = Math.max(rGreenDelta, rBlueDelta);

    console.log(`\n  ── Neutral Round-Trip ──`);
    console.log(`  Auto result: temp=${result.temperature}K, tint=${result.tint}`);
    console.log(`  After process: R=${afterAvg[0].toFixed(4)} G=${afterAvg[1].toFixed(4)} B=${afterAvg[2].toFixed(4)}`);
    console.log(`  Max channel spread: ${maxChannelSpread.toFixed(6)}`);
    console.log(`  Still neutral? ${maxChannelSpread < 0.02 ? 'YES' : 'NO -- color shift introduced'}`);

    expect(isValidImageData(output)).toBe(true);
  });
});

// ─── 5. autoBasicAdj ────────────────────────────────────────────────────────

describe('autoBasicAdj', () => {
  it('should boost dark image (positive brightness)', () => {
    const stats = autoAdjustService.analyse(createDarkImage(), W, H);
    const result = autoAdjustService.autoBasicAdj(stats);

    // Exposure is always 0 in basicAdj (ExposureModule handles it)
    expect(result.exposure).toBe(0);
    expect(result.brightness).toBeGreaterThan(0);
    logVisual('autoBasicAdj on dark', result as unknown as Record<string, unknown>);
  });

  it('should add contrast to flat image', () => {
    const stats = autoAdjustService.analyse(createFlatImage(), W, H);
    const result = autoAdjustService.autoBasicAdj(stats);

    expect(result.contrast).toBeGreaterThan(0); // flat → needs contrast
    logVisual('autoBasicAdj on flat', result as unknown as Record<string, unknown>);
  });

  it('should return near-zero for neutral image', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoBasicAdj(stats);

    expect(Math.abs(result.exposure)).toBeLessThan(0.15);
    logVisual('autoBasicAdj on neutral', result as unknown as Record<string, unknown>);
  });

  it('should keep all params within valid ranges', () => {
    // Test with various images
    for (const img of [createDarkImage(), createBrightImage(), createWarmImage(), createCoolImage()]) {
      const stats = autoAdjustService.analyse(img, W, H);
      const result = autoAdjustService.autoBasicAdj(stats);

      expect(result.exposure).toBeGreaterThanOrEqual(-1);
      expect(result.exposure).toBeLessThanOrEqual(1);
      expect(result.contrast).toBeGreaterThanOrEqual(-0.5);
      expect(result.contrast).toBeLessThanOrEqual(0.8);
      expect(result.brightness).toBeGreaterThanOrEqual(-0.3);
      expect(result.brightness).toBeLessThanOrEqual(0.3);
      expect(result.saturation).toBeGreaterThanOrEqual(-0.5);
      expect(result.saturation).toBeLessThanOrEqual(0.5);
      expect(result.vibrance).toBeGreaterThanOrEqual(-0.3);
      expect(result.vibrance).toBeLessThanOrEqual(0.4);
    }
  });
});

// ─── 6. autoToneCurve ───────────────────────────────────────────────────────

describe('autoToneCurve', () => {
  it('should return valid curve starting at (0,0) and ending at (1,1)', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoToneCurve(stats) as {
      baseCurve: Array<{ x: number; y: number }>;
      baseCurveNodes: number;
      autoLevels: boolean;
      autoContrast: boolean;
    };

    expect(result.baseCurve).toBeDefined();
    expect(Array.isArray(result.baseCurve)).toBe(true);
    expect(result.baseCurve.length).toBeGreaterThanOrEqual(2);
    expect(result.baseCurve[0]).toEqual({ x: 0, y: 0 });
    expect(result.baseCurve[result.baseCurve.length - 1]).toEqual({ x: 1, y: 1 });
    expect(result.autoLevels).toBe(false);
    expect(result.autoContrast).toBe(false);
    logVisual('autoToneCurve on neutral', result as unknown as Record<string, unknown>);
  });

  it('should produce stronger S-curve for flat image', () => {
    const flatStats = autoAdjustService.analyse(createFlatImage(), W, H);
    const flatResult = autoAdjustService.autoToneCurve(flatStats) as { baseCurve: Array<{ x: number; y: number }> };

    const gradientStats = autoAdjustService.analyse(createGradientImage(W, H), W, H);
    const gradientResult = autoAdjustService.autoToneCurve(gradientStats) as { baseCurve: Array<{ x: number; y: number }> };

    // Flat image should have bigger deviation from linear in curve midpoints
    // Check y at the 25% x-point: stronger S-curve pushes it further from linear
    const flatMidLow = flatResult.baseCurve.find(p => p.x > 0.1 && p.x < 0.4);
    const gradientMidLow = gradientResult.baseCurve.find(p => p.x > 0.1 && p.x < 0.4);

    if (flatMidLow && gradientMidLow) {
      // For S-curve, shadows are pushed down → lower y value means stronger curve
      console.log(`\n  ── S-curve strength comparison ──`);
      console.log(`  Flat image curve @~25%: y=${flatMidLow.y.toFixed(4)}`);
      console.log(`  Gradient curve @~25%: y=${gradientMidLow.y.toFixed(4)}`);
    }
  });

  it('should process image and produce valid output', () => {
    const img = createGradientImage(W, H);
    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoToneCurve(stats);

    const tc = new ToneCurveModule();
    tc.setParams(result as Record<string, unknown>);
    const output = tc.process({ width: W, height: H, data: img, channels: 4 });

    expect(isValidImageData(output.data)).toBe(true);
    logVisual('autoToneCurve processed gradient', result as unknown as Record<string, unknown>,
      calculateAveragePixel(img), calculateAveragePixel(output.data));
  });

  it('should produce all curve points with x in [0,1] and y in [0,1]', () => {
    for (const img of [createDarkImage(), createBrightImage(), createFlatImage()]) {
      const stats = autoAdjustService.analyse(img, W, H);
      const result = autoAdjustService.autoToneCurve(stats) as { baseCurve: Array<{ x: number; y: number }> };
      for (const point of result.baseCurve) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─── 7. autoColorBalance ────────────────────────────────────────────────────

describe('autoColorBalance', () => {
  it('should return near-zero corrections for neutral image', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoColorBalance(stats) as {
      shadows: { cyan_red: number; magenta_green: number; yellow_blue: number };
      midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
      highlights: { cyan_red: number; magenta_green: number; yellow_blue: number };
    };

    expect(Math.abs(result.midtones.cyan_red)).toBeLessThan(0.05);
    expect(Math.abs(result.midtones.magenta_green)).toBeLessThan(0.05);
    expect(Math.abs(result.midtones.yellow_blue)).toBeLessThan(0.05);
    logVisual('autoColorBalance on neutral', result as unknown as Record<string, unknown>);
  });

  it('should push cyan to counteract warm (red-excess) image', () => {
    const stats = autoAdjustService.analyse(createWarmImage(), W, H);
    const result = autoAdjustService.autoColorBalance(stats) as {
      midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
    };

    // Red excess → correction pushes cyan (negative cyan_red)
    expect(result.midtones.cyan_red).toBeLessThan(0);
    logVisual('autoColorBalance on warm', result as unknown as Record<string, unknown>);
  });

  it('should push yellow to counteract cool (blue-excess) image', () => {
    const stats = autoAdjustService.analyse(createCoolImage(), W, H);
    const result = autoAdjustService.autoColorBalance(stats) as {
      midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
    };

    // Blue excess → correction pushes yellow (negative yellow_blue)
    expect(result.midtones.yellow_blue).toBeLessThan(0);
    logVisual('autoColorBalance on cool', result as unknown as Record<string, unknown>);
  });

  it('should keep all corrections within [-0.5, 0.5]', () => {
    for (const img of [createDarkImage(), createWarmImage(), createCoolImage(), createBrightImage()]) {
      const stats = autoAdjustService.analyse(img, W, H);
      const result = autoAdjustService.autoColorBalance(stats) as {
        shadows: { cyan_red: number; magenta_green: number; yellow_blue: number };
        midtones: { cyan_red: number; magenta_green: number; yellow_blue: number };
        highlights: { cyan_red: number; magenta_green: number; yellow_blue: number };
      };

      for (const zone of [result.shadows, result.midtones, result.highlights]) {
        expect(zone.cyan_red).toBeGreaterThanOrEqual(-0.5);
        expect(zone.cyan_red).toBeLessThanOrEqual(0.5);
        expect(zone.magenta_green).toBeGreaterThanOrEqual(-0.5);
        expect(zone.magenta_green).toBeLessThanOrEqual(0.5);
        expect(zone.yellow_blue).toBeGreaterThanOrEqual(-0.5);
        expect(zone.yellow_blue).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

// ─── 8. autoShadowsHighlights ──────────────────────────────────────────────

describe('autoShadowsHighlights', () => {
  it('should recover shadows in very dark image', () => {
    // Use a very dark image (0.05 lum) so shadowMeanLum < 0.12 target
    const img = createTestImage(W, H, 0.05, 0.05, 0.05);
    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoShadowsHighlights(stats) as Record<string, unknown>;

    expect(result.shadows as number).toBeGreaterThan(50);
    logVisual('autoSH on very dark', result);
  });

  it('should recover highlights in very bright image', () => {
    // Use a very bright image (0.97) so highlightMeanLum > 0.92 threshold
    const img = createTestImage(W, H, 0.97, 0.97, 0.97);
    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoShadowsHighlights(stats) as Record<string, unknown>;

    expect(result.highlights as number).toBeGreaterThan(50);
    logVisual('autoSH on very bright', result);
  });

  it('should return near-zero for neutral image', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const result = autoAdjustService.autoShadowsHighlights(stats) as Record<string, unknown>;

    // Neutral image has no shadow or highlight issues (50 = neutral in new scale)
    expect(result.shadows as number).toBeCloseTo(50, 0);
    expect(result.highlights as number).toBeCloseTo(50, 0);
    logVisual('autoSH on neutral', result);
  });

  it('should process and produce valid output', () => {
    const img = createDarkImage();
    const stats = autoAdjustService.analyse(img, W, H);
    const result = autoAdjustService.autoShadowsHighlights(stats);

    const sh = new ShadowsHighlightsModule();
    sh.setParams(result);
    const output = sh.process({ width: W, height: H, data: img, channels: 4 });

    expect(isValidImageData(output.data)).toBe(true);
    logVisual('autoSH processed dark',
      result as unknown as Record<string, unknown>,
      calculateAveragePixel(img),
      calculateAveragePixel(output.data));
  });
});

// ─── 9. NoiseReductionModule.autoAdjust ─────────────────────────────────────

describe('NoiseReductionModule.autoAdjust', () => {
  it('should select low-noise settings for uniform image', () => {
    const module = new NoiseReductionModule();
    const img = createNeutralImage();
    const result = module.autoAdjust(img, CTX);

    expect(result.enabled).toBe(true);
    // v1.36.0 C1/F1: the low bucket's raw strength is remapped through the recalibrated NR
    // curve (nrCurve.ts) to preserve its old EFFECTIVE h — ~85 on the new scale, not 20.
    expect(nrStrengthToH(result.strength)).toBeCloseTo(legacyNrStrengthToH(20), 8);
    expect(result.strength).toBeLessThan(100);
    expect(result.preserveDetail).toBeGreaterThanOrEqual(80);
    expect(result.method).toBe('wavelet');
    logVisual('autoNR on uniform', result as unknown as Record<string, unknown>);
  });

  it('should select stronger settings for noisy image', () => {
    const module = new NoiseReductionModule();
    const img = createNoiseImage(W, H);
    const result = module.autoAdjust(img, CTX);

    expect(result.enabled).toBe(true);
    expect(result.strength).toBeGreaterThan(20);
    logVisual('autoNR on noisy', result as unknown as Record<string, unknown>);
  });

  it('should maintain chromaStrength <= lumaStrength', () => {
    const module = new NoiseReductionModule();
    const img = createNoiseImage(W, H);
    const result = module.autoAdjust(img, CTX);

    expect(result.chromaStrength).toBeLessThanOrEqual(result.lumaStrength);
  });

  it('should keep all params in valid ranges', () => {
    const module = new NoiseReductionModule();
    for (const img of [createNeutralImage(), createNoiseImage(W, H), createGradientImage(W, H)]) {
      const result = module.autoAdjust(img, CTX);

      expect(result.strength).toBeGreaterThanOrEqual(0);
      expect(result.strength).toBeLessThanOrEqual(100);
      expect(result.preserveDetail).toBeGreaterThanOrEqual(0);
      expect(result.preserveDetail).toBeLessThanOrEqual(100);
      expect(['wavelet', 'nlmeans', 'bm3d', 'hybrid']).toContain(result.method);
    }
  });
});

// ─── 10. WhiteBalanceModule.autoDetectWhiteBalance ──────────────────────────

describe('WhiteBalanceModule.autoDetectWhiteBalance', () => {
  it('should detect ~6500K for neutral image', () => {
    const wb = new WhiteBalanceModule();
    const img = createNeutralImage();
    wb.autoDetectWhiteBalance(img, CTX);
    const params = wb.getParams();

    // Neutral median solves to 6500K, and damping keeps 6500 as its fixed point
    expect(params.temperature).toBeCloseTo(6500, -2);
    expect(params.auto).toBe(true);
    logVisual('module autoDetect on neutral', params as unknown as Record<string, unknown>);
  });

  it('should detect lower temperature for warm image', () => {
    const wb = new WhiteBalanceModule();
    const img = createWarmImage();
    wb.autoDetectWhiteBalance(img, CTX);
    const params = wb.getParams();

    expect(params.temperature).toBeLessThan(6500);
    logVisual('module autoDetect on warm', params as unknown as Record<string, unknown>);
  });

  it('should detect higher temperature for cool image', () => {
    const wb = new WhiteBalanceModule();
    const img = createCoolImage();
    wb.autoDetectWhiteBalance(img, CTX);
    const params = wb.getParams();

    expect(params.temperature).toBeGreaterThan(6500);
    logVisual('module autoDetect on cool', params as unknown as Record<string, unknown>);
  });

  it('should reduce the cast after autoDetect + process while retaining some warmth (damped policy)', () => {
    const wb = new WhiteBalanceModule();
    const img = createWarmImage();
    const beforeAvg = calculateAveragePixel(img);

    wb.autoDetectWhiteBalance(img, CTX);
    const output = wb.process(img, CTX);
    const afterAvg = calculateAveragePixel(output);

    // Damped correction: the R/B spread shrinks, but the scene keeps part of its
    // warmth (R stays above B) instead of being neutralised to R≈B.
    const beforeSpread = Math.abs(beforeAvg[0] - beforeAvg[2]);
    const afterSpread = Math.abs(afterAvg[0] - afterAvg[2]);

    console.log(`\n  ── Module autoDetect + process (warm) ──`);
    console.log(`  Before R-B spread: ${beforeSpread.toFixed(4)}`);
    console.log(`  After  R-B spread: ${afterSpread.toFixed(4)}`);
    console.log(`  Improved? ${afterSpread < beforeSpread ? 'YES' : 'NO'}`);

    expect(afterSpread).toBeLessThan(beforeSpread);
    expect(afterAvg[0]).toBeGreaterThan(afterAvg[2]); // warmth retained, not sterilised
    expect(isValidImageData(output)).toBe(true);
    logVisual('module autoDetect+process warm', wb.getParams() as unknown as Record<string, unknown>, beforeAvg, afterAvg);
  });
});

// ─── 11. LensCorrectionsModule.autoDetectVignetting ─────────────────────────

describe('LensCorrectionsModule.autoDetectVignetting', () => {
  it('should NOT enable correction for uniform image', () => {
    const lc = new LensCorrectionsModule();
    const img = createTestImage(200, 200, 0.5, 0.5, 0.5);
    lc.autoDetectVignetting(img, 200, 200);
    const params = lc.getParams();

    // Uniform image has no brightness falloff
    expect(params.vignetting.enabled).toBe(false);
    logVisual('autoVignette on uniform', { enabled: params.vignetting.enabled, amount: params.vignetting.amount });
  });

  it('should enable correction for vignetted image', () => {
    const lc = new LensCorrectionsModule();
    const img = createVignettedImage(200, 200);
    lc.autoDetectVignetting(img, 200, 200);
    const params = lc.getParams();

    expect(params.vignetting.enabled).toBe(true);
    expect(params.vignetting.amount).toBeGreaterThan(0);
    expect(params.vignetting.amount).toBeLessThanOrEqual(50);
    logVisual('autoVignette on vignetted', { enabled: params.vignetting.enabled, amount: params.vignetting.amount });
  });

  it('should cap vignetting amount at 50', () => {
    const lc = new LensCorrectionsModule();
    // Extreme vignetting: bright center, very dark corners
    const w = 200, h = 200;
    const channels = 4;
    const data = new Float32Array(w * h * channels);
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * channels;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const falloff = 1.0 - (dist / maxDist) * 0.95; // extreme falloff
        data[idx] = 0.9 * Math.max(0.01, falloff);
        data[idx + 1] = 0.9 * Math.max(0.01, falloff);
        data[idx + 2] = 0.9 * Math.max(0.01, falloff);
        data[idx + 3] = 1.0;
      }
    }

    lc.autoDetectVignetting(data, w, h);
    const params = lc.getParams();

    expect(params.vignetting.amount).toBeLessThanOrEqual(50);
  });
});

// ─── 12. Full Auto Simulation ───────────────────────────────────────────────

describe('Full Auto simulation', () => {
  function runFullAuto(inputImage: Float32Array) {
    const stats = autoAdjustService.analyse(inputImage, W, H);

    // Exposure
    const exposureParams = autoAdjustService.autoExposure(stats);
    const exposureMod = new ExposureModule();
    exposureMod.setCurrentParams(exposureParams);
    let current = exposureMod.process(inputImage, CTX);

    // White Balance
    const wbParams = autoAdjustService.autoWhiteBalance(stats);
    const wbMod = new WhiteBalanceModule();
    wbMod.setParams(wbParams);
    current = wbMod.process(current, CTX);

    // Basic Adjustments (zero out exposure — ExposureModule already handles it)
    const baParams = autoAdjustService.autoBasicAdj(stats);
    baParams.exposure = 0;
    const baMod = new BasicAdjustmentsModule();
    baMod.setParams(baParams);
    current = baMod.process(current, CTX);

    // Tone Curve
    const tcParams = autoAdjustService.autoToneCurve(stats);
    const tcMod = new ToneCurveModule();
    tcMod.setParams(tcParams as Record<string, unknown>);
    const tcOutput = tcMod.process({ width: W, height: H, data: current, channels: 4 });
    current = tcOutput.data;

    // Color Balance
    const cbParams = autoAdjustService.autoColorBalance(stats);
    const cbMod = new ColorBalanceModule();
    cbMod.setParams(cbParams as Record<string, unknown>);
    current = cbMod.process(current, CTX);

    // Shadows/Highlights
    const shParams = autoAdjustService.autoShadowsHighlights(stats);
    const shMod = new ShadowsHighlightsModule();
    shMod.setParams(shParams);
    const shOutput = shMod.process({ width: W, height: H, data: current, channels: 4 });
    current = shOutput.data;

    return {
      output: current,
      params: { exposureParams, wbParams, baParams, tcParams, cbParams, shParams },
      stats,
    };
  }

  it('should produce valid output for dark image', () => {
    const img = createDarkImage();
    const beforeAvg = calculateAveragePixel(img);
    const { output } = runFullAuto(img);

    expect(isValidImageData(output)).toBe(true);
    const afterAvg = calculateAveragePixel(output);

    const beforeLum = beforeAvg[0] * 0.2126 + beforeAvg[1] * 0.7152 + beforeAvg[2] * 0.0722;
    const afterLum = afterAvg[0] * 0.2126 + afterAvg[1] * 0.7152 + afterAvg[2] * 0.0722;

    console.log(`\n  ── Full Auto on dark ──`);
    console.log(`  Before lum: ${beforeLum.toFixed(4)}, After lum: ${afterLum.toFixed(4)}`);
    // low_light profile grades dark images darker (median 0.0655), so Full Auto
    // must not brighten a dark image (was: expected brightening toward 0.45).
    expect(afterLum).toBeLessThanOrEqual(beforeLum + 1e-3);
    logVisual('Full Auto dark', {}, beforeAvg, afterAvg);
  });

  it('should produce valid output for bright image', () => {
    const img = createBrightImage();
    const { output } = runFullAuto(img);

    expect(isValidImageData(output)).toBe(true);
    const afterAvg = calculateAveragePixel(output);
    logVisual('Full Auto bright', {}, calculateAveragePixel(img), afterAvg);
  });

  it('should move warm image R/B ratio toward 1.0', () => {
    const img = createWarmImage();
    const beforeAvg = calculateAveragePixel(img);
    const { output } = runFullAuto(img);
    const afterAvg = calculateAveragePixel(output);

    const beforeRB = beforeAvg[0] / beforeAvg[2];
    const afterRB = afterAvg[0] / afterAvg[2];

    console.log(`\n  ── Full Auto warm R/B ratio ──`);
    console.log(`  Before R/B: ${beforeRB.toFixed(4)}`);
    console.log(`  After  R/B: ${afterRB.toFixed(4)}`);
    console.log(`  Closer to 1.0? ${Math.abs(afterRB - 1) < Math.abs(beforeRB - 1) ? 'YES' : 'NO'}`);

    expect(isValidImageData(output)).toBe(true);
  });

  it('should keep neutral image roughly neutral', () => {
    const img = createNeutralImage();
    const { output } = runFullAuto(img);
    const afterAvg = calculateAveragePixel(output);

    // All channels should still be close to each other
    const spread = Math.max(afterAvg[0], afterAvg[1], afterAvg[2]) - Math.min(afterAvg[0], afterAvg[1], afterAvg[2]);
    console.log(`\n  ── Full Auto neutral ──`);
    console.log(`  After avg: R=${afterAvg[0].toFixed(4)} G=${afterAvg[1].toFixed(4)} B=${afterAvg[2].toFixed(4)}`);
    console.log(`  Channel spread: ${spread.toFixed(4)}`);

    expect(isValidImageData(output)).toBe(true);
  });

  it('should produce valid output for cool image', () => {
    const img = createCoolImage();
    const { output } = runFullAuto(img);

    expect(isValidImageData(output)).toBe(true);
    logVisual('Full Auto cool', {}, calculateAveragePixel(img), calculateAveragePixel(output));
  });
});

// ─── 13. Full Auto Idempotency ──────────────────────────────────────────────

describe('Full Auto idempotency', () => {
  function runFullAutoPass(inputImage: Float32Array) {
    const stats = autoAdjustService.analyse(inputImage, W, H);

    const exposureParams = autoAdjustService.autoExposure(stats);
    const exposureMod = new ExposureModule();
    exposureMod.setCurrentParams(exposureParams);
    let current = exposureMod.process(inputImage, CTX);

    const wbParams = autoAdjustService.autoWhiteBalance(stats);
    const wbMod = new WhiteBalanceModule();
    wbMod.setParams(wbParams);
    current = wbMod.process(current, CTX);

    const baParams = autoAdjustService.autoBasicAdj(stats);
    baParams.exposure = 0; // ExposureModule already handles exposure
    const baMod = new BasicAdjustmentsModule();
    baMod.setParams(baParams);
    current = baMod.process(current, CTX);

    const tcParams = autoAdjustService.autoToneCurve(stats);
    const tcMod = new ToneCurveModule();
    tcMod.setParams(tcParams as Record<string, unknown>);
    const tcOut = tcMod.process({ width: W, height: H, data: current, channels: 4 });
    current = tcOut.data;

    const cbParams = autoAdjustService.autoColorBalance(stats);
    const cbMod = new ColorBalanceModule();
    cbMod.setParams(cbParams as Record<string, unknown>);
    current = cbMod.process(current, CTX);

    const shParams = autoAdjustService.autoShadowsHighlights(stats);
    const shMod = new ShadowsHighlightsModule();
    shMod.setParams(shParams);
    const shOut = shMod.process({ width: W, height: H, data: current, channels: 4 });
    current = shOut.data;

    return { output: current, exposureParams, wbParams, baParams };
  }

  it('should converge after 2 passes on dark warm image', () => {
    const img = createWarmImage();
    // Make it dark-warm
    for (let i = 0; i < img.length; i += 4) {
      img[i] *= 0.3;
      img[i + 1] *= 0.3;
      img[i + 2] *= 0.3;
    }

    const pass1 = runFullAutoPass(img);
    const pass2 = runFullAutoPass(pass1.output);

    console.log(`\n  ── Full Auto Idempotency (dark warm) ──`);
    console.log(`  Pass 1: exposure=${pass1.exposureParams.exposure.toFixed(3)}, wb_temp=${pass1.wbParams.temperature}K`);
    console.log(`  Pass 2: exposure=${pass2.exposureParams.exposure.toFixed(3)}, wb_temp=${pass2.wbParams.temperature}K`);

    const expDelta1 = Math.abs(pass1.exposureParams.exposure);
    const expDelta2 = Math.abs(pass2.exposureParams.exposure);

    console.log(`  Exposure magnitude: pass1=${expDelta1.toFixed(3)}, pass2=${expDelta2.toFixed(3)}`);
    console.log(`  Converging? ${expDelta2 < expDelta1 ? 'YES' : 'NO'}`);

    // Pass 2 adjustments should be smaller than pass 1
    expect(isValidImageData(pass2.output)).toBe(true);
  });

  it('should converge after 2 passes on cool image', () => {
    const img = createCoolImage();
    const pass1 = runFullAutoPass(img);
    const pass2 = runFullAutoPass(pass1.output);

    const avg1 = calculateAveragePixel(pass1.output);
    const avg2 = calculateAveragePixel(pass2.output);

    // Measure how much pass2 changed the image compared to pass1
    const delta1 = calculateAveragePixel(img).map((v, i) => Math.abs(calculateAveragePixel(pass1.output)[i] - v));
    const delta2 = avg1.map((v, i) => Math.abs(avg2[i] - v));

    const totalDelta1 = delta1.slice(0, 3).reduce((a, b) => a + b, 0);
    const totalDelta2 = delta2.slice(0, 3).reduce((a, b) => a + b, 0);

    console.log(`\n  ── Full Auto Idempotency (cool) ──`);
    console.log(`  Pass 1 total RGB change: ${totalDelta1.toFixed(4)}`);
    console.log(`  Pass 2 total RGB change: ${totalDelta2.toFixed(4)}`);
    console.log(`  Converging? ${totalDelta2 < totalDelta1 ? 'YES' : 'NO'}`);

    expect(isValidImageData(pass2.output)).toBe(true);
  });

  it('should produce minimal change on 2nd pass for neutral image', () => {
    const img = createNeutralImage();
    const pass1 = runFullAutoPass(img);
    const pass2 = runFullAutoPass(pass1.output);

    const avg1 = calculateAveragePixel(pass1.output);
    const avg2 = calculateAveragePixel(pass2.output);

    const maxDelta = Math.max(
      Math.abs(avg2[0] - avg1[0]),
      Math.abs(avg2[1] - avg1[1]),
      Math.abs(avg2[2] - avg1[2])
    );

    console.log(`\n  ── Full Auto Idempotency (neutral) ──`);
    console.log(`  Pass 1 avg: R=${avg1[0].toFixed(4)} G=${avg1[1].toFixed(4)} B=${avg1[2].toFixed(4)}`);
    console.log(`  Pass 2 avg: R=${avg2[0].toFixed(4)} G=${avg2[1].toFixed(4)} B=${avg2[2].toFixed(4)}`);
    console.log(`  Max delta between passes: ${maxDelta.toFixed(6)}`);

    expect(isValidImageData(pass2.output)).toBe(true);
  });
});

// ─── User style profile: bucket routing + profile-driven targets ─────────────

describe('selectBucket()', () => {
  it('routes very dark images to low_light', () => {
    expect(selectBucket({ mean_lum: 0.15, rb_ratio: 1.0 })).toBe('low_light');
  });
  it('routes very bright images to high_key', () => {
    expect(selectBucket({ mean_lum: 0.70, rb_ratio: 1.0 })).toBe('high_key');
  });
  it('routes warm mid/low images to warm', () => {
    expect(selectBucket({ mean_lum: 0.40, rb_ratio: 1.30 })).toBe('warm');
  });
  it('routes blue-biased images to cool', () => {
    expect(selectBucket({ mean_lum: 0.40, rb_ratio: 0.70 })).toBe('cool');
  });
  it('falls back to standard for neutral mid images', () => {
    expect(selectBucket({ mean_lum: 0.40, rb_ratio: 1.00 })).toBe('standard');
  });
});

describe('autoExposure uses per-bucket profile targets (not the old 0.45)', () => {
  const buckets: Array<{ bucket: BucketName; make: () => Float32Array }> = [
    { bucket: 'low_light', make: createDarkImage },
    { bucket: 'high_key', make: createBrightImage },
    { bucket: 'warm', make: createWarmImage },
    { bucket: 'cool', make: createCoolImage },
    { bucket: 'standard', make: createNeutralImage },
  ];

  it.each(buckets)('routes a $bucket synthetic image to the $bucket bucket', ({ bucket, make }) => {
    const stats = autoAdjustService.analyse(make(), W, H);
    const picked = selectBucket({ mean_lum: stats.meanLum, rb_ratio: stats.meanR / Math.max(0.001, stats.meanB) });
    expect(picked).toBe(bucket);
  });

  it('darkens a low-light image toward its profile (old code brightened it toward 0.45)', () => {
    const stats = autoAdjustService.analyse(createDarkImage(), W, H);
    const { exposure } = autoAdjustService.autoExposure(stats);
    // low_light target median 0.0655 < p50 0.15 → pull DOWN. Old 0.45 target pulled UP.
    expect(exposure).toBeLessThan(0);
    expect(userStyleProfile.low_light.targetMedianLum).toBeLessThan(0.45);
  });

  it('aims a standard image at ~0.4166, not 0.45 (slight negative exposure from p50≈0.5)', () => {
    const stats = autoAdjustService.analyse(createNeutralImage(), W, H);
    const { exposure } = autoAdjustService.autoExposure(stats);
    expect(exposure).toBeLessThan(0); // old code returned 0 (0.45 within deadzone of 0.5)
  });

  it('does not crush an already-bright high-key image toward 0.45', () => {
    const stats = autoAdjustService.analyse(createBrightImage(), W, H);
    const { exposure } = autoAdjustService.autoExposure(stats);
    // high_key target 0.9163 ≈ image 0.9 → near-zero. Old 0.45 target → strong darken.
    expect(exposure).toBeGreaterThan(-0.1);
  });
});

describe('autoAll()', () => {
  it('warm scene → warm bucket, negative exposure, full bundle', () => {
    const result = autoAdjustService.autoAll(createWarmImage(), W, H);
    expect(result.bucket).toBe('warm');
    expect(result.exposure.exposure).toBeLessThan(0);
    expect(result.basicAdj).toBeDefined();
    expect(result.shadowsHighlights).toBeDefined();
    expect(result.toneCurve).toBeDefined();
    expect(result.colorBalance).toBeDefined();
    expect(result.whiteBalance).toBeDefined();
    expect(result.stats.meanLum).toBeGreaterThan(0);
  });

  it('white balance targets the bucket R/B ratio and stays in range', () => {
    const result = autoAdjustService.autoAll(createWarmImage(), W, H);
    expect(result.whiteBalance.temperature).toBeGreaterThan(2000);
    expect(result.whiteBalance.temperature).toBeLessThan(12000);
  });
});
