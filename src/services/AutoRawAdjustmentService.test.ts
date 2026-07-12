/**
 * Unit tests for AutoRawAdjustmentService dehaze wiring.
 *
 * Focused on the previously-broken path: the auto-computed dehaze value must now
 * reach the BasicAdjustments module via applyParametersToPipeline (the old code
 * had a "skipping dehaze" comment and dropped it). RAW service dependencies are
 * mocked so the test stays a pure unit test in jsdom.
 */

// Mock the logger to keep test output clean.
jest.mock('../utils/Logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the heavy service dependencies pulled in at module load so importing the
// service under test does not initialize GPU/WebGL/worker code in jsdom.
jest.mock('./RawImageService', () => ({
  rawImageService: {
    isRawFile: jest.fn(),
    loadRawImageWithHistogram: jest.fn(),
    analyzeImageExposure: jest.fn(),
  },
}));

import { AutoRawAdjustmentService } from './AutoRawAdjustmentService';

// Minimal structural type so we can call the private method without `any`.
type PipelineLike = {
  getModule: (id: string) => unknown;
  setModuleEnabled: (id: string, enabled: boolean) => void;
};

describe('AutoRawAdjustmentService - dehaze wiring', () => {
  it('forwards basicAdjustments.dehaze to the basicadj module setParams', () => {
    const service = AutoRawAdjustmentService.getInstance();

    const setParams = jest.fn();
    const basicModule = { setParams };
    const setModuleEnabled = jest.fn();

    const pipeline: PipelineLike = {
      getModule: (id: string) => (id === 'basicadj' ? basicModule : null),
      setModuleEnabled,
    };

    const params = {
      exposure: {},
      whiteBalance: {},
      basicAdjustments: { contrast: 0.2, dehaze: 0.3 },
      shadowsHighlights: {},
    };

    // applyParametersToPipeline is private; cast through unknown to invoke it.
    (service as unknown as {
      applyParametersToPipeline: (p: typeof params, pipe: PipelineLike) => void;
    }).applyParametersToPipeline(params, pipeline);

    expect(setParams).toHaveBeenCalledTimes(1);
    const passed = setParams.mock.calls[0][0];
    expect(passed).toEqual(expect.objectContaining({ dehaze: 0.3, contrast: 0.2 }));
    expect(setModuleEnabled).toHaveBeenCalledWith('basicadj', true);
  });
});
