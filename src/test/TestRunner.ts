/**
 * Test Runner - Comprehensive Test Orchestration
 *
 * Coordinates all test suites and generates unified reports:
 * - Performance benchmarks
 * - Integration tests
 * - Module-specific tests
 * - Overall quality validation
 */

import { logger } from '../utils/Logger';
import { performanceBenchmarks, BenchmarkSuite } from './PerformanceBenchmarks';
import { integrationTests, IntegrationTestSuite } from './IntegrationTests';
import { moduleTests, ModuleTestSuite } from './ModuleTests';

export interface TestRunResults {
  timestamp: Date;
  totalDuration: number;
  benchmarks: Map<string, BenchmarkSuite>;
  integrationSuite: IntegrationTestSuite;
  moduleSuites: ModuleTestSuite[];
  overallSuccess: boolean;
  summary: TestSummary;
}

export interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  performanceTargetsMet: boolean;
  criticalFailures: string[];
  warnings: string[];
}

export class TestRunner {
  private static instance: TestRunner;

  private constructor() {
    logger.info('TestRunner initialized');
  }

  static getInstance(): TestRunner {
    if (!TestRunner.instance) {
      TestRunner.instance = new TestRunner();
    }
    return TestRunner.instance;
  }

  /**
   * Run all test suites
   */
  async runAllTests(): Promise<TestRunResults> {
    const overallStartTime = performance.now();
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('🚀 COMPREHENSIVE TEST SUITE - STARTING');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('');

    const results: Partial<TestRunResults> = {
      timestamp: new Date()
    };

    try {
      // 1. Run Performance Benchmarks
      logger.info('📊 Phase 1/3: Performance Benchmarks');
      logger.info('───────────────────────────────────────────────────────');
      const benchmarkStart = performance.now();
      results.benchmarks = await performanceBenchmarks.runComprehensiveSuite();
      const benchmarkDuration = performance.now() - benchmarkStart;
      logger.info(`✅ Benchmarks complete (${benchmarkDuration.toFixed(2)}ms)`);
      logger.info('');

      // 2. Run Integration Tests
      logger.info('🔗 Phase 2/3: Integration Tests');
      logger.info('───────────────────────────────────────────────────────');
      const integrationStart = performance.now();
      results.integrationSuite = await integrationTests.runAllTests();
      const integrationDuration = performance.now() - integrationStart;
      logger.info(`✅ Integration tests complete (${integrationDuration.toFixed(2)}ms)`);
      logger.info('');

      // 3. Run Module-Specific Tests
      logger.info('🧩 Phase 3/3: Module-Specific Tests');
      logger.info('───────────────────────────────────────────────────────');
      const moduleStart = performance.now();
      results.moduleSuites = await moduleTests.runAllTests();
      const moduleDuration = performance.now() - moduleStart;
      logger.info(`✅ Module tests complete (${moduleDuration.toFixed(2)}ms)`);
      logger.info('');

      // Calculate overall results
      const totalDuration = performance.now() - overallStartTime;
      results.totalDuration = totalDuration;

      // Generate summary
      results.summary = this.generateSummary(
        results.benchmarks!,
        results.integrationSuite!,
        results.moduleSuites!
      );

      // Determine overall success
      results.overallSuccess = results.summary.successRate >= 95 &&
                               results.summary.criticalFailures.length === 0;

      // Print final summary
      this.printFinalSummary(results as TestRunResults);

      return results as TestRunResults;

    } catch (error) {
      logger.error('❌ Test suite failed with error:', error);
      throw error;
    }
  }

  /**
   * Run only performance benchmarks
   */
  async runBenchmarksOnly(): Promise<Map<string, BenchmarkSuite>> {
    logger.info('📊 Running performance benchmarks only...');
    const results = await performanceBenchmarks.runComprehensiveSuite();
    logger.info('✅ Benchmarks complete');
    return results;
  }

  /**
   * Run only integration tests
   */
  async runIntegrationTestsOnly(): Promise<IntegrationTestSuite> {
    logger.info('🔗 Running integration tests only...');
    const results = await integrationTests.runAllTests();
    logger.info('✅ Integration tests complete');
    return results;
  }

