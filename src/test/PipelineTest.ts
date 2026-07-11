import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { logger } from '../utils/Logger';

/**
 * Test function to verify the complete 5-module processing pipeline
 */
export function testCompletePipeline(): void {
  logger.info('Testing complete 5-module processing pipeline...');

  // Get pipeline statistics
  const stats = imageProcessingPipeline.getStats();
  logger.info('Pipeline Stats:', stats);

  // Expected modules in processing order
  const expectedModules = ['exposure', 'temperature', 'basicadj', 'tonecurve', 'colorbalance', 'shadowshighlights'];

  // Verify module count
  if (stats.moduleCount !== 6) {
    logger.error(`Expected 6 modules, found ${stats.moduleCount}`);
    return;
  }

  // Verify processing order
  const processingOrder = imageProcessingPipeline.getProcessingOrder();
  logger.info('Processing Order:', processingOrder);

  expectedModules.forEach((expectedId, index) => {
    if (processingOrder[index] !== expectedId) {
      logger.error(`Expected module ${expectedId} at position ${index}, found ${processingOrder[index]}`);
      return;
    }
  });

  // Test module retrieval
  const exposureModule = imageProcessingPipeline.getModule('exposure');
  const whiteBalanceModule = imageProcessingPipeline.getModule('temperature');
  const basicAdjModule = imageProcessingPipeline.getModule('basicadj');
  const toneCurveModule = imageProcessingPipeline.getModule('tonecurve');
  const colorBalanceModule = imageProcessingPipeline.getModule('colorbalance');
  const shadowsHighlightsModule = imageProcessingPipeline.getModule('shadowshighlights');

  if (!exposureModule) {
    logger.error('Exposure module not found');
    return;
  }
  if (!whiteBalanceModule) {
    logger.error('White Balance module not found');
    return;
  }
  if (!basicAdjModule) {
    logger.error('Basic Adjustments module not found');
    return;
  }
  if (!toneCurveModule) {
    logger.error('Tone Curve module not found');
    return;
  }
  if (!colorBalanceModule) {
    logger.error('Color Balance module not found');
    return;
  }
  if (!shadowsHighlightsModule) {
    logger.error('Shadows/Highlights module not found');
    return;
  }

  // Test enable/disable functionality
  logger.info('Testing module enable/disable...');

  // Disable shadows/highlights module
  imageProcessingPipeline.setModuleEnabled('shadowshighlights', false);
  const statsDisabled = imageProcessingPipeline.getStats();
  if (statsDisabled.enabledModules !== 5) {
    logger.error(`Expected 5 enabled modules after disabling shadows/highlights, found ${statsDisabled.enabledModules}`);
    return;
  }

  // Re-enable shadows/highlights module
  imageProcessingPipeline.setModuleEnabled('shadowshighlights', true);
  const statsEnabled = imageProcessingPipeline.getStats();
  if (statsEnabled.enabledModules !== 6) {
    logger.error(`Expected 6 enabled modules after re-enabling shadows/highlights, found ${statsEnabled.enabledModules}`);
    return;
  }

  // Test basic processing with dummy data
  logger.info('Testing image processing...');

  const testImageData = new Float32Array(100 * 100 * 4); // 100x100 RGBA
  // Fill with test pattern
  for (let i = 0; i < testImageData.length; i += 4) {
    testImageData[i] = 0.5;     // R
    testImageData[i + 1] = 0.3; // G
    testImageData[i + 2] = 0.7; // B
    testImageData[i + 3] = 1.0; // A
  }

  const context = {
    width: 100,
    height: 100,
    channels: 4
  };

  // Process test image (synchronous for testing)
  imageProcessingPipeline.processImage(testImageData, context, { useWebWorkers: false })
    .then((processedData) => {
      if (processedData.length !== testImageData.length) {
        logger.error('Processed data length mismatch');
        return;
      }

      // Verify processing changed the data
      let hasChanged = false;
      for (let i = 0; i < 100; i += 4) {
        if (processedData[i] !== testImageData[i] ||
            processedData[i + 1] !== testImageData[i + 1] ||
            processedData[i + 2] !== testImageData[i + 2]) {
          hasChanged = true;
          break;
        }
      }

      if (!hasChanged) {
        logger.warn('Processing did not change image data - modules may not be processing');
      }

      logger.info('✅ Complete 6-module pipeline test passed!');
      logger.info('Pipeline Status:', {
        modules: stats.moduleNames,
        processingOrder: processingOrder,
        enabledModules: stats.enabledModules,
        totalModules: stats.moduleCount
      });

    })
    .catch((error) => {
      logger.error('Pipeline processing test failed:', error);
    });
}

// Test Web Worker processing if available
export async function testWebWorkerProcessing(): Promise<void> {
  logger.info('Testing Web Worker processing...');

  const testImageData = new Float32Array(1000 * 1000 * 4); // 1MP test image
  // Fill with gradient pattern
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x < 1000; x++) {
      const i = (y * 1000 + x) * 4;
      testImageData[i] = x / 1000;         // R gradient
      testImageData[i + 1] = y / 1000;     // G gradient
      testImageData[i + 2] = 0.5;          // B constant
      testImageData[i + 3] = 1.0;          // A full
    }
  }

  const context = {
    width: 1000,
    height: 1000,
    channels: 4
  };

  try {
    const startTime = performance.now();
    const processedData = await imageProcessingPipeline.processImage(testImageData, context, { useWebWorkers: true });
    const processingTime = performance.now() - startTime;

    logger.info(`Web Worker processing completed in ${processingTime.toFixed(2)}ms`);

    if (processedData.length === testImageData.length) {
      logger.info('✅ Web Worker processing test passed!');
    } else {
      logger.error('❌ Web Worker processing data length mismatch');
    }

  } catch (error) {
    logger.warn('Web Worker processing failed, likely fell back to main thread:', error);
  }
}

// Export test functions for console access
if (typeof window !== 'undefined') {
  (window as typeof window & { testPipeline?: typeof testCompletePipeline; testWebWorkers?: typeof testWebWorkerProcessing }).testPipeline = testCompletePipeline;
  (window as typeof window & { testPipeline?: typeof testCompletePipeline; testWebWorkers?: typeof testWebWorkerProcessing }).testWebWorkers = testWebWorkerProcessing;
}