/**
 * Unit tests for AdvancedRawModule.applyProcessing wiring.
 *
 * Verifies that the module's two apply branches (standard + professional) run
 * the real RAW services and push the returned RawImageData into the Zustand
 * store via setProcessedImageData with the ProcessedImageData shape
 * ({data,width,height,isPreview:true}) that Canvas keys its redraw off of.
 *
 * The RAW services and the store are mocked; only the apply wiring is exercised.
 */
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

// --- Mocks --------------------------------------------------------------

// Store: useAppStore(selector) must run the selector against a fake state that
// carries currentImage + the setProcessedImageData spy.
const setProcessedImageData = jest.fn();
let mockCurrentImage: { path: string } | null = { path: 'C:/in/a.orf' };

jest.mock('../stores/appStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentImage: mockCurrentImage,
      setProcessedImageData
    })
}));

// RAW service: spy on both decode paths.
const loadRawImage = jest.fn();
const processRawWithProfessionalQuality = jest.fn();
jest.mock('../services/RawImageService', () => ({
  rawImageService: {
    loadRawImage: (...args: unknown[]) => loadRawImage(...args),
    processRawWithProfessionalQuality: (...args: unknown[]) =>
      processRawWithProfessionalQuality(...args),
    getAvailableCameraProfiles: () => []
  }
}));

// AdvancedRawProcessor: only the static helpers the module reads on mount.
jest.mock('../services/AdvancedRawProcessor', () => ({
  advancedRawProcessor: {
    getSupportedFormats: jest.fn().mockResolvedValue([]),
    getCameraProfile: jest.fn().mockReturnValue(null),
    getDefaultProcessingOptions: jest.fn().mockReturnValue({})
  }
}));

// CameraMetadataService: no EXIF -> no camera card.
jest.mock('../services/CameraMetadataService', () => ({
  cameraMetadataService: {
    getCameraInfo: jest.fn().mockResolvedValue(null)
  }
}));

import { AdvancedRawModule } from '../components/Modules/AdvancedRawModule';

const sampleResult = {
  data: new Float32Array(2 * 2 * 4).fill(0.5),
  width: 2,
  height: 2,
  fileName: 'a.orf',
  filePath: 'C:/in/a.orf',
  format: 'ORF',
  metadata: {}
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentImage = { path: 'C:/in/a.orf' };
  loadRawImage.mockResolvedValue(sampleResult);
  processRawWithProfessionalQuality.mockResolvedValue(sampleResult);
});

describe('AdvancedRawModule apply wiring', () => {
  test('standard branch: loadRawImage decodes and writes ProcessedImageData', async () => {
    render(<AdvancedRawModule isEnabled={true} onToggle={() => {}} />);

    await waitFor(() => {
      expect(loadRawImage).toHaveBeenCalled();
    });

    expect(loadRawImage).toHaveBeenCalledWith('C:/in/a.orf', expect.any(Object));
    expect(processRawWithProfessionalQuality).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(setProcessedImageData).toHaveBeenCalledWith({
        data: sampleResult.data,
        width: 2,
        height: 2,
        isPreview: true
      });
    });
  });

  test('professional branch: toggling Professional Mode runs the pro pipeline and writes ProcessedImageData', async () => {
    render(<AdvancedRawModule isEnabled={true} onToggle={() => {}} />);

    // Standard branch fires first on mount.
    await waitFor(() => {
      expect(loadRawImage).toHaveBeenCalled();
    });

    // Toggle Professional Mode -> applyProcessing identity changes -> effect re-runs.
    // The label text and the toggle input live in sibling divs under a shared
    // "justify-between" row; walk up to that row, then find its checkbox.
    const proRow = screen.getByText('Professional Mode').closest('.justify-between')!;
    const proToggle = proRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(proToggle);

    await waitFor(() => {
      expect(processRawWithProfessionalQuality).toHaveBeenCalled();
    });

    expect(processRawWithProfessionalQuality).toHaveBeenCalledWith(
      'C:/in/a.orf',
      expect.objectContaining({ demosaicAlgorithm: 'VNG', bayerPattern: 'RGGB' })
    );
    expect(setProcessedImageData).toHaveBeenCalledWith({
      data: sampleResult.data,
      width: 2,
      height: 2,
      isPreview: true
    });
  });

  test('does nothing when disabled', async () => {
    render(<AdvancedRawModule isEnabled={false} onToggle={() => {}} />);
    // Give effects a tick.
    await Promise.resolve();
    expect(loadRawImage).not.toHaveBeenCalled();
    expect(processRawWithProfessionalQuality).not.toHaveBeenCalled();
    expect(setProcessedImageData).not.toHaveBeenCalled();
  });

  test('does nothing when there is no current image path', async () => {
    mockCurrentImage = null;
    render(<AdvancedRawModule isEnabled={true} onToggle={() => {}} />);
    await Promise.resolve();
    expect(loadRawImage).not.toHaveBeenCalled();
    expect(setProcessedImageData).not.toHaveBeenCalled();
  });

  test('service rejection is caught and no store write happens', async () => {
    loadRawImage.mockRejectedValue(new Error('decode failed'));
    render(<AdvancedRawModule isEnabled={true} onToggle={() => {}} />);

    await waitFor(() => {
      expect(loadRawImage).toHaveBeenCalled();
    });
    // The catch swallows the error; no ProcessedImageData is written.
    await Promise.resolve();
    expect(setProcessedImageData).not.toHaveBeenCalled();
  });
});