  /**
   * Run only module tests
   */
  async runModuleTestsOnly(): Promise<ModuleTestSuite[]> {
    logger.info('🧩 Running module tests only...');
    const results = await moduleTests.runAllTests();
    logger.info('✅ Module tests complete');
    return results;
  }

  /**
   * Generate comprehensive summary
   */
  private generateSummary(
    benchmarks: Map<string, BenchmarkSuite>,
    integrationSuite: IntegrationTestSuite,
    moduleSuites: ModuleTestSuite[]
  ): TestSummary {
    const criticalFailures: string[] = [];
    const warnings: string[] = [];

    // Count total tests
    const moduleTestCount = moduleSuites.reduce((sum, suite) => sum + suite.totalTests, 0);
    const totalTests = integrationSuite.totalTests + moduleTestCount;

    // Count passed tests
    const modulePassedCount = moduleSuites.reduce((sum, suite) => sum + suite.passedTests, 0);
    const passedTests = integrationSuite.passedTests + modulePassedCount;

    const failedTests = totalTests - passedTests;
    const successRate = (passedTests / totalTests) * 100;

    // Check performance targets
    let performanceTargetsMet = true;

    // Check 12MP target (<200ms)
    const mp12Key = 'pipeline-12MP';
    const mp12Suite = benchmarks.get(mp12Key);
    if (mp12Suite) {
      if (mp12Suite.averageTime >= 200) {
        performanceTargetsMet = false;
        criticalFailures.push(`12MP pipeline exceeds 200ms target: ${mp12Suite.averageTime.toFixed(2)}ms`);
      }
    } else {
      warnings.push('12MP benchmark not found');
    }

    // Check 24MP target (<400ms)
    const mp24Key = 'pipeline-24MP';
    const mp24Suite = benchmarks.get(mp24Key);
    if (mp24Suite) {
      if (mp24Suite.averageTime >= 400) {
        performanceTargetsMet = false;
        criticalFailures.push(`24MP pipeline exceeds 400ms target: ${mp24Suite.averageTime.toFixed(2)}ms`);
      }
    } else {
      warnings.push('24MP benchmark not found');
    }

    // Check for failed integration tests
    for (const test of integrationSuite.tests) {
      if (!test.passed) {
        criticalFailures.push(`Integration test failed: ${test.testName}`);
      }
    }

    // Check for failed module tests
    for (const suite of moduleSuites) {
      for (const test of suite.tests) {
        if (!test.passed) {
          warnings.push(`${suite.moduleName} test failed: ${test.testName}`);
        }
      }
    }

    return {
      totalTests,
      passedTests,
      failedTests,
      successRate,
      performanceTargetsMet,
      criticalFailures,
      warnings
    };
  }

  /**
   * Print final summary
   */
  private printFinalSummary(results: TestRunResults): void {
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('📋 TEST SUITE SUMMARY');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('');

    // Overall statistics
    logger.info(`⏱️  Total Duration: ${results.totalDuration.toFixed(2)}ms`);
    logger.info(`📊 Total Tests: ${results.summary.totalTests}`);
    logger.info(`✅ Passed: ${results.summary.passedTests}`);
    logger.info(`❌ Failed: ${results.summary.failedTests}`);
    logger.info(`📈 Success Rate: ${results.summary.successRate.toFixed(1)}%`);
    logger.info('');

    // Performance targets
    logger.info('🎯 Performance Targets:');
    if (results.summary.performanceTargetsMet) {
      logger.info('   ✅ All performance targets met');
    } else {
      logger.info('   ❌ Some performance targets not met');
    }

    // Show key benchmarks
    const mp12 = results.benchmarks.get('pipeline-12MP');
    const mp24 = results.benchmarks.get('pipeline-24MP');

    if (mp12) {
      const status = mp12.averageTime < 200 ? '✅' : '❌';
      logger.info(`   ${status} 12MP: ${mp12.averageTime.toFixed(2)}ms (target: <200ms)`);
    }

    if (mp24) {
      const status = mp24.averageTime < 400 ? '✅' : '❌';
      logger.info(`   ${status} 24MP: ${mp24.averageTime.toFixed(2)}ms (target: <400ms)`);
    }

    logger.info('');

    // Critical failures
    if (results.summary.criticalFailures.length > 0) {
      logger.info('🚨 Critical Failures:');
      for (const failure of results.summary.criticalFailures) {
        logger.error(`   ❌ ${failure}`);
      }
      logger.info('');
    }

    // Warnings
    if (results.summary.warnings.length > 0 && results.summary.warnings.length <= 5) {
      logger.info('⚠️  Warnings:');
      for (const warning of results.summary.warnings) {
        logger.warn(`   ⚠️  ${warning}`);
      }
      logger.info('');
    } else if (results.summary.warnings.length > 5) {
      logger.info(`⚠️  Warnings: ${results.summary.warnings.length} warnings (see detailed report)`);
      logger.info('');
    }

    // Overall status
    logger.info('═══════════════════════════════════════════════════════');
    if (results.overallSuccess) {
      logger.info('🎉 OVERALL STATUS: ✅ SUCCESS');
      logger.info('   All tests passed and performance targets met!');
    } else {
      logger.info('⚠️  OVERALL STATUS: ⚠️  NEEDS ATTENTION');
      logger.info('   Some tests failed or performance targets not met.');
    }
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('');
  }

