/**
 * Contract tests for PrintDialog (Task B3 — the live print UI previously had NO
 * coverage). Covers: renders via the shared GlassModal chrome (role=dialog +
 * accessible name), the Resolution SliderRow defaults to 300 DPI, the close
 * chip / Cancel button fire onClose, and Print invokes printService.printImage
 * with the dialog's current options. The service is mocked; only the
 * dialog->service wiring is verified (same pattern as batchEnqueue.test.tsx).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mock the print service singleton -----------------------------------
const getPaperSizes = jest.fn();
const printImage = jest.fn();

jest.mock('../services/PrintService', () => ({
  printService: {
    getPaperSizes: (...args: unknown[]) => getPaperSizes(...args),
    printImage: (...args: unknown[]) => printImage(...args),
  },
}));

import { PrintDialog } from '../components/Dialogs/PrintDialog';

const paperSizes = [
  { name: 'A4', width: 210, height: 297, aspectRatio: 210 / 297 },
  { name: 'Letter', width: 215.9, height: 279.4, aspectRatio: 215.9 / 279.4 },
];

const imageData = new Float32Array(4 * 4 * 4).fill(0.5);

function setup() {
  const onClose = jest.fn();
  render(
    <PrintDialog
      isOpen={true}
      onClose={onClose}
      imageData={imageData}
      imageWidth={4}
      imageHeight={4}
      fileName="sunset.jpg"
    />
  );
  return { onClose };
}

// The shared jest.setup canvas mock (src/setupTests.ts) doesn't stub every 2D
// method PrintDialog's preview effect calls (e.g. strokeRect for the margin
// guides) — override it locally with the full set needed, same pattern as
// printSoftProof.test.tsx.
let getContextSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  getPaperSizes.mockReturnValue(paperSizes);
  printImage.mockResolvedValue(undefined);

  getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    setLineDash: jest.fn(),
    drawImage: jest.fn(),
    createImageData: jest.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: jest.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  getContextSpy.mockRestore();
});

describe('PrintDialog', () => {
  it('renders via GlassModal as a dialog with an accessible name', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Print Image' })).toBeInTheDocument();
  });

  it('shows the Resolution slider defaulting to 300 DPI', () => {
    setup();
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '300 DPI' })).toBeInTheDocument();
  });

  it('fires onClose when the header close chip is clicked', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when Cancel is clicked', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes printService.printImage with the current options when Print is clicked', async () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    await waitFor(() => expect(printImage).toHaveBeenCalledTimes(1));
    expect(printImage).toHaveBeenCalledWith(
      imageData,
      4,
      4,
      expect.objectContaining({
        paperSize: 'A4',
        orientation: 'portrait',
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        resolution: 300,
        title: 'Vitrine — sunset.jpg',
        colorAdjustments: { brightness: 0, contrast: 0, saturation: 0, shadows: 0, highlights: 0 },
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
