/**
 * Unit tests for PrintModule soft-proof preview wiring.
 *
 * Verifies that clicking "Soft Proof" calls printService.generateSoftProof with
 * the image data + dimensions + settings, stores the returned proof pixels, and
 * paints them onto a <canvas> (rather than discarding the result). Also covers
 * the empty-state hint when the proof toggle is on but no proof exists yet.
 *
 * The services and the store are mocked; only the renderer wiring is exercised.
 */
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

// --- Mocks --------------------------------------------------------------

// Store: useAppStore(selector) runs the selector against a fake state carrying
// currentImage + processedImageData.
let mockProcessedImageData: Float32Array | { data: Float32Array } | null =
  new Float32Array(2 * 2 * 4).fill(0.5);
let mockCurrentImage: { metadata: { width: number; height: number } } | null = {
  metadata: { width: 2, height: 2 }
};

jest.mock('../stores/appStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentImage: mockCurrentImage,
      processedImageData: mockProcessedImageData
    })
}));

// PrintService: spy on generateSoftProof; provide the static helpers the module
// reads on mount / for selects.
const generateSoftProof = jest.fn();
jest.mock('../services/PrintService', () => ({
  printService: {
    generateSoftProof: (...args: unknown[]) => generateSoftProof(...args),
    getPaperSizes: () => [{ name: 'A4', width: 210, height: 297 }],
    getPrintLayoutsForPaper: () => [{ name: 'Full Page' }],
    getAllPrintJobs: () => [],
    createPrintJob: jest.fn(),
    deletePrintJob: jest.fn()
  }
}));

// ColorManagementService: one print profile so a profile is auto-selected.
jest.mock('../services/ColorManagementService', () => ({
  colorManagementService: {
    getPrintProfiles: () => [{ name: 'sRGB' }]
  }
}));

import { PrintModule } from '../components/Modules/PrintModule';

// A known 2x2 RGBA proof (0-1 normalised) so the paint path is exercised.
const proofResult = new Float32Array(2 * 2 * 4).fill(0.25);

// Spy on canvas paint so we can assert the proof was rendered, not discarded.
let putImageData: jest.Mock;
let createImageData: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockProcessedImageData = new Float32Array(2 * 2 * 4).fill(0.5);
  mockCurrentImage = { metadata: { width: 2, height: 2 } };
  generateSoftProof.mockResolvedValue(proofResult);

  putImageData = jest.fn();
  createImageData = jest.fn(() => ({ data: new Uint8ClampedArray(2 * 2 * 4) }));
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ createImageData, putImageData } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  (HTMLCanvasElement.prototype.getContext as unknown as jest.Mock).mockRestore?.();
});

describe('PrintModule soft-proof preview', () => {
  test('clicking Soft Proof generates the proof, stores it, and paints a canvas', async () => {
    render(<PrintModule isEnabled={true} onToggle={() => {}} />);

    // The "Soft Proof" action button.
    const button = screen.getByText('Soft Proof');
    fireEvent.click(button);

    // generateSoftProof is called once with the image data + dims + settings.
    await waitFor(() => {
      expect(generateSoftProof).toHaveBeenCalledTimes(1);
    });
    expect(generateSoftProof).toHaveBeenCalledWith(
      mockProcessedImageData,
      2,
      2,
      expect.objectContaining({ renderingIntent: 'perceptual' })
    );

    // A canvas appears and the proof was painted onto it (not discarded).
    await waitFor(() => {
      expect(putImageData).toHaveBeenCalled();
    });
    expect(createImageData).toHaveBeenCalledWith(2, 2);
    expect(document.querySelector('canvas')).not.toBeNull();
  });

  test('proof toggle on with no generated proof shows the hint and paints nothing', async () => {
    render(<PrintModule isEnabled={true} onToggle={() => {}} />);

    // Toggle the "Proof" button in the header (shows the preview block without
    // generating a proof).
    const proofToggle = screen.getByTitle('Toggle soft proof preview');
    fireEvent.click(proofToggle);

    await waitFor(() => {
      expect(screen.getByText('Click Soft Proof to generate preview')).toBeTruthy();
    });
    expect(generateSoftProof).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).toBeNull();
  });
});