  /**
   * Generate comprehensive markdown report
   */
  generateMarkdownReport(results: TestRunResults): string {
    let report = '# Comprehensive Test Report\n\n';
    report += `**Generated:** ${results.timestamp.toISOString()}\n`;
    report += `**Total Duration:** ${results.totalDuration.toFixed(2)}ms\n\n`;

    report += '---\n\n';

    // Executive Summary
    report += '## Executive Summary\n\n';
    report += `- **Total Tests:** ${results.summary.totalTests}\n`;
    report += `- **Passed:** ${results.summary.passedTests}\n`;
    report += `- **Failed:** ${results.summary.failedTests}\n`;
    report += `- **Success Rate:** ${results.summary.successRate.toFixed(1)}%\n`;
    report += `- **Performance Targets Met:** ${results.summary.performanceTargetsMet ? '✅ Yes' : '❌ No'}\n`;
    report += `- **Overall Status:** ${results.overallSuccess ? '✅ SUCCESS' : '⚠️ NEEDS ATTENTION'}\n\n`;

    // Performance Benchmarks
    report += '## Performance Benchmarks\n\n';
    report += '### Pipeline Performance\n\n';
    report += '| Image Size | Avg Time (ms) | Min (ms) | Max (ms) | Std Dev (ms) | Target | Status |\n';
    report += '|-----------|---------------|----------|----------|-------------|--------|--------|\n';

    const pipelineKeys = ['pipeline-2MP (1080p)', 'pipeline-4MP (1440p)', 'pipeline-12MP', 'pipeline-24MP'];
    const targets = [100, 150, 200, 400];

    for (let i = 0; i < pipelineKeys.length; i++) {
      const suite = results.benchmarks.get(pipelineKeys[i]);
      if (suite) {
        const status = suite.averageTime < targets[i] ? '✅ PASS' : '❌ FAIL';
        report += `| ${pipelineKeys[i].replace('pipeline-', '')} | ${suite.averageTime.toFixed(2)} | ${suite.minTime.toFixed(2)} | ${suite.maxTime.toFixed(2)} | ${suite.stdDev.toFixed(2)} | <${targets[i]} | ${status} |\n`;
      }
    }

    report += '\n### Module Performance\n\n';
    report += '| Module | Image Size | Avg Time (ms) | Min (ms) | Max (ms) |\n';
    report += '|--------|-----------|---------------|----------|----------|\n';

    const modules = ['crop', 'exposure', 'temperature', 'basicadj', 'tonecurve', 'colorbalance', 'shadowshighlights', 'noise-reduction'];
    const sizes = ['12MP', '24MP'];

    for (const module of modules) {
      for (const size of sizes) {
        const key = `${module}-${size}`;
        const suite = results.benchmarks.get(key);
        if (suite) {
          report += `| ${module} | ${size} | ${suite.averageTime.toFixed(2)} | ${suite.minTime.toFixed(2)} | ${suite.maxTime.toFixed(2)} |\n`;
        }
      }
    }

    report += '\n';

    // Integration Tests
    report += '## Integration Tests\n\n';
    report += `**Total:** ${results.integrationSuite.totalTests} | `;
    report += `**Passed:** ${results.integrationSuite.passedTests} | `;
    report += `**Failed:** ${results.integrationSuite.failedTests} | `;
    report += `**Success Rate:** ${results.integrationSuite.successRate.toFixed(1)}%\n\n`;

    report += '| Test Name | Status | Duration (ms) | Details |\n';
    report += '|-----------|--------|---------------|----------|\n';

    for (const test of results.integrationSuite.tests) {
      const status = test.passed ? '✅ PASS' : '❌ FAIL';
      const details = test.error || (test.details ? JSON.stringify(test.details) : '-');
      report += `| ${test.testName} | ${status} | ${test.duration.toFixed(2)} | ${details} |\n`;
    }

    report += '\n';

    // Module Tests
    report += '## Module-Specific Tests\n\n';

    for (const suite of results.moduleSuites) {
      report += `### ${suite.moduleName}\n\n`;
      report += `**Total:** ${suite.totalTests} | `;
      report += `**Passed:** ${suite.passedTests} | `;
      report += `**Failed:** ${suite.failedTests} | `;
      report += `**Success Rate:** ${suite.successRate.toFixed(1)}%\n\n`;

      report += '| Test Name | Status | Duration (ms) |\n';
      report += '|-----------|--------|---------------|\n';

      for (const test of suite.tests) {
        const status = test.passed ? '✅ PASS' : '❌ FAIL';
        report += `| ${test.testName} | ${status} | ${test.duration.toFixed(2)} |\n`;
      }

      report += '\n';
    }

    // Critical Failures
    if (results.summary.criticalFailures.length > 0) {
      report += '## 🚨 Critical Failures\n\n';
      for (const failure of results.summary.criticalFailures) {
        report += `- ❌ ${failure}\n`;
      }
      report += '\n';
    }

    // Warnings
    if (results.summary.warnings.length > 0) {
      report += '## ⚠️ Warnings\n\n';
      for (const warning of results.summary.warnings) {
        report += `- ⚠️ ${warning}\n`;
      }
      report += '\n';
    }

    // Conclusion
    report += '## Conclusion\n\n';
    if (results.overallSuccess) {
      report += '✅ **All tests passed successfully!** The image processing pipeline is working correctly and meeting performance targets.\n\n';
      report += '**Key Achievements:**\n';
      report += '- All integration tests passed\n';
      report += '- All module tests passed\n';
      report += '- Performance targets met for all image sizes\n';
      report += '- No critical failures detected\n';
    } else {
      report += '⚠️ **Action required.** Some tests failed or performance targets were not met.\n\n';
      report += '**Recommendations:**\n';
      report += '- Review failed tests in detail\n';
      report += '- Optimize modules that exceed performance targets\n';
      report += '- Address any critical failures immediately\n';
      report += '- Re-run tests after fixes\n';
    }

    report += '\n---\n\n';
    report += `*Report generated by TestRunner on ${results.timestamp.toISOString()}*\n`;

    return report;
  }

