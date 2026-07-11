/**
 * Contract tests for the filename-chip Info popover (Task Q6). Verifies it opens
 * with the camera + file fields, and dismisses on Escape and outside-click —
 * mirroring the Gallery/Toolbar popover idiom (not aria-modal).
 *
 * CameraMetadataService.getCameraInfo is stubbed so the test drives the popover's
 * rendering/dismissal contract, not the underlying EXIF plumbing (covered by
 * cameraMetadataService.test.ts and rawMetadata.test.ts).
 */
import { useRef } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InfoPopover } from '../components/InfoPopover';
import { cameraMetadataService, type CameraInfo } from '../services/CameraMetadataService';
import type { ImageFileInfo } from '../services/FileSystemService';

function makeImage(): ImageFileInfo {
  return {
    id: 'C:/pics/P2060833.ORF',
    name: 'P2060833.ORF',
    path: 'C:/pics/P2060833.ORF',
    size: 21_400_000,
    format: 'orf',
    type: 'image',
    lastModified: Date.now(),
    dimensions: { width: 5184, height: 3888 },
    dateModified: new Date(),
  };
}

const FULL_INFO: CameraInfo = {
  make: 'OLYMPUS CORPORATION',
  model: 'PEN-F',
  iso: 1600,
  lensModel: 'OLYMPUS M.17mm F1.8',
  shutter: '1/500 s',
  aperture: 1.8,
  focalLength: 17,
  dateTime: '2025:02:06 20:27:48',
};

/** Renders the popover beneath a real anchor element, wiring the chip-style ref. */
function Harness({ onClose, info }: { onClose: () => void; info: CameraInfo | null }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  jest.spyOn(cameraMetadataService, 'getCameraInfo').mockResolvedValue(info);
  return (
    <div>
      <div ref={anchorRef} data-testid="chip">
        P2060833.ORF
      </div>
      <InfoPopover image={makeImage()} anchorRef={anchorRef} onClose={onClose} />
      <button data-testid="outside">outside</button>
    </div>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe('InfoPopover', () => {
  test('opens and shows camera + file fields', async () => {
    render(<Harness onClose={jest.fn()} info={FULL_INFO} />);

    const panel = await screen.findByTestId('info-popover');
    expect(panel).toBeInTheDocument();

    // File name header + file facts (always present).
    expect(screen.getAllByText('P2060833.ORF').length).toBeGreaterThan(0);
    expect(screen.getByText('5184 × 3888')).toBeInTheDocument();
    expect(screen.getByText('20.4 MB')).toBeInTheDocument();

    // Camera EXIF (from the stubbed CameraInfo).
    await waitFor(() => expect(screen.getByText('OLYMPUS CORPORATION PEN-F')).toBeInTheDocument());
    expect(screen.getByText('OLYMPUS M.17mm F1.8')).toBeInTheDocument();
    expect(screen.getByText('1600')).toBeInTheDocument();
    expect(screen.getByText('1/500 s')).toBeInTheDocument();
    expect(screen.getByText('f/1.8')).toBeInTheDocument();
    expect(screen.getByText('17 mm')).toBeInTheDocument();
    expect(screen.getByText('2025-02-06 20:27')).toBeInTheDocument();
  });

  test('shows "No camera metadata" when EXIF is absent but still lists file facts', async () => {
    render(<Harness onClose={jest.fn()} info={null} />);
    await screen.findByTestId('info-popover');
    expect(screen.getByText('No camera metadata')).toBeInTheDocument();
    expect(screen.getByText('5184 × 3888')).toBeInTheDocument();
  });

  test('closes on Escape', async () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} info={FULL_INFO} />);
    await screen.findByTestId('info-popover');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('closes on an outside click', async () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} info={FULL_INFO} />);
    await screen.findByTestId('info-popover');

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does NOT close when clicking inside the panel', async () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} info={FULL_INFO} />);
    const panel = await screen.findByTestId('info-popover');

    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('does NOT close when clicking the anchor chip (its own toggle owns that)', async () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} info={FULL_INFO} />);
    await screen.findByTestId('info-popover');

    fireEvent.mouseDown(screen.getByTestId('chip'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
