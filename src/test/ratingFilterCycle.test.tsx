/**
 * Task 12d — footer rating filter cycle: >=N -> =N -> off.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { StatusBar } from '../components/Layout/StatusBar';
import { ThumbnailPanel } from '../components/Panels/ThumbnailPanel';
import { GalleryView } from '../components/Gallery/GalleryView';
import { filterImagesByRating } from '../utils/gallerySelection';
import type { ImageFileInfo } from '../services/FileSystemService';

const mk = (n: number) =>
  ({ id: `img${n}`, path: `/p/${n}.jpg`, name: `${n}.jpg`, size: 100, format: 'JPG', type: 'image/jpeg', lastModified: n, dateModified: new Date(n) }) as unknown as ImageFileInfo;
const images = [mk(1), mk(2), mk(3)];
const ratings = { img1: 5, img2: 3, img3: 2 };

beforeEach(() => {
  useAppStore.setState({
    ratingFilter: 0,
    ratingFilterMode: 'min',
    imageRatings: ratings,
    selectedImageIds: [],
    selectionAnchorId: null,
    alignmentAxisX: null,
    viewMode: 'develop',
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    readImageAsDataURL: jest.fn().mockResolvedValue(null),
    readImageRating: jest.fn().mockResolvedValue(null),
    writeImageRating: jest.fn().mockResolvedValue({ ok: true }),
  };
});

const state = () => useAppStore.getState();

describe('filterImagesByRating modes', () => {
  it('min (default / legacy call) keeps >= N', () => {
    expect(filterImagesByRating(images, ratings, 3).map((i) => i.id)).toEqual(['img1', 'img2']);
    expect(filterImagesByRating(images, ratings, 3, 'min').map((i) => i.id)).toEqual(['img1', 'img2']);
  });
  it('exact keeps only rating === N', () => {
    expect(filterImagesByRating(images, ratings, 3, 'exact').map((i) => i.id)).toEqual(['img2']);
  });
  it('0 is All in either mode', () => {
    expect(filterImagesByRating(images, ratings, 0, 'exact')).toHaveLength(3);
  });
});

describe('footer chip cycle', () => {
  it('>=3 -> =3 -> off; a different chip restarts at min', () => {
    render(<StatusBar currentImage={null} />);
    fireEvent.click(screen.getByRole('tab', { name: '≥3★' }));
    expect([state().ratingFilter, state().ratingFilterMode]).toEqual([3, 'min']);

    fireEvent.click(screen.getByRole('tab', { name: '≥3★' }));
    expect([state().ratingFilter, state().ratingFilterMode]).toEqual([3, 'exact']);
    expect(screen.getByRole('tab', { name: '=3★' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '=3★' }));
    expect(state().ratingFilter).toBe(0);
    expect(state().ratingFilterMode).toBe('min');

    fireEvent.click(screen.getByRole('tab', { name: '≥3★' }));
    fireEvent.click(screen.getByRole('tab', { name: '≥3★' }));
    fireEvent.click(screen.getByRole('tab', { name: '≥2★' }));
    expect([state().ratingFilter, state().ratingFilterMode]).toEqual([2, 'min']);

    fireEvent.click(screen.getByRole('tab', { name: '≥4★' }));
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect([state().ratingFilter, state().ratingFilterMode]).toEqual([0, 'min']);
  });

  it('setRatingFilter(n) without a mode resets to min (legacy callers)', () => {
    useAppStore.setState({ ratingFilter: 3, ratingFilterMode: 'exact' });
    state().setRatingFilter(2);
    expect([state().ratingFilter, state().ratingFilterMode]).toEqual([2, 'min']);
  });
});

describe('views honour exact mode', () => {
  beforeEach(() => useAppStore.setState({ ratingFilter: 3, ratingFilterMode: 'exact' }));

  it('filmstrip shows only the exact-3 photos', () => {
    render(<ThumbnailPanel images={images} selectedImage={images[1]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />);
    expect(document.querySelector('[data-image-id="img2"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img1"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img3"]')).not.toBeInTheDocument();
  });

  it('gallery shows only the exact-3 photos', () => {
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    expect(document.querySelector('[data-image-id="img2"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img1"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img3"]')).not.toBeInTheDocument();
  });
});
