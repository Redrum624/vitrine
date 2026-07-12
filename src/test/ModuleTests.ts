/**
 * Module-Specific Unit Tests
 *
 * Tests each image processing module in isolation to validate:
 * - Parameter validation
 * - Edge case handling
 * - Output correctness
 * - Performance characteristics
 */

import { logger } from '../utils/Logger';
import { CropModule } from '../modules/CropModule';
import { ExposureModule } from '../modules/ExposureModule';
import { WhiteBalanceModule } from '../modules/WhiteBalanceModule';
import { BasicAdjustmentsModule } from '../modules/BasicAdjustmentsModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { NoiseReductionModule } from '../modules/NoiseReductionModule';

export interface ModuleTestResult {
  moduleName: string;
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ModuleTestSuite {
  moduleName: string;
  tests: ModuleTestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
}

export class ModuleTests {
  private static instance: ModuleTests;
  private results: ModuleTestResult[] = [];

  private constructor() {
    logger.info('ModuleTests initialized');
  }

  static getInstance(): ModuleTests {
    if (!ModuleTests.instance) {
      ModuleTests.instance = new ModuleTests();
    }
    return ModuleTests.instance;
  }

  /**
   * Generate simple test image
   */
  private generateTestImage(width: number, height: number, value: number = 0.5): Float32Array {
    const data = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 1.0;
    }
    return data;
  }

  // ============================================================================
  // EXPOSURE MODULE TESTS
  // ============================================================================

