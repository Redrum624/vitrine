/**
 * Test Execution Entry Point
 *
 * Runs the comprehensive test suite for the photo editing application.
 * This script executes all tests and generates detailed reports.
 *
 * Usage:
 *   npm run test              - Run all tests
 *   npm run test:benchmark    - Run only benchmarks
 *   npm run test:integration  - Run only integration tests
 *   npm run test:module       - Run only module tests
 */

import { testRunner } from './TestRunner';
import { performanceBenchmarks } from './PerformanceBenchmarks';
import { integrationTests } from './IntegrationTests';
import { moduleTests } from './ModuleTests';
import { logger } from '../utils/Logger';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main test execution function
 */
async function runAllTests(): Promise<void> {
  try {
    logger.info('');
    logger.info('╔═══════════════════════════════════════════════════════╗');
    logger.info('║    PHOTO EDITING APP - COMPREHENSIVE TEST SUITE      ║');
    logger.info('╚═══════════════════════════════════════════════════════╝');
    logger.info('');

    // Run all tests
    const results = await testRunner.runAllTests();

    // Generate reports
    const markdownReport = testRunner.generateMarkdownReport(results);
    const jsonReport = testRunner.exportResultsJSON(results);

    // Save reports to disk
    const reportsDir = path.join(__dirname, '../../test-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mdPath = path.join(reportsDir, `test-report-${timestamp}.md`);
    const jsonPath = path.join(reportsDir, `test-results-${timestamp}.json`);

    fs.writeFileSync(mdPath, markdownReport);
    fs.writeFileSync(jsonPath, jsonReport);

    logger.info('');
    logger.info('📄 Reports saved:');
    logger.info(`   Markdown: ${mdPath}`);
    logger.info(`   JSON: ${jsonPath}`);
    logger.info('');

    // Exit with appropriate code
    if (results.overallSuccess) {
      logger.info('✅ All tests passed! Exiting with code 0');
      process.exit(0);
    } else {
      logger.error('❌ Some tests failed! Exiting with code 1');
      process.exit(1);
    }

  } catch (error) {
    logger.error('💥 Test execution failed with error:', error);
    process.exit(1);
  }
}

/**
 * Run only performance benchmarks
 */
async function runBenchmarksOnly(): Promise<void> {
  try {
    logger.info('📊 Running performance benchmarks only...');
    await performanceBenchmarks.runComprehensiveSuite();

    const report = performanceBenchmarks.generateReport();
    logger.info('');
    logger.info(report);

    const jsonResults = performanceBenchmarks.exportResults();

    const reportsDir = path.join(__dirname, '../../test-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(reportsDir, `benchmark-results-${timestamp}.json`);
    fs.writeFileSync(jsonPath, jsonResults);

    logger.info(`📄 Benchmark results saved: ${jsonPath}`);
    process.exit(0);

  } catch (error) {
    logger.error('Benchmark execution failed:', error);
    process.exit(1);
  }
}

/**
 * Run only integration tests
 */
async function runIntegrationOnly(): Promise<void> {
  try {
    logger.info('🔗 Running integration tests only...');
    const suite = await integrationTests.runAllTests();

    const report = integrationTests.generateReport();
    logger.info('');
    logger.info(report);

    if (suite.successRate === 100) {
      logger.info('✅ All integration tests passed!');
      process.exit(0);
    } else {
      logger.error('❌ Some integration tests failed!');
      process.exit(1);
    }

  } catch (error) {
    logger.error('Integration test execution failed:', error);
    process.exit(1);
  }
}

/**
 * Run only module tests
 */
async function runModuleTestsOnly(): Promise<void> {
  try {
    logger.info('🧩 Running module tests only...');
    const suites = await moduleTests.runAllTests();

    const report = moduleTests.generateReport();
    logger.info('');
    logger.info(report);

    const allPassed = suites.every(s => s.successRate === 100);
    if (allPassed) {
      logger.info('✅ All module tests passed!');
      process.exit(0);
    } else {
      logger.error('❌ Some module tests failed!');
      process.exit(1);
    }

  } catch (error) {
    logger.error('Module test execution failed:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args[0] || 'all';

// Execute based on mode
switch (mode) {
  case 'benchmark':
  case 'benchmarks':
    runBenchmarksOnly();
    break;

  case 'integration':
    runIntegrationOnly();
    break;

  case 'module':
  case 'modules':
    runModuleTestsOnly();
    break;

  case 'all':
  default:
    runAllTests();
    break;
}
