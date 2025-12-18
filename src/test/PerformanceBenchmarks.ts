/**
 * Performance Benchmarking Framework
 *
 * Comprehensive benchmarking for all image processing modules.
 * Measures execution time, memory usage, and GPU utilization.
 */

import { logger } from '../utils/Logger';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { PerformanceWithMemory } from '../types/global';

export interface BenchmarkResult {
  moduleName: string;
  imageSize: string;
  executionTime: number;  // milliseconds
  memoryUsed: number;     // bytes
  successful: boolean;
  error?: string;
}

export interface BenchmarkSuite {
  suiteName: string;
  results: BenchmarkResult[];
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  stdDev: number;
}

export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export class PerformanceBenchmarks {
  private static instance: PerformanceBenchmarks;
  private results: Map<string, BenchmarkSuite> = new Map();

  private constructor() {
    logger.info('PerformanceBenchmarks initialized');
  }

  static getInstance(): PerformanceBenchmarks {
    if (!PerformanceBenchmarks.instance) {
      PerformanceBenchmarks.instance = new PerformanceBenchmarks();
    }
    return PerformanceBenchmarks.instance;
  }

  /**
   * Generate synthetic test image
   */
  generateTestImage(width: number, height: number): Float32Array {
    const data = new Float32Array(width * height * 4);

    // Generate gradient + noise pattern
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Gradient
        const gradientX = x / width;
        const gradientY = y / height;

        // Add some noise
        const noise = (Math.random() - 0.5) * 0.1;

        data[idx] = Math.max(0, Math.min(1, gradientX + noise));     // R
        data[idx + 1] = Math.max(0, Math.min(1, gradientY + noise)); // G
        data[idx + 2] = Math.max(0, Math.min(1, 0.5 + noise));       // B
        data[idx + 3] = 1.0;                                          // A
      }
    }

    return data;
  }

  /**
   * Get memory snapshot
   */
  private getMemorySnapshot(): MemorySnapshot {
    if (performance && (performance as PerformanceWithMemory).memory) {
      const mem = (performance as PerformanceWithMemory).memory!;
      return {
        timestamp: Date.now(),
        heapUsed: mem.usedJSHeapSize || 0,
        heapTotal: mem.totalJSHeapSize || 0,
        external: 0
      };
    }

    return {
      timestamp: Date.now(),
      heapUsed: 0,
      heapTotal: 0,
      external: 0
    };
  }

  /**
   * Benchmark a single module
   */
  async benchmarkModule(
    moduleName: string,
    imageWidth: number,
    imageHeight: number,
    iterations: number = 10
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const imageSize = `${imageWidth}x${imageHeight}`;

    logger.info(`Benchmarking ${moduleName} at ${imageSize} (${iterations} iterations)`);

    // Generate test image
    const testImage = this.generateTestImage(imageWidth, imageHeight);

    // Get module from pipeline
    const module = imageProcessingPipeline.getModule(moduleName);
    if (!module) {
      logger.error(`Module ${moduleName} not found`);
      return [];
    }

    // Run iterations
    for (let i = 0; i < iterations; i++) {
      const memBefore = this.getMemorySnapshot();
      const startTime = performance.now();

      try {
        // Process image
        const context = {
          width: imageWidth,
          height: imageHeight,
          channels: 4
        };

        module.process(testImage, context);

        const endTime = performance.now();
        const memAfter = this.getMemorySnapshot();

        const executionTime = endTime - startTime;
        const memoryUsed = memAfter.heapUsed - memBefore.heapUsed;

        results.push({
          moduleName,
          imageSize,
          executionTime,
          memoryUsed,
          successful: true
        });

        logger.debug(`  Iteration ${i + 1}: ${executionTime.toFixed(2)}ms`);

      } catch (error) {
        logger.error(`  Iteration ${i + 1} failed:`, error);
        results.push({
          moduleName,
          imageSize,
          executionTime: 0,
          memoryUsed: 0,
          successful: false,
          error: String(error)
        });
      }

      // Allow GC between iterations
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Benchmark entire pipeline
   */
  async benchmarkPipeline(
    imageWidth: number,
    imageHeight: number,
    iterations: number = 10
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const imageSize = `${imageWidth}x${imageHeight}`;

    logger.info(`Benchmarking full pipeline at ${imageSize} (${iterations} iterations)`);

    for (let i = 0; i < iterations; i++) {
      const testImage = this.generateTestImage(imageWidth, imageHeight);
      const memBefore = this.getMemorySnapshot();
      const startTime = performance.now();

      try {
        // Process through entire pipeline
        await imageProcessingPipeline.processImage(testImage, { width: imageWidth, height: imageHeight, channels: 4 });

        const endTime = performance.now();
        const memAfter = this.getMemorySnapshot();

        const executionTime = endTime - startTime;
        const memoryUsed = memAfter.heapUsed - memBefore.heapUsed;

        results.push({
          moduleName: 'full-pipeline',
          imageSize,
          executionTime,
          memoryUsed,
          successful: true
        });

        logger.debug(`  Pipeline iteration ${i + 1}: ${executionTime.toFixed(2)}ms`);

      } catch (error) {
        logger.error(`  Pipeline iteration ${i + 1} failed:`, error);
        results.push({
          moduleName: 'full-pipeline',
          imageSize,
          executionTime: 0,
          memoryUsed: 0,
          successful: false,
          error: String(error)
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Calculate statistics from benchmark results
   */
  calculateStatistics(results: BenchmarkResult[]): BenchmarkSuite {
    const successfulResults = results.filter(r => r.successful);
    const times = successfulResults.map(r => r.executionTime);

    const totalTime = times.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / times.length;

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // Calculate standard deviation
    const squaredDiffs = times.map(time => Math.pow(time - averageTime, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / times.length;
    const stdDev = Math.sqrt(variance);

    return {
      suiteName: results[0]?.moduleName || 'unknown',
      results,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      stdDev
    };
  }

  /**
   * Run comprehensive benchmark suite
   */
  async runComprehensiveSuite(): Promise<Map<string, BenchmarkSuite>> {
    logger.info('🚀 Running comprehensive benchmark suite...');

    const testSizes = [
      { width: 1920, height: 1080, name: '2MP (1080p)' },
      { width: 2560, height: 1440, name: '4MP (1440p)' },
      { width: 4000, height: 3000, name: '12MP' },
      { width: 6000, height: 4000, name: '24MP' }
    ];

    const modules = [
      'crop',
      'exposure',
      'temperature',
      'basicadj',
      'tonecurve',
      'colorbalance',
      'shadowshighlights',
      'noise-reduction'
    ];

    const suiteResults = new Map<string, BenchmarkSuite>();

    // Benchmark each module at different sizes
    for (const size of testSizes) {
      for (const moduleName of modules) {
        const results = await this.benchmarkModule(moduleName, size.width, size.height, 5);
        const stats = this.calculateStatistics(results);
        const key = `${moduleName}-${size.name}`;
        suiteResults.set(key, stats);

        logger.info(`  ${moduleName} @ ${size.name}: avg=${stats.averageTime.toFixed(2)}ms, stddev=${stats.stdDev.toFixed(2)}ms`);
      }
    }

    // Benchmark full pipeline
    for (const size of testSizes) {
      const results = await this.benchmarkPipeline(size.width, size.height, 5);
      const stats = this.calculateStatistics(results);
      const key = `pipeline-${size.name}`;
      suiteResults.set(key, stats);

      logger.info(`  Full pipeline @ ${size.name}: avg=${stats.averageTime.toFixed(2)}ms`);
    }

    this.results = suiteResults;
    logger.info('✅ Benchmark suite complete');

    return suiteResults;
  }

  /**
   * Export results to JSON
   */
  exportResults(): string {
    interface ExportedSuiteResult {
      suiteName: string;
      averageTime: number;
      minTime: number;
      maxTime: number;
      stdDev: number;
      totalIterations: number;
      successRate: number;
    }
    const resultsObj: Record<string, ExportedSuiteResult> = {};

    for (const [key, suite] of this.results) {
      resultsObj[key] = {
        suiteName: suite.suiteName,
        averageTime: suite.averageTime,
        minTime: suite.minTime,
        maxTime: suite.maxTime,
        stdDev: suite.stdDev,
        totalIterations: suite.results.length,
        successRate: (suite.results.filter(r => r.successful).length / suite.results.length) * 100
      };
    }

    return JSON.stringify(resultsObj, null, 2);
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    let report = '# Performance Benchmark Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += '## Summary\n\n';
    report += '| Module | Image Size | Avg Time (ms) | Min (ms) | Max (ms) | Std Dev (ms) |\n';
    report += '|--------|-----------|---------------|----------|----------|-------------|\n';

    for (const [key, suite] of this.results) {
      const imageSize = key.split('-').slice(1).join('-');
      report += `| ${suite.suiteName} | ${imageSize} | ${suite.averageTime.toFixed(2)} | ${suite.minTime.toFixed(2)} | ${suite.maxTime.toFixed(2)} | ${suite.stdDev.toFixed(2)} |\n`;
    }

    report += '\n## Performance Targets\n\n';
    report += '| Image Size | Target | Status |\n';
    report += '|-----------|--------|--------|\n';

    const targets = [
      { size: '12MP', target: 200 },
      { size: '24MP', target: 400 }
    ];

    for (const target of targets) {
      const pipelineKey = `pipeline-${target.size}`;
      const suite = this.results.get(pipelineKey);

      if (suite) {
        const status = suite.averageTime < target.target ? '✅ PASS' : '❌ FAIL';
        report += `| ${target.size} | < ${target.target}ms | ${status} (${suite.averageTime.toFixed(2)}ms) |\n`;
      }
    }

    return report;
  }

  /**
   * Get results
   */
  getResults(): Map<string, BenchmarkSuite> {
    return this.results;
  }
}

export const performanceBenchmarks = PerformanceBenchmarks.getInstance();