  async testExposureModule_Basic(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new ExposureModule();
      const testImage = this.generateTestImage(512, 512, 0.5);

      module.setCurrentParams({ exposure: 1.0, black: 0 });
      const result = module.process(testImage, { width: 512, height: 512, channels: 4 });

      // With +1EV, output should be brighter
      let avgBrightness = 0;
      for (let i = 0; i < result.length / 4; i++) {
        avgBrightness += (result[i * 4] + result[i * 4 + 1] + result[i * 4 + 2]) / 3;
      }
      avgBrightness /= (result.length / 4);

      if (avgBrightness <= 0.5) {
        throw new Error('Exposure increase did not brighten image');
      }

      return {
        moduleName: 'ExposureModule',
        testName: 'Basic Exposure Adjustment',
        passed: true,
        duration: performance.now() - startTime,
        details: { avgBrightness: avgBrightness.toFixed(3) }
      };

    } catch (error) {
      return {
        moduleName: 'ExposureModule',
        testName: 'Basic Exposure Adjustment',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testExposureModule_Disabled(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new ExposureModule();
      const testImage = this.generateTestImage(256, 256, 0.5);

      // Reset to defaults (disabled state)
      module.resetParams();
      const result = module.process(testImage, { width: 256, height: 256, channels: 4 });

      // When disabled, output should match input
      let maxDiff = 0;
      for (let i = 0; i < testImage.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(result[i] - testImage[i]));
      }

      if (maxDiff > 0.001) {
        throw new Error('Disabled module changed output');
      }

      return {
        moduleName: 'ExposureModule',
        testName: 'Disabled Mode',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        moduleName: 'ExposureModule',
        testName: 'Disabled Mode',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // WHITE BALANCE MODULE TESTS
  // ============================================================================

  async testWhiteBalanceModule_WarmShift(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new WhiteBalanceModule();
      const testImage = this.generateTestImage(256, 256, 0.5);

      module.setParams({ temperature: 6500, tint: 0, mode: 'manual' });
      const result = module.process(testImage, { width: 256, height: 256, channels: 4 });

      // Warm shift should increase red/yellow
      let avgRed = 0, avgBlue = 0;
      for (let i = 0; i < result.length / 4; i++) {
        avgRed += result[i * 4];
        avgBlue += result[i * 4 + 2];
      }
      avgRed /= (result.length / 4);
      avgBlue /= (result.length / 4);

      if (avgRed <= avgBlue) {
        throw new Error('Warm temperature shift did not increase red');
      }

      return {
        moduleName: 'WhiteBalanceModule',
        testName: 'Warm Temperature Shift',
        passed: true,
        duration: performance.now() - startTime,
        details: { avgRed: avgRed.toFixed(3), avgBlue: avgBlue.toFixed(3) }
      };

    } catch (error) {
      return {
        moduleName: 'WhiteBalanceModule',
        testName: 'Warm Temperature Shift',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testWhiteBalanceModule_CoolShift(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new WhiteBalanceModule();
      const testImage = this.generateTestImage(256, 256, 0.5);

      module.setParams({ temperature: 4500, tint: 0, mode: 'manual' });
      const result = module.process(testImage, { width: 256, height: 256, channels: 4 });

      // Cool shift should increase blue
      let avgRed = 0, avgBlue = 0;
      for (let i = 0; i < result.length / 4; i++) {
        avgRed += result[i * 4];
        avgBlue += result[i * 4 + 2];
      }
      avgRed /= (result.length / 4);
      avgBlue /= (result.length / 4);

      if (avgBlue <= avgRed) {
        throw new Error('Cool temperature shift did not increase blue');
      }

      return {
        moduleName: 'WhiteBalanceModule',
        testName: 'Cool Temperature Shift',
        passed: true,
        duration: performance.now() - startTime,
        details: { avgRed: avgRed.toFixed(3), avgBlue: avgBlue.toFixed(3) }
      };

    } catch (error) {
      return {
        moduleName: 'WhiteBalanceModule',
        testName: 'Cool Temperature Shift',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // BASIC ADJUSTMENTS MODULE TESTS
  // ============================================================================

  async testBasicAdjustments_Contrast(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new BasicAdjustmentsModule();

      // Create gradient image
      const width = 256, height = 256;
      const testImage = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const value = x / width;
          testImage[idx] = value;
          testImage[idx + 1] = value;
          testImage[idx + 2] = value;
          testImage[idx + 3] = 1.0;
        }
      }

      module.setParams({
        contrast: 50,
        saturation: 0,
        vibrance: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      // Increased contrast should make darks darker and brights brighter
      const inputRange = this.calculateRange(testImage);
      const outputRange = this.calculateRange(result);

      if (outputRange <= inputRange) {
        throw new Error('Contrast increase did not expand tonal range');
      }

      return {
        moduleName: 'BasicAdjustmentsModule',
        testName: 'Contrast Adjustment',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          inputRange: inputRange.toFixed(3),
          outputRange: outputRange.toFixed(3)
        }
      };

    } catch (error) {
      return {
        moduleName: 'BasicAdjustmentsModule',
        testName: 'Contrast Adjustment',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testBasicAdjustments_Saturation(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new BasicAdjustmentsModule();

      // Create colored image
      const width = 256, height = 256;
      const testImage = new Float32Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        testImage[idx] = 0.8;     // R
        testImage[idx + 1] = 0.3; // G
        testImage[idx + 2] = 0.3; // B
        testImage[idx + 3] = 1.0; // A
      }

      module.setParams({
        contrast: 0,
        saturation: 50,
        vibrance: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      // Increased saturation should increase color separation
      const inputColorSep = Math.abs(testImage[0] - testImage[1]);
      const outputColorSep = Math.abs(result[0] - result[1]);

      if (outputColorSep <= inputColorSep) {
        throw new Error('Saturation increase did not increase color separation');
      }

      return {
        moduleName: 'BasicAdjustmentsModule',
        testName: 'Saturation Adjustment',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        moduleName: 'BasicAdjustmentsModule',
        testName: 'Saturation Adjustment',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // NOISE REDUCTION MODULE TESTS
  // ============================================================================

  async testNoiseReduction_BM3D(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new NoiseReductionModule();

      // Create noisy image
      const width = 512, height = 512;
      const testImage = new Float32Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const noise = (Math.random() - 0.5) * 0.2;
        testImage[idx] = 0.5 + noise;
        testImage[idx + 1] = 0.5 + noise;
        testImage[idx + 2] = 0.5 + noise;
        testImage[idx + 3] = 1.0;
      }

      module.setParams({
        enabled: true,
        strength: 70,
        method: 'bm3d',
        preserveDetail: 70,
        chromaStrength: 70,
        lumaStrength: 70
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      // Denoising should reduce variance
      const inputVariance = this.calculateVariance(testImage);
      const outputVariance = this.calculateVariance(result);

      if (outputVariance >= inputVariance) {
        throw new Error('BM3D denoising did not reduce variance');
      }

      return {
        moduleName: 'NoiseReductionModule',
        testName: 'BM3D Denoising',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          inputVariance: inputVariance.toFixed(6),
          outputVariance: outputVariance.toFixed(6),
          reduction: ((1 - outputVariance / inputVariance) * 100).toFixed(1) + '%'
        }
      };

    } catch (error) {
      return {
        moduleName: 'NoiseReductionModule',
        testName: 'BM3D Denoising',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testNoiseReduction_NLMeans(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new NoiseReductionModule();

      const width = 512, height = 512;
      const testImage = new Float32Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const noise = (Math.random() - 0.5) * 0.2;
        testImage[idx] = 0.5 + noise;
        testImage[idx + 1] = 0.5 + noise;
        testImage[idx + 2] = 0.5 + noise;
        testImage[idx + 3] = 1.0;
      }

      module.setParams({
        enabled: true,
        strength: 70,
        method: 'nlmeans',
        preserveDetail: 70,
        chromaStrength: 70,
        lumaStrength: 70
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      const inputVariance = this.calculateVariance(testImage);
      const outputVariance = this.calculateVariance(result);

      if (outputVariance >= inputVariance) {
        throw new Error('NLMeans denoising did not reduce variance');
      }

      return {
        moduleName: 'NoiseReductionModule',
        testName: 'Non-Local Means Denoising',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          reduction: ((1 - outputVariance / inputVariance) * 100).toFixed(1) + '%'
        }
      };

    } catch (error) {
      return {
        moduleName: 'NoiseReductionModule',
        testName: 'Non-Local Means Denoising',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testNoiseReduction_AutoSelect(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new NoiseReductionModule();

      const width = 512, height = 512;
      const testImage = new Float32Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        testImage[idx] = Math.random();
        testImage[idx + 1] = Math.random();
        testImage[idx + 2] = Math.random();
        testImage[idx + 3] = 1.0;
      }

      module.setParams({
        enabled: true,
        strength: 70,
        method: 'auto',
        preserveDetail: 70,
        chromaStrength: 70,
        lumaStrength: 70
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      // Just verify it doesn't crash and produces valid output
      for (let i = 0; i < result.length; i++) {
        if (isNaN(result[i]) || !isFinite(result[i])) {
          throw new Error('Auto-select produced invalid values');
        }
      }

      return {
        moduleName: 'NoiseReductionModule',
        testName: 'Auto Method Selection',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        moduleName: 'NoiseReductionModule',
        testName: 'Auto Method Selection',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // COLOR BALANCE MODULE TESTS
  // ============================================================================

  async testColorBalance_ShadowShift(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new ColorBalanceModule();

      // Create dark image (shadows)
      const testImage = this.generateTestImage(256, 256, 0.2);

      module.setParams({
        enabled: true,
        shadowsRed: 50,
        shadowsGreen: 0,
        shadowsBlue: 0,
        midtonesRed: 0,
        midtonesGreen: 0,
        midtonesBlue: 0,
        highlightsRed: 0,
        highlightsGreen: 0,
        highlightsBlue: 0
      });

      const result = module.process(testImage, { width: 256, height: 256, channels: 4 });

      // Red in shadows should increase
      if (result[0] <= testImage[0]) {
        throw new Error('Shadow red adjustment did not increase red');
      }

      return {
        moduleName: 'ColorBalanceModule',
        testName: 'Shadow Color Shift',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        moduleName: 'ColorBalanceModule',
        testName: 'Shadow Color Shift',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  async testColorBalance_HighlightShift(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new ColorBalanceModule();

      // Create bright image (highlights)
      const testImage = this.generateTestImage(256, 256, 0.9);

      module.setParams({
        enabled: true,
        shadowsRed: 0,
        shadowsGreen: 0,
        shadowsBlue: 0,
        midtonesRed: 0,
        midtonesGreen: 0,
        midtonesBlue: 0,
        highlightsRed: 0,
        highlightsGreen: 50,
        highlightsBlue: 0
      });

      const result = module.process(testImage, { width: 256, height: 256, channels: 4 });

      // Green in highlights should increase
      if (result[1] <= testImage[1]) {
        throw new Error('Highlight green adjustment did not increase green');
      }

      return {
        moduleName: 'ColorBalanceModule',
        testName: 'Highlight Color Shift',
        passed: true,
        duration: performance.now() - startTime
      };

    } catch (error) {
      return {
        moduleName: 'ColorBalanceModule',
        testName: 'Highlight Color Shift',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // CROP MODULE TESTS
  // ============================================================================

  async testCrop_CenterCrop(): Promise<ModuleTestResult> {
    const startTime = performance.now();

    try {
      const module = new CropModule();

      const width = 1000, height = 1000;
      const testImage = this.generateTestImage(width, height, 0.5);

      module.setParams({
        enabled: true,
        x: 250,
        y: 250,
        width: 500,
        height: 500,
        aspectRatio: 'free',
        straightenAngle: 0
      });

      const result = module.process(testImage, { width, height, channels: 4 });

      // Cropped size should be smaller
      if (result.length >= testImage.length) {
        throw new Error('Crop did not reduce image size');
      }

      return {
        moduleName: 'CropModule',
        testName: 'Center Crop',
        passed: true,
        duration: performance.now() - startTime,
        details: {
          originalPixels: testImage.length / 4,
          croppedPixels: result.length / 4
        }
      };

    } catch (error) {
      return {
        moduleName: 'CropModule',
        testName: 'Center Crop',
        passed: false,
        duration: performance.now() - startTime,
        error: String(error)
      };
    }
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  private calculateRange(data: Float32Array): number {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length / 4; i++) {
      const luminance = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
    }
    return max - min;
  }

  private calculateVariance(data: Float32Array): number {
    let sum = 0, count = 0;
    for (let i = 0; i < data.length / 4; i++) {
      const luminance = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      sum += luminance;
      count++;
    }
    const mean = sum / count;

    let varianceSum = 0;
    for (let i = 0; i < data.length / 4; i++) {
      const luminance = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      varianceSum += Math.pow(luminance - mean, 2);
    }

    return varianceSum / count;
  }

  // ============================================================================
  // TEST RUNNER
  // ============================================================================

  async runAllTests(): Promise<ModuleTestSuite[]> {
    logger.info('🧪 Running module-specific tests...');
    this.results = [];

    const tests = [
      // Exposure Module
      () => this.testExposureModule_Basic(),
      () => this.testExposureModule_Disabled(),

      // White Balance Module
      () => this.testWhiteBalanceModule_WarmShift(),
      () => this.testWhiteBalanceModule_CoolShift(),

      // Basic Adjustments Module
      () => this.testBasicAdjustments_Contrast(),
      () => this.testBasicAdjustments_Saturation(),

      // Noise Reduction Module
      () => this.testNoiseReduction_BM3D(),
      () => this.testNoiseReduction_NLMeans(),
      () => this.testNoiseReduction_AutoSelect(),

      // Color Balance Module
      () => this.testColorBalance_ShadowShift(),
      () => this.testColorBalance_HighlightShift(),

      // Crop Module
      () => this.testCrop_CenterCrop()
    ];

    for (const test of tests) {
      const result = await test();
      this.results.push(result);
      logger.info(`  ${result.passed ? '✅' : '❌'} ${result.moduleName}: ${result.testName} (${result.duration.toFixed(2)}ms)`);
    }

    // Group by module
    const moduleGroups = new Map<string, ModuleTestResult[]>();
    for (const result of this.results) {
      if (!moduleGroups.has(result.moduleName)) {
        moduleGroups.set(result.moduleName, []);
      }
      moduleGroups.get(result.moduleName)!.push(result);
    }

    // Create suites
    const suites: ModuleTestSuite[] = [];
    for (const [moduleName, tests] of moduleGroups) {
      const passedTests = tests.filter(t => t.passed).length;
      const failedTests = tests.filter(t => !t.passed).length;

      suites.push({
        moduleName,
        tests,
        totalTests: tests.length,
        passedTests,
        failedTests,
        successRate: (passedTests / tests.length) * 100
      });
    }

    const totalPassed = this.results.filter(r => r.passed).length;
    logger.info(`\n✅ Module tests complete: ${totalPassed}/${this.results.length} passed`);

    return suites;
  }

  generateReport(): string {
    let report = '# Module Test Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    report += '## Summary\n\n';
    report += `- Total Tests: ${this.results.length}\n`;
    report += `- Passed: ${passed}\n`;
    report += `- Failed: ${failed}\n`;
    report += `- Success Rate: ${((passed / this.results.length) * 100).toFixed(1)}%\n\n`;

    report += '## Results by Module\n\n';

    const moduleGroups = new Map<string, ModuleTestResult[]>();
    for (const result of this.results) {
      if (!moduleGroups.has(result.moduleName)) {
        moduleGroups.set(result.moduleName, []);
      }
      moduleGroups.get(result.moduleName)!.push(result);
    }

    for (const [moduleName, tests] of moduleGroups) {
      const modulePassed = tests.filter(t => t.passed).length;
      report += `### ${moduleName} (${modulePassed}/${tests.length} passed)\n\n`;
      report += '| Test | Status | Duration (ms) |\n';
      report += '|------|--------|---------------|\n';

      for (const test of tests) {
        const status = test.passed ? '✅ PASS' : '❌ FAIL';
        report += `| ${test.testName} | ${status} | ${test.duration.toFixed(2)} |\n`;
      }

      report += '\n';
    }

    return report;
  }

  getResults(): ModuleTestResult[] {
    return this.results;
  }
}

export const moduleTests = ModuleTests.getInstance();
