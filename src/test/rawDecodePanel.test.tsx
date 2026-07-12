// src/test/rawDecodePanel.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RawDecodePanel } from '../components/Panels/RawDecodePanel';
import { useAppStore } from '../stores/appStore';
import { rawImageService } from '../services/RawImageService';
import { notificationService } from '../services/NotificationService';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';
import { imageProcessingPipeline } from '../services/ImageProcessingPipeline';
import type { ImageFileInfo } from '../services/FileSystemService';

const hrModule = () =>
  imageProcessingPipeline.getModule(
    'highlightrecovery',
  ) as unknown as { getParams: () => { strength: number }; setParams: (p: { strength: number }) => void };

jest.mock('../services/RawImageService', () => ({
  rawImageService: {
    isRawFile: jest.fn((path: string) => /\.(orf|cr2|cr3|nef|arw|dng|raf|rw2)$/i.test(path)),
    reDecode: jest.fn(async () => {}),
  },
}));

jest.mock('../services/NotificationService', () => ({
  notificationService: { error: jest.fn() },
}));

// The current image is passed as a PROP (App's live selection). The Zustand
// store's `currentImage` is never populated in this app, so gating on it made
// the panel permanently invisible (v1.13.0 bug) — these tests drive the prop.
const RAW_IMAGE: ImageFileInfo = {
  id: '1', name: 'photo.orf', path: '/photo.orf', size: 100,
  format: 'orf', type: 'image', lastModified: 0, dateModified: new Date(),
};

const JPEG_IMAGE: ImageFileInfo = {
  id: '2', name: 'photo.jpg', path: '/photo.jpg', size: 100,
  format: 'jpg', type: 'image', lastModified: 0, dateModified: new Date(),
};

describe('RawDecodePanel', () => {
  beforeEach(() => {
    useAppStore.setState({ rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS, reDecoding: false });
    (rawImageService.reDecode as jest.Mock).mockClear();
    (rawImageService.reDecode as jest.Mock).mockResolvedValue(undefined);
    (notificationService.error as jest.Mock).mockClear();
    hrModule().setParams({ strength: 0 }); // reset the shared pipeline module between tests
  });

  it('renders nothing when there is no current image', () => {
    const { container } = render(<RawDecodePanel currentImage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a non-RAW image', () => {
    const { container } = render(<RawDecodePanel currentImage={JPEG_IMAGE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed by default for a RAW image (selects not yet in the DOM)', () => {
    useAppStore.setState({ rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    expect(screen.getByText('RAW Decode')).toBeInTheDocument();
    expect(screen.queryByLabelText('Demosaic')).toBeNull();
  });

  it('renders the two selects with current values for a RAW image once expanded', () => {
    useAppStore.setState({ rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toHaveValue('dcb');
    expect(screen.getByLabelText('Highlights')).toHaveValue('blend');
  });

  it('selecting a demosaic option invokes reDecode with the expected RawDecodeOptions', () => {
    useAppStore.setState({ rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Demosaic'), { target: { value: 'ahd' } });
    expect(rawImageService.reDecode).toHaveBeenCalledWith({ demosaic: 'ahd', highlightMode: 'blend' }, RAW_IMAGE.id);
  });

  it('selecting a highlight option invokes reDecode with the expected RawDecodeOptions', () => {
    useAppStore.setState({ rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Highlights'), { target: { value: 'reconstruct' } });
    expect(rawImageService.reDecode).toHaveBeenCalledWith({ demosaic: 'dcb', highlightMode: 'reconstruct' }, RAW_IMAGE.id);
  });

  it('surfaces a notification when reDecode rejects (no unhandled rejection)', async () => {
    (rawImageService.reDecode as jest.Mock).mockRejectedValueOnce(new Error('decode boom'));
    useAppStore.setState({ rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Highlights'), { target: { value: 'reconstruct' } });
    await waitFor(() =>
      expect(notificationService.error).toHaveBeenCalledWith(
        'RAW re-decode failed',
        expect.stringMatching(/decode boom/),
      ),
    );
  });

  it('disables both controls and shows progress while reDecoding', () => {
    useAppStore.setState({ rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS, reDecoding: true });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toBeDisabled();
    expect(screen.getByLabelText('Highlights')).toBeDisabled();
    expect(screen.getByText(/re-decoding/i)).toBeInTheDocument();
  });

  it('shows the highlight recovery slider (default 0) once expanded', () => {
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    const slider = screen.getByLabelText('Highlight recovery') as HTMLInputElement;
    expect(slider).toHaveValue('0');
  });

  it('moving the highlight recovery slider updates the module strength WITHOUT a re-decode', () => {
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Highlight recovery'), { target: { value: '65' } });
    expect(hrModule().getParams().strength).toBe(65);
    // It is a POST-decode module param, so it must NOT trigger a RAW re-decode.
    expect(rawImageService.reDecode).not.toHaveBeenCalled();
  });

  it('the highlight recovery control makes clear it does NOT re-decode', () => {
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Highlight recovery')).toHaveAttribute(
      'title',
      expect.stringMatching(/does NOT re-decode/i),
    );
  });

  it('exposes a tooltip noting that changing options re-decodes the file', () => {
    useAppStore.setState({ rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS });
    render(<RawDecodePanel currentImage={RAW_IMAGE} />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toHaveAttribute('title', expect.stringMatching(/re-decode/i));
    expect(screen.getByLabelText('Highlights')).toHaveAttribute('title', expect.stringMatching(/re-decode/i));
  });
});