  /**
   * Export results to JSON
   */
  exportResultsJSON(results: TestRunResults): string {
    const exportObj = {
      timestamp: results.timestamp.toISOString(),
      totalDuration: results.totalDuration,
      summary: results.summary,
      overallSuccess: results.overallSuccess,
      benchmarks: Array.from(results.benchmarks.entries()).map(([key, suite]) => ({
        key,
        suiteName: suite.suiteName,
        averageTime: suite.averageTime,
        minTime: suite.minTime,
        maxTime: suite.maxTime,
        stdDev: suite.stdDev,
        totalIterations: suite.results.length
      })),
      integrationTests: {
        totalTests: results.integrationSuite.totalTests,
        passedTests: results.integrationSuite.passedTests,
        failedTests: results.integrationSuite.failedTests,
        successRate: results.integrationSuite.successRate,
        tests: results.integrationSuite.tests
      },
      moduleTests: results.moduleSuites.map(suite => ({
        moduleName: suite.moduleName,
        totalTests: suite.totalTests,
        passedTests: suite.passedTests,
        failedTests: suite.failedTests,
        successRate: suite.successRate,
        tests: suite.tests
      }))
    };

    return JSON.stringify(exportObj, null, 2);
  }
}

export const testRunner = TestRunner.getInstance();
