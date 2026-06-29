// src/test/enhanceRegistration.test.ts
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import { EnhanceModule } from '../modules/EnhanceModule';

describe('enhance registration', () => {
  it('registers the enhance module and not sharpen', () => {
    expect(imageProcessingPipeline.getModule('enhance')).toBeInstanceOf(EnhanceModule);
    expect(imageProcessingPipeline.getModule('sharpen')).toBeUndefined();
    expect(imageProcessingPipeline.getStats().processingOrder).toContain('enhance');
  });
});
