/**
 * Glass · Sectioned — Gallery view (Task 7, 5a).
 *
 * Covers the shared `viewMode` store field (round-trips without losing selection),
 * the grid's tile rendering (RAW badge, scrim meta, selected check badge), the
 * shared click selection semantics (shift range / ctrl toggle / plain select+load
 * — the same `handleImageClick` the filmstrip dock uses), double-click's
 * develop-view handoff, the shared rating filter hiding non-matching tiles, and
 * the Toolbar's Develop|Gallery segmented (shown in both toolbar variants).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import { GalleryView } from '../components/Gallery/GalleryView';
import { Toolbar } from '../components/Layout/Toolbar';
import { electronService } from '../services/ElectronService';
import type { ImageFileInfo } from '../services/FileSystemService';

const images = [
  { id: 'img1', path: '/p/1.jpg', name: '1.jpg', size: 100, format: 'JPG', type: 'image/jpeg', lastModified: 3000, dateModified: new Date(3000) },
  { id: 'img2', path: '/p/2.cr3', name: '2.cr3', size: 200, format: 'CR3', type: 'image/x-canon-cr3', lastModified: 2000, dateModified: new Date(2000) },
  { id: 'img3', path: '/p/3.jpg', name: '3.jpg', size: 300, format: 'JPG', type: 'image/jpeg', lastModified: 1000, dateModified: new Date(1000) },
] as unknown as ImageFileInfo[];

const resetStore = () => {
  useAppStore.setState({
    viewMode: 'develop',
    ratingFilter: 0,
    imageRatings: {},
    selectedImageIds: [],
    selectionAnchorId: null,
    gallerySortAscending: false,
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

const getTile = (id: string) => document.querySelector(`[data-image-id="${id}"]`) as HTMLElement;
const clickTile = (id: string, init?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
  fireEvent.click(getTile(id), init);
};

describe('appStore.viewMode', () => {
  it('defaults to develop and round-trips through the setter without losing selection', () => {
    expect(useAppStore.getState().viewMode).toBe('develop');
    useAppStore.getState().setSelection(['img1', 'img2'], 'img2');

    useAppStore.getState().setViewMode('gallery');
    expect(useAppStore.getState().viewMode).toBe('gallery');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2']);

    useAppStore.getState().setViewMode('develop');
    expect(useAppStore.getState().viewMode).toBe('develop');
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2']);
  });
});

describe('GalleryView grid', () => {
  it('renders a tile per image with the RAW badge, scrim meta, and the selected check badge', () => {
    useAppStore.setState({ selectedImageIds: ['img2'], selectionAnchorId: 'img2' });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);

    expect(getTile('img1')).toBeInTheDocument();
    expect(getTile('img2')).toBeInTheDocument();
    expect(getTile('img3')).toBeInTheDocument();

    // RAW badge only on the .cr3 file.
    expect(getTile('img2')).toHaveTextContent('RAW');
    expect(getTile('img1')).not.toHaveTextContent('RAW');

    // Scrim: filename + FMT meta (no pixel dimensions for a folder-scanned file).
    expect(getTile('img1')).toHaveTextContent('1.jpg');
    expect(getTile('img1')).toHaveTextContent('JPG');

    // Selected tile shows the check badge and the data-selected attribute; others don't.
    expect(getTile('img2')).toHaveAttribute('data-selected', 'true');
    expect(getTile('img2').querySelector('[data-testid="gallery-check-badge"]')).toBeInTheDocument();
    expect(getTile('img1')).not.toHaveAttribute('data-selected');
    expect(getTile('img1').querySelector('[data-testid="gallery-check-badge"]')).not.toBeInTheDocument();
  });

  it('renders nothing while not visible', () => {
    const { container } = render(<GalleryView images={images} onImageSelect={jest.fn()} visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GalleryView selection semantics (shared with the filmstrip dock)', () => {
  it('plain click loads to canvas and single-selects', () => {
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img2');
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img2' }));
    expect(useAppStore.getState().selectedImageIds).toEqual(['img2']);
  });

  it('ctrl+click toggles membership without loading to canvas', () => {
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img1', { ctrlKey: true });
    expect(onImageSelect).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1']);
    clickTile('img3', { ctrlKey: true });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img3']);
  });

  it('shift+click selects the contiguous range from the anchor (display order)', () => {
    useAppStore.setState({ selectedImageIds: ['img1'], selectionAnchorId: 'img1' });
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    clickTile('img3', { shiftKey: true });
    expect(useAppStore.getState().selectedImageIds).toEqual(['img1', 'img2', 'img3']);
    expect(onImageSelect).not.toHaveBeenCalled();
  });
});

describe('GalleryView double-click', () => {
  it('switches viewMode to develop and loads the image (reusing the plain-click path)', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    const onImageSelect = jest.fn();
    render(<GalleryView images={images} onImageSelect={onImageSelect} visible={true} />);
    const tile = getTile('img1');
    fireEvent.click(tile);
    fireEvent.doubleClick(tile);
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'img1' }));
    expect(useAppStore.getState().viewMode).toBe('develop');
  });
});

describe('GalleryView rating filter (shared store field)', () => {
  it('hides tiles rated below the ratingFilter threshold', () => {
    useAppStore.setState({ imageRatings: { img1: 5, img2: 2, img3: 0 }, ratingFilter: 3 });
    render(<GalleryView images={images} onImageSelect={jest.fn()} visible={true} />);
    expect(document.querySelector('[data-image-id="img1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img2"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-image-id="img3"]')).not.toBeInTheDocument();
  });
});

describe('Toolbar — Develop|Gallery segmented (Gallery toolbar variant only)', () => {
  // Per the locked spec (§7's Gallery geometry table + the 4a-develop.png /
  // 5a-gallery.png reference screenshots), the segmented lives in the GALLERY
  // toolbar only — Develop's own toolbar geometry (§3) never lists one, and the
  // dock's Gallery chip already covers the Develop -> Gallery direction. See
  // task-7-report.md for why adding it to Develop too was tried and reverted
  // (it overlapped the filename chip for longer filenames).
  beforeEach(() => {
    jest.spyOn(electronService, 'isElectron').mockReturnValue(true);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render the Develop|Gallery segmented in the Develop toolbar', () => {
    render(<Toolbar hasImage zoom={1} />);
    expect(screen.queryByRole('tab', { name: 'Gallery' })).not.toBeInTheDocument();
  });

  it('switches viewMode back to develop when the Develop tab is clicked from the Gallery toolbar', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    render(<Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Develop' }));
    expect(useAppStore.getState().viewMode).toBe('develop');
  });

  it('renders the Gallery toolbar variant (Open Folder / Sort / Batch Process) in gallery mode', () => {
    useAppStore.setState({ viewMode: 'gallery' });
    render(<Toolbar hasImage zoom={1} onBatchProcess={jest.fn()} />);
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sort: capture time/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /batch process/i })).toBeInTheDocument();
  });
});
