// src/test/rawDecodePanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { RawDecodePanel } from '../components/Panels/RawDecodePanel';
import { useAppStore } from '../stores/appStore';
import { rawImageService } from '../services/RawImageService';
import { DEFAULT_RAW_DECODE_OPTIONS } from '../types/electron';
import type { ImageFile } from '../types';

jest.mock('../services/RawImageService', () => ({
  rawImageService: {
    isRawFile: jest.fn((path: string) => /\.(orf|cr2|cr3|nef|arw|dng|raf|rw2)$/i.test(path)),
    reDecode: jest.fn(async () => {}),
  },
}));

const RAW_IMAGE: ImageFile = {
  id: '1',
  name: 'photo.orf',
  path: '/photo.orf',
  thumbnail: '',
  metadata: { width: 4, height: 2, size: 100, format: 'orf', dateCreated: new Date() },
};

const JPEG_IMAGE: ImageFile = {
  id: '2',
  name: 'photo.jpg',
  path: '/photo.jpg',
  thumbnail: '',
  metadata: { width: 4, height: 2, size: 100, format: 'jpg', dateCreated: new Date() },
};

describe('RawDecodePanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentImage: null,
      rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS,
      reDecoding: false,
    });
    (rawImageService.reDecode as jest.Mock).mockClear();
  });

  it('renders nothing when there is no current image', () => {
    const { container } = render(<RawDecodePanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a non-RAW image', () => {
    useAppStore.setState({ currentImage: JPEG_IMAGE });
    const { container } = render(<RawDecodePanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is collapsed by default for a RAW image (selects not yet in the DOM)', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel />);
    expect(screen.getByText('RAW Decode')).toBeInTheDocument();
    expect(screen.queryByLabelText('Demosaic')).toBeNull();
  });

  it('renders the two selects with current values for a RAW image once expanded', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toHaveValue('dcb');
    expect(screen.getByLabelText('Highlights')).toHaveValue('blend');
  });

  it('selecting a demosaic option invokes reDecode with the expected RawDecodeOptions', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Demosaic'), { target: { value: 'ahd' } });
    expect(rawImageService.reDecode).toHaveBeenCalledWith({ demosaic: 'ahd', highlightMode: 'blend' });
  });

  it('selecting a highlight option invokes reDecode with the expected RawDecodeOptions', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: { demosaic: 'dcb', highlightMode: 'blend' } });
    render(<RawDecodePanel />);
    fireEvent.click(screen.getByText('RAW Decode'));
    fireEvent.change(screen.getByLabelText('Highlights'), { target: { value: 'reconstruct' } });
    expect(rawImageService.reDecode).toHaveBeenCalledWith({ demosaic: 'dcb', highlightMode: 'reconstruct' });
  });

  it('disables both controls and shows progress while reDecoding', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS, reDecoding: true });
    render(<RawDecodePanel />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toBeDisabled();
    expect(screen.getByLabelText('Highlights')).toBeDisabled();
    expect(screen.getByText(/re-decoding/i)).toBeInTheDocument();
  });

  it('exposes a tooltip noting that changing options re-decodes the file', () => {
    useAppStore.setState({ currentImage: RAW_IMAGE, rawDecodeOptions: DEFAULT_RAW_DECODE_OPTIONS });
    render(<RawDecodePanel />);
    fireEvent.click(screen.getByText('RAW Decode'));
    expect(screen.getByLabelText('Demosaic')).toHaveAttribute('title', expect.stringMatching(/re-decode/i));
    expect(screen.getByLabelText('Highlights')).toHaveAttribute('title', expect.stringMatching(/re-decode/i));
  });
});
