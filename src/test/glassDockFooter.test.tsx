/**
 * Glass · Sectioned — filmstrip dock + footer rating cluster (Task 6).
 *
 * Covers the store's shared `ratingFilter` (dock/footer/gallery all read the
 * same value now, replacing ThumbnailPanel's old local useState), the dock's
 * selected-vs-other thumb frame geometry, the Gallery stub chip, and the
 * footer's rating-filter segmented + current-photo star cluster (click-to-rate
 * writes through the existing xmp:Rating path).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { ThumbnailPanel } from '../components/Panels/ThumbnailPanel';
import { StatusBar } from '../components/Layout/StatusBar';
import type { ImageFileInfo } from '../services/FileSystemService';

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0) },
  { id: 'img2', path: '/p/2.jpg', name: '2.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0) },
] as unknown as ImageFileInfo[];

const resetStore = () => {
  useAppStore.setState({
    ratingFilter: 0,
    imageRatings: {},
    selectedImageIds: [],
    selectionAnchorId: null,
    alignmentAxisX: null,
  });
};

beforeEach(() => {
  resetStore();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
    writeImageRating: jest.fn().mockResolvedValue({ ok: true }),
  };
});

describe('appStore.ratingFilter (shared by dock, footer, and Task 7 gallery)', () => {
  it('defaults to 0 (All) and round-trips through the setter', () => {
    expect(useAppStore.getState().ratingFilter).toBe(0);
    useAppStore.getState().setRatingFilter(3);
    expect(useAppStore.getState().ratingFilter).toBe(3);
    useAppStore.getState().setRatingFilter(0);
    expect(useAppStore.getState().ratingFilter).toBe(0);
  });
});

describe('ThumbnailPanel dock — ratingFilter drives filteredImages', () => {
  it('hides thumbnails below the store rating filter threshold', () => {
    useAppStore.setState({ imageRatings: { img1: 5, img2: 2 }, ratingFilter: 3 });
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    expect(document.querySelector('[data-image-id="img1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img2"]')).not.toBeInTheDocument();
  });

  it('shows every thumbnail again once the filter is cleared (All)', () => {
    useAppStore.setState({ imageRatings: { img1: 5, img2: 2 }, ratingFilter: 0 });
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    expect(document.querySelector('[data-image-id="img1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img2"]')).toBeInTheDocument();
  });
});

describe('ThumbnailPanel dock — thumb frame geometry (spec §3)', () => {
  it('the current (selected) thumb is 66×88 with the accent frame; others are 114×88 with a faint border', () => {
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    const current = document.querySelector('[data-image-id="img1"]') as HTMLElement;
    const other = document.querySelector('[data-image-id="img2"]') as HTMLElement;

    expect(current).toHaveStyle({ width: '66px', height: '88px', borderColor: '#3b82f6' });
    expect(other).toHaveStyle({ width: '114px', height: '88px', borderColor: 'rgba(255, 255, 255, 0.09)' });
  });

  it('renders the Gallery chip as a dashed stub button', () => {
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    const galleryBtn = screen.getByRole('button', { name: /gallery/i });
    expect(galleryBtn).toHaveStyle({ borderStyle: 'dashed' });
  });
});

describe('StatusBar footer — rating filter segmented + current photo rating cluster', () => {
  const currentImage = { id: 'img1', path: '/p/1.jpg', name: '1.jpg', width: 800, height: 600, size: 12345, type: 'jpeg' };

  it('renders the rating-filter segmented control and the current photo\'s star rating', () => {
    render(<StatusBar currentImage={currentImage} />);
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '≥3★' })).toBeInTheDocument();
    expect(screen.getByTestId('star-1')).toHaveAttribute('data-filled', 'false');
  });

  it('clicking a rating-filter segment updates the shared store', () => {
    render(<StatusBar currentImage={currentImage} />);
    fireEvent.click(screen.getByRole('tab', { name: '≥3★' }));
    expect(useAppStore.getState().ratingFilter).toBe(3);
  });

  it('clicking a footer star rates the current photo and persists it (xmp:Rating)', () => {
    render(<StatusBar currentImage={currentImage} />);
    fireEvent.click(screen.getByTestId('star-4'));
    expect(useAppStore.getState().imageRatings['img1']).toBe(4);
    expect(window.electronAPI!.writeImageRating).toHaveBeenCalledWith('/p/1.jpg', 4);
  });
});
