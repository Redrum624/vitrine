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
import { StatusBar, formatStatusBarFileInfoParts } from '../components/Layout/StatusBar';
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

describe('ThumbnailPanel dock — thumb frame geometry (aspect-adaptive)', () => {
  // Tile WIDTH now follows each photo's aspect ratio (dockThumbAspect.test.ts
  // covers the mapping) so portraits/landscapes display whole — the former
  // fixed 66/114×88 spec-§3 tiles cover-cropped them. Before a thumb loads and
  // reports its aspect, every tile uses the neutral 114px fallback; selection
  // is expressed by the frame alone.
  it('pre-aspect, both thumbs use the fallback width; the current one carries the accent frame', () => {
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    const current = document.querySelector('[data-image-id="img1"]') as HTMLElement;
    const other = document.querySelector('[data-image-id="img2"]') as HTMLElement;

    expect(current).toHaveStyle({ width: '114px', height: '88px', borderColor: '#3b82f6' });
    expect(other).toHaveStyle({ width: '114px', height: '88px', borderColor: 'rgba(255, 255, 255, 0.09)' });
  });

  it('shows a gold star strip on rated thumbs and none on unrated ones', () => {
    useAppStore.setState({ imageRatings: { img1: 3 }, ratingFilter: 0 });
    render(
      <ThumbnailPanel images={images} selectedImage={images[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    const strips = document.querySelectorAll('[data-testid="dock-thumb-rating"]');
    expect(strips.length).toBe(1);
    expect(strips[0].textContent).toBe('★★★');
    expect(strips[0].closest('[data-image-id]')?.getAttribute('data-image-id')).toBe('img1');
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

describe('StatusBar footer — clean format label (Task B2, folder-scanned MIME-ish `type` bug)', () => {
  // Folder-scanned images carry a MIME-ish `type` ("image/jpeg") that used to be
  // rendered via `type.toUpperCase()` -> "IMAGE/JPEG". The footer meta must show
  // the clean, camera/photo-app-familiar format label instead ("JPG"), derived
  // from the file name's extension via getDisplayFormat rather than the raw
  // `type` string.
  it('shows "JPG" (not "IMAGE/JPEG") for a folder-scanned image whose `type` is a MIME string', () => {
    const currentImage = { id: 'img1', path: '/p/1.jpg', name: '1.jpg', width: 800, height: 600, size: 12345, type: 'image/jpeg' };
    const { meta } = formatStatusBarFileInfoParts(currentImage);
    expect(meta).toContain('JPG');
    expect(meta).not.toContain('IMAGE/JPEG');
  });

  it('renders "JPG" in the live footer for a MIME-typed current image', () => {
    const currentImage = { id: 'img1', path: '/p/1.jpg', name: '1.jpg', width: 800, height: 600, size: 12345, type: 'image/jpeg' };
    render(<StatusBar currentImage={currentImage} />);
    expect(screen.getByText(/JPG/)).toBeInTheDocument();
    expect(screen.queryByText(/IMAGE\/JPEG/)).not.toBeInTheDocument();
  });

  it('shows the clean RAW extension label ("ORF") for a RAW file, not its raw extension echo', () => {
    const currentImage = { id: 'img2', path: '/p/2.orf', name: '2.orf', width: 4000, height: 3000, size: 1, type: 'image/x-olympus-orf' };
    const { meta } = formatStatusBarFileInfoParts(currentImage);
    expect(meta).toContain('ORF');
  });
});

describe('ThumbnailPanel dock — clean format label for a raw MIME-ish `format` (round-6 P8)', () => {
  // Same producer inconsistency as the footer (Task B2) — the dock tile's title attribute
  // and no-thumbnail placeholder both used to print `image.format` verbatim. Both now route
  // through getDisplayFormat, same as the footer.
  const mimeImages = [
    { id: 'mime1', path: '/p/mime1.jpg', name: 'mime1.jpg', size: 100, format: 'image/jpeg', type: 'image/jpeg', lastModified: 0, dateModified: new Date(0) },
  ] as unknown as ImageFileInfo[];

  it('shows "JPG" (not "image/jpeg") in the dock thumbnail title attribute', () => {
    render(
      <ThumbnailPanel images={mimeImages} selectedImage={mimeImages[0]} onImageSelect={jest.fn()} onClose={jest.fn()} visible={true} />,
    );
    const thumb = document.querySelector('[data-image-id="mime1"]') as HTMLElement;
    expect(thumb).toHaveAttribute('title', 'mime1.jpg (JPG)');
    expect(thumb.getAttribute('title')).not.toContain('image/jpeg');
  });
});

describe('StatusBar footer — left group never overlaps the center cluster at narrow widths (Fix round 1)', () => {
  // A long name is exactly the unbounded-content case that used to overprint the
  // window-centered cluster at ~1280px (packaged smoke evidence, task-8-report.md
  // "Concerns"). jsdom has no real layout engine, so an exact geometry proof isn't
  // possible here — this asserts the TRUNCATION MECHANISM is wired (ellipsizing
  // span + a maxWidth budget derived from the cluster's own position), which is
  // what makes overlap structurally impossible regardless of window width. The
  // real-width geometry proof is the mandatory packaged/dev-mode smoke check
  // (see task-8-report.md, "Fix round 1").
  // This is the LAST describe block in the file, so the Gallery-mode `viewMode`
  // set by the last test below doesn't need resetting for any later test.
  const longName = 'P9190037-a-very-long-descriptive-filename-that-would-have-overprinted-the-rating-cluster.JPG';
  const currentImage = { id: 'img1', path: '/p/1.jpg', name: longName, width: 5184, height: 3888, size: 9_961_472, type: 'jpg' };

  it('gives the left group a calc()-derived maxWidth + overflow:hidden, and ellipsizes the name span first', () => {
    useAppStore.setState({ alignmentAxisX: 408 }); // a real measured Develop axis (task-8-report.md)
    render(<StatusBar currentImage={currentImage} />);

    const nameSpan = screen.getByText(longName);
    // The name (unbounded user content) gets the ellipsis treatment, can shrink
    // below its own content width (min-width: 0 — the flexbox truncation
    // prerequisite), and carries a hugely disproportionate flex-shrink factor so
    // it absorbs available shrinkage before its meta sibling does.
    expect(nameSpan).toHaveClass('truncate');
    expect(nameSpan.style.minWidth).toMatch(/^0(px)?$/);
    expect(nameSpan.style.flexShrink).toBe('9999');

    const leftGroup = nameSpan.parentElement as HTMLElement;
    // The group's width budget is derived from the cluster's own left position
    // via calc(), not a hardcoded pixel value or a live DOM measurement.
    expect(leftGroup.style.overflow).toBe('hidden');
    expect(leftGroup.style.maxWidth).toMatch(/^calc\(408px - \d+px\)$/);

    // The metadata tail (dimensions/format/size) only shrinks once the name has
    // fully collapsed (a much smaller flex-shrink factor), and ellipsizes too
    // instead of being hard-clipped by the container's overflow:hidden.
    const metaSpan = screen.getByText(/5184 × 3888/);
    expect(metaSpan).toHaveClass('truncate');
    expect(metaSpan.style.flexShrink).toBe('1');

    // The cluster itself is unmoved and still fully rendered alongside.
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
  });

  it('also bounds the right group (processing stats + memory) symmetrically', () => {
    useAppStore.setState({ alignmentAxisX: 408 });
    render(<StatusBar currentImage={currentImage} processingStats={{ processingTime: 12.3, modulesActive: 3, totalModules: 11 }} />);
    const statsSpan = screen.getByText(/modules/);
    const rightGroup = statsSpan.parentElement as HTMLElement;
    expect(rightGroup.style.overflow).toBe('hidden');
    expect(rightGroup.style.maxWidth).toMatch(/^calc\(100% - 408px - \d+px\)$/);
  });

  it('centers on 50% (not a live axis) in Gallery mode, and the left group budget follows suit', () => {
    useAppStore.setState({ alignmentAxisX: null, viewMode: 'gallery' });
    render(<StatusBar images={[]} />);
    const leftGroup = screen.getByText('No folder open').parentElement as HTMLElement;
    expect(leftGroup.style.maxWidth).toMatch(/^calc\(50% - \d+px\)$/);
  });
});
