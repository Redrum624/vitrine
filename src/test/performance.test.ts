/**
 * Performance Benchmark Tests
 *
 * Tests module processing performance characteristics.
 * Note: Node.js/Jest execution is slower than browser environments.
 * These tests focus on relative performance and scalability rather than
 * absolute timing targets (which are better tested in browser).
 */

import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { ProcessingContext } from '../services/ImageProcessingPipeline';

// Mock the logger
jest.mock('../utils/Logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Generate a test image with gradient pattern
 */
function generateTestImage(width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = x / width;         // R: 0 to 1 left-to-right
      data[idx + 1] = y / height;    // G: 0 to 1 top-to-bottom
      data[idx + 2] = 0.5;           // B: constant
      data[idx + 3] = 1.0;           // A: opaque
    }
  }

  return data;
}

/**
 * Run multiple iterations and return statistics
 */
function measurePerformance(
  fn: () => void,
  iterations: number = 3
): { avg: number; min: number; max: number; times: number[] } {
  const times: number[] = [];

  // Warmup run
  fn();

  // Timed runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  return { avg, min, max, times };
}

describe('Performance Benchmarks', () => {
  // Use small test images for fast tests in Jest
  const testSize = { width: 64, height: 64 };

  describe('WhiteBalanceModule Performance', () => {
    it('should complete processing without hanging', () => {
      const { width, height } = testSize;
      const input = generateTestImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new WhiteBalanceModule();
      module.setParams({ temperature: 4500, tint: 10 });

      const start = performance.now();
      const output = module.process(input, context);
      const duration = performance.now() - start;

      expect(output.length).toBe(input.length);
      expect(duration).toBeLessThan(5000); // Should complete within 5s
    });
  });

  describe('BasicAdjustmentsModule Performance', () => {
    it('should complete processing without hanging', () => {
      const { width, height } = testSize;
      const input = generateTestImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new BasicAdjustmentsModule();
      module.setParams({ exposure: 0.5, contrast: 20, saturation: 10 });

      const start = performance.now();
      const output = module.process(input, context);
      const duration = performance.now() - start;

      expect(output.length).toBe(input.length);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('ColorBalanceModule Performance', () => {
    it('should complete processing without hanging', () => {
      const { width, height } = testSize;
      const input = generateTestImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new ColorBalanceModule();
      module.setParams({
        shadows: { cyan_red: 0.2, magenta_green: 0.1, yellow_blue: 0 },
      });

      const start = performance.now();
      const output = module.process(input, context);
      const duration = performance.now() - start;

      expect(output.length).toBe(input.length);
      expect(duration).toBeLessThan(10000);
    });
  });

  describe('Scalability', () => {
    it('should scale reasonably with pixel count', () => {
      const module = new WhiteBalanceModule();
      module.setParams({ temperature: 5000 });

      // Measure small image (32x32 = 1024 pixels)
      const smallInput = generateTestImage(32, 32);
      const smallContext: ProcessingContext = { width: 32, height: 32, channels: 4 };
      const smallStats = measurePerformance(() => {
        module.process(smallInput, smallContext);
      });

      // Measure 4x larger image (64x64 = 4096 pixels)
      const largeInput = generateTestImage(64, 64);
      const largeContext: ProcessingContext = { width: 64, height: 64, channels: 4 };
      const largeStats = measurePerformance(() => {
        module.process(largeInput, largeContext);
      });

      // Time should scale - 4x pixels should take more time, but not wildly more
      // (allow up to 10x due to overhead and non-linear effects)
      const ratio = largeStats.avg / smallStats.avg;
      expect(ratio).toBeLessThan(10);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not crash after multiple iterations', () => {
      const { width, height } = testSize;
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new BasicAdjustmentsModule();
      module.setParams({ exposure: 0.5 });

      // Run many iterations without crashing
      for (let i = 0; i < 20; i++) {
        const input = generateTestImage(width, height);
        const output = module.process(input, context);
        expect(output.length).toBe(input.length);
      }
    });
  });

  describe('Multi-Module Pipeline', () => {
    it('should process through 3 modules sequentially', () => {
      const { width, height } = testSize;
      const input = generateTestImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const wb = new WhiteBalanceModule();
      wb.setParams({ temperature: 5000 });

      const basic = new BasicAdjustmentsModule();
      basic.setParams({ contrast: 10 });

      const color = new ColorBalanceModule();
      color.setParams({
        midtones: { cyan_red: 0.1, magenta_green: 0, yellow_blue: 0 },
      });

      const start = performance.now();
      let data = wb.process(input, context);
      data = basic.process(data, context);
      const output = color.process(data, context);
      const duration = performance.now() - start;

      expect(output.length).toBe(input.length);
      expect(duration).toBeLessThan(30000); // Should complete within 30s
    });
  });

  describe('Consistency', () => {
    it('should produce consistent timing across runs', () => {
      const { width, height } = testSize;
      const input = generateTestImage(width, height);
      const context: ProcessingContext = { width, height, channels: 4 };

      const module = new WhiteBalanceModule();
      module.setParams({ temperature: 5000 });

      const stats = measurePerformance(() => {
        module.process(input, context);
      }, 5);

      // All runs should complete (no outliers to infinity)
      for (const time of stats.times) {
        expect(Number.isFinite(time)).toBe(true);
        expect(time).toBeGreaterThan(0);
      }

      // Max should not be wildly different from min (within 10x)
      expect(stats.max / stats.min).toBeLessThan(10);
    });
  });
});
