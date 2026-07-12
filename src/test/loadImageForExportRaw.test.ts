/**
 * Regression test for the corrupted-RAW-export bug: loadImageForExport must
 * decode RAW files at FULL resolution (via the RAW decoder), not pull the tiny
 * embedded preview through the `read-image-as-data-url` thumbnail IPC (which
 * produced a ~300×200 image that the full-res pipeline scrambled).
 */
const isRawFile = jest.fn();
const loadRawImage = jest.fn();
jest.mock('../services/RawImageService', () => ({
  rawImageService: { isRawFile, loadRawImage },
}));
jest.mock('../services/ValidationService', () => ({
  ValidationService: {
    validateFilePath: () => ({ valid: true }),
    validateDimensions: () => ({ valid: true }),
  },
}));

import { imageService } from '../services/ImageService';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';

const readImageAsDataURL = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (window as unknown as { electronAPI: { readImageAsDataURL: typeof readImageAsDataURL } }).electronAPI = { readImageAsDataURL };
});

it('decodes RAW at full resolution for export and never uses the thumbnail IPC', async () => {
  isRawFile.mockReturnValue(true);
  const data = new Float32Array(200 * 100 * 4);
  loadRawImage.mockResolvedValue({
    width: 200, height: 100, data, fileName: 'p.orf', filePath: 'C:/x/p.orf', metadata: {},
  });

  const result = await imageService.loadImageForExport('C:/x/p.orf');

  // No image is currently open and nothing is persisted for this path (electronAPI.storeGet is
  // not stubbed here), so decodeForExport falls back to DEFAULT_RAW_DECODE_OPTIONS. The third arg
  // is interactive=false: an export decode must not write-through to the disk base-cache LRU.
  expect(loadRawImage).toHaveBeenCalledWith('C:/x/p.orf', DEFAULT_RAW_DECODE_OPTIONS, false);
  expect(result.width).toBe(200);
  expect(result.height).toBe(100);
  expect(result.data).toBe(data);
  expect(readImageAsDataURL).not.toHaveBeenCalled();
});
