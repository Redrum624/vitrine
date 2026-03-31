/**
 * Integration Test Suite
 *
 * Tests the complete image processing pipeline with all modules working together.
 * Validates end-to-end functionality, module interactions, and edge cases.
 */

import { logger } from '../utils/Logger';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { CropModule, AspectRatio } from '../modules/CropModule';
import { ExposureModule } from '../modules/ExposureModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';
import { PerformanceWithMemory } from '../types/global';

export interface IntegrationTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface IntegrationTestSuite {
  suiteName: string;
  tests: IntegrationTestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  successRate: number;
}

export class IntegrationTests {
  private static instance: IntegrationTests;
  private results: IntegrationTestResult[] = [];

  private constructor() {
    logger.info('IntegrationTests initialized');
  }

  static getInstance(): IntegrationTests {
    if (!IntegrationTests.instance) {
      IntegrationTests.instance = new IntegrationTests();
    }
    return IntegrationTests.instance;
  }

  /**
   * Generate test image with known characteristics
   */
  private generateTestImage(
    width: number,
    height: number,
    pattern: 'gradient' | 'solid' | 'checkerboard' | 'noise' = 'gradient'
  ): Float32Array {
    const data = new Float32Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        switch (pattern) {
          case 'gradient':
            data[idx] = x / width;
            data[idx + 1] = y / height;
            data[idx + 2] = 0.5;
            data[idx + 3] = 1.0;
            break;

          case 'solid':
            data[idx] = 0.5;
            data[idx + 1] = 0.5;
            data[idx + 2] = 0.5;
            data[idx + 3] = 1.0;
            break;

          case 'checkerboard': {
            const isWhite = (Math.floor(x / 64) + Math.floor(y / 64)) % 2 === 0;
            const value = isWhite ? 1.0 : 0.0;
            data[idx] = value;
            data[idx + 1] = value;
            data[idx + 2] = value;
            data[idx + 3] = 1.0;
            break;
          }

          case 'noise':
            data[idx] = Math.random();
            data[idx + 1] = Math.random();
            data[idx + 2] = Math.random();
            data[idx + 3] = 1.0;
            break;
        }
      }
    }

    return data;
  }

  /**
   * Test: Full pipeline with all modules enabled
   */
  async testFullPipeline(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      // Generate test image
      const width = 1920;
      const height = 1080;
      const testImage = this.generateTestImage(width, height, 'gradient');

      // Enable all modules with moderate settings
      this.enableAllModules();

      // Process through entire pipeline
      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Validate output
      if (result.length !== testImage.length) {
        throw new Error('Output size mismatch');
      }

      // Check for NaN or invalid values
      for (let i = 0; i < result.length; i++) {
        if (isNaN(result[i]) || !isFinite(result[i])) {
          throw new Error(`Invalid value at index ${i}: ${result[i]}`);
        }
      }

      const duration = performance.now() - startTime;
      logger.info(`Full pipeline test passed in ${duration.toFixed(2)}ms`);

      return {
        testName: 'Full Pipeline Processing',
        passed: true,
        duration,
        details: {
          inputSize: testImage.length,
          outputSize: result.length,
          imageResolution: `${width}x${height}`
        }
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error('Full pipeline test failed:', error);

      return {
        testName: 'Full Pipeline Processing',
        passed: false,
        duration,
        error: String(error)
      };
    }
  }

  /**
   * Test: Edge case - extreme exposure values
   */
  async testExtremeExposure(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 512;
      const height = 512;
      const testImage = this.generateTestImage(width, height, 'solid');

      // Get exposure module
      const exposureModule = imageProcessingPipeline.getModule<ExposureModule>('exposure');
      if (!exposureModule) {
        throw new Error('Exposure module not found');
      }

      // Test extreme positive exposure
      exposureModule.setCurrentParams({ exposure: 3.0, black: 0 });
      const result1 = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Test extreme negative exposure
      exposureModule.setCurrentParams({ exposure: -3.0, black: 0 });
      const result2 = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Validate no crashes or invalid values
      for (let i = 0; i < result1.length; i++) {
        if (isNaN(result1[i]) || isNaN(result2[i])) {
          throw new Error('NaN values in output');
        }
      }

      const duration = performance.now() - startTime;

      return {
        testName: 'Extreme Exposure Values',
        passed: true,
        duration,
        details: {
          extremePositive: 'passed',
          extremeNegative: 'passed'
        }
      };

    } catch (error) {
      return {
        testName: 'Extreme Exposure Values',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Edge case - all zeros input
   */
  async testAllZerosInput(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 256;
      const height = 256;
      const testImage = new Float32Array(width * height * 4); // All zeros

      // Process
      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Should handle gracefully without crashes
      if (result.length !== testImage.length) {
        throw new Error('Output size mismatch');
      }

      // Check for invalid values
      for (let i = 0; i < result.length; i++) {
        if (isNaN(result[i]) || !isFinite(result[i])) {
          throw new Error(`Invalid value at index ${i}`);
        }
      }

      return {
        testName: 'All Zeros Input',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        testName: 'All Zeros Input',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Edge case - all ones input (max brightness)
   */
  async testAllOnesInput(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 256;
      const height = 256;
      const testImage = new Float32Array(width * height * 4);
      testImage.fill(1.0);

      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      if (result.length !== testImage.length) {
        throw new Error('Output size mismatch');
      }

      for (let i = 0; i < result.length; i++) {
        if (isNaN(result[i]) || !isFinite(result[i])) {
          throw new Error('Invalid value in output');
        }
      }

      return {
        testName: 'All Ones Input (Max Brightness)',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        testName: 'All Ones Input (Max Brightness)',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Multiple processing passes (idempotency)
   */
  async testMultiplePasses(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 512;
      const height = 512;
      const testImage = this.generateTestImage(width, height, 'gradient');

      // Disable all modules (identity transform)
      this.disableAllModules();

      // Process multiple times
      let result: Float32Array = new Float32Array(testImage);
      for (let pass = 0; pass < 5; pass++) {
        result = await imageProcessingPipeline.processImage(result, { width, height, channels: 4 }) as Float32Array;
      }

      // With all modules disabled, output should be very close to input
      let maxDiff = 0;
      for (let i = 0; i < testImage.length; i++) {
        const diff = Math.abs(result[i] - testImage[i]);
        if (diff > maxDiff) maxDiff = diff;
      }

      // Allow small numerical errors
      if (maxDiff > 0.01) {
        throw new Error(`Multiple passes changed output too much: ${maxDiff}`);
      }

      return {
        testName: 'Multiple Processing Passes',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          passes: 5,
          maxDifference: maxDiff
        }
      };

    } catch (error) {
      return {
        testName: 'Multiple Processing Passes',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Large image processing (24MP)
   */
  async testLargeImage(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 6000;
      const height = 4000;
      const testImage = this.generateTestImage(width, height, 'gradient');

      logger.info(`Processing large image: ${width}x${height} (24MP)`);

      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      if (result.length !== testImage.length) {
        throw new Error('Output size mismatch');
      }

      const duration = performance.now() - startTime;
      logger.info(`Large image processed in ${duration.toFixed(2)}ms`);

      // Check performance target (<400ms for 24MP)
      const meetsTarget = duration < 400;

      return {
        testName: 'Large Image Processing (24MP)',
        passed: true,
        duration,
        details: {
          resolution: `${width}x${height}`,
          pixelCount: width * height,
          meetsPerformanceTarget: meetsTarget,
          targetMs: 400
        }
      };

    } catch (error) {
      return {
        testName: 'Large Image Processing (24MP)',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Noise reduction on noisy image
   */
  async testNoiseReduction(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 1024;
      const height = 1024;
      const testImage = this.generateTestImage(width, height, 'noise');

      const noiseModule = imageProcessingPipeline.getModule<NoiseReductionModule>('noise-reduction');
      if (!noiseModule) {
        throw new Error('Noise reduction module not found');
      }

      // Enable noise reduction with high strength
      noiseModule.setParams({
        enabled: true,
        strength: 80,
        method: 'bm3d',
        preserveDetail: 70,
        chromaStrength: 75,
        lumaStrength: 75
      });

      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Calculate noise reduction (variance should decrease)
      const inputVariance = this.calculateVariance(testImage, width, height);
      const outputVariance = this.calculateVariance(result, width, height);

      if (outputVariance >= inputVariance) {
        throw new Error('Noise reduction did not reduce variance');
      }

      const reductionPercent = ((inputVariance - outputVariance) / inputVariance) * 100;

      return {
        testName: 'Noise Reduction Effectiveness',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          inputVariance: inputVariance.toFixed(6),
          outputVariance: outputVariance.toFixed(6),
          reductionPercent: reductionPercent.toFixed(2) + '%'
        }
      };

    } catch (error) {
      return {
        testName: 'Noise Reduction Effectiveness',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Crop module with various aspect ratios
   */
  async testCropAspectRatios(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 1920;
      const height = 1080;
      const testImage = this.generateTestImage(width, height, 'gradient');

      const cropModule = imageProcessingPipeline.getModule<CropModule>('crop');
      if (!cropModule) {
        throw new Error('Crop module not found');
      }

      const aspectRatios: AspectRatio[] = ['1:1', '3:2', '4:3', '16:9'];
      const results: Record<string, boolean> = {};

      for (const ratio of aspectRatios) {
        cropModule.setParams({
          enabled: true,
          x: 0,
          y: 0,
          width: width,
          height: height,
          aspectRatio: ratio,
          straightenAngle: 0
        });

        const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });
        results[ratio] = result.length > 0;
      }

      const allPassed = Object.values(results).every(v => v);

      return {
        testName: 'Crop Aspect Ratios',
        passed: allPassed,
        duration: performance.now() - startTime,
        details: results
      };

    } catch (error) {
      return {
        testName: 'Crop Aspect Ratios',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Color balance extremes
   */
  async testColorBalanceExtremes(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 512;
      const height = 512;
      const testImage = this.generateTestImage(width, height, 'solid');

      const colorModule = imageProcessingPipeline.getModule<ColorBalanceModule>('colorbalance');
      if (!colorModule) {
        throw new Error('Color balance module not found');
      }

      // Test extreme color shifts
      colorModule.setParams({
        enabled: true,
        shadowsRed: 100,
        shadowsGreen: -100,
        shadowsBlue: 100,
        midtonesRed: 0,
        midtonesGreen: 0,
        midtonesBlue: 0,
        highlightsRed: -100,
        highlightsGreen: 100,
        highlightsBlue: -100
      });

      const result = await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

      // Validate no crashes or invalid values
      for (let i = 0; i < result.length; i++) {
        if (isNaN(result[i]) || !isFinite(result[i])) {
          throw new Error('Invalid values in output');
        }
      }

      return {
        testName: 'Color Balance Extremes',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        testName: 'Color Balance Extremes',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Test: Memory stability over multiple images
   */
  async testMemoryStability(): Promise<IntegrationTestResult> {
    const startTime = performance.now();

    try {
      const width = 2048;
      const height = 1536;
      const iterations = 50;

      const memorySnapshots: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const testImage = this.generateTestImage(width, height, 'gradient');
        await imageProcessingPipeline.processImage(testImage, { width, height, channels: 4 });

        // Capture memory if available
        if (performance && (performance as PerformanceWithMemory).memory) {
          const mem = (performance as PerformanceWithMemory).memory!;
          memorySnapshots.push(mem.usedJSHeapSize);
        }

        // Allow GC
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Check for memory leaks (significant growth)
      if (memorySnapshots.length > 2) {
        const firstHalf = memorySnapshots.slice(0, Math.floor(memorySnapshots.length / 2));
        const secondHalf = memorySnapshots.slice(Math.floor(memorySnapshots.length / 2));

        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        const growthPercent = ((secondAvg - firstAvg) / firstAvg) * 100;

        // Allow 50% growth (conservative)
        if (growthPercent > 50) {
          throw new Error(`Potential memory leak: ${growthPercent.toFixed(2)}% growth`);
        }

        return {
          testName: 'Memory Stability',
          passed: true,
          duration: performance.now() - startTime,
          details: {
            iterations,
            memoryGrowth: growthPercent.toFixed(2) + '%'
          }
        };
      } else {
        return {
          testName: 'Memory Stability',
          passed: true,
          duration: performance.now() - startTime,
          details: {
            iterations,
            note: 'Memory API not available'
          }
        };
      }

    } catch (error) {
      return {
        testName: 'Memory Stability',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  /**
   * Calculate variance for noise measurement
   */
  private calculateVariance(data: Float32Array, width: number, height: number): number {
    const pixelCount = width * height;
    let sum = 0;

    // Calculate mean
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const luminance = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
      sum += luminance;
    }

    const mean = sum / pixelCount;

    // Calculate variance
    let varianceSum = 0;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const luminance = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
      varianceSum += Math.pow(luminance - mean, 2);
    }

    return varianceSum / pixelCount;
  }

  /**
   * Enable all modules with moderate settings
   */
  private enableAllModules(): void {
    // Crop - keep disabled for full-frame tests
    const cropModule = imageProcessingPipeline.getModule<CropModule>('crop');
    cropModule?.setParams({ enabled: false, x: 0, y: 0, width: 1920, height: 1080, aspectRatio: 'free', straightenAngle: 0 });

    // Exposure
    const exposureModule = imageProcessingPipeline.getModule<ExposureModule>('exposure');
    exposureModule?.setCurrentParams({ exposure: 0.5, black: 0 });

    // White Balance
    const wbModule = imageProcessingPipeline.getModule<WhiteBalanceModule>('whitebalance');
    wbModule?.setParams({ temperature: 6500, tint: 0, mode: 'manual' });

    // Basic adjustments
    const basicModule = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj');
    basicModule?.setParams({ contrast: 10, saturation: 10, vibrance: 10, highlights: -10, shadows: 10, whites: 5, blacks: -5 });

    // Other modules can be added as needed
  }

  /**
   * Disable all modules by setting them to identity
   */
  private disableAllModules(): void {
    // Reset all modules to default values
    const exposureModule = imageProcessingPipeline.getModule<ExposureModule>('exposure');
    exposureModule?.resetParams();

    const wbModule = imageProcessingPipeline.getModule<WhiteBalanceModule>('whitebalance');
    wbModule?.resetParams();

    const basicModule = imageProcessingPipeline.getModule<BasicAdjustmentsModule>('basicadj');
    basicModule?.resetParams();

    const noiseModule = imageProcessingPipeline.getModule<NoiseReductionModule>('noise-reduction');
    noiseModule?.resetParams();

    const colorModule = imageProcessingPipeline.getModule<ColorBalanceModule>('colorbalance');
    colorModule?.resetParams();

    const cropModule = imageProcessingPipeline.getModule<CropModule>('crop');
    cropModule?.resetParams();
  }

  /**
   * Run all integration tests
   */
  async runAllTests(): Promise<IntegrationTestSuite> {
    logger.info('🧪 Running integration test suite...');
    this.results = [];

    const tests = [
      () => this.testFullPipeline(),
      () => this.testExtremeExposure(),
      () => this.testAllZerosInput(),
      () => this.testAllOnesInput(),
      () => this.testMultiplePasses(),
      () => this.testLargeImage(),
      () => this.testNoiseReduction(),
      () => this.testCropAspectRatios(),
      () => this.testColorBalanceExtremes(),
      () => this.testMemoryStability()
    ];

    for (const test of tests) {
      const result = await test();
      this.results.push(result);
      logger.info(`  ${result.passed ? '✅' : '❌'} ${result.testName}: ${result.duration.toFixed(2)}ms`);
    }

    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = this.results.filter(r => !r.passed).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    const suite: IntegrationTestSuite = {
      suiteName: 'Integration Tests',
      tests: this.results,
      totalTests: this.results.length,
      passedTests,
      failedTests,
      totalDuration,
      successRate: (passedTests / this.results.length) * 100
    };

    logger.info(`\n✅ Integration tests complete: ${passedTests}/${this.results.length} passed (${suite.successRate.toFixed(1)}%)`);
    logger.info(`   Total duration: ${totalDuration.toFixed(2)}ms`);

    return suite;
  }

  /**
   * Generate test report
   */
  generateReport(): string {
    let report = '# Integration Test Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += '## Summary\n\n';
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const successRate = (passed / this.results.length) * 100;

    report += `- Total Tests: ${this.results.length}\n`;
    report += `- Passed: ${passed}\n`;
    report += `- Failed: ${failed}\n`;
    report += `- Success Rate: ${successRate.toFixed(1)}%\n\n`;

    report += '## Test Results\n\n';
    report += '| Test Name | Status | Duration (ms) | Details |\n';
    report += '|-----------|--------|---------------|----------|\n';

    for (const result of this.results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      const details = result.error || (result.details ? JSON.stringify(result.details) : '-');
      report += `| ${result.testName} | ${status} | ${result.duration.toFixed(2)} | ${details} |\n`;
    }

    return report;
  }

  /**
   * Get results
   */
  getResults(): IntegrationTestResult[] {
    return this.results;
  }
}

export const integrationTests = IntegrationTests.getInstance();
